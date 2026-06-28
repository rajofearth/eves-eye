import { NextResponse } from "next/server";
import { threatDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const rows = threatDb.getThreatHistory(100);
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
