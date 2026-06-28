import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_IMAGES_PER_REQUEST } from "@/lib/vlm/cerebras-client";
import type { VideoContext } from "./types";

export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const MAX_FRAMES_PER_VIDEO = MAX_IMAGES_PER_REQUEST;

function pickKeyframeTimes(ctx: VideoContext): number[] {
  const times = new Set<number>();
  times.add(1);
  if (ctx.durationSec > 0) {
    times.add(Math.round(ctx.durationSec / 2));
    times.add(Math.round(ctx.durationSec));
  }
  for (const t of ctx.threats) {
    times.add(Math.round(t.startSec));
    times.add(Math.round((t.startSec + t.endSec) / 2));
  }
  return [...times].sort((a, b) => a - b).slice(0, MAX_FRAMES_PER_VIDEO);
}

export async function buildVideoAttachments(
  videos: VideoContext[],
): Promise<VisionContentPart[]> {
  const parts: VisionContentPart[] = [];

  parts.push({
    type: "text",
    text: "VIDEO EVIDENCE ATTACHMENTS — key frames from each tagged video. Analyse, cross-reference, and investigate thoroughly.",
  });

  for (const v of videos) {
    parts.push({
      type: "text",
      text: `\n--- VISUAL FRAMES: "${v.filename}" (job_id: ${v.jobId}, full video: ${v.videoUrl}) ---`,
    });

    const keyTimes = pickKeyframeTimes(v);
    for (const timeSec of keyTimes) {
      const frameIndex = Math.max(1, Math.round(timeSec));
      const padded = String(frameIndex).padStart(4, "0");
      const framePath = join(
        process.cwd(),
        "public",
        "uploads",
        "videos",
        v.jobId,
        "frames",
        `frame_${padded}.jpg`,
      );

      try {
        const buf = await readFile(framePath);
        parts.push({ type: "text", text: `Frame at ${timeSec}s:` });
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${buf.toString("base64")}`,
          },
        });
      } catch {
        // frame not available
      }
    }
  }

  return parts;
}

/** Split vision parts so each chunk has at most MAX_IMAGES_PER_REQUEST images */
export function chunkVisionParts(parts: VisionContentPart[]): VisionContentPart[][] {
  const chunks: VisionContentPart[][] = [];
  let current: VisionContentPart[] = [];
  let imageCount = 0;

  for (const part of parts) {
    if (part.type === "image_url") {
      if (imageCount >= MAX_IMAGES_PER_REQUEST) {
        chunks.push(current);
        current = [];
        imageCount = 0;
      }
      imageCount++;
    }
    current.push(part);
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}
