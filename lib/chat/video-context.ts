import { db } from "@/lib/db";
import type { VideoContext } from "./types";

export function loadVideoContext(jobId: string): VideoContext | null {
  const job = db
    .prepare("SELECT filename, status, summary FROM video_jobs WHERE id = ?")
    .get(jobId) as
    | { filename: string; status: string; summary: string | null }
    | undefined;

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
    summary: job.summary ?? "",
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

Call ONE tool per turn using this exact format (no markdown):

<tool_call>{"name":"TOOL_NAME","args":{...}}</tool_call>

Tools:

1. get_time_window — detections in a time range
   Args: { "jobId": string, "startSec": number, "endSec": number }

2. get_threat_window — threats/warnings overlapping a range
   Args: { "jobId": string, "startSec": number, "endSec": number }

3. get_threats — full threat timeline
   Args: { "jobId": string }

4. get_time_period_assessment — full assessment of a window
   Args: { "jobId": string, "startSec": number, "endSec": number }

5. get_face_roster — unique people identified in video
   Args: { "jobId": string }

6. get_frame_snapshot — inspect a specific frame
   Args: { "jobId": string, "timeSec": number }

7. run_video_subagent — dispatch focused investigation subagent
   Use liberally for complex questions. Run multiple subagents on different videos or time ranges.
   Args: { "jobId": string, "task": string, "startSec"?: number, "endSec"?: number }

After a tool_call you receive <tool_result>. You MUST then either call another tool OR write your final briefing.
Never stop with an empty response after a tool/subagent result.
When fully done, output your complete final intelligence briefing with NO tool_call tags.
Never use markdown code blocks.
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
Summary: ${v.summary || "Pending"}

CRITICAL THREATS (${critical.length}):
${critical.map(formatThreat).join("\n") || "  • None"}

WARNINGS (${warnings.length}):
${warnings.map(formatThreat).join("\n") || "  • None"}`;
    })
    .join("\n\n---\n\n");

  return `You are EVE'S EYE Lead Intelligence Analyst — an expert surveillance investigator.

YOUR ROLE:
- ANALYSE: Deeply examine all video evidence attached to this conversation
- SEARCH: Use tools to inspect any time period, frame, or threat window
- EXPLORE: Cross-reference multiple videos; follow leads wherever they go
- DELEGATE: Dispatch run_video_subagent liberally — use multiple subagents on different videos, time ranges, or hypotheses in parallel across turns
- PERSIST: Take as many tool/subagent turns as needed for the best possible answer. Never settle for a shallow response.

You have ${videos.length} video(s). Key frames from each source video are attached visually — treat them as direct footage access alongside the full video files on disk.

${videoContexts}

${TOOL_SCHEMA}

Cite videos by filename. Be thorough, precise, and intelligence-report in tone.
After subagents or tools return, always synthesize findings into a final answer — never leave the analyst with only raw tool output.`;
}

export { parseToolCall } from "./agent-loop";
