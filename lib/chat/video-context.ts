import { db } from "@/lib/db";
import type { VideoContext } from "./types";

export function loadVideoContext(jobId: string): VideoContext | null {
  const job = db
    .prepare("SELECT filename, status FROM video_jobs WHERE id = ?")
    .get(jobId) as { filename: string; status: string } | undefined;

  if (!job) return null;

  const threats = db
    .prepare(
      "SELECT start_sec, end_sec, severity, reason FROM video_threats WHERE job_id = ? ORDER BY start_sec ASC",
    )
    .all(jobId) as {
    start_sec: number;
    end_sec: number;
    severity: string;
    reason: string;
  }[];

  const duration = db
    .prepare(
      "SELECT MAX(timestamp_sec) as dur FROM video_detections WHERE job_id = ?",
    )
    .get(jobId) as { dur: number | null } | undefined;

  return {
    jobId,
    filename: job.filename,
    status: job.status,
    durationSec: duration?.dur ?? 0,
    videoUrl: `/uploads/videos/${jobId}/video.mp4`,
    threats: threats.map((t) => ({
      startSec: t.start_sec,
      endSec: t.end_sec,
      severity: t.severity,
      reason: t.reason,
    })),
  };
}

export function loadVideoContexts(jobIds: string[]): VideoContext[] {
  return jobIds
    .map(loadVideoContext)
    .filter((v): v is VideoContext => v !== null);
}

export const TOOL_SCHEMA = `
## AVAILABLE TOOLS

When you need more detail you MAY call ONE tool per response turn by outputting this exact block (no markdown wrapping):

<tool_call>{"name":"TOOL_NAME","args":{...}}</tool_call>

Available tools:

1. get_time_window
   Gets all object detections in a specific time range for deep inspection.
   Args: { "jobId": string, "startSec": number, "endSec": number }

2. get_threat_window
   Gets threat/warning timeline entries overlapping a time range.
   Args: { "jobId": string, "startSec": number, "endSec": number }

3. get_threats
   Gets the full threat and warning timeline for a video.
   Args: { "jobId": string }

4. get_time_period_assessment
   Comprehensive assessment of a time window: overlapping threats, detections, and face roster.
   Use for thorough situational analysis of a specific period.
   Args: { "jobId": string, "startSec": number, "endSec": number }

5. get_face_roster
   Gets all unique faces detected in a video.
   Args: { "jobId": string }

6. get_frame_snapshot
   Visually inspects the actual video frame at a specific moment.
   Args: { "jobId": string, "timeSec": number }

7. run_video_subagent
   Dispatches a focused investigation subagent on a pre-analysed video.
   The subagent receives the full threat timeline, detections in scope, and frame snapshots.
   Use for complex multi-step analysis tasks on a single video (e.g. "trace person X through the scene",
   "correlate all critical events", "build incident timeline for 2:00–3:30").
   Args: { "jobId": string, "task": string, "startSec"?: number, "endSec"?: number }

After your tool_call block I will send back a <tool_result> block. Then continue your analysis.
Only call tools when you genuinely need more detail than the context provides.
Never output markdown code blocks. Be concise, factual, and surveillance-analyst in tone.
`;

export function buildSystemPrompt(videos: VideoContext[]): string {
  const videoContexts = videos
    .map((v) => {
      const critical = v.threats.filter((t) => t.severity === "critical");
      const warnings = v.threats.filter((t) => t.severity === "warning");

      const formatThreat = (t: (typeof v.threats)[0]) =>
        `  • [${t.startSec}s–${t.endSec}s] ${t.severity.toUpperCase()}: ${t.reason}`;

      return `VIDEO: "${v.filename}" (job_id: ${v.jobId})
Source file: ${v.videoUrl}
Duration: ${v.durationSec}s
Status: ${v.status}

CRITICAL THREATS (${critical.length}):
${critical.map(formatThreat).join("\n") || "  • None recorded"}

WARNINGS (${warnings.length}):
${warnings.map(formatThreat).join("\n") || "  • None recorded"}`;
    })
    .join("\n\n---\n\n");

  return `You are EVE'S EYE Intel Analyst — a sharp, precise AI surveillance analyst embedded in the EVE'S EYE system.
You have intelligence from ${videos.length} analysed video(s). Each video source file is stored locally and accessible via tools.

Your initial context includes ONLY the threat and warning timeline for each video — not raw detections or summaries.
Use tools to drill into specific time periods, inspect frames visually, or dispatch subagents for deep investigation.

${videoContexts}

${TOOL_SCHEMA}

Always cite which video you're referring to by filename.
When comparing multiple videos, cross-reference timestamps and threat patterns explicitly.
Respond in the terse, factual tone of a security intelligence report.`;
}

export function parseToolCall(text: string): import("./types").ToolCall | null {
  const match = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as {
      name: string;
      args: Record<string, unknown>;
    };
    if (parsed.name && parsed.args) return parsed;
    return null;
  } catch {
    return null;
  }
}
