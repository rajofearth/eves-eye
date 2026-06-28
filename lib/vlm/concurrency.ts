import { MAX_IMAGES_PER_REQUEST } from "./cerebras-client";

/** Shared concurrency helpers for VLM pipeline workers */

export async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

/** Split items into fixed-size batches and run batches concurrently */
export async function runBatchedConcurrent<T>(
  items: T[],
  batchSize: number,
  batchConcurrency: number,
  fn: (batch: T[], batchIndex: number) => Promise<void>,
): Promise<void> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  await runConcurrent(batches, batchConcurrency, fn);
}

export const PIPELINE = {
  /** Parallel Gemma calls per frame-scan worker pool */
  FRAME_SCAN_CONCURRENCY: 12,
  /** Frames per face-detection batch (Cerebras max 5 images) */
  PEOPLE_BATCH_SIZE: MAX_IMAGES_PER_REQUEST,
  /** Parallel face-detection batches */
  PEOPLE_BATCH_CONCURRENCY: 10,
  /** Parallel face crops / saves */
  FACE_CROP_CONCURRENCY: 12,
  /** Parallel Gemma visual dedup batches */
  FACE_DEDUP_CONCURRENCY: 8,
  /** Frames sampled for intelligence report (evenly spaced) */
  INTEL_SAMPLE_MAX: 24,
  /** Parallel intelligence sample batches */
  INTEL_BATCH_CONCURRENCY: 4,
  /** Frames per intel batch vision call (Cerebras max 5 images) */
  INTEL_BATCH_SIZE: MAX_IMAGES_PER_REQUEST,
} as const;
