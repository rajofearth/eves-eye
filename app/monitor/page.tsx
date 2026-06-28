"use client";

import { Activity, Layers, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraSurface } from "@/components/camera/camera-surface";
import type { LogEntry } from "@/components/monitor/intel-log-stream";
import { IntelLogStream } from "@/components/monitor/intel-log-stream";
// Modular architectural sub-components
import { MonitorHeader } from "@/components/monitor/monitor-header";
import { StatsPanel } from "@/components/monitor/stats-panel";
import { ThreatAlertCard } from "@/components/monitor/threat-alert-card";
import type { SQLiteThreatLog } from "@/components/monitor/threats-drawer";
import { ThreatsDrawer } from "@/components/monitor/threats-drawer";
import { IntelTag } from "@/components/ui/intel-log";
import { MonoLabel } from "@/components/ui/mono-label";
import { useWebcamDetect } from "@/hooks/useWebcamDetect";

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------
interface MockCamera {
  id: string;
  name: string;
  cameraId: string;
  sourceType: "device" | "simulated";
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

    setLogEntries((prev) => {
      if (prev.some((e) => e.id === "sys-init")) return prev;
      return [
        ...prev,
        {
          id: "sys-init",
          timestamp: nowTimestamp(),
          source: "SYS",
          message:
            "· EVE'S EYE system diagnostics active. Reallocating local resources...",
        },
      ];
    });

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
          setLogEntries((prev) => {
            if (prev.some((e) => e.id === "sys-stream-ok")) return prev;
            return [
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
            ];
          });
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
          setLogEntries((prev) => {
            if (prev.some((e) => e.id === "sys-stream-err")) return prev;
            return [
              ...prev,
              {
                id: "sys-stream-err",
                timestamp: nowTimestamp(),
                source: "SYS",
                message: `· Error loading browser webcam: ${errMsg}`,
              },
            ];
          });
        }
      });

    // Seed initial logs
    setLogEntries((prev) => {
      if (prev.some((e) => e.id === "seed-1")) return prev;
      return [
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
      ];
    });

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
    const classesSet = new Set(detections.map((d) => d.label || "OBJECT"));
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
                  <IntelTag>{d.label || "OBJECT"}</IntelTag> (
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
          const label = d.label || "OBJECT";
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

  const isPrimaryPulsing = !!(threat?.isHarm && !threatAcknowledged);

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground transition-colors duration-300">
      {/* ── HEADER PANEL ── */}
      <MonitorHeader
        isPrimaryPulsing={isPrimaryPulsing}
        isProcessing={isProcessing}
        utcTime={utcTime}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        setShowThreatLogPanel={setShowThreatLogPanel}
      />

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
                            {det.label || "OBJECT"}{" "}
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
                  <ThreatAlertCard
                    threat={threat}
                    threatAcknowledged={threatAcknowledged}
                    setThreatAcknowledged={setThreatAcknowledged}
                    setZoomImageUrl={setZoomImageUrl}
                  />
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
          <IntelLogStream
            logEntries={logEntries}
            intelLogScrollRef={intelLogScrollRef}
          />

          {/* Active Detections Summary Panel (30% width) */}
          <StatsPanel
            systemLoad={systemLoad}
            sortedSessionTotals={sortedSessionTotals}
          />
        </div>

        {/* ── SLIDE-OVER THREAT LOG DRAWER (ALERTS LIST VIEWER) ── */}
        <ThreatsDrawer
          showThreatLogPanel={showThreatLogPanel}
          setShowThreatLogPanel={setShowThreatLogPanel}
          threatLogList={threatLogList}
          loadingThreatLog={loadingThreatLog}
          fetchThreatLog={fetchThreatLog}
          setZoomImageUrl={setZoomImageUrl}
        />

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
