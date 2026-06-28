import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // All completed video jobs with threat/warning counts
    const jobs = db
      .prepare(
        `SELECT vj.id, vj.filename, vj.status, vj.total_frames, vj.summary, vj.created_at,
          (SELECT COUNT(*) FROM video_threats WHERE job_id = vj.id AND severity = 'critical') as threat_count,
          (SELECT COUNT(*) FROM video_threats WHERE job_id = vj.id AND severity = 'warning') as warning_count,
          (SELECT MAX(timestamp_sec) FROM video_detections WHERE job_id = vj.id) as duration_sec,
          (SELECT avatar_path FROM video_faces WHERE job_id = vj.id LIMIT 1) as thumbnail_face
        FROM video_jobs vj
        WHERE vj.status = 'completed'
        ORDER BY vj.created_at DESC`,
      )
      .all() as {
      id: string;
      filename: string;
      status: string;
      total_frames: number;
      summary: string | null;
      created_at: string;
      threat_count: number;
      warning_count: number;
      duration_sec: number | null;
      thumbnail_face: string | null;
    }[];

    return NextResponse.json({ ok: true, videos: jobs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
