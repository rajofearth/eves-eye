import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";

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

    // 3. Extract frame data
    const formData = await req.formData();
    const file = formData.get("frame");

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

    // 5. Construct multimodal prompt for Gemma 4 31B
    const prompt = `Analyze this frame from a surveillance camera. Detect all objects, people, items, or actions of interest.
For each object, determine its bounding box coordinates [ymin, xmin, ymax, xmax] normalized on a scale of 0 to 1000 (where 0 is top/left and 1000 is bottom/right).
Be precise. Free-style the labels to describe what you see (e.g. "person wearing glasses", "coffee mug", "laptop").
Return the detections as a JSON object matching this exact structure:
{
  "detections": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "label": "person wearing glasses"
    }
  ]
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
        `Cerebras API returned HTTP ${response.status}: ${errText}`,
      );
    }

    const resultJson = await response.json();
    const content = resultJson.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Cerebras API returned an empty completion content");
    }

    // 7. Parse model detection outputs
    const parsedModelOutput = JSON.parse(content);
    const rawDetections = parsedModelOutput.detections || [];

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

    const latencyMs = performance.now() - startTime;

    return NextResponse.json({
      ok: true,
      requestId,
      detections: detections.slice(0, 50),
      frame: { width: origWidth, height: origHeight },
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
