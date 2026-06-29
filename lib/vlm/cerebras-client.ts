import { Cerebras } from "@cerebras/cerebras_cloud_sdk";

export interface CerebrasResponse {
  choices?: { message?: { content?: string } }[];
}

/** Cerebras Gemma vision limit per request */
export const MAX_IMAGES_PER_REQUEST = 5;

let sharedClient: Cerebras | null = null;

export function getCerebrasClient(): Cerebras {
  if (!sharedClient) {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      throw new Error("CEREBRAS_API_KEY environment variable is not configured.");
    }
    sharedClient = new Cerebras({ apiKey, timeout: 25000 });
  }
  return sharedClient;
}

export async function gemmaJson<T>(
  messages: Parameters<Cerebras["chat"]["completions"]["create"]>[0]["messages"],
): Promise<T> {
  const client = getCerebrasClient();
  const response = await client.chat.completions.create({
    model: "gemma-4-31b",
    messages,
    response_format: { type: "json_object" },
  });
  const content = (response as unknown as CerebrasResponse).choices?.[0]?.message
    ?.content;
  if (!content) throw new Error("Gemma returned empty completion.");
  return JSON.parse(content) as T;
}

export async function gemmaVisionJson<T>(
  prompt: string,
  images: { base64: string; label: string }[],
): Promise<T> {
  const capped = images.slice(0, MAX_IMAGES_PER_REQUEST);
  return gemmaJson<T>([
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...capped.map((img) => ({
          type: "image_url" as const,
          image_url: {
            url: `data:image/jpeg;base64,${img.base64}`,
          },
        })),
      ],
    },
  ]);
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function gemmaMultimodal(
  system: string,
  content: ContentPart[],
): Promise<string> {
  const client = getCerebrasClient();
  const response = await client.chat.completions.create({
    model: "gemma-4-31b",
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
  });
  return (
    (response as unknown as CerebrasResponse).choices?.[0]?.message?.content ?? ""
  );
}
