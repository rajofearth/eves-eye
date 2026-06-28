import { gemmaCerebrasAdapter } from "./gemma-cerebras-adapter";

export interface VlmDetection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  class: number;
  label: string;
  model: string;
}

export interface VlmThreatInfo {
  isHarm: boolean;
  severity: "critical" | "warning" | "nominal";
  reason: string;
}

export interface VlmAnalysisResult {
  detections: VlmDetection[];
  threat: VlmThreatInfo;
  rawJson: string;
}

export interface VlmThreatAnalyzer {
  analyzeFrame(
    imageBuffer: Buffer,
    mimeType: string,
    cameraId: string,
    origWidth: number,
    origHeight: number,
  ): Promise<VlmAnalysisResult>;
}

// Active production VLM analyzer adapter instance
export const vlmThreatAnalyzer: VlmThreatAnalyzer = gemmaCerebrasAdapter;
