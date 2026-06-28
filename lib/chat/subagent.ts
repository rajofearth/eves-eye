import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Cerebras } from "@cerebras/cerebras_cloud_sdk";
import { db } from "@/lib/db";
import { MAX_IMAGES_PER_REQUEST } from "@/lib/vlm/cerebras-client";
import { loadVideoContext } from "./video-context";
import type { ToolResult } from "./types";

interface CerebrasResponse {
  choices?: { message?: { content?: string } }[];
}

async function loadFrameBase64(
  jobId: string,
  timeSec: number,
): Promise<{ base64: string; label: string } | null> {
  const targetFrame = Math.max(1, Math.round(timeSec));
  const paddedIndex = String(targetFrame).padStart(4, "0");
  const framePath = join(
    process.cwd(),
    "public",
    "uploads",
    "videos",
    jobId,
    "frames",
    `frame_${paddedIndex}.jpg`,
  );

  try {
    const buffer = await readFile(framePath);
    return {
      base64: buffer.toString("base64"),
      label: `${timeSec}s (frame_${paddedIndex}.jpg)`,
    };
  } catch {
    return null;
  }
}

function pickSnapshotTimes(
  startSec: number,
  endSec: number,
  threatStarts: number[],
): number[] {
  const times = new Set<number>();
  times.add(startSec);
  times.add(Math.round((startSec + endSec) / 2));
  times.add(endSec);

  for (const t of threatStarts) {
    if (t >= startSec && t <= endSec) {
      times.add(Math.round(t));
    }
  }

  return [...times].sort((a, b) => a - b).slice(0, MAX_IMAGES_PER_REQUEST);
}

export async function runVideoSubagent(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { jobId, task, startSec, endSec } = args as {
    jobId: string;
    task: string;
    startSec?: number;
    endSec?: number;
  };

  const ctx = loadVideoContext(jobId);
  if (!ctx) {
    return { text: `Subagent failed: video job ${jobId} not found.` };
  }

  if (ctx.status !== "completed") {
    return {
      text: `Subagent cannot run: "${ctx.filename}" is still ${ctx.status}. Wait for analysis to complete.`,
    };
  }

  const windowStart = startSec ?? 0;
  const windowEnd = endSec ?? ctx.durationSec;

  const threatsInScope = ctx.threats.filter(
    (t) => t.endSec >= windowStart && t.startSec <= windowEnd,
  );

  const detections = db
    .prepare(
      `SELECT timestamp_sec, label, confidence FROM video_detections
       WHERE job_id = ? AND timestamp_sec >= ? AND timestamp_sec <= ?
       ORDER BY timestamp_sec ASC LIMIT 80`,
    )
    .all(jobId, windowStart, windowEnd) as {
    timestamp_sec: number;
    label: string;
    confidence: number;
  }[];

  const faces = db
    .prepare(
      `SELECT DISTINCT face_id, MIN(timestamp_sec) as first_seen, COUNT(*) as appearances
       FROM video_faces
       WHERE job_id = ? AND timestamp_sec >= ? AND timestamp_sec <= ?
       GROUP BY face_id`,
    )
    .all(jobId, windowStart, windowEnd) as {
    face_id: string;
    first_seen: number;
    appearances: number;
  }[];

  const threatLines = threatsInScope
    .map(
      (t) =>
        `[${t.startSec}s–${t.endSec}s] ${t.severity.toUpperCase()}: ${t.reason}`,
    )
    .join("\n");

  const detectionLines = detections
    .map(
      (d) =>
        `[${d.timestamp_sec}s] ${d.label} (${Math.round(d.confidence * 100)}%)`,
    )
    .join("\n");

  const faceLines = faces
    .map(
      (f) =>
        `${f.face_id}: first ${f.first_seen}s, ${f.appearances} appearances`,
    )
    .join("\n");

  const snapshotTimes = pickSnapshotTimes(
    windowStart,
    windowEnd,
    threatsInScope.map((t) => t.startSec),
  );

  const frames: { label: string; base64: string }[] = [];
  for (const t of snapshotTimes) {
    const frame = await loadFrameBase64(jobId, t);
    if (frame) frames.push(frame);
  }

  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    return { text: "Subagent failed: CEREBRAS_API_KEY not configured." };
  }

  const client = new Cerebras({ apiKey });

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

  const evidenceBlock = `VIDEO: "${ctx.filename}" (job_id: ${ctx.jobId})
Source: ${ctx.videoUrl}
Investigation window: ${windowStart}s–${windowEnd}s
Duration: ${ctx.durationSec}s

TASK: ${task}

THREATS / WARNINGS IN SCOPE:
${threatLines || "None"}

DETECTIONS IN SCOPE (${detections.length}):
${detectionLines || "None"}

FACES IN SCOPE:
${faceLines || "None"}

${frames.length} frame snapshots attached for visual verification.`;

  const userContent: ContentPart[] = [
    { type: "text", text: evidenceBlock },
    ...frames.map((f) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/jpeg;base64,${f.base64}`,
      },
    })),
  ];

  try {
    const response = await client.chat.completions.create({
      model: "gemma-4-31b",
      messages: [
        {
          role: "system",
          content: `You are a focused video investigation subagent for EVE'S EYE surveillance analysis.
Your job is to complete the assigned task using ONLY the evidence provided.
Be thorough but concise. Structure findings as:
FINDINGS: (bullet points)
ASSESSMENT: (1-2 sentences)
CONFIDENCE: HIGH | MEDIUM | LOW
Do not speculate beyond the evidence. Cite timestamps.`,
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const report =
      (response as unknown as CerebrasResponse).choices?.[0]?.message
        ?.content ?? "Subagent returned no output.";

    return {
      text: `SUBAGENT REPORT — "${ctx.filename}" [${windowStart}s–${windowEnd}s]\nTask: ${task}\n\n${report}`,
      imageBase64: frames[0]?.base64,
      mimeType: frames.length > 0 ? "image/jpeg" : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Subagent error: ${msg}` };
  }
}
