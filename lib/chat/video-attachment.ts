import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoContext } from "./types";

export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function pickKeyframeTimes(ctx: VideoContext, limit: number): number[] {
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
  return [...times].sort((a, b) => a - b).slice(0, limit);
}

export async function buildVideoAttachments(
  videos: VideoContext[],
): Promise<VisionContentPart[]> {
  const parts: VisionContentPart[] = [];

  parts.push({
    type: "text",
    text: "VIDEO EVIDENCE ATTACHMENTS — key frames from tagged videos. Analyse and cross-reference carefully.",
  });

  if (videos.length === 0) return parts;

  // Budget at most 4 images total across all videos to guarantee space for tool snapshots
  const maxTotalInitialFrames = 4;
  const framesPerVideo = Math.max(1, Math.floor(maxTotalInitialFrames / videos.length));
  let totalScheduled = 0;

  for (const v of videos) {
    if (totalScheduled >= maxTotalInitialFrames) break;

    parts.push({
      type: "text",
      text: `\n--- VISUAL FRAMES: "${v.friendlyName}" ---`,
    });

    const keyTimes = pickKeyframeTimes(v, framesPerVideo);
    for (const timeSec of keyTimes) {
      if (totalScheduled >= maxTotalInitialFrames) break;

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
        totalScheduled++;
      } catch {
        // frame not available
      }
    }
  }

  return parts;
}

/** Split vision parts so each chunk has at most 5 images (keeps backwards compatibility) */
export function chunkVisionParts(parts: VisionContentPart[]): VisionContentPart[][] {
  const chunks: VisionContentPart[][] = [];
  let current: VisionContentPart[] = [];
  let imageCount = 0;

  for (const part of parts) {
    if (part.type === "image_url") {
      if (imageCount >= 5) {
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
