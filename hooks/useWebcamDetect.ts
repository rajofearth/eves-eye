import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface Detection {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly confidence: number;
  readonly class: number;
  readonly label?: string;
  readonly model?: string;
}

export interface FrameDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ThreatAlert {
  readonly isHarm: boolean;
  readonly severity: "critical" | "warning" | "nominal";
  readonly reason: string;
  readonly snapshotPath?: string;
}

export interface UseWebcamDetectOptions {
  readonly maxFps?: number;
  readonly minConfidence?: number;
  readonly cameraId?: string;
  readonly initialDelayMs?: number;
}

export interface UseWebcamDetectResult {
  readonly detections: readonly Detection[];
  readonly detectionCount: number;
  readonly lastLatency: number | null;
  readonly isProcessing: boolean;
  readonly error: string | null;
  readonly frameDimensions: FrameDimensions | null;
  readonly threat: ThreatAlert | null;
}

const DEFAULT_MAX_FPS = 4;
const DEFAULT_MIN_CONFIDENCE = 0.45;

export function useWebcamDetect(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isActive: boolean,
  options?: UseWebcamDetectOptions,
): UseWebcamDetectResult {
  const maxFps = options?.maxFps ?? DEFAULT_MAX_FPS;
  const minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const cameraId = options?.cameraId;
  const initialDelayMs = options?.initialDelayMs ?? 0;
  const minIntervalMs = 1000 / maxFps;

  const [detections, setDetections] = useState<readonly Detection[]>([]);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameDimensions, setFrameDimensions] =
    useState<FrameDimensions | null>(null);
  const [threat, setThreat] = useState<ThreatAlert | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRequestTimeRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isActiveRef = useRef<boolean>(isActive);
  const backoffDelayRef = useRef<number>(0);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const processFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!isActiveRef.current || !video || video.readyState < 2) {
      // Loop if active but video is not ready yet
      if (isActiveRef.current) {
        timeoutRef.current = setTimeout(() => {
          void processFrame();
        }, 100);
      }
      return;
    }

    const now = performance.now();
    const sinceLast = now - lastRequestTimeRef.current;

    if (sinceLast < minIntervalMs) {
      timeoutRef.current = setTimeout(() => {
        void processFrame();
      }, minIntervalMs - sinceLast);
      return;
    }

    // Lazy load or create canvas helper
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      timeoutRef.current = setTimeout(() => {
        void processFrame();
      }, 50);
      return;
    }

    // Capture current frame from video onto the offscreen canvas
    ctx.drawImage(video, 0, 0, w, h);

    // Convert canvas image to JPEG blob
    const blobPromise = new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.75);
    });

    const blob = await blobPromise;
    if (!blob) {
      timeoutRef.current = setTimeout(() => {
        void processFrame();
      }, 50);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsProcessing(true);
    lastRequestTimeRef.current = performance.now();

    try {
      const formData = new FormData();
      formData.append("frame", blob);
      if (cameraId) {
        formData.append("camera_id", cameraId);
      }

      const res = await fetch("/api/detect", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();

      if (!json.ok) {
        const errMsg = json.message || "Detection failed";

        if (
          errMsg.includes("429") ||
          errMsg.toLowerCase().includes("too many requests") ||
          errMsg.toLowerCase().includes("quota")
        ) {
          backoffDelayRef.current =
            backoffDelayRef.current === 0
              ? 12000
              : Math.min(60000, backoffDelayRef.current * 2);
          console.warn(
            `[useWebcamDetect] Rate limit backoff: ${backoffDelayRef.current}ms`,
          );
        } else {
          backoffDelayRef.current = 5000;
        }

        startTransition(() => {
          setError(errMsg);
          setDetections([]);
          setLastLatency(null);
          setFrameDimensions(null);
          setThreat(null);
        });
      } else {
        backoffDelayRef.current = 0;

        const filtered = (json.detections || []).filter(
          (d: Detection) => d.confidence >= minConfidence,
        );
        startTransition(() => {
          setDetections(filtered);
          setLastLatency(json.meta?.latencyMs ?? null);
          setFrameDimensions(json.frame || null);
          setThreat(json.threat || null);
          setError(null);
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Unknown error";

      if (
        msg.includes("429") ||
        msg.toLowerCase().includes("too many requests") ||
        msg.toLowerCase().includes("quota")
      ) {
        backoffDelayRef.current =
          backoffDelayRef.current === 0
            ? 12000
            : Math.min(60000, backoffDelayRef.current * 2);
        console.warn(
          `[useWebcamDetect] Rate limit backoff: ${backoffDelayRef.current}ms`,
        );
      } else {
        backoffDelayRef.current = 5000;
      }

      startTransition(() => {
        setError(`Inference failed: ${msg}`);
        setDetections([]);
        setLastLatency(null);
        setFrameDimensions(null);
        setThreat(null);
      });
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;

      if (isActiveRef.current) {
        const delay =
          backoffDelayRef.current > 0
            ? backoffDelayRef.current
            : Math.max(
                0,
                minIntervalMs -
                  (performance.now() - lastRequestTimeRef.current),
              );
        timeoutRef.current = setTimeout(() => {
          void processFrame();
        }, delay);
      }
    }
  }, [videoRef, minIntervalMs, minConfidence, cameraId]);

  useEffect(() => {
    if (!isActive) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setDetections([]);
      setError(null);
      setFrameDimensions(null);
      setIsProcessing(false);
      setThreat(null);
      return;
    }

    const startDetection = () => {
      void processFrame();
    };

    if (initialDelayMs > 0) {
      timeoutRef.current = setTimeout(startDetection, initialDelayMs);
    } else {
      startDetection();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isActive, processFrame, initialDelayMs]);

  return {
    detections,
    detectionCount: detections.length,
    lastLatency,
    isProcessing,
    error,
    frameDimensions,
    threat,
  };
}
