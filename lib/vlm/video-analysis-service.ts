import { exec } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { db } from "../db";
import { PIPELINE, runBatchedConcurrent, runConcurrent } from "./concurrency";
import { persistFrameDetections, scanFramesBatch, type FrameEntry } from "./frame-scanner";
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

      // Run frame scan, intelligence report, and people face identification fully in parallel (overlapped latency)
      const intelTask = runIntelligenceReport(jobId, framesDir, frameEntries);
      const peopleTask = runPeopleIdentification(jobId, framesDir, frameEntries);

      const frameScanTask = runBatchedConcurrent(
        frameEntries,
        5, // Batch size of 5 (Cerebras image limit)
        PIPELINE.FRAME_SCAN_CONCURRENCY,
        async (batch) => {
          const result = await scanFramesBatch(batch, framesDir);

          for (const f of batch) {
            // Find detections matching this frame's index (supports absolute and 1-based relative)
            const frameDetections = result.detections.filter((d) => {
              if (d.frame_index === f.frameIndex) return true;
              const relativeIndex = batch.findIndex((b) => b.frameIndex === f.frameIndex) + 1;
              return d.frame_index === relativeIndex;
            });

            const mappedDetections = frameDetections.map((d) => ({
              label: d.label,
              box_2d: d.box_2d,
            }));

            persistFrameDetections(jobId, f.frameIndex, f.timestampSec, mappedDetections);
          }
        },
      );

      await Promise.all([intelTask, frameScanTask, peopleTask]);

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
