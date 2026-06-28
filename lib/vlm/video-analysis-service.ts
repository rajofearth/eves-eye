import { exec } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Cerebras } from "@cerebras/cerebras_cloud_sdk";
import sharp from "sharp";
import { db } from "../db";

const execPromise = promisify(exec);

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
   * Crop face from a frame image and use Gemma to agentically match it against existing unique faces
   */
  async processFaceCrop(
    framePath: string,
    jobId: string,
    frameIndex: number,
    faceBox: [number, number, number, number],
    uniqueFaces: { faceId: string; path: string }[],
  ): Promise<string | null> {
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
      10,
      Math.min(width - left, Math.round(((xmax - xmin) / 1000) * width)),
    );
    const extractHeight = Math.max(
      10,
      Math.min(height - top, Math.round(((ymax - ymin) / 1000) * height)),
    );

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

    // Crop face
    await sharp(framePath)
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .resize(128, 128)
      .toFile(faceOutputPath);

    const _avatarUrl = `/uploads/videos/${jobId}/faces/${faceFilename}`;

    // If there are no unique faces in portfolio, this is automatically Face #1 (UID-1)
    if (uniqueFaces.length === 0) {
      return "UID-1";
    }

    // Call Gemma to match the face crop against the portfolio
    // For simplicity, we load the base64 of the new crop and up to 3 unique faces to run comparison
    const client = this.getClient();
    const newCropBuffer = await readFile(faceOutputPath);
    const newCropBase64 = newCropBuffer.toString("base64");

    const previousFacesContent = [];
    for (let i = 0; i < Math.min(uniqueFaces.length, 3); i++) {
      const uFace = uniqueFaces[i];
      const uBuffer = await readFile(join(process.cwd(), "public", uFace.path));
      previousFacesContent.push({
        type: "text" as const,
        text: `Previous Face ${uFace.faceId}:`,
      });
      previousFacesContent.push({
        type: "image_url" as const,
        image_url: {
          url: `data:image/jpeg;base64,${uBuffer.toString("base64")}`,
        },
      });
    }

    const prompt = `Compare the new face image (New Face) against the list of previously identified unique faces.
Is New Face a match to any of the previous faces, or is it a completely new person?
Return matching JSON structure:
{
  "match": "UID-X" | null,
  "isUnique": true | false
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
              type: "text",
              text: "New Face to compare:",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${newCropBase64}`,
              },
            },
            ...previousFacesContent,
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = (response as unknown as CerebrasResponse).choices?.[0]
      ?.message?.content;
    if (!content) {
      return `UID-${uniqueFaces.length + 1}`;
    }

    try {
      const matchResult = JSON.parse(content);
      if (matchResult.match) {
        return matchResult.match;
      }
      return `UID-${uniqueFaces.length + 1}`;
    } catch {
      return `UID-${uniqueFaces.length + 1}`;
    }
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
      // 1. Extract frames
      db.prepare(
        "UPDATE video_jobs SET status = 'extracting' WHERE id = ?",
      ).run(jobId);
      const totalFrames = await this.extractFrames(videoFilePath, framesDir);

      db.prepare(
        "UPDATE video_jobs SET status = 'analyzing', total_frames = ? WHERE id = ?",
      ).run(totalFrames, jobId);

      const files = await readdir(framesDir);
      const frameFiles = files.filter((f) => f.endsWith(".jpg")).sort();

      const uniqueFaces: { faceId: string; path: string }[] = [];

      // 2. Loop and scan each frame
      for (let i = 0; i < frameFiles.length; i++) {
        const frameFile = frameFiles[i];
        const framePath = join(framesDir, frameFile);
        const frameIndex = i + 1;
        const timestampSec = frameIndex; // 1 frame per second -> timestamp matches index

        // Scan frame for objects and faces
        const scanResult = await this.scanFrame(framePath, jobId, frameIndex);

        // Log detections to SQLite
        for (const det of scanResult.detections) {
          const xmin = det.box_2d[1];
          const ymin = det.box_2d[0];
          const xmax = det.box_2d[3];
          const ymax = det.box_2d[2];

          db.prepare(`
            INSERT INTO video_detections (job_id, frame_index, timestamp_sec, label, x1, y1, x2, y2, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
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

        // Process face detections
        for (const fBox of scanResult.faces) {
          const faceId = await this.processFaceCrop(
            framePath,
            jobId,
            frameIndex,
            fBox.box_2d,
            uniqueFaces,
          );
          if (faceId) {
            const faceFilename = `face_${frameIndex}_${Date.now()}.jpg`;
            const path = `/uploads/videos/${jobId}/faces/${faceFilename}`;

            // Check if this faceId is already in our unique list
            if (!uniqueFaces.some((uf) => uf.faceId === faceId)) {
              uniqueFaces.push({ faceId, path });
            }

            db.prepare(`
              INSERT INTO video_faces (job_id, frame_index, timestamp_sec, face_id, avatar_path)
              VALUES (?, ?, ?, ?, ?)
            `).run(jobId, frameIndex, timestampSec, faceId, path);
          }
        }

        // Update progress counter
        db.prepare(
          "UPDATE video_jobs SET completed_frames = ? WHERE id = ?",
        ).run(i + 1, jobId);
      }

      // 3. Final Timeline Threat Analysis
      db.prepare(
        "UPDATE video_jobs SET status = 'summarizing' WHERE id = ?",
      ).run(jobId);

      const detections = db
        .prepare(
          "SELECT timestamp_sec, label FROM video_detections WHERE job_id = ?",
        )
        .all(jobId) as { timestamp_sec: number; label: string }[];

      const timelineAnalysis = await this.analyzeThreatTimeline(
        jobId,
        detections,
      );

      // Store threats segments
      for (const t of timelineAnalysis.threat_periods) {
        db.prepare(`
          INSERT INTO video_threats (job_id, start_sec, end_sec, severity, reason)
          VALUES (?, ?, ?, 'critical', ?)
        `).run(jobId, t.start, t.end, t.reason);
      }

      for (const w of timelineAnalysis.warning_periods) {
        db.prepare(`
          INSERT INTO video_threats (job_id, start_sec, end_sec, severity, reason)
          VALUES (?, ?, ?, 'warning', ?)
        `).run(jobId, w.start, w.end, w.reason);
      }

      // Rewrite event logs in detections if generated by Gemma
      if (timelineAnalysis.events && timelineAnalysis.events.length > 0) {
        // Clear automatic detections log and insert structured threat logs
        db.prepare("DELETE FROM video_detections WHERE job_id = ?").run(jobId);
        for (const ev of timelineAnalysis.events) {
          db.prepare(`
            INSERT INTO video_detections (job_id, frame_index, timestamp_sec, label, x1, y1, x2, y2, confidence)
            VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)
          `).run(jobId, Math.floor(ev.time_sec), ev.time_sec, ev.cls, ev.conf);
        }
      }

      // Set job status completed
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
