import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { logDetections, logThreat } from "@/lib/db";
import { vlmThreatAnalyzer } from "@/lib/vlm/vlm-analyzer";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const startTime = performance.now();
  const requestId = Math.random().toString(36).slice(2, 9).toUpperCase();

  try {
    // 1. Validate API Key configuration
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      console.error(
        "[DETECT] CEREBRAS_API_KEY is missing from environment variables.",
      );
      return NextResponse.json(
        {
          ok: false,
          requestId,
          errorCode: "MODEL_ERROR",
          message:
            "Cerebras API key is not configured on the server. Please add CEREBRAS_API_KEY to your .env file.",
        },
        { status: 400 },
      );
    }

    // 2. Validate request content type
    const contentType = req.headers.get("content-type");
    if (!contentType?.includes("multipart/form-data")) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          errorCode: "BAD_REQUEST",
          message: "Content-Type must be multipart/form-data",
        },
        { status: 400 },
      );
    }

    // 3. Extract form fields
    const formData = await req.formData();
    const file = formData.get("frame");
    const cameraId = (formData.get("camera_id") as string) || "CAM-01-WEBCAM";

    if (!(file instanceof Blob) || !file.size) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          errorCode: "BAD_REQUEST",
          message: "Missing or empty 'frame' field",
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 4. Retrieve frame dimensions using sharp
    const metadata = await sharp(buffer).metadata();
    const origWidth = metadata.width ?? 0;
    const origHeight = metadata.height ?? 0;
    if (origWidth <= 0 || origHeight <= 0) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          errorCode: "BAD_REQUEST",
          message: "Invalid image dimensions",
        },
        { status: 400 },
      );
    }

    const mimeType = metadata.format === "png" ? "image/png" : "image/jpeg";

    // 5. Delegate frame evaluation to VlmThreatAnalyzer Seam
    const analysis = await vlmThreatAnalyzer.analyzeFrame(
      buffer,
      mimeType,
      cameraId,
      origWidth,
      origHeight,
    );

    // 6. Handle threat snapshot local image save on active threat
    let snapshotPath: string | undefined;
    if (analysis.threat.isHarm) {
      try {
        const threatsDir = join(process.cwd(), "public", "threats");
        await fs.mkdir(threatsDir, { recursive: true });

        const filename = `${requestId}.jpg`;
        const filepath = join(threatsDir, filename);
        await fs.writeFile(filepath, buffer);

        snapshotPath = `/threats/${filename}`;
        console.log(`[DETECT] Threat snapshot frame saved: ${snapshotPath}`);
      } catch (saveError) {
        console.error(
          "[DETECT] Failed to write threat snapshot frame file:",
          saveError,
        );
      }
    }

    // 7. Log everything to SQLite database locally
    try {
      if (analysis.detections.length > 0) {
        logDetections(cameraId, analysis.detections);
      }
      logThreat(cameraId, {
        isHarm: analysis.threat.isHarm,
        severity: analysis.threat.severity,
        reason: analysis.threat.reason,
        rawJson: analysis.rawJson,
        snapshotPath,
      });
    } catch (dbError) {
      console.error("[DETECT] Failed to write logs to SQLite:", dbError);
    }

    const latencyMs = performance.now() - startTime;

    return NextResponse.json({
      ok: true,
      requestId,
      detections: analysis.detections.slice(0, 50),
      frame: { width: origWidth, height: origHeight },
      threat: {
        isHarm: analysis.threat.isHarm,
        severity: analysis.threat.severity,
        reason: analysis.threat.reason,
        snapshotPath,
      },
      meta: { latencyMs },
    });
  } catch (error) {
    const latencyMs = performance.now() - startTime;
    console.error(
      `[DETECT] Gemma 4 Inference error (Latency: ${latencyMs.toFixed(1)}ms):`,
      error,
    );
    return NextResponse.json(
      {
        ok: false,
        requestId,
        errorCode: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
