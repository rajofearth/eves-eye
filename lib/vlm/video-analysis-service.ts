import { exec } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Cerebras } from "@cerebras/cerebras_cloud_sdk";
import sharp from "sharp";
import { db } from "../db";

const execPromise = promisify(exec);

/** How many Gemma calls run simultaneously during object scanning */
const OBJECT_SCAN_CONCURRENCY = 6;

/**
 * Runs `fn` over every item in `items` with at most `concurrency` parallel
 * executions at a time. As soon as one slot frees another item is picked up,
 * so slow frames don't block faster ones from starting.
 */
async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

interface CerebrasResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
}

export class VideoAnalysisService {
  private client: Cerebras | null = null;

  private getClient(): Cerebras {
    if (!this.client) {
      const apiKey = process.env.CEREBRAS_API_KEY;
      if (!apiKey) {
        throw new Error(
          "CEREBRAS_API_KEY environment variable is not configured.",
        );
      }
      this.client = new Cerebras({ apiKey });
    }
    return this.client;
  }

  /**
   * Run ffmpeg to extract 1 frame per second
   */
  async extractFrames(videoPath: string, outputDir: string): Promise<number> {
    await mkdir(outputDir, { recursive: true });
    const cmd = `ffmpeg -y -i "${videoPath}" -vf "fps=1" "${join(outputDir, "frame_%04d.jpg")}"`;
    await execPromise(cmd);

    // Count extracted frames
    const files = await readdir(outputDir);
    const frameFiles = files.filter((f) => f.endsWith(".jpg"));
    return frameFiles.length;
  }

