import { exec } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { db } from "../db";
import { PIPELINE, runConcurrent } from "./concurrency";
import { persistFrameDetections, scanFrame, type FrameEntry } from "./frame-scanner";
import { runIntelligenceReport } from "./intelligence-report";
import { runPeopleIdentification } from "./people-in-video";

const execPromise = promisify(exec);

export class VideoAnalysisService {
  async extractFrames(videoPath: string, outputDir: string): Promise<number> {
    await mkdir(outputDir, { recursive: true });
    const cmd = `ffmpeg -y -i "${videoPath}" -vf "fps=1" "${join(outputDir, "frame_%04d.jpg")}"`;
    await execPromise(cmd);
    const files = await readdir(outputDir);
    return files.filter((f) => f.endsWith(".jpg")).length;
  }

  async processJobAsync(jobId: string, videoFilePath: string): Promise<void> {
    const uploadsDir = join(process.cwd(), "public", "uploads", "videos", jobId);
    const framesDir = join(uploadsDir, "frames");
    await mkdir(join(uploadsDir, "faces"), { recursive: true });

    try {
      db.prepare("UPDATE video_jobs SET status = 'extracting' WHERE id = ?").run(jobId);

      const totalFrames = await this.extractFrames(videoFilePath, framesDir);

      db.prepare(
        "UPDATE video_jobs SET status = 'analyzing', total_frames = ?, completed_frames = 0 WHERE id = ?",
      ).run(totalFrames, jobId);

      const files = await readdir(framesDir);
      const frameEntries: FrameEntry[] = files
        .filter((f) => f.endsWith(".jpg"))
        .sort()
        .map((f, i) => ({
          file: f,
          frameIndex: i + 1,
          timestampSec: i + 1,
        }));

      // ── Parallel pipeline: frame scan + intel report + people ID ──
      const frameScanTask = runConcurrent(
        frameEntries,
        PIPELINE.FRAME_SCAN_CONCURRENCY,
        async ({ file, frameIndex, timestampSec }) => {
          const framePath = join(framesDir, file);
          const result = await scanFrame(framePath, frameIndex);
          persistFrameDetections(jobId, frameIndex, timestampSec, result.detections);
        },
      );

      const intelTask = runIntelligenceReport(jobId, framesDir, frameEntries);
      const peopleTask = runPeopleIdentification(jobId, framesDir, frameEntries);

      await Promise.all([frameScanTask, intelTask, peopleTask]);

      db.prepare("UPDATE video_jobs SET status = 'completed' WHERE id = ?").run(jobId);
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
