import { db } from "@/lib/db";
import type { VideoContext } from "./types";

/**
 * Convert a raw filename into a short human-readable label.
 * Examples:
 *   "AMCREST PROHD 1080P PAN_TILT WI-FI CAMERA – SAMPLE FOOTAGE (INDOOR DAYTIME SCHOOLWORK).MP4"
 *   → "Amcrest Prohd 1080p Pan Tilt Wi-fi Camera – Sample Footage"
 *
 *   "bedroom_cam_2024-06-01.mkv" → "Bedroom Cam 2024 06 01"
 */
function makeFriendlyName(filename: string): string {
  return (
    filename
      // remove file extension
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      // replace underscores with spaces
      .replace(/_/g, " ")
      // collapse multiple spaces
      .replace(/\s{2,}/g, " ")
      .trim()
      // title-case each word
      .replace(
        /\b(\w)/g,
        (c) => c.toUpperCase(),
      )
      // trim to 50 chars
      .slice(0, 50)
      .trimEnd()
  );
}

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
    friendlyName: makeFriendlyName(job.filename),
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

You may call ONE OR MORE tools in a single response by including multiple tool_call blocks.
Tools execute in PARALLEL — use this to investigate multiple videos, time ranges, or hypotheses simultaneously.

Format (repeat as many times as needed in one response):
<tool_call>{"name":"TOOL_NAME","args":{...}}</tool_call>
<tool_call>{"name":"ANOTHER_TOOL","args":{...}}</tool_call>

Tools available:

1. get_time_window — detections in a time range
   Args: { "jobId": string, "startSec": number, "endSec": number }

2. get_threat_window — threats/warnings overlapping a range
   Args: { "jobId": string, "startSec": number, "endSec": number }

3. get_threats — full threat timeline
   Args: { "jobId": string }

4. get_time_period_assessment — combined detection + threat + face summary for a window
   Args: { "jobId": string, "startSec": number, "endSec": number }

5. get_face_roster — unique people identified in video
   Args: { "jobId": string }

6. get_frame_snapshot — visually inspect a specific frame
   Args: { "jobId": string, "timeSec": number }

7. run_video_subagent — dispatch a focused investigation subagent with full evidence access
   Run multiple subagents in the SAME response to investigate different videos or time ranges in parallel.
   Args: { "jobId": string, "task": string, "startSec"?: number, "endSec"?: number }

After ALL parallel tool_calls complete you will receive all <tool_result>s. Then either call more tools or write your final briefing.
Never stop with an empty response after receiving tool results.
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

      return `VIDEO: "${v.friendlyName}" (internal job_id for tool calls: ${v.jobId})
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
- DELEGATE: Dispatch run_video_subagent liberally — run MULTIPLE subagents in parallel by including multiple tool_call blocks in one response
- PERSIST: Take as many tool/subagent turns as needed for the best possible answer. Never settle for a shallow response.

You have ${videos.length} video(s). Key frames from each source are attached visually.

${videoContexts}

${TOOL_SCHEMA}

CRITICAL OUTPUT RULES:
- NEVER expose job_ids, raw filenames, file paths, or internal system references in your answers.
- Refer to videos ONLY by their friendly name (e.g. "the schoolwork footage", "the bedroom cam").
- Cite timestamps (e.g. "at 13s", "between 30s and 45s") — never technical IDs.
- Be thorough, precise, and intelligence-report in tone.
- After subagents or tools return, ALWAYS synthesize findings into a complete final answer.`;
}

export { parseToolCall } from "./agent-loop";