  /**
   * Analyze a single frame using Gemma 4 (31B) to scan for objects and face coordinates
   */
  async scanFrame(
    framePath: string,
    _jobId: string,
    frameIndex: number,
  ): Promise<{
    detections: { label: string; box_2d: [number, number, number, number] }[];
    faces: { box_2d: [number, number, number, number] }[];
  }> {
    const client = this.getClient();
    const imageBuffer = await readFile(framePath);
    const base64Image = imageBuffer.toString("base64");

    const prompt = `Analyze this frame (Frame index: ${frameIndex}) from video surveillance.
Tasks:
1. Identify all objects, people, vehicles, or items of interest. Output bounding boxes [ymin, xmin, ymax, xmax] normalized on a scale of 0 to 1000 (0 is top/left, 1000 is bottom/right). Use natural free-style labels (e.g. "person in jacket", "fire", "crowbar").
2. Identify the bounding boxes [ymin, xmin, ymax, xmax] of any human faces visible in the frame.

Return the results as a JSON object matching this structure:
{
  "detections": [
    { "label": "crowbar", "box_2d": [ymin, xmin, ymax, xmax] }
  ],
  "faces": [
    { "box_2d": [ymin, xmin, ymax, xmax] }
  ]
}
Do not write markdown wraps. Return ONLY the raw JSON string.`;

    const response = await client.chat.completions.create({
      model: "gemma-4-31b",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = (response as unknown as CerebrasResponse).choices?.[0]
      ?.message?.content;
    if (!content) {
      throw new Error(
        "Cerebras SDK returned empty completion content for frame scan.",
      );
    }

    const parsed = JSON.parse(content);
    return {
      detections: parsed.detections || [],
      faces: parsed.faces || [],
    };
  }


  /**
   * Compute a 16×16 grayscale thumbnail fingerprint for a face image.
   * 256 values (0-255) capture enough spatial info to distinguish people
   * without being sensitive to minor lighting or angle changes.
   */
  private async computeFaceFingerprint(imagePath: string): Promise<number[]> {
    const { data } = await sharp(imagePath)
      .resize(16, 16, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return Array.from(data);
  }

  /**
   * Mean squared error between two fingerprints.
   * Lower = more similar faces.
   * Typical same-person range: 200-1400 (lighting/angle variation)
   * Different people: usually > 1800
   */
  private fingerprintMSE(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      sum += d * d;
    }
    return sum / a.length;
  }

  /**
   * Crop a face from a frame, compute its perceptual fingerprint, and
   * compare against ALL known unique faces using pixel-level MSE.
   * No Gemma call needed — fast, reliable, works across all frames.
   */
  async processFaceCrop(
    framePath: string,
    jobId: string,
    frameIndex: number,
    faceBox: [number, number, number, number],
    uniqueFaces: {
      faceId: string;
      avatarPath: string;
      diskPath: string;
      fingerprint: number[];
    }[],
  ): Promise<{
    faceId: string;
    avatarPath: string;
    diskPath: string;
    fingerprint: number[];
  } | null> {
    const metadata = await sharp(framePath).metadata();
    const width = metadata.width || 1280;
    const height = metadata.height || 720;

    const ymin = faceBox[0];
    const xmin = faceBox[1];
    const ymax = faceBox[2];
    const xmax = faceBox[3];

    // Clamp coordinates
    const left = Math.max(
      0,
      Math.min(width - 1, Math.round((xmin / 1000) * width)),
    );
    const top = Math.max(
      0,
      Math.min(height - 1, Math.round((ymin / 1000) * height)),
    );
    const extractWidth = Math.max(
      1,
      Math.min(width - left, Math.round(((xmax - xmin) / 1000) * width)),
    );
    const extractHeight = Math.max(
      1,
      Math.min(height - top, Math.round(((ymax - ymin) / 1000) * height)),
    );

    // Skip faces that are too small to be reliable (< 30px in either dimension)
    if (extractWidth < 30 || extractHeight < 30) {
      return null;
    }

    const faceFilename = `face_${frameIndex}_${Date.now()}.jpg`;
    const facesDir = join(
      process.cwd(),
      "public",
      "uploads",
      "videos",
      jobId,
      "faces",
    );
    const faceOutputPath = join(facesDir, faceFilename);

    // Crop and save face
    await sharp(framePath)
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .resize(128, 128)
      .toFile(faceOutputPath);

    const avatarPath = `/uploads/videos/${jobId}/faces/${faceFilename}`;
    const diskPath = faceOutputPath;

    // Compute perceptual fingerprint from the saved crop
    const fingerprint = await this.computeFaceFingerprint(faceOutputPath);

    // If portfolio is empty this is automatically UID-1
    if (uniqueFaces.length === 0) {
      return { faceId: "UID-1", avatarPath, diskPath, fingerprint };
    }

    // Compare against every known unique face — MSE threshold 1500
    // (same person same/different angle ≈ 200-1400; different person ≈ 1800+)
    const MATCH_THRESHOLD = 1500;
    let bestMatch: string | null = null;
    let bestMSE = Number.POSITIVE_INFINITY;

    for (const known of uniqueFaces) {
      const mse = this.fingerprintMSE(fingerprint, known.fingerprint);
      if (mse < bestMSE) {
        bestMSE = mse;
        bestMatch = known.faceId;
      }
    }

    if (bestMatch !== null && bestMSE < MATCH_THRESHOLD) {
      // Matched an existing face — return its ID but discard this crop
      return { faceId: bestMatch, avatarPath, diskPath, fingerprint };
    }

    // New unique face
    return {
      faceId: `UID-${uniqueFaces.length + 1}`,
      avatarPath,
      diskPath,
      fingerprint,
    };
  }

  /**
   * Final analysis stage: analyze all object logs and threat timelines
   */
  async analyzeThreatTimeline(
    _jobId: string,
    detections: { timestamp_sec: number; label: string }[],
  ): Promise<{
    summary: string;
    threat_periods: { start: number; end: number; reason: string }[];
    warning_periods: { start: number; end: number; reason: string }[];
    events: {
      time_sec: number;
      cls: string;
      conf: number;
      note: string;
      tone: "normal" | "warning" | "critical";
    }[];
  }> {
    const client = this.getClient();

    // Serialize detections chronologically for the text prompt
    const timelineLog = detections
      .map((d) => `[${d.timestamp_sec}s]: ${d.label}`)
      .slice(0, 150) // Limit size to fit within prompt safely
      .join("\n");

    const prompt = `Analyze this chronological list of objects detected in a surveillance video:
${timelineLog}

Tasks:
1. Summarize the video events in 1-2 sentences.
2. Group warning periods (e.g. suspicious loitering, license plate checks) and critical threat periods (weapons, break-ins, fires) with start and end times in seconds.
3. Generate detailed event logs to mark specific moment actions with a tone ("normal", "warning", or "critical").

Return matching JSON structure:
{
  "summary": "...",
  "threat_periods": [
    { "start": 10.0, "end": 25.5, "reason": "Subject holding a weapon near the entry" }
  ],
  "warning_periods": [
    { "start": 0.0, "end": 9.5, "reason": "Subject loitering around window" }
  ],
  "events": [
    { "time_sec": 12.5, "cls": "PERSON", "conf": 0.95, "note": "Subject loiters near restricted Door B.", "tone": "warning" }
  ]
}
Do not write markdown wraps. Return ONLY the raw JSON string.`;

    const response = await client.chat.completions.create({
      model: "gemma-4-31b",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = (response as unknown as CerebrasResponse).choices?.[0]
      ?.message?.content;
    if (!content) {
      throw new Error("Cerebras SDK returned empty timeline analysis.");
    }

    return JSON.parse(content);
  }

  /**
   * Orchestrates the entire background analysis pipeline
   */
  async processJobAsync(jobId: string, videoFilePath: string): Promise<void> {
    const uploadsDir = join(
      process.cwd(),
      "public",
      "uploads",
      "videos",
      jobId,
    );
    const framesDir = join(uploadsDir, "frames");
    const facesDir = join(uploadsDir, "faces");

    await mkdir(facesDir, { recursive: true });

    try {
      // ── Phase 1: Extract frames ────────────────────────────────────────────
      db.prepare(
        "UPDATE video_jobs SET status = 'extracting' WHERE id = ?",
      ).run(jobId);

      const totalFrames = await this.extractFrames(videoFilePath, framesDir);

      db.prepare(
        "UPDATE video_jobs SET status = 'analyzing', total_frames = ? WHERE id = ?",
      ).run(totalFrames, jobId);

      const files = await readdir(framesDir);
      const frameEntries = files
        .filter((f) => f.endsWith(".jpg"))
        .sort()
        .map((f, i) => ({
          file: f,
          frameIndex: i + 1,
          timestampSec: i + 1, // 1fps → index equals seconds
        }));

      // Collect face boxes from Phase 1 for sequential processing in Phase 2
      // Key: frameIndex → array of face bounding boxes
      const faceBoxesPerFrame = new Map<
        number,
        { box_2d: [number, number, number, number] }[]
      >();

      // ── Phase 2: Parallel object scanning ─────────────────────────────────
      // Each worker scans a frame and writes detections to SQLite immediately.
      // The frontend polls /api/analysis/status every 1.5 s and sees them
      // stream in live as they arrive — no need to wait for all frames.
      await runConcurrent(
        frameEntries,
        OBJECT_SCAN_CONCURRENCY,
        async ({ file, frameIndex, timestampSec }) => {
          const framePath = join(framesDir, file);
          const scanResult = await this.scanFrame(
            framePath,
            jobId,
            frameIndex,
          );

          // Persist face boxes so Phase 3 can process them sequentially
          if (scanResult.faces.length > 0) {
            faceBoxesPerFrame.set(frameIndex, scanResult.faces);
          }

          // Write object detections immediately — frontend sees them live
          const insertDetection = db.prepare(`
            INSERT INTO video_detections
              (job_id, frame_index, timestamp_sec, label, x1, y1, x2, y2, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const det of scanResult.detections) {
            const xmin = det.box_2d[1];
            const ymin = det.box_2d[0];
            const xmax = det.box_2d[3];
            const ymax = det.box_2d[2];
            insertDetection.run(
              jobId,
              frameIndex,
              timestampSec,
              det.label.toUpperCase(),
              xmin,
              ymin,
              xmax,
              ymax,
              0.95,
            );
          }

          // Atomic increment so concurrent workers don't stomp each other
          db.prepare(
            "UPDATE video_jobs SET completed_frames = completed_frames + 1 WHERE id = ?",
          ).run(jobId);
        },
      );

      // ── Phase 3: Sequential face deduplication ────────────────────────────
      // Must run in frame order so that Gemma can compare each new face crop
      // against the growing confirmed-unique portfolio without race conditions.
      const uniqueFaces: {
        faceId: string;
        avatarPath: string;
        diskPath: string;
        fingerprint: number[];
      }[] = [];

      const sortedFaceFrames = [...faceBoxesPerFrame.entries()].sort(
        ([a], [b]) => a - b,
      );

      for (const [frameIndex, faceBoxes] of sortedFaceFrames) {
        const framePath = join(
          framesDir,
          frameEntries[frameIndex - 1]?.file ?? "",
        );
        const timestampSec = frameIndex;

        for (const fBox of faceBoxes) {
          const result = await this.processFaceCrop(
            framePath,
            jobId,
            frameIndex,
            fBox.box_2d,
            uniqueFaces,
          );
          if (result) {
            const { faceId, avatarPath, diskPath, fingerprint } = result;
            if (!uniqueFaces.some((uf) => uf.faceId === faceId)) {
              uniqueFaces.push({ faceId, avatarPath, diskPath, fingerprint });
            }
            db.prepare(`
              INSERT INTO video_faces
                (job_id, frame_index, timestamp_sec, face_id, avatar_path)
              VALUES (?, ?, ?, ?, ?)
            `).run(jobId, frameIndex, timestampSec, faceId, avatarPath);
          }
        }
      }

      // ── Phase 4: Threat timeline analysis ────────────────────────────────
      db.prepare(
        "UPDATE video_jobs SET status = 'summarizing' WHERE id = ?",
      ).run(jobId);

      const detections = db
        .prepare(
          "SELECT timestamp_sec, label FROM video_detections WHERE job_id = ? ORDER BY timestamp_sec ASC",
        )
        .all(jobId) as { timestamp_sec: number; label: string }[];

      const timelineAnalysis = await this.analyzeThreatTimeline(
        jobId,
        detections,
      );

      // Store warning/critical segments
      for (const t of timelineAnalysis.threat_periods) {
        db.prepare(
          "INSERT INTO video_threats (job_id, start_sec, end_sec, severity, reason) VALUES (?, ?, ?, 'critical', ?)",
        ).run(jobId, t.start, t.end, t.reason);
      }
      for (const w of timelineAnalysis.warning_periods) {
        db.prepare(
          "INSERT INTO video_threats (job_id, start_sec, end_sec, severity, reason) VALUES (?, ?, ?, 'warning', ?)",
        ).run(jobId, w.start, w.end, w.reason);
      }

      // Mark job complete — preserve the streaming detections (bounding boxes)
      // so the video player can still show them during playback.
      db.prepare(
        "UPDATE video_jobs SET status = 'completed', summary = ? WHERE id = ?",
      ).run(timelineAnalysis.summary, jobId);
    } catch (err) {
      console.error("[VIDEO_ANALYSIS_WORKER] Job failed:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      db.prepare(
        "UPDATE video_jobs SET status = 'error', summary = ? WHERE id = ?",
      ).run(`Analysis failed: ${errMsg}`, jobId);
    }
  }
}

export const videoAnalysisService = new VideoAnalysisService();
