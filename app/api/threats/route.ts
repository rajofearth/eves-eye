import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const rows = db
      .prepare("SELECT * FROM threats ORDER BY timestamp DESC LIMIT 100")
      .all();
    return NextResponse.json({ ok: true, threats: rows });
  } catch (error) {
    console.error("[API_THREATS] Failed to fetch threats from SQLite:", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Database fetch failed",
      },
      { status: 500 },
    );
  }
}
