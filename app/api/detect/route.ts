import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { logDetections, logThreat } from "@/lib/db";

export const runtime = "nodejs";

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

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

    // Determine correct MIME type
    const mimeType = metadata.format === "png" ? "image/png" : "image/jpeg";
    const base64Image = buffer.toString("base64");

    // 5. Construct multimodal prompt for Gemma 4 31B (incorporating threat assessment and object detection)
    const prompt = `Analyze this frame from a surveillance camera (ID: ${cameraId}). 
Tasks:
1. Detect all objects, people, items, or actions of interest. Determine their bounding box coordinates [ymin, xmin, ymax, xmax] normalized on a scale of 0 to 1000 (where 0 is top/left and 1000 is bottom/right). Use natural free-style labels (e.g. "person in jacket", "keyboard", "fire", "crowbar").
2. Assess whether there is any active threat or emergency occurring (e.g. weapons, physical violence, fire, medical distress). Return "isHarm" true if a threat is verified. Set "severity" to "critical" (for immediate dangers/weapons/violence), "warning" (for suspicious objects/actions), or "nominal" (no threat). Provide a concise "reason" detailing your assessment.

Return the results as a JSON object matching this exact structure:
{
  "detections": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "label": "crowbar"
    }
  ],
  "threat": {
    "isHarm": false,
    "severity": "nominal",
    "reason": "The scene shows a person working at a desk with ordinary office equipment."
  }
}
Do not write any markdown code block wraps. Return ONLY the raw JSON string.`;

    // 6. Execute Cerebras Multimodal API request
    const response = await fetch(
      "https://api.cerebras.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gemma-4-31b",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        errText || `Cerebras API returned HTTP ${response.status}: ${errText}`,
      );
    }

    const resultJson = await response.json();
    const content = resultJson.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Cerebras API returned an empty completion content");
    }

    // 7. Parse model outputs
    const parsedModelOutput = JSON.parse(content);
    const rawDetections = parsedModelOutput.detections || [];
    const threatObj = parsedModelOutput.threat || {
      isHarm: false,
      severity: "nominal",
      reason: "No threat identified.",
    };

    const detections = [];

    for (const d of rawDetections) {
      const box = d.box_2d;
      if (!Array.isArray(box) || box.length !== 4) continue;

      const ymin = Number(box[0]);
      const xmin = Number(box[1]);
      const ymax = Number(box[2]);
      const xmax = Number(box[3]);

      if ([ymin, xmin, ymax, xmax].some(Number.isNaN)) continue;

      // Map normalized 0-1000 coordinates to absolute pixels
      const x1 = clamp((xmin / 1000) * origWidth, 0, origWidth);
      const y1 = clamp((ymin / 1000) * origHeight, 0, origHeight);
      const x2 = clamp((xmax / 1000) * origWidth, 0, origWidth);
      const y2 = clamp((ymax / 1000) * origHeight, 0, origHeight);

      if (x2 > x1 && y2 > y1) {
        detections.push({
          x1,
          y1,
          x2,
          y2,
          confidence: 1.0,
          class: 0,
          label: (d.label || "object").toUpperCase(),
          model: "gemma",
        });
      }
    }

    // 8. Handle threat snapshot local image save on active threat
    let snapshotPath: string | undefined;
    if (threatObj.isHarm) {
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

    // 9. Log everything to SQLite database locally
    try {
      if (detections.length > 0) {
        logDetections(cameraId, detections);
      }
      logThreat(cameraId, {
        isHarm: !!threatObj.isHarm,
        severity: threatObj.severity || "nominal",
        reason: threatObj.reason || "No threat identified.",
        rawJson: content,
        snapshotPath,
      });
    } catch (dbError) {
      console.error("[DETECT] Failed to write logs to SQLite:", dbError);
    }

    const latencyMs = performance.now() - startTime;

    return NextResponse.json({
      ok: true,
      requestId,
      detections: detections.slice(0, 50),
      frame: { width: origWidth, height: origHeight },
      threat: {
        isHarm: !!threatObj.isHarm,
        severity: threatObj.severity || "nominal",
        reason: threatObj.reason || "No threat identified.",
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
