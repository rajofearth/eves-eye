"use client";

import {
  Activity,
  Clock,
  Cpu,
  Database,
  Layers,
  Moon,
  RefreshCw,
  Shield,
  Sparkles,
  Sun,
  Terminal,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CameraSurface } from "@/components/camera/camera-surface";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { IntelLog, IntelLogEntry, IntelTag } from "@/components/ui/intel-log";
import { MonoLabel } from "@/components/ui/mono-label";
import { StatusDot, StatusIndicator } from "@/components/ui/status-dot";
import { useWebcamDetect } from "@/hooks/useWebcamDetect";
import { cocoClassName } from "@/lib/coco";

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------
interface MockCamera {
  id: string;
  name: string;
  cameraId: string;
  sourceType: "device" | "simulated";
}

interface LogEntry {
  id: string;
  timestamp: string;
  source: string;
  message: React.ReactNode;
  dimmed?: boolean;
}

const MAX_LOG_ENTRIES = 50;

const INITIAL_CAMERAS: MockCamera[] = [
  {
    id: "cam-webcam",
    name: "Main Browser Cam",
    cameraId: "CAM-01-WEBCAM",
    sourceType: "device",
  },
  {
    id: "cam-north",
    name: "Perimeter North",
    cameraId: "CAM-02-NORTH",
    sourceType: "simulated",
  },
  {
    id: "cam-gate",
    name: "Docking Gate 4",
    cameraId: "CAM-03-GATE",
    sourceType: "simulated",
  },
  {
    id: "cam-corridor",
    name: "Server Corridor",
    cameraId: "CAM-04-SERVER",
    sourceType: "simulated",
  },
];

function nowTimestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export default function LiveMonitorPage() {
  // --- Page States ---
  const [activeCameraId, setActiveCameraId] = useState<string>("cam-webcam");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [systemLoad, setSystemLoad] = useState<number>(6);
  const [utcTime, setUtcTime] = useState<string>("");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [sessionTotals, setSessionTotals] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [lastLoggedClasses, setLastLoggedClasses] = useState<string>("");

  const intelLogScrollRef = useRef<HTMLDivElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);

  // --- Real-time RT-DETR Detection Hook ---
  // Runs whenever stream is active, regardless of whether webcam is promoted or in the grid!
  const {
    detections,
    lastLatency,
    isProcessing,
    error: detectionError,
    frameDimensions,
  } = useWebcamDetect(webcamVideoRef, !!stream, {
    maxFps: 0.15, // Safe rate limiting for cloud APIs (approx 1 request per 6.6 seconds)
    minConfidence: 0.45,
    cameraId: "CAM-01-WEBCAM",
  });

  // --- Initialize Time & Clock ---
  useEffect(() => {
    const updateClock = () => {
      const d = new Date();
      setUtcTime(`${d.toUTCString().slice(17, 25)} UTC`);
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- System Theme Application ---
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [darkMode]);

  // --- Fetch Browser Webcam Stream ---
  useEffect(() => {
    let active = true;
    let activeStream: MediaStream | null = null;

    setLogEntries((prev) => [
      ...prev,
      {
        id: "sys-init",
        timestamp: nowTimestamp(),
        source: "SYS",
        message:
          "· EVE'S EYE system diagnostics active. Reallocating local resources...",
      },
    ]);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      })
      .then((mediaStream) => {
        if (active) {
          activeStream = mediaStream;
          setStream(mediaStream);
          setLogEntries((prev) => [
            ...prev,
            {
              id: "sys-stream-ok",
              timestamp: nowTimestamp(),
              source: "SYS",
              message: (
                <>
                  · Browser webcam successfully mounted. stream descriptor:{" "}
                  <IntelTag>1280x720@30FPS</IntelTag>
                </>
              ),
            },
          ]);
        } else {
          mediaStream.getTracks().forEach((track) => {
            track.stop();
          });
        }
      })
      .catch((err) => {
        if (active) {
          const errMsg =
            err.message || "Permission denied or device not found.";
          setStreamError(errMsg);
          setLogEntries((prev) => [
            ...prev,
            {
              id: "sys-stream-err",
              timestamp: nowTimestamp(),
              source: "SYS",
              message: `· Error loading browser webcam: ${errMsg}`,
            },
          ]);
        }
      });

    // Seed initial logs
    setLogEntries((prev) => [
      ...prev,
      {
        id: "seed-1",
        timestamp: nowTimestamp(),
        source: "SYS",
        message: "· RT-DETR Server Session Handler initializing...",
      },
      {
        id: "seed-2",
        timestamp: nowTimestamp(),
        source: "SYS",
        message: (
          <>
            · Live log registry stream online. Hooked to{" "}
            <IntelTag>RT_DETR_MODEL_INFERENCE</IntelTag>
          </>
        ),
      },
    ]);

    return () => {
      active = false;
      if (activeStream) {
        activeStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, []);

  // --- Auto-scroll Intel log to bottom ---
  useEffect(() => {
    const el = intelLogScrollRef.current;
    if (el && logEntries.length >= 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logEntries]);

  // --- Core Log and Total statistics correlation from real detections ---
  useEffect(() => {
    if (!stream || detections.length === 0) return;

    // Group classes to prevent duplicate print triggers on consecutive identical frames
    const classesSet = new Set(
      detections.map((d) => d.label || cocoClassName(d.class)),
    );
    const classesStr = Array.from(classesSet).sort().join(",");

    if (classesStr !== lastLoggedClasses) {
      setLastLoggedClasses(classesStr);

      const time = nowTimestamp();

      setLogEntries((prev) => [
        ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
        {
          id: uid(),
          timestamp: time,
          source: "VLM",
          message: (
            <>
              · Objects identified on WEBCAM:{" "}
              {detections.map((d, index) => (
                <span
                  key={`log-item-${index}-${d.class}-${d.confidence}-${d.label || ""}`}
                >
                  {index > 0 && ", "}
                  <IntelTag>{d.label || cocoClassName(d.class)}</IntelTag> (
                  {Math.round(d.confidence * 100)}%)
                </span>
              ))}
            </>
          ),
        },
      ]);

      // Update counters in panel
      setSessionTotals((prev) => {
        const next = new Map(prev);
        for (const d of detections) {
          const label = d.label || cocoClassName(d.class);
          next.set(label, (next.get(label) ?? 0) + 1);
        }
        return next;
      });
    }
  }, [detections, lastLoggedClasses, stream]);

  // --- Log error warnings if detection fails ---
  useEffect(() => {
    if (detectionError) {
      setLogEntries((prev) => [
        ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
        {
          id: uid(),
          timestamp: nowTimestamp(),
          source: "SYS",
          message: `· WARNING: ${detectionError}`,
        },
      ]);
    }
  }, [detectionError]);

  // --- Simulated Diagnostic Tickers ---
  useEffect(() => {
    // 1. CPU Load Fluctuator
    const cpuInterval = setInterval(() => {
      setSystemLoad((prev) => {
        const change = Math.floor(Math.random() * 3) - 1;
        return Math.max(4, Math.min(22, prev + change));
      });
    }, 3000);

    // 2. Simulated System Messages
    const mockLogs = [
      "· Diagnostics: Core temperatures within bounds (39.2°C)",
      "· Buffer Routine: Purging frame cache (0B cleared)",
      "· Security Policy: Session validated successfully",
    ];

    const logInterval = setInterval(() => {
      const msg = mockLogs[Math.floor(Math.random() * mockLogs.length)];
      setLogEntries((prev) => [
        ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
        {
          id: uid(),
          timestamp: nowTimestamp(),
          source: "SYS",
          message: msg,
          dimmed: true,
        },
      ]);
    }, 12000);

    return () => {
      clearInterval(cpuInterval);
      clearInterval(logInterval);
    };
  }, []);

  // --- Handlers ---
  const handlePromoteCamera = (id: string) => {
    setActiveCameraId(id);
    const targetCam = INITIAL_CAMERAS.find((c) => c.id === id);
    if (targetCam) {
      setLogEntries((prev) => [
        ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
        {
          id: uid(),
          timestamp: nowTimestamp(),
          source: "SYS",
          message: `· Stream Manager: Promoted camera ${targetCam.cameraId} to primary feed.`,
        },
      ]);
    }
  };

  // --- Derived Values ---
  const activeCamera =
    INITIAL_CAMERAS.find((c) => c.id === activeCameraId) ?? INITIAL_CAMERAS[0];
  const gridCameras = INITIAL_CAMERAS.filter((c) => c.id !== activeCameraId);

  const sortedSessionTotals = useMemo(() => {
    return [...sessionTotals.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessionTotals]);

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground transition-colors duration-300">
      {/* ── HEADER PANEL ── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/45 backdrop-blur-md px-4 py-1.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-primary/10 rounded-sm px-2 py-0.5 border border-primary/20">
            <Shield className="w-4 h-4 text-primary animate-pulse" />
            <span className="font-heading text-xs font-semibold uppercase tracking-wider text-primary">
              EVE&apos;S EYE
            </span>
          </div>
          <StatusIndicator
            variant="nominal"
            pulse
            className="hidden md:inline-flex"
          >
            ONLINE
          </StatusIndicator>
        </div>

        <div className="flex items-center gap-4">
          {isProcessing && (
            <div className="flex items-center gap-1 text-primary text-[10px] font-mono font-medium animate-pulse">
              <RefreshCw className="w-3 h-3 animate-spin" />
              RUNNING_INFERENCE
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-muted rounded-xs px-2.5 py-1 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 text-muted-foreground/80" />
            <span className="font-mono text-2xs font-medium tracking-wide uppercase">
              {utcTime || "CONNECTING CLOCK..."}
            </span>
          </div>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            type="button"
            title="Toggle Theme"
          >
            {darkMode ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* ── MAIN CONTENT AREA ── */}
      <main className="flex flex-1 flex-col gap-3 overflow-hidden p-3 lg:gap-4 lg:p-4">
        {/* ── TOP SECTION: PRIMARY STREAM & MINI GRID ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row lg:gap-4">
          {/* Primary Promotion Frame (62% width) */}
          <div className="flex min-h-[250px] w-full md:min-h-0 md:w-[62%] relative">
            <CameraSurface
              camera={activeCamera}
              isPrimary
              stream={activeCamera.sourceType === "device" ? stream : null}
              error={activeCamera.sourceType === "device" ? streamError : null}
              videoRef={
                activeCamera.id === "cam-webcam" ? webcamVideoRef : undefined
              }
              overlays={
                <>
                  {/* Real Bounding Box Highlights (Rendered relative to absolute frame size) */}
                  {activeCamera.id === "cam-webcam" &&
                    frameDimensions &&
                    detections.map((det, index) => {
                      const fw = frameDimensions.width || 640;
                      const fh = frameDimensions.height || 480;

                      const left = (det.x1 / fw) * 100;
                      const top = (det.y1 / fh) * 100;
                      const width = ((det.x2 - det.x1) / fw) * 100;
                      const height = ((det.y2 - det.y1) / fh) * 100;

                      return (
                        <div
                          key={`bbox-${index}-${det.class}-${det.confidence}`}
                          className="absolute border-2 border-primary bg-primary/5 rounded-xs pointer-events-none transition-all duration-100"
                          style={{
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${width}%`,
                            height: `${height}%`,
                          }}
                        >
                          <div className="absolute top-0 left-0 bg-primary px-1.5 py-0.5 text-primary-foreground font-mono text-[8px] font-bold uppercase tracking-wider translate-y-[-100%] rounded-t-xs flex items-center gap-1 shadow-md">
                            <Sparkles className="w-2.5 h-2.5 animate-spin" />
                            {det.label || cocoClassName(det.class)}{" "}
                            {Math.round(det.confidence * 100)}%
                          </div>
                        </div>
                      );
                    })}

                  {/* High Tech Status Corner Badges */}
                  <div className="absolute bottom-3 right-3 flex items-center gap-2 border border-border bg-card/80 backdrop-blur-xs rounded-sm px-2.5 py-1 z-10 shadow-lg">
                    <Layers className="w-3.5 h-3.5 text-primary" />
                    <div className="flex flex-col text-left">
                      <MonoLabel size="2xs">MODEL_ANALYSIS</MonoLabel>
                      <MonoLabel
                        size="xs"
                        variant={isProcessing ? "warning" : "nominal"}
                        className="font-semibold"
                      >
                        {isProcessing ? "INFERRING..." : "RT-DETR LIVE"}
                      </MonoLabel>
                    </div>
                  </div>

                  <div className="absolute bottom-3 left-3 border border-border bg-card/85 backdrop-blur-xs rounded-sm px-2.5 py-1 z-10 shadow-lg flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
                    <MonoLabel
                      size="xs"
                      variant="silver"
                      className="font-semibold"
                    >
                      {lastLatency !== null
                        ? `${lastLatency.toFixed(0)}ms`
                        : "N/A"}
                    </MonoLabel>
                  </div>
                </>
              }
            />
          </div>

          {/* Camera Grid (38% width) */}
          <div className="grid min-h-[220px] w-full grid-cols-2 grid-rows-2 gap-3 md:min-h-0 md:w-[38%] lg:gap-4">
            {gridCameras.map((camera) => (
              <CameraSurface
                key={camera.id}
                camera={camera}
                stream={camera.sourceType === "device" ? stream : null}
                error={camera.sourceType === "device" ? streamError : null}
                onSelect={handlePromoteCamera}
                videoRef={
                  camera.id === "cam-webcam" ? webcamVideoRef : undefined
                }
              />
            ))}
          </div>
        </div>

        {/* ── BOTTOM SECTION: INTEL TERMINAL LOG & ACTIVE DETECTIONS ── */}
        <div className="flex min-h-0 shrink-0 flex-col gap-3 sm:h-56 sm:flex-row lg:gap-4">
          {/* Intel Stream Logger Panel (70% width) */}
          <div className="flex flex-1 flex-col overflow-hidden rounded-md border border-border bg-card shadow-xs">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3.5">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-muted-foreground" />
                <MonoLabel className="font-bold">INTEL_STREAM</MonoLabel>
              </div>
              <MonoLabel size="2xs" variant="muted" className="font-semibold">
                SYSTEM: LOGGING_ACTIVE
              </MonoLabel>
            </div>

            <div
              ref={intelLogScrollRef}
              className="flex-1 overflow-y-auto p-4 bg-zinc-950/20 dark:bg-black/20"
            >
              <IntelLog>
                {logEntries.map((entry) => (
                  <IntelLogEntry
                    key={entry.id}
                    timestamp={entry.timestamp}
                    source={entry.source}
                    message={entry.message}
                    dimmed={entry.dimmed}
                  />
                ))}
                <IntelLogEntry timestamp="" source="" message="" cursor />
              </IntelLog>
            </div>
          </div>

          {/* Active Detections Summary Panel (30% width) */}
          <div className="flex min-h-[160px] w-full flex-col overflow-hidden rounded-md border border-border bg-card sm:min-h-0 sm:w-[30%] shadow-xs">
            <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-muted/30 px-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Database className="w-4 h-4 text-muted-foreground" />
                <MonoLabel className="truncate font-bold">
                  SESSION_TOTALS
                </MonoLabel>
              </div>

              {/* CPU Load Metric (Fluctuating) */}
              <div
                className="flex items-center gap-2 max-w-[45%] shrink-0"
                title="System CPU workload"
              >
                <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                <ConfidenceBar
                  value={systemLoad}
                  showLabel
                  variant="silver"
                  className="w-16 sm:w-20"
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 pt-3">
              <MonoLabel
                size="2xs"
                variant="muted"
                className="shrink-0 font-semibold"
              >
                DETECTION_COUNTS (ALL_CLASSES)
              </MonoLabel>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                {sortedSessionTotals.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <MonoLabel size="xs" variant="muted">
                      AWAITING_REAL_EVENTS...
                    </MonoLabel>
                  </div>
                ) : (
                  sortedSessionTotals.map(([label, count]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-center gap-2">
                        <StatusDot variant="silver" size="xs" />
                        <span className="font-mono text-[10px] text-zinc-300 uppercase tracking-wide">
                          {label}
                        </span>
                      </div>
                      <span className="font-mono text-xs font-bold text-primary tabular-nums">
                        {count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
