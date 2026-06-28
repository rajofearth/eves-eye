import { db } from "@/lib/db";
import { Cerebras } from "@cerebras/cerebras_cloud_sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface CerebrasResponse {
  choices?: { message?: { content?: string } }[];
}

interface VideoContext {
  jobId: string;
  filename: string;
  durationSec: number;
  summary: string;
  threats: { startSec: number; endSec: number; severity: string; reason: string }[];
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

// ── Tool Definitions ────────────────────────────────────────────────────────

const TOOL_SCHEMA = `
## AVAILABLE TOOLS

When you need more detail you MAY call ONE tool per response turn by outputting this exact block (no markdown wrapping):

<tool_call>{"name":"TOOL_NAME","args":{...}}</tool_call>

Available tools:

1. get_time_window
   Gets all object detections in a specific time range.
   Args: { "jobId": string, "startSec": number, "endSec": number }

2. get_threats
   Gets full threat and warning timeline for a video.
   Args: { "jobId": string }

3. get_face_roster
   Gets all unique faces detected in a video.
   Args: { "jobId": string }

4. get_frame_snapshot
   Visually inspects the actual video frame at a specific moment.
   Use when asked about visual details at a specific time.
   Args: { "jobId": string, "timeSec": number }

After your tool_call block I will send back a <tool_result> block. Then continue your analysis.
Only call tools when you genuinely need more detail than the context provides.
Never output markdown code blocks. Be concise, factual, and surveillance-analyst in tone.
`;

// ── Tool Executors ───────────────────────────────────────────────────────────

function execGetTimeWindow(args: Record<string, unknown>): string {
  const { jobId, startSec, endSec } = args as {
    jobId: string;
    startSec: number;
    endSec: number;
  };
  const rows = db
    .prepare(
      `SELECT frame_index, timestamp_sec, label, x1, y1, x2, y2, confidence
       FROM video_detections
       WHERE job_id = ? AND timestamp_sec >= ? AND timestamp_sec <= ?
       ORDER BY timestamp_sec ASC`,
    )
    .all(jobId, startSec, endSec) as {
    frame_index: number;
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
      `SELECT DISTINCT face_id, MIN(timestamp_sec) as first_seen, COUNT(*) as appearances, avatar_path
       FROM video_faces WHERE job_id = ?
       GROUP BY face_id ORDER BY first_seen ASC`,
    )
    .all(jobId) as {
    face_id: string;
    first_seen: number;
    appearances: number;
    avatar_path: string;
  }[];

  if (rows.length === 0) return `No faces detected in job ${jobId}.`;

  return rows
    .map(
      (r) =>
        `${r.face_id}: first seen at ${r.first_seen}s, appeared in ${r.appearances} frames`,
    )
    .join("\n");
}

async function execGetFrameSnapshot(
  args: Record<string, unknown>,
): Promise<{ text: string; imageBase64?: string; mimeType?: string }> {
  const { jobId, timeSec } = args as { jobId: string; timeSec: number };

  // Find the closest frame file
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

// ── Tool Dispatcher ──────────────────────────────────────────────────────────

async function executeTool(
  tool: ToolCall,
): Promise<{ text: string; imageBase64?: string; mimeType?: string }> {
  switch (tool.name) {
    case "get_time_window":
      return { text: execGetTimeWindow(tool.args) };
    case "get_threats":
      return { text: execGetThreats(tool.args) };
    case "get_face_roster":
      return { text: execGetFaceRoster(tool.args) };
    case "get_frame_snapshot":
      return execGetFrameSnapshot(tool.args);
    default:
      return { text: `Unknown tool: ${tool.name}` };
  }
}

// ── Context Builder ──────────────────────────────────────────────────────────

function buildSystemPrompt(videos: VideoContext[]): string {
  const videoContexts = videos
    .map((v) => {
      const threatLines = v.threats
        .map(
          (t) =>
            `  • [${t.startSec}s–${t.endSec}s] ${t.severity.toUpperCase()}: ${t.reason}`,
        )
        .join("\n");

      return `VIDEO: "${v.filename}" (job_id: ${v.jobId})
Duration: ${v.durationSec}s
Summary: ${v.summary || "No summary available."}
Timeline threats/warnings:
${threatLines || "  • No threats or warnings recorded."}`;
    })
    .join("\n\n---\n\n");

  return `You are EVE'S EYE Intel Analyst — a sharp, precise AI surveillance analyst embedded in the EVE'S EYE system.
You have been given intelligence data from ${videos.length} analysed video(s).

${videoContexts}

${TOOL_SCHEMA}

Always cite which video you're referring to by filename.
Respond in the terse, factual tone of a security intelligence report.`;
}

// ── Parse tool_call from model output ───────────────────────────────────────

function parseToolCall(text: string): ToolCall | null {
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

// ── SSE helpers ──────────────────────────────────────────────────────────────

function sse(ctrl: ReadableStreamDefaultController, data: unknown) {
  ctrl.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
  );
}

// ── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId: string;
    message: string;
    videoJobIds: string[];
  };

