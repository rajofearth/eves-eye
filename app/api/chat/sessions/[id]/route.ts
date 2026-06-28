import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const session = db
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(id) as
      | {
          id: string;
          title: string;
          video_job_ids: string;
          created_at: string;
        }
      | undefined;

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 },
      );
    }

    const messages = db
      .prepare(
        "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
      )
      .all(id) as {
      id: number;
      session_id: string;
      role: string;
      content: string;
      tool_calls: string | null;
      created_at: string;
    }[];

    return NextResponse.json({
      ok: true,
      session: {
        ...session,
        videoJobIds: JSON.parse(session.video_job_ids || "[]") as string[],
      },
      messages: messages.map((m) => ({
        ...m,
        toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      title?: string;
      videoJobIds?: string[];
    };

    if (body.title !== undefined) {
      db.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(
        body.title,
        id,
      );
    }
    if (body.videoJobIds !== undefined) {
      db.prepare("UPDATE chat_sessions SET video_job_ids = ? WHERE id = ?").run(
        JSON.stringify(body.videoJobIds),
        id,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
