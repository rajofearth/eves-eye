import { db } from "@/lib/db";
import {
  buildSystemPrompt,
  loadVideoContexts,
  parseToolCall,
} from "@/lib/chat/video-context";
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

        const systemPrompt = buildSystemPrompt(videos);

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

        const toolLog: { call: ToolCall; result: string }[] = [];
        let assistantFullText = "";

        for (let iteration = 0; iteration < 6; iteration++) {
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
            const cleanText = raw
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
              .trim();
            assistantFullText = cleanText;

            const chunkSize = 6;
            for (let i = 0; i < cleanText.length; i += chunkSize) {
              sse(controller, {
                type: "text",
                delta: cleanText.slice(i, i + chunkSize),
              });
              await new Promise((r) => setTimeout(r, 0));
            }
            break;
          }

          sse(controller, { type: "tool_call", call: toolCall });

          const toolResult = await executeTool(toolCall);
          toolLog.push({ call: toolCall, result: toolResult.text });

          sse(controller, {
            type: "tool_result",
            call: toolCall,
            result: toolResult.text,
            imageBase64: toolResult.imageBase64,
            mimeType: toolResult.mimeType,
          });

          messages.push({ role: "assistant", content: raw });

          if (toolResult.imageBase64) {
            messages.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text: `<tool_result>${toolResult.text}</tool_result>`,
                },
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