  const { sessionId, message, videoJobIds } = body;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. Load context for each tagged video
        const videos: VideoContext[] = videoJobIds.map((jobId) => {
          const job = db
            .prepare("SELECT filename, summary FROM video_jobs WHERE id = ?")
            .get(jobId) as
            | { filename: string; summary: string | null }
            | undefined;

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
            filename: job?.filename || jobId,
            durationSec: duration?.dur || 0,
            summary: job?.summary || "",
            threats: threats.map((t) => ({
              startSec: t.start_sec,
              endSec: t.end_sec,
              severity: t.severity,
              reason: t.reason,
            })),
          };
        });

        // 2. Load existing message history
        const history = db
          .prepare(
            "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
          )
          .all(sessionId) as { role: string; content: string }[];

        // 3. Save user message
        db.prepare(
          "INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
        ).run(sessionId, message, new Date().toISOString());

        const client = new Cerebras({
          apiKey: process.env.CEREBRAS_API_KEY,
        });

        const systemPrompt = buildSystemPrompt(videos);

        // Build full message list for Gemma
        type GemmaMessage = {
          role: "system" | "user" | "assistant";
          content:
            | string
            | { type: string; text?: string; image_url?: { url: string } }[];
        };

        const messages: GemmaMessage[] = [
          { role: "system", content: systemPrompt },
          ...history.map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content,
          })),
          { role: "user", content: message },
        ];

        // 4. Agentic tool loop (max 5 iterations)
        const toolLog: { call: ToolCall; result: string }[] = [];
        let assistantFullText = "";

        for (let iteration = 0; iteration < 5; iteration++) {
          const response = await client.chat.completions.create({
            model: "gemma-4-31b",
            messages: messages as Parameters<
              typeof client.chat.completions.create
            >[0]["messages"],
          });

          const raw =
            (response as unknown as CerebrasResponse).choices?.[0]?.message
              ?.content ?? "";

          const toolCall = parseToolCall(raw);

          if (!toolCall) {
            // No more tool calls — stream the final answer
            const cleanText = raw
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
              .trim();
            assistantFullText = cleanText;

            // Stream token by token (simulated chunking for UX)
            const chunkSize = 6;
            for (let i = 0; i < cleanText.length; i += chunkSize) {
              sse(controller, {
                type: "text",
                delta: cleanText.slice(i, i + chunkSize),
              });
              // Small yield to allow SSE flush
              await new Promise((r) => setTimeout(r, 0));
            }
            break;
          }

          // Tool call found — stream tool_call event
          sse(controller, { type: "tool_call", call: toolCall });

          // Execute tool
          const toolResult = await executeTool(toolCall);
          toolLog.push({ call: toolCall, result: toolResult.text });

          // Stream tool_result event (with optional image for frame snapshots)
          sse(controller, {
            type: "tool_result",
            call: toolCall,
            result: toolResult.text,
            imageBase64: toolResult.imageBase64,
            mimeType: toolResult.mimeType,
          });

          // Append the assistant message + tool result to message history
          messages.push({ role: "assistant", content: raw });

          // Feed tool result back as user message
          if (toolResult.imageBase64) {
            messages.push({
              role: "user",
              content: [
                { type: "text", text: `<tool_result>${toolResult.text}</tool_result>` },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${toolResult.mimeType};base64,${toolResult.imageBase64}`,
                  },
                },
              ],
            });
          } else {
            messages.push({
              role: "user",
              content: `<tool_result>${toolResult.text}</tool_result>`,
            });
          }
        }

        // 5. Save full assistant response to DB
        const toolCallsJson =
          toolLog.length > 0 ? JSON.stringify(toolLog) : null;
        db.prepare(
          "INSERT INTO chat_messages (session_id, role, content, tool_calls, created_at) VALUES (?, 'assistant', ?, ?, ?)",
        ).run(
          sessionId,
          assistantFullText,
          toolCallsJson,
          new Date().toISOString(),
        );

        // Auto-update session title from first message if still default
        const sess = db
          .prepare("SELECT title FROM chat_sessions WHERE id = ?")
          .get(sessionId) as { title: string } | undefined;
        if (sess?.title === "New Intel Session") {
          const autoTitle = message.slice(0, 48) + (message.length > 48 ? "…" : "");
          db.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(
            autoTitle,
            sessionId,
          );
        }

        sse(controller, { type: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sse(controller, { type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
