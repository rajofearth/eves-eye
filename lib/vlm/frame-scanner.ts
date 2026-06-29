import { join } from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { gemmaVisionJson } from "./cerebras-client";

export interface FrameEntry {
  file: string;
  frameIndex: number;
  timestampSec: number;
}

export interface FrameScanResult {
  detections: { label: string; box_2d: [number, number, number, number] }[];
}

export interface BatchedFrameScanResult {
  detections: {
    frame_index: number;
    label: string;
    box_2d: [number, number, number, number];
  }[];
}

export async function scanFrame(
  framePath: string,
  frameIndex: number,
): Promise<FrameScanResult> {
  const imageBuffer = await sharp(framePath)
    .resize(640, null, { withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  const base64Image = imageBuffer.toString("base64");

  const prompt = `Analyze surveillance frame ${frameIndex} (1 fps video).
Identify objects, people, vehicles, or items of interest.
Output bounding boxes [ymin, xmin, ymax, xmax] on 0–1000 scale.

Return JSON:
{
  "detections": [
    { "label": "person in jacket", "box_2d": [ymin, xmin, ymax, xmax] }
  ]
}
Return ONLY raw JSON.`;

  const parsed = await gemmaVisionJson<{ detections?: FrameScanResult["detections"] }>(
    prompt,
    [{ base64: base64Image, label: `frame_${frameIndex}` }],
  );

  return { detections: parsed.detections ?? [] };
}

export async function scanFramesBatch(
  batch: FrameEntry[],
  framesDir: string,
): Promise<BatchedFrameScanResult> {
  const images: { base64: string; label: string }[] = [];
  for (const f of batch) {
    const framePath = join(framesDir, f.file);
    try {
      const buf = await sharp(framePath)
        .resize(640, null, { withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      images.push({
        base64: buf.toString("base64"),
        label: `frame_${f.frameIndex}`,
      });
    } catch {
      // skip if frame not found
    }
  }

  if (images.length === 0) {
    return { detections: [] };
  }

  const mapping = batch
    .map(
      (f, i) =>
        `  image ${i + 1} = frame_index ${f.frameIndex} (${f.timestampSec}s)`,
    )
    .join("\n");

  const prompt = `Analyze these sequential surveillance frames.
${mapping}

Identify objects, people, vehicles, or items of interest in each image.
Output bounding boxes [ymin, xmin, ymax, xmax] on 0–1000 scale.
You MUST specify the correct absolute frame_index for each detection.

Return JSON:
{
  "detections": [
    { "frame_index": 12, "label": "person", "box_2d": [ymin, xmin, ymax, xmax] }
  ]
}
Return ONLY raw JSON.`;

  const parsed = await gemmaVisionJson<{ detections?: BatchedFrameScanResult["detections"] }>(
    prompt,
    images,
  );

  return { detections: parsed.detections ?? [] };
}

export function persistFrameDetections(
  jobId: string,
  frameIndex: number,
  timestampSec: number,
  detections: FrameScanResult["detections"],
): void {
  const insert = db.prepare(`
    INSERT INTO video_detections
      (job_id, frame_index, timestamp_sec, label, x1, y1, x2, y2, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const det of detections) {
    insert.run(
      jobId,
      frameIndex,
      timestampSec,
      det.label.toUpperCase(),
      det.box_2d[1],
      det.box_2d[0],
      det.box_2d[3],
      det.box_2d[2],
      0.95,
    );
  }

  db.prepare(
    "UPDATE video_jobs SET completed_frames = completed_frames + 1 WHERE id = ?",
  ).run(jobId);
}
