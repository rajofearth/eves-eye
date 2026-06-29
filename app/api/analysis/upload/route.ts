import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoAnalysisService } from "@/lib/vlm/video-analysis-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const isFresh = formData.get("fresh") === "true";

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No file payload provided" },
        { status: 400 },
      );
    }

    const filename = file.name.toUpperCase();

    // Cache Check: If not a fresh run, search for a completed analysis job with matching filename
    if (!isFresh) {
      const cachedJob = db
        .prepare(
          "SELECT id FROM video_jobs WHERE filename = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
        )
        .get(filename) as { id: string } | undefined;

      if (cachedJob) {
        try {
          const cachedVideoPath = join(
            process.cwd(),
            "public",
            "uploads",
            "videos",
            cachedJob.id,
            "video.mp4",
          );
          await access(cachedVideoPath);

          // Return the cached jobId and complete status immediately
          return NextResponse.json({
            ok: true,
            jobId: cachedJob.id,
            status: "completed",
            filename,
          });
        } catch {
          // Video file on disk was cleared/missing; proceed with new analysis
        }
      }
    }

    const jobId = `job_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    const uploadsDir = join(
      process.cwd(),
      "public",
      "uploads",
      "videos",
      jobId,
    );
    await mkdir(uploadsDir, { recursive: true });

    const videoFilePath = join(uploadsDir, "video.mp4");
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(videoFilePath, Buffer.from(arrayBuffer));

    // Initialize job in SQLite
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO video_jobs (id, filename, status, total_frames, completed_frames, created_at)
      VALUES (?, ?, 'pending', 0, 0, ?)
    `).run(jobId, filename, createdAt);

    // Trigger analysis asynchronously in the background
    void videoAnalysisService.processJobAsync(jobId, videoFilePath);

    return NextResponse.json({
      ok: true,
      jobId,
      status: "pending",
      filename: file.name.toUpperCase(),
    });
  } catch (err) {
    console.error("[VIDEO_UPLOAD_API] Error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: errMsg || "Failed to process video upload payload",
      },
      { status: 500 },
    );
  }
}
