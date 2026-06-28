import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface DBJobRow {
  id: string;
  filename: string;
  status: string;
  total_frames: number;
  completed_frames: number;
  summary: string | null;
  created_at: string;
}

interface DBDetectionRow {
  id: number;
  frame_index: number;
  timestamp_sec: number;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

interface DBFaceRow {
  id: number;
  frame_index: number;
  timestamp_sec: number;
  face_id: string;
  avatar_path: string;
}

interface DBThreatRow {
  id: number;
  start_sec: number;
  end_sec: number;
  severity: string;
  reason: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        { ok: false, error: "Missing jobId query parameter" },
        { status: 400 },
      );
    }

    // Query job status
    const job = db
      .prepare("SELECT * FROM video_jobs WHERE id = ?")
      .get(jobId) as DBJobRow | undefined;

    if (!job) {
      return NextResponse.json(
        { ok: false, error: "Analysis job not found" },
        { status: 404 },
      );
    }

    // Query detections, faces, and threats
    const detections = db
      .prepare(
        "SELECT * FROM video_detections WHERE job_id = ? ORDER BY timestamp_sec ASC",
      )
      .all(jobId) as DBDetectionRow[];

    const faces = db
      .prepare(
        "SELECT * FROM video_faces WHERE job_id = ? ORDER BY timestamp_sec ASC",
      )
      .all(jobId) as DBFaceRow[];

    const threats = db
      .prepare(
        "SELECT * FROM video_threats WHERE job_id = ? ORDER BY start_sec ASC",
      )
      .all(jobId) as DBThreatRow[];

    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        filename: job.filename,
        status: job.status,
        totalFrames: job.total_frames,
        completedFrames: job.completed_frames,
        summary: job.summary,
        createdAt: job.created_at,
      },
      detections: detections.map((d) => ({
        id: d.id,
        frameIndex: d.frame_index,
        timestampSec: d.timestamp_sec,
        label: d.label,
        x1: d.x1,
        y1: d.y1,
        x2: d.x2,
        y2: d.y2,
        confidence: d.confidence,
      })),
      faces: faces.map((f) => ({
        id: f.id,
        frameIndex: f.frame_index,
        timestampSec: f.timestamp_sec,
        faceId: f.face_id,
        avatarPath: f.avatar_path,
      })),
      threats: threats.map((t) => ({
        id: t.id,
        startSec: t.start_sec,
        endSec: t.end_sec,
        severity: t.severity,
        reason: t.reason,
      })),
    });
  } catch (err) {
    console.error("[VIDEO_STATUS_API] Error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: errMsg || "Failed to retrieve analysis status" },
      { status: 500 },
    );
  }
}
