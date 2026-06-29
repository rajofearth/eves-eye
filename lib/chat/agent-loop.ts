import type { ToolCall, ToolResult } from "./types";

export const MAX_AGENT_ITERATIONS = 15;

// Single tool_call block (kept for backward compat)
const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/i;
// Global version for parsing multiple calls
const TOOL_CALL_RE_G = /<tool_call>([\s\S]*?)<\/tool_call>/gi;

/** Parse the FIRST tool_call block (legacy helper) */
export function parseToolCall(text: string): ToolCall | null {
  const match = text.match(TOOL_CALL_RE);
  if (!match) return null;

  const inner = match[1].trim();
  try {
    const parsed = JSON.parse(inner) as {
      name: string;
      args: Record<string, unknown>;
    };
    if (parsed.name && parsed.args) return parsed;
  } catch {
    // Try extracting JSON object from noisy model output
    const jsonMatch = inner.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          name: string;
          args: Record<string, unknown>;
        };
        if (parsed.name && parsed.args) return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Parse ALL tool_call blocks from a response (parallel execution). */
export function parseToolCalls(text: string): ToolCall[] {
  const results: ToolCall[] = [];
  for (const match of text.matchAll(TOOL_CALL_RE_G)) {
    const inner = match[1].trim();
    try {
      const parsed = JSON.parse(inner) as { name: string; args: Record<string, unknown> };
      if (parsed.name && parsed.args) results.push(parsed);
    } catch {
      const jsonMatch = inner.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { name: string; args: Record<string, unknown> };
          if (parsed.name && parsed.args) results.push(parsed);
        } catch { /* skip */ }
      }
    }
  }
  return results;
}

export function stripToolCalls(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
}

export function buildToolResultFollowUp(
  toolResult: ToolResult,
  toolName: string,
): string {
  const base = `<tool_result>${toolResult.text}</tool_result>`;

  if (toolName === "run_video_subagent") {
    return `${base}

Subagent investigation complete. You MUST immediately do ONE of:
1. Call another tool or subagent if more investigation is needed — use <tool_call>{"name":"...","args":{...}}</tool_call>
2. Write your COMPLETE final intelligence briefing synthesizing ALL findings above — no tool_call tags.

Do NOT output an empty response. The analyst is waiting.`;
  }

  return `${base}

Tool complete. You MUST immediately do ONE of:
1. Call another tool if more data is needed — use <tool_call>{"name":"...","args":{...}}</tool_call>
2. Write your complete final intelligence briefing now — no tool_call tags.

Do NOT output an empty response.`;
}

export function buildEmptyResponseNudge(): string {
  return `Your last response was empty. Review the tool/subagent results above and either call another tool with <tool_call>...</tool_call> or write your final intelligence briefing now.`;
}

export function buildForcedSynthesisPrompt(): string {
  return `Investigation phase complete. Synthesize ALL tool and subagent results gathered in this session into one final, thorough intelligence briefing for the analyst. Do not use tool_call tags. Address the analyst's original question directly.`;
}

export function isSubstantiveFinal(text: string): boolean {
  const stripped = stripToolCalls(text);
  return stripped.length >= 24;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

/**
 * Append one tool exchange (single call) to the message history.
 * Keeps the raw assistant output and injects the result as a user turn.
 */
export function appendToolExchange(
  messages: AgentMessage[],
  assistantRaw: string,
  toolResult: ToolResult,
  toolName: string,
): void {
  // Cerebras rejects assistant messages with empty content — use the raw
  // output if available, otherwise a minimal placeholder so the history
  // stays valid for the next API call.
  const safeAssistantContent = assistantRaw.trim() || `<tool_call>{"name":"${toolName}","args":{}}</tool_call>`;
  messages.push({ role: "assistant", content: safeAssistantContent });

  if (toolResult.imageBase64) {
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: buildToolResultFollowUp(toolResult, toolName),
        },
        {
          type: "image_url",
          image_url: {
            url: `data:${toolResult.mimeType ?? "image/jpeg"};base64,${toolResult.imageBase64}`,
          },
        },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: buildToolResultFollowUp(toolResult, toolName),
    });
  }
}

/**
 * Append MULTIPLE parallel tool exchanges to the message history.
 * All tool calls from one assistant turn are recorded, then all results
 * are injected together in one user turn so Gemma sees the full batch.
 */
export function appendParallelToolExchanges(
  messages: AgentMessage[],
  assistantRaw: string,
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
): void {
  const safeAssistantContent =
    assistantRaw.trim() ||
    toolCalls
      .map((tc) => `<tool_call>{"name":"${tc.name}","args":{}}</tool_call>`)
      .join("\n");

  messages.push({ role: "assistant", content: safeAssistantContent });

  // Build a combined user turn with all results + any images
  const textParts: string[] = [];
  const imageParts: ContentPart[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]!;
    const res = toolResults[i]!;
    textParts.push(
      `<tool_result name="${tc.name}">${res.text}</tool_result>`,
    );
    if (res.imageBase64) {
      imageParts.push({
        type: "image_url",
        image_url: {
          url: `data:${res.mimeType ?? "image/jpeg"};base64,${res.imageBase64}`,
        },
      });
    }
  }

  const allResultsText = textParts.join("\n\n");
  const hasSubagent = toolCalls.some((tc) => tc.name === "run_video_subagent");

  const followUp = hasSubagent
    ? `${allResultsText}\n\nAll ${toolCalls.length} parallel task(s) complete. You MUST immediately:\n1. Call more tools/subagents if investigation is incomplete — include multiple <tool_call> blocks.\n2. OR write your COMPLETE final intelligence briefing now — no tool_call tags.\n\nDo NOT output an empty response.`
    : `${allResultsText}\n\nAll ${toolCalls.length} tool result(s) received. You MUST immediately:\n1. Call more tools if needed — include multiple <tool_call> blocks.\n2. OR write your complete final intelligence briefing now — no tool_call tags.\n\nDo NOT output an empty response.`;

  if (imageParts.length > 0) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: followUp }, ...imageParts],
    });
  } else {
    messages.push({ role: "user", content: followUp });
  }
}

/**
 * Ensures the total number of images in the history/messages sent to Cerebras
 * does not exceed the maximum allowed limit (default 5).
 * Prioritizes keeping the most recent images (from the end of the history).
 */
export function pruneMessagesImageBudget(
  messages: AgentMessage[],
  maxImages = 5,
): AgentMessage[] {
  let imageCount = 0;
  const result: AgentMessage[] = [];

  // Traverse from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (typeof msg.content === "string") {
      result.unshift(msg);
      continue;
    }

    // It's ContentPart[]
    const newContentParts: ContentPart[] = [];
    const imagesInMsg = msg.content.filter((p) => p.type === "image_url");

    if (imageCount + imagesInMsg.length <= maxImages) {
      // Keep all images in this message
      imageCount += imagesInMsg.length;
      result.unshift(msg);
    } else {
      // Keep only up to the remaining budget
      const allowed = maxImages - imageCount;
      let kept = 0;

      for (const part of msg.content) {
        if (part.type === "image_url") {
          if (kept < allowed) {
            newContentParts.push(part);
            kept++;
            imageCount++;
          } else {
            // Drop image and add a text placeholder so we don't break message meaning
            newContentParts.push({
              type: "text",
              text: "[Visual context frame omitted to respect model rate limits]",
            });
          }
        } else {
          newContentParts.push(part);
        }
      }

      result.unshift({
        ...msg,
        content: newContentParts,
      });
    }
  }

  return result;
}
