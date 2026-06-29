import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { jobId } = await req.json();

    if (!jobId) {
      return NextResponse.json(
        { ok: false, error: "Missing jobId in request body" },
        { status: 400 },
      );
    }

    // 1. Delete records from SQLite database
    db.prepare("DELETE FROM video_jobs WHERE id = ?").run(jobId);
    db.prepare("DELETE FROM video_detections WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM video_faces WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM video_threats WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM video_events WHERE job_id = ?").run(jobId);

    // 2. Delete public/uploads/videos/{jobId} directory from disk
    const uploadsDir = join(
      process.cwd(),
      "public",
      "uploads",
      "videos",
      jobId,
    );
    try {
      await rm(uploadsDir, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[VIDEO_CLEAR_API] Error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: errMsg || "Failed to clear video job cache" },
      { status: 500 },
    );
  }
}
