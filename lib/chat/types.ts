export interface VideoThreat {
  startSec: number;
  endSec: number;
  severity: string;
  reason: string;
}

export interface VideoContext {
  jobId: string;
  filename: string;
  durationSec: number;
  status: string;
  summary: string;
  videoUrl: string;
  threats: VideoThreat[];
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  imageBase64?: string;
  mimeType?: string;
}
