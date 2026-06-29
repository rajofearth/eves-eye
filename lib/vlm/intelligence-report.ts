import { join } from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { gemmaJson, gemmaVisionJson } from "./cerebras-client";
import {
  PIPELINE,
  runConcurrent,
} from "./concurrency";
import type { FrameEntry } from "./frame-scanner";

export interface IntelEvent {
  time_sec: number;
  cls: string;
  conf: number;
  note: string;
  tone: "normal" | "warning" | "critical";
}

export interface IntelligenceReport {
  summary: string;
  threat_periods: { start: number; end: number; reason: string }[];
  warning_periods: { start: number; end: number; reason: string }[];
  events: IntelEvent[];
}

function sampleFrames(
  frames: FrameEntry[],
  maxSamples: number,
): FrameEntry[] {
  if (frames.length <= maxSamples) return frames;
  const step = frames.length / maxSamples;
  const sampled: FrameEntry[] = [];
  for (let i = 0; i < maxSamples; i++) {
    sampled.push(frames[Math.floor(i * step)]!);
  }
  return sampled;
}

async function analyzeSampleBatch(
  framesDir: string,
  batch: FrameEntry[],
): Promise<Partial<IntelligenceReport>> {
  const images: { base64: string; label: string }[] = [];
  for (const f of batch) {
    const buf = await sharp(join(framesDir, f.file))
      .resize(640, null, { withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    images.push({
      base64: buf.toString("base64"),
      label: `${f.timestampSec}s`,
    });
  }

  const frameList = batch
    .map((f) => `  - ${f.timestampSec}s (frame ${f.frameIndex})`)
    .join("\n");

  const prompt = `You are a surveillance intelligence analyst reviewing video frames.
Frames in this batch (timestamps in seconds):
${frameList}

Watch for weapons, break-ins, fires, assaults (CRITICAL) and loitering, suspicious activity, trespass (WARNING).

Return JSON:
{
  "summary": "brief batch observation",
  "threat_periods": [{ "start": 10.0, "end": 25.0, "reason": "..." }],
  "warning_periods": [{ "start": 0.0, "end": 9.0, "reason": "..." }],
  "events": [
    { "time_sec": 12.5, "cls": "PERSON", "conf": 0.95, "note": "Subject loiters near door.", "tone": "warning" }
  ]
}
Return ONLY raw JSON.`;

  return gemmaVisionJson<Partial<IntelligenceReport>>(prompt, images);
}

function mergeReports(reports: Partial<IntelligenceReport>[]): IntelligenceReport {
  const summary = reports
    .map((r) => r.summary)
    .filter(Boolean)
    .join(" ");

  const threat_periods = reports.flatMap((r) => r.threat_periods ?? []);
  const warning_periods = reports.flatMap((r) => r.warning_periods ?? []);
  const events = reports.flatMap((r) => r.events ?? []);

  events.sort((a, b) => a.time_sec - b.time_sec);

  return {
    summary: summary || "Video intelligence analysis complete.",
    threat_periods,
    warning_periods,
    events,
  };
}

export function persistIntelligenceReport(
  jobId: string,
  report: IntelligenceReport,
): void {
  db.prepare("DELETE FROM video_threats WHERE job_id = ?").run(jobId);
  db.prepare("DELETE FROM video_events WHERE job_id = ?").run(jobId);

  for (const t of report.threat_periods) {
    db.prepare(
      "INSERT INTO video_threats (job_id, start_sec, end_sec, severity, reason) VALUES (?, ?, ?, 'critical', ?)",
    ).run(jobId, t.start, t.end, t.reason);
  }
  for (const w of report.warning_periods) {
    db.prepare(
      "INSERT INTO video_threats (job_id, start_sec, end_sec, severity, reason) VALUES (?, ?, ?, 'warning', ?)",
    ).run(jobId, w.start, w.end, w.reason);
  }

  const insertEvent = db.prepare(`
    INSERT INTO video_events (job_id, time_sec, cls, conf, note, tone)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const e of report.events) {
    insertEvent.run(jobId, e.time_sec, e.cls, e.conf, e.note, e.tone);
  }

  db.prepare("UPDATE video_jobs SET summary = ? WHERE id = ?").run(
    report.summary,
    jobId,
  );
}

/**
 * Runs in parallel with frame scanning — Gemma watches sampled frames
 * and produces threat/warning periods + event log.
 */
export async function runIntelligenceReport(
  jobId: string,
  framesDir: string,
  allFrames: FrameEntry[],
): Promise<IntelligenceReport> {

  const sampled = sampleFrames(allFrames, PIPELINE.INTEL_SAMPLE_MAX);
  const batches: FrameEntry[][] = [];
  for (let i = 0; i < sampled.length; i += PIPELINE.INTEL_BATCH_SIZE) {
    batches.push(sampled.slice(i, i + PIPELINE.INTEL_BATCH_SIZE));
  }

  const partialReports: Partial<IntelligenceReport>[] = [];

  await runConcurrent(batches, PIPELINE.INTEL_BATCH_CONCURRENCY, async (batch) => {
    let partial: Partial<IntelligenceReport> = {};
    let retries = 3;
    while (retries > 0) {
      try {
        partial = await analyzeSampleBatch(framesDir, batch);
        break;
      } catch (err) {
        retries--;
        console.warn(
          `[INTEL_REPORT] Batch failed, retrying (${3 - retries}/3)...`,
          err,
        );
        if (retries === 0) {
          console.error(
            "[INTEL_REPORT] Batch failed all retries, skipping.",
            err,
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }
    partialReports.push(partial);
  });

  const merged = mergeReports(partialReports);
  persistIntelligenceReport(jobId, merged);
  return merged;
}
