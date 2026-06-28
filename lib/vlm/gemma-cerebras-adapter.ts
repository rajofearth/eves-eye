import { Cerebras } from "@cerebras/cerebras_cloud_sdk";
import type {
  VlmAnalysisResult,
  VlmDetection,
  VlmThreatAnalyzer,
} from "./vlm-analyzer";

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export class GemmaCerebrasAdapter implements VlmThreatAnalyzer {
  private client: Cerebras | null = null;

  private getClient(): Cerebras {
    if (!this.client) {
      const apiKey = process.env.CEREBRAS_API_KEY;
      if (!apiKey) {
        throw new Error(
          "CEREBRAS_API_KEY environment variable is not configured.",
        );
      }
      this.client = new Cerebras({ apiKey });
    }
    return this.client;
  }

  async analyzeFrame(
    imageBuffer: Buffer,
    mimeType: string,
    cameraId: string,
    origWidth: number,
    origHeight: number,
  ): Promise<VlmAnalysisResult> {
    const client = this.getClient();
    const base64Image = imageBuffer.toString("base64");

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

    const response = await client.chat.completions.create({
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
    });

    interface CerebrasResponse {
      choices?: {
        message?: {
          content?: string;
        };
      }[];
    }
    const content = (response as unknown as CerebrasResponse).choices?.[0]
      ?.message?.content;
    if (!content) {
      throw new Error("Cerebras SDK returned empty completion content.");
    }

    const parsedModelOutput = JSON.parse(content);
    const rawDetections = parsedModelOutput.detections || [];
    const threatObj = parsedModelOutput.threat || {
      isHarm: false,
      severity: "nominal",
      reason: "No threat identified.",
    };

    const detections: VlmDetection[] = [];

    for (const d of rawDetections) {
      const box = d.box_2d;
      if (!Array.isArray(box) || box.length !== 4) continue;

      const ymin = Number(box[0]);
      const xmin = Number(box[1]);
      const ymax = Number(box[2]);
      const xmax = Number(box[3]);

      if ([ymin, xmin, ymax, xmax].some(Number.isNaN)) continue;

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

    return {
      detections,
      threat: {
        isHarm: !!threatObj.isHarm,
        severity: threatObj.severity || "nominal",
        reason: threatObj.reason || "No threat identified.",
      },
      rawJson: content,
    };
  }
}

export const gemmaCerebrasAdapter = new GemmaCerebrasAdapter();
