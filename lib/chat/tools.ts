import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import type { ToolCall, ToolResult } from "./types";
import { runVideoSubagent } from "./subagent";

function execGetTimeWindow(args: Record<string, unknown>): string {
  const { jobId, startSec, endSec } = args as {
    jobId: string;
    startSec: number;
    endSec: number;
  };
  const rows = db
    .prepare(
      `SELECT timestamp_sec, label, x1, y1, x2, y2, confidence
       FROM video_detections
       WHERE job_id = ? AND timestamp_sec >= ? AND timestamp_sec <= ?
       ORDER BY timestamp_sec ASC`,
    )
    .all(jobId, startSec, endSec) as {
    timestamp_sec: number;
    label: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence: number;
  }[];

  if (rows.length === 0) {
    return `No detections found in ${startSec}s–${endSec}s for job ${jobId}.`;
  }

  const lines = rows.map(
    (r) =>
      `[${r.timestamp_sec}s] ${r.label} (conf: ${Math.round(r.confidence * 100)}%, box: ${r.x1.toFixed(0)},${r.y1.toFixed(0)} → ${r.x2.toFixed(0)},${r.y2.toFixed(0)})`,
  );
  return `${rows.length} detections in ${startSec}s–${endSec}s:\n${lines.join("\n")}`;
}

function execGetThreatWindow(args: Record<string, unknown>): string {
  const { jobId, startSec, endSec } = args as {
    jobId: string;
    startSec: number;
    endSec: number;
  };
  const rows = db
    .prepare(
      `SELECT start_sec, end_sec, severity, reason FROM video_threats
       WHERE job_id = ? AND end_sec >= ? AND start_sec <= ?
       ORDER BY start_sec ASC`,
    )
    .all(jobId, startSec, endSec) as {
    start_sec: number;
    end_sec: number;
    severity: string;
    reason: string;
  }[];

  if (rows.length === 0) {
    return `No threats or warnings overlap ${startSec}s–${endSec}s for job ${jobId}.`;
  }

  return rows
    .map(
      (r) =>
        `[${r.start_sec}s–${r.end_sec}s] ${r.severity.toUpperCase()}: ${r.reason}`,
    )
    .join("\n");
}

function execGetThreats(args: Record<string, unknown>): string {
  const { jobId } = args as { jobId: string };
  const rows = db
    .prepare(
      "SELECT start_sec, end_sec, severity, reason FROM video_threats WHERE job_id = ? ORDER BY start_sec ASC",
    )
    .all(jobId) as {
    start_sec: number;
    end_sec: number;
    severity: string;
    reason: string;
  }[];

  if (rows.length === 0) return `No threats recorded for job ${jobId}.`;

  return rows
    .map(
      (r) =>
        `[${r.start_sec}s–${r.end_sec}s] ${r.severity.toUpperCase()}: ${r.reason}`,
    )
    .join("\n");
}

function execGetFaceRoster(args: Record<string, unknown>): string {
  const { jobId } = args as { jobId: string };
  const rows = db
    .prepare(
      `SELECT DISTINCT face_id, MIN(timestamp_sec) as first_seen, COUNT(*) as appearances
       FROM video_faces WHERE job_id = ?
       GROUP BY face_id ORDER BY first_seen ASC`,
    )
    .all(jobId) as {
    face_id: string;
    first_seen: number;
    appearances: number;
  }[];

  if (rows.length === 0) return `No people identified in job ${jobId}.`;

  return rows
    .map(
      (r) =>
        `${r.face_id}: first seen at ${r.first_seen}s, ${r.appearances} frame(s)`,
    )
    .join("\n");
}

function execGetTimePeriodAssessment(args: Record<string, unknown>): string {
  const { jobId, startSec, endSec } = args as {
    jobId: string;
    startSec: number;
    endSec: number;
  };

  const job = db
    .prepare("SELECT filename FROM video_jobs WHERE id = ?")
    .get(jobId) as { filename: string } | undefined;

  const threats = execGetThreatWindow({ jobId, startSec, endSec });
  const detections = execGetTimeWindow({ jobId, startSec, endSec });

  const facesInWindow = db
    .prepare(
      `SELECT DISTINCT face_id, MIN(timestamp_sec) as first_in_window, COUNT(*) as appearances
       FROM video_faces
       WHERE job_id = ? AND timestamp_sec >= ? AND timestamp_sec <= ?
       GROUP BY face_id ORDER BY first_in_window ASC`,
    )
    .all(jobId, startSec, endSec) as {
    face_id: string;
    first_in_window: number;
    appearances: number;
  }[];

  const faceLines =
    facesInWindow.length === 0
      ? "No faces in window."
      : facesInWindow
          .map(
            (f) =>
              `${f.face_id}: first at ${f.first_in_window}s, ${f.appearances} appearances`,
          )
          .join("\n");

  return `TIME PERIOD ASSESSMENT: "${job?.filename ?? jobId}" [${startSec}s–${endSec}s]

=== THREATS / WARNINGS ===
${threats}

=== DETECTIONS ===
${detections}

=== FACES IN WINDOW ===
${faceLines}`;
}

async function execGetFrameSnapshot(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { jobId, timeSec } = args as { jobId: string; timeSec: number };

  const framesDir = join(
    process.cwd(),
    "public",
    "uploads",
    "videos",
    jobId,
    "frames",
  );

  const targetFrame = Math.max(1, Math.round(timeSec));
  const paddedIndex = String(targetFrame).padStart(4, "0");
  const framePath = join(framesDir, `frame_${paddedIndex}.jpg`);

  try {
    const buffer = await readFile(framePath);
    const base64 = buffer.toString("base64");
    return {
      text: `Frame at ${timeSec}s (frame_${paddedIndex}.jpg) — image attached below.`,
      imageBase64: base64,
      mimeType: "image/jpeg",
    };
  } catch {
    return {
      text: `Frame at ${timeSec}s not available (frames may have been cleaned up).`,
    };
  }
}

export async function executeTool(tool: ToolCall): Promise<ToolResult> {
  switch (tool.name) {
    case "get_time_window":
      return { text: execGetTimeWindow(tool.args) };
    case "get_threat_window":
      return { text: execGetThreatWindow(tool.args) };
    case "get_threats":
      return { text: execGetThreats(tool.args) };
    case "get_time_period_assessment":
      return { text: execGetTimePeriodAssessment(tool.args) };
    case "get_face_roster":
      return { text: execGetFaceRoster(tool.args) };
    case "get_frame_snapshot":
      return execGetFrameSnapshot(tool.args);
    case "run_video_subagent":
      return runVideoSubagent(tool.args);
    default:
      return { text: `Unknown tool: ${tool.name}` };
  }
}

export const TOOL_LABELS: Record<string, string> = {
  get_time_window: "TIME WINDOW SCAN",
  get_threat_window: "THREAT WINDOW",
  get_threats: "THREAT TIMELINE",
  get_time_period_assessment: "PERIOD ASSESSMENT",
  get_face_roster: "PEOPLE ROSTER",
  get_frame_snapshot: "FRAME SNAPSHOT",
  run_video_subagent: "VIDEO SUBAGENT",
};
