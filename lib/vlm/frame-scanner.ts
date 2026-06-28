import { readFile } from "node:fs/promises";
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

export async function scanFrame(
  framePath: string,
  frameIndex: number,
): Promise<FrameScanResult> {
  const imageBuffer = await readFile(framePath);
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
