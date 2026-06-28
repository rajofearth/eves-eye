"use client";

import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  Database,
  History,
  Layers,
  Maximize2,
  Moon,
  RefreshCw,
  Shield,
  Sparkles,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface SQLiteThreatLog {
  id: number;
  timestamp: string;
  camera_id: string;
  is_harm: number;
  severity: string;
  reason: string;
  snapshot_path: string | null;
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

  // --- Threat Management States ---
  const [lastThreatReason, setLastThreatReason] = useState<string>("");
  const [threatAcknowledged, setThreatAcknowledged] = useState<boolean>(false);

  // --- Threat History Logs Panel ---
  const [showThreatLogPanel, setShowThreatLogPanel] = useState<boolean>(false);
  const [threatLogList, setThreatLogList] = useState<SQLiteThreatLog[]>([]);
  const [loadingThreatLog, setLoadingThreatLog] = useState<boolean>(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  const intelLogScrollRef = useRef<HTMLDivElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);

  // --- Real-time Object & Threat Detection Hook ---
  const {
    detections,
    lastLatency,
    isProcessing,
    error: detectionError,
    frameDimensions,
    threat,
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
        message:
          "· Gemma 4 Cloud Threat Analyzer Session Handler initializing...",
      },
      {
        id: "seed-2",
        timestamp: nowTimestamp(),
        source: "SYS",
        message: (
          <>
            · Live log registry stream online. Hooked to{" "}
            <IntelTag>GEMMA_4_31B_VISION</IntelTag> and{" "}
            <IntelTag>LOCAL_SQLITE_LOGS</IntelTag>
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

  // --- Threat Interceptor ---
  useEffect(() => {
    if (threat?.isHarm && threat.reason !== lastThreatReason) {
      setLastThreatReason(threat.reason);
      setThreatAcknowledged(false); // Fire a new alert card!

      // Log security event in red in the scrolling terminal log
      setLogEntries((prev) => [
        ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
        {
          id: uid(),
          timestamp: nowTimestamp(),
          source: "CRIT",
          message: (
            <span className="font-bold text-red-500 animate-pulse tracking-wide">
              !!! THREAT DETECTED: {threat.reason.toUpperCase()}
            </span>
          ),
        },
      ]);
    }
  }, [threat, lastThreatReason]);

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
      "· SQLite Handler: Syncing transaction buffers to database...",
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

  // --- SQLite Threats history loader ---
  const fetchThreatLog = useCallback(async () => {
    setLoadingThreatLog(true);
    try {
      const res = await fetch("/api/threats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        setThreatLogList(data.threats || []);
      }
    } catch (e) {
      console.error("[MONITOR] Failed to fetch SQLite threats log:", e);
    } finally {
      setLoadingThreatLog(false);
    }
  }, []);

  useEffect(() => {
    if (showThreatLogPanel) {
      void fetchThreatLog();
    }
  }, [showThreatLogPanel, fetchThreatLog]);

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

  const isPrimaryPulsing = threat?.isHarm && !threatAcknowledged;

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground transition-colors duration-300">
      {/* ── HEADER PANEL ── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/45 backdrop-blur-md px-4 py-1.5 z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-primary/10 rounded-sm px-2 py-0.5 border border-primary/20">
            <Shield className="w-4 h-4 text-primary" />
            <span className="font-heading text-xs font-semibold uppercase tracking-wider text-primary font-bold">
              EVE&apos;S EYE
            </span>
          </div>

          {isPrimaryPulsing ? (
            <div className="inline-flex items-center gap-1.5 rounded-sm border border-red-500/30 bg-red-950/20 px-2 py-0.5 font-mono text-[10px] font-bold text-red-500 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" />
              THREAT ACTIVE
            </div>
          ) : (
            <StatusIndicator
              variant="nominal"
              pulse
              className="hidden md:inline-flex"
            >
              ONLINE
            </StatusIndicator>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isProcessing && (
            <div className="flex items-center gap-1 text-primary text-[10px] font-mono font-medium animate-pulse mr-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              INFERRING_THREATS
            </div>
          )}

          {/* Menubar Option: Threat Log History Toggle */}
          <button
            onClick={() => setShowThreatLogPanel(true)}
            className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1 text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer shadow-xs"
            type="button"
            title="View SQLite Threat Log history"
          >
            <History className="w-3.5 h-3.5 text-primary" />
            THREAT_LOG
          </button>

          <div className="flex items-center gap-1.5 bg-muted rounded-xs px-2.5 py-1 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 text-muted-foreground/80" />
            <span className="font-mono text-2xs font-medium tracking-wide uppercase">
              {utcTime || "CONNECTING CLOCK..."}
            </span>
          </div>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
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
      <main className="flex flex-1 flex-col gap-3 overflow-hidden p-3 lg:gap-4 lg:p-4 relative">
        {/* ── TOP SECTION: PRIMARY STREAM & MINI GRID ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row lg:gap-4">
          {/* Primary Promotion Frame (62% width) */}
          <div
            className={`flex min-h-[250px] w-full md:min-h-0 md:w-[62%] relative rounded-md transition-all duration-300 overflow-hidden ${
              isPrimaryPulsing
                ? "ring-2 ring-red-500 ring-offset-2 ring-offset-background shadow-[0_0_20px_rgba(239,68,68,0.45)]"
                : "border border-border"
            }`}
          >
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
                  {/* Real Bounding Box Highlights */}
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

                  {/* Operational Security Status corner badges */}
                  <div className="absolute bottom-3 right-3 flex items-center gap-2 border border-border bg-card/80 backdrop-blur-xs rounded-sm px-2.5 py-1 z-10 shadow-lg">
                    <Layers className="w-3.5 h-3.5 text-primary" />
                    <div className="flex flex-col text-left">
                      <MonoLabel size="2xs">THREAT_ANALYZER</MonoLabel>
                      <MonoLabel
                        size="xs"
                        variant={isProcessing ? "warning" : "nominal"}
                        className="font-semibold"
                      >
                        {isProcessing ? "ANALYZING..." : "GEMMA 4 31B"}
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

                  {/* FLOATING THREAT ALERT */}
                  {threat?.isHarm && !threatAcknowledged && (
                    <div className="absolute top-3 right-3 z-30 w-[340px] rounded-md border border-red-500 bg-red-950/95 backdrop-blur-md p-4 text-white shadow-2xl animate-in slide-in-from-top-4 duration-300">
                      <div className="flex items-start gap-3">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400 animate-pulse">
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        </div>
                        <div className="flex-1 text-left">
                          <div className="flex items-center justify-between">
                            <span className="font-heading text-xs font-bold uppercase tracking-wider text-red-400">
                              SECURITY THREAT IDENTIFIED
                            </span>
                            <span className="font-mono text-[8px] bg-red-600/30 px-1 py-0.5 rounded-xs text-red-300 font-bold uppercase">
                              {threat.severity}
                            </span>
                          </div>

                          {/* Threat Reason details */}
                          <p className="mt-2 font-mono text-[10px] text-red-100 leading-normal uppercase tracking-wide">
                            {threat.reason}
                          </p>

                          {/* Snapshot of the moment of alert (Thumbnail) */}
                          {threat.snapshotPath && (
                            <div className="relative mt-3 overflow-hidden rounded-xs border border-red-500/30 bg-black/50 shadow-inner group">
                              {/* biome-ignore lint/performance/noImgElement: Custom local filesystem snapshot JPEG path */}
                              <img
                                src={threat.snapshotPath}
                                alt="Alert Frame Snapshot"
                                className="w-full h-24 object-cover object-center grayscale-[20%] hover:grayscale-0 transition-all duration-300"
                              />
                              <button
                                onClick={() =>
                                  setZoomImageUrl(threat.snapshotPath || null)
                                }
                                className="absolute bottom-1.5 right-1.5 bg-black/60 hover:bg-black/85 text-white p-1 rounded-xs flex items-center justify-center border border-white/10 transition-colors cursor-pointer"
                                type="button"
                                title="Expand Frame Snapshot"
                              >
                                <Maximize2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}

                          <div className="mt-3 flex items-center justify-end">
                            <button
                              onClick={() => setThreatAcknowledged(true)}
                              className="rounded-xs bg-red-600 hover:bg-red-500 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white shadow-sm transition-colors cursor-pointer"
                              type="button"
                            >
                              ACKNOWLEDGE_THREAT
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
                SYSTEM: SQLite_SYNC_ACTIVE
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
                LOCAL_DB_TALLIES (SQLite)
              </MonoLabel>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                {sortedSessionTotals.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <MonoLabel size="xs" variant="muted">
                      AWAITING_DB_EVENTS...
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

        {/* ── SLIDE-OVER THREAT LOG DRAWER (ALERTS LIST VIEWER) ── */}
        {showThreatLogPanel && (
          <div className="absolute inset-0 bg-background/55 backdrop-blur-xs z-40 flex justify-end animate-in fade-in duration-200">
            {/* Click outside to close */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Backdrop click-outside helper */}
            <div
              className="flex-1"
              onClick={() => setShowThreatLogPanel(false)}
              role="presentation"
            />

            <div className="w-96 md:w-[420px] h-full bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-4">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  <MonoLabel className="font-bold">
                    SQLITE_THREAT_LOGS
                  </MonoLabel>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={fetchThreatLog}
                    className="p-1.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    type="button"
                    title="Refresh Log"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setShowThreatLogPanel(false)}
                    className="p-1.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    type="button"
                    title="Close Panel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Threat Logs List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loadingThreatLog ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                    <MonoLabel size="2xs" variant="muted">
                      READING_SQLITE_INDEX...
                    </MonoLabel>
                  </div>
                ) : threatLogList.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center text-center">
                    <AlertTriangle className="w-6 h-6 text-muted-foreground/30 mb-2" />
                    <MonoLabel size="xs" variant="muted">
                      NO_THREATS_ARCHIVED
                    </MonoLabel>
                    <span className="font-mono text-[9px] text-muted-foreground/50 mt-1 max-w-[200px]">
                      Verified threat alert details will appear here once
                      identified.
                    </span>
                  </div>
                ) : (
                  threatLogList.map((item) => (
                    <div
                      key={item.id}
                      className={`border rounded-md p-3.5 bg-zinc-950/10 dark:bg-black/10 transition-colors ${
                        item.is_harm === 1
                          ? "border-red-500/20 hover:border-red-500/40"
                          : "border-border/60 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[9px] text-zinc-300 font-bold bg-muted px-1.5 py-0.5 rounded-xs leading-none">
                          {item.camera_id}
                        </span>

                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-[8px] px-1 py-0.5 rounded-xs font-bold uppercase leading-none ${
                              item.is_harm === 1
                                ? "bg-red-500/25 text-red-400"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {item.is_harm === 1 ? "THREAT" : "NOMINAL"}
                          </span>
                          <span className="font-mono text-[8px] text-muted-foreground/60 leading-none">
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>

                      <p className="font-mono text-[10px] text-zinc-200 leading-normal uppercase">
                        {item.reason}
                      </p>

                      {/* Display Alert Captured Frame from DB path */}
                      {item.snapshot_path && (
                        <div className="relative mt-2.5 overflow-hidden rounded-xs border border-border bg-black/40 group">
                          {/* biome-ignore lint/performance/noImgElement: Custom local filesystem snapshot JPEG path */}
                          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Clickable image to zoom */}
                          <img
                            src={item.snapshot_path}
                            alt="Captured Threat Moment"
                            className="w-full h-24 object-cover object-center grayscale-[15%] group-hover:grayscale-0 transition-all duration-300 cursor-pointer"
                            onClick={() => setZoomImageUrl(item.snapshot_path)}
                          />
                          <div className="absolute bottom-1.5 right-1.5 bg-black/60 text-white px-1 font-mono text-[8px] rounded-xs border border-white/5 pointer-events-none">
                            ALERT_FRAME
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── IMAGE ZOOM OVERLAY (FULL SCREEN POPUP) ── */}
        {zoomImageUrl && (
          /* biome-ignore lint/a11y/noStaticElementInteractions: Zoom modal backdrop */
          <div
            className="absolute inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setZoomImageUrl(null)}
            role="presentation"
          >
            <div className="relative max-w-full max-h-full">
              {/* biome-ignore lint/performance/noImgElement: Zoomed alert view */}
              <img
                src={zoomImageUrl}
                alt="Zoomed Alert Frame"
                className="max-w-full max-h-[85vh] rounded-md border border-white/10 object-contain shadow-2xl"
              />
              <button
                onClick={() => setZoomImageUrl(null)}
                className="absolute top-3 right-3 bg-black/70 hover:bg-black/90 text-white rounded-full p-2 border border-white/10 transition-colors cursor-pointer"
                type="button"
                title="Close Image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
