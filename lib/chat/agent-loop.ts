import type { ToolCall, ToolResult } from "./types";

export const MAX_AGENT_ITERATIONS = 15;

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/i;

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
