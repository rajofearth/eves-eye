import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = db
      .prepare(
        "SELECT id, title, video_job_ids, created_at FROM chat_sessions ORDER BY created_at DESC",
      )
      .all() as {
      id: string;
      title: string;
      video_job_ids: string;
      created_at: string;
    }[];

    return NextResponse.json({
      ok: true,
      sessions: sessions.map((s) => ({
        ...s,
        videoJobIds: JSON.parse(s.video_job_ids || "[]") as string[],
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: string;
      videoJobIds?: string[];
    };
    const id = `sess_${randomBytes(4).toString("hex").toUpperCase()}`;
    const title = body.title || "New Intel Session";
    const videoJobIds = JSON.stringify(body.videoJobIds || []);
    const createdAt = new Date().toISOString();

    db.prepare(
      "INSERT INTO chat_sessions (id, title, video_job_ids, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, title, videoJobIds, createdAt);

    return NextResponse.json({ ok: true, sessionId: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
