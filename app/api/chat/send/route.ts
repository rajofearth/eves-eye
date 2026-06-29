import { db } from "@/lib/db";
import {
  appendParallelToolExchanges,
  buildEmptyResponseNudge,
  buildForcedSynthesisPrompt,
  isSubstantiveFinal,
  MAX_AGENT_ITERATIONS,
  parseToolCalls,
  pruneMessagesImageBudget,
  stripToolCalls,
  type AgentMessage,
} from "@/lib/chat/agent-loop";
import {
  buildSystemPrompt,
  loadVideoContexts,
} from "@/lib/chat/video-context";
import {
  buildVideoAttachments,
  chunkVisionParts,
} from "@/lib/chat/video-attachment";
import { executeTool } from "@/lib/chat/tools";
import type { ToolCall } from "@/lib/chat/types";
import { Cerebras } from "@cerebras/cerebras_cloud_sdk";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface CerebrasResponse {
  choices?: { message?: { content?: string } }[];
}

function sse(ctrl: ReadableStreamDefaultController, data: unknown) {
  ctrl.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
  );
}

async function callGemma(
  client: Cerebras,
  messages: AgentMessage[],
): Promise<string> {
  try {
    const pruned = pruneMessagesImageBudget(messages, 5);
    const response = await client.chat.completions.create({
      model: "gemma-4-31b",
      messages: pruned as Parameters<
        typeof client.chat.completions.create
      >[0]["messages"],
    });
    return (
      (response as unknown as CerebrasResponse).choices?.[0]?.message
        ?.content ?? ""
    );
  } catch (err) {
    // Cerebras throws if it receives an empty assistant message in history
    // or if the model returns empty output. Return empty string so the
    // loop's nudge / forced-synthesis path can recover cleanly.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[callGemma] API error:", msg);
    return "";
  }
}

async function streamFinalText(
  controller: ReadableStreamDefaultController,
  text: string,
): Promise<void> {
  const chunkSize = 6;
  for (let i = 0; i < text.length; i += chunkSize) {
    sse(controller, { type: "text", delta: text.slice(i, i + chunkSize) });
    await new Promise((r) => setTimeout(r, 0));
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId: string;
    message: string;
    videoJobIds: string[];
  };

  const { sessionId, message, videoJobIds } = body;

  const incomplete = videoJobIds.filter((id) => {
    const job = db
      .prepare("SELECT status FROM video_jobs WHERE id = ?")
      .get(id) as { status: string } | undefined;
    return !job || job.status !== "completed";
  });

  if (incomplete.length > 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Videos still analysing: ${incomplete.join(", ")}. Wait for completion before chatting.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const videos = loadVideoContexts(videoJobIds);
        const videoAttachmentParts = await buildVideoAttachments(videos);
        const attachmentChunks = chunkVisionParts(videoAttachmentParts);

        const history = db
          .prepare(
            "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
          )
          .all(sessionId) as { role: string; content: string }[];

        db.prepare(
          "INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
        ).run(sessionId, message, new Date().toISOString());

        const client = new Cerebras({
          apiKey: process.env.CEREBRAS_API_KEY,
        });

        const evidenceMessages: AgentMessage[] = [];
        for (let i = 0; i < attachmentChunks.length; i++) {
          const chunk = attachmentChunks[i]!;
          const isLast = i === attachmentChunks.length - 1;
          evidenceMessages.push({
            role: "user",
            content: [
              ...chunk,
              {
                type: "text",
                text: isLast
                  ? "Above are key visual frames from tagged videos. Use tools and subagents for deeper investigation."
                  : `Video evidence batch ${i + 1}/${attachmentChunks.length}. More frames follow.`,
              },
            ],
          });
          evidenceMessages.push({
            role: "assistant",
            content: isLast
              ? "All video evidence received. I will analyse, search, and deploy subagents as needed."
              : `Batch ${i + 1} received. Standing by for remaining frames.`,
          });
        }

        const messages: AgentMessage[] = [
          { role: "system", content: buildSystemPrompt(videos) },
          ...evidenceMessages,
          ...history.map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content,
          })),
          { role: "user", content: message },
        ];

        const toolLog: { call: ToolCall; result: string }[] = [];
        let assistantFullText = "";

        for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
          const raw = await callGemma(client, messages);
          const toolCalls = parseToolCalls(raw);

          if (toolCalls.length > 0) {
            // Stream all tool_call events immediately so the UI shows them
            for (const tc of toolCalls) {
              sse(controller, { type: "tool_call", call: tc });
            }

            // Execute ALL tools in parallel
            const toolResults = await Promise.all(
              toolCalls.map((tc) => executeTool(tc)),
            );

            // Stream all results and accumulate log
            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i]!;
              const res = toolResults[i]!;
              toolLog.push({ call: tc, result: res.text });
              sse(controller, {
                type: "tool_result",
                call: tc,
                result: res.text,
                imageBase64: res.imageBase64,
                mimeType: res.mimeType,
              });
            }

            // Inject assistant turn + combined results user turn
            appendParallelToolExchanges(messages, raw, toolCalls, toolResults);
            continue;
          }

          const cleanText = stripToolCalls(raw);

          // Empty or too-short response after tools — nudge and continue loop
          if (
            toolLog.length > 0 &&
            !isSubstantiveFinal(cleanText) &&
            iteration < MAX_AGENT_ITERATIONS - 1
          ) {
            messages.push({
              role: "assistant",
              content: raw || "(no output)",
            });
            messages.push({
              role: "user",
              content: buildEmptyResponseNudge(),
            });
            continue;
          }

          // Final answer
          assistantFullText = cleanText;
          if (assistantFullText) {
            await streamFinalText(controller, assistantFullText);
          }
          break;
        }

        // Ran tools but never got a final briefing — force synthesis pass
        if (!assistantFullText && toolLog.length > 0) {
          messages.push({
            role: "user",
            content: buildForcedSynthesisPrompt(),
          });
          const synthesis = stripToolCalls(await callGemma(client, messages));
          assistantFullText = synthesis || toolLog.at(-1)?.result || "";
          if (assistantFullText) {
            await streamFinalText(controller, assistantFullText);
          }
        }

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

        const sess = db
          .prepare("SELECT title FROM chat_sessions WHERE id = ?")
          .get(sessionId) as { title: string } | undefined;
        if (sess?.title === "New Intel Session") {
          const autoTitle =
            message.slice(0, 48) + (message.length > 48 ? "…" : "");
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
