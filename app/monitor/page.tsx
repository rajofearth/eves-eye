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
import { SettingsDrawer } from "@/components/monitor/settings-drawer";

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------
interface MockCamera {
  id: string;
  name: string;
  cameraId: string;
  sourceType: "device" | "simulated" | "video";
  videoUrl?: string;
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
  // --- Dynamic Cameras State ---
  const [cameras, setCameras] = useState<MockCamera[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("eves_eye_cameras");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // ignore
        }
      }
    }
    return INITIAL_CAMERAS;
  });

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
  const [lastLoggedClassesMap, setLastLoggedClassesMap] = useState<Record<string, string>>({});

  // --- Threat Management States ---
  const [lastThreatReason, setLastThreatReason] = useState<string>("");
  const [threatAcknowledged, setThreatAcknowledged] = useState<boolean>(false);

  // --- Drawers Panels States ---
  const [showThreatLogPanel, setShowThreatLogPanel] = useState<boolean>(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState<boolean>(false);
  const [threatLogList, setThreatLogList] = useState<SQLiteThreatLog[]>([]);
  const [loadingThreatLog, setLoadingThreatLog] = useState<boolean>(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  const intelLogScrollRef = useRef<HTMLDivElement>(null);

  // --- Separate Video References for 4 Camera Slots ---
  const cam1Ref = useRef<HTMLVideoElement | null>(null);
  const cam2Ref = useRef<HTMLVideoElement | null>(null);
  const cam3Ref = useRef<HTMLVideoElement | null>(null);
  const cam4Ref = useRef<HTMLVideoElement | null>(null);

  const getRefForCameraId = (id: string) => {
    if (cameras[0]?.id === id) return cam1Ref;
    if (cameras[1]?.id === id) return cam2Ref;
    if (cameras[2]?.id === id) return cam3Ref;
    if (cameras[3]?.id === id) return cam4Ref;
    return undefined;
  };

  // --- Camera 1 Real-time Object & Threat Detection Hook ---
  const active1 = cameras[0]?.sourceType === "device" ? !!stream : (cameras[0]?.sourceType === "video" && !!cameras[0]?.videoUrl);
  const det1 = useWebcamDetect(cam1Ref, active1, {
    maxFps: 0.15,
    minConfidence: 0.45,
    cameraId: cameras[0]?.cameraId || "CAM-01-WEBCAM",
  });

  // --- Camera 2 Real-time Object & Threat Detection Hook ---
  const active2 = cameras[1]?.sourceType === "device" ? !!stream : (cameras[1]?.sourceType === "video" && !!cameras[1]?.videoUrl);
  const det2 = useWebcamDetect(cam2Ref, active2, {
    maxFps: 0.15,
    minConfidence: 0.45,
    cameraId: cameras[1]?.cameraId || "CAM-02-NORTH",
  });

  // --- Camera 3 Real-time Object & Threat Detection Hook ---
  const active3 = cameras[2]?.sourceType === "device" ? !!stream : (cameras[2]?.sourceType === "video" && !!cameras[2]?.videoUrl);
  const det3 = useWebcamDetect(cam3Ref, active3, {
    maxFps: 0.15,
    minConfidence: 0.45,
    cameraId: cameras[2]?.cameraId || "CAM-03-GATE",
  });

  // --- Camera 4 Real-time Object & Threat Detection Hook ---
  const active4 = cameras[3]?.sourceType === "device" ? !!stream : (cameras[3]?.sourceType === "video" && !!cameras[3]?.videoUrl);
  const det4 = useWebcamDetect(cam4Ref, active4, {
    maxFps: 0.15,
    minConfidence: 0.45,
    cameraId: cameras[3]?.cameraId || "CAM-04-SERVER",
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

  // --- Multi-Camera Threat Interceptor & Auto-Promotion ---
  useEffect(() => {
    const detectorsList = [
      { cam: cameras[0], det: det1 },
      { cam: cameras[1], det: det2 },
      { cam: cameras[2], det: det3 },
      { cam: cameras[3], det: det4 },
    ];

    for (const item of detectorsList) {
      if (!item.cam) continue;
      const t = item.det.threat;
      if (t?.isHarm && t.reason !== lastThreatReason) {
        setLastThreatReason(t.reason);
        setThreatAcknowledged(false); // Fire a new alert card!

        // Automatically promote camera if threat found on inactive channel
        if (activeCameraId !== item.cam.id) {
          setActiveCameraId(item.cam.id);
          setLogEntries((prev) => [
            ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
            {
              id: uid(),
              timestamp: nowTimestamp(),
              source: "SYS",
              message: `· Stream Manager: Auto-promoted ${item.cam.cameraId} (${item.cam.name.toUpperCase()}) to primary feed due to high-severity threat.`,
            },
          ]);
        }

        // Log security event in red in the scrolling terminal log
        setLogEntries((prev) => [
          ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
          {
            id: uid(),
            timestamp: nowTimestamp(),
            source: "CRIT",
            message: (
              <span className="font-bold text-red-500 animate-pulse tracking-wide">
                !!! THREAT DETECTED ON {item.cam.cameraId}: {t.reason.toUpperCase()}
              </span>
            ),
          },
        ]);
      }
    }
  }, [
    det1.threat,
    det2.threat,
    det3.threat,
    det4.threat,
    cameras,
    lastThreatReason,
    activeCameraId,
  ]);

  // --- Dynamic Core Log and Totals statistics correlation from all 4 detectors ---
  useEffect(() => {
    const detectorsList = [
      { cam: cameras[0], det: det1 },
      { cam: cameras[1], det: det2 },
      { cam: cameras[2], det: det3 },
      { cam: cameras[3], det: det4 },
    ];

    for (const item of detectorsList) {
      if (!item.cam || item.det.detections.length === 0) continue;

      const classesSet = new Set(item.det.detections.map((d) => d.label || "OBJECT"));
      const classesStr = Array.from(classesSet).sort().join(",");
      const prevStr = lastLoggedClassesMap[item.cam.id] || "";

      if (classesStr !== prevStr) {
        setLastLoggedClassesMap((prev) => ({ ...prev, [item.cam.id]: classesStr }));

        const time = nowTimestamp();

        setLogEntries((prev) => [
          ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
          {
            id: uid(),
            timestamp: time,
            source: "VLM",
            message: (
              <>
                · Objects identified on {item.cam.cameraId} ({item.cam.name.toUpperCase()}):{" "}
                {item.det.detections.map((d, index) => (
                  <span
                    key={`log-item-${item.cam.id}-${index}-${d.class}-${d.confidence}`}
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
          for (const d of item.det.detections) {
            const label = d.label || "OBJECT";
            next.set(label, (next.get(label) ?? 0) + 1);
          }
          return next;
        });
      }
    }
  }, [
    det1.detections,
    det2.detections,
    det3.detections,
    det4.detections,
    cameras,
    lastLoggedClassesMap,
  ]);

  // --- Log error warnings if detection fails ---
  useEffect(() => {
    const detectorsList = [
      { cam: cameras[0], det: det1 },
      { cam: cameras[1], det: det2 },
      { cam: cameras[2], det: det3 },
      { cam: cameras[3], det: det4 },
    ];
    for (const item of detectorsList) {
      if (item.cam && item.det.error) {
        setLogEntries((prev) => [
          ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
          {
            id: uid(),
            timestamp: nowTimestamp(),
            source: "SYS",
            message: `· WARNING (${item.cam.cameraId}): ${item.det.error}`,
          },
        ]);
      }
    }
  }, [det1.error, det2.error, det3.error, det4.error, cameras]);

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
    const targetCam = cameras.find((c) => c.id === id);
    if (targetCam) {
      setLogEntries((prev) => [
        ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
        {
          id: uid(),
          timestamp: nowTimestamp(),
          source: "SYS",
          message: `· Stream Manager: Promoted camera ${targetCam.cameraId} (${targetCam.name.toUpperCase()}) to primary feed.`,
        },
      ]);
    }
  };

  const handleSaveCameras = (updated: MockCamera[]) => {
    setCameras(updated);
    localStorage.setItem("eves_eye_cameras", JSON.stringify(updated));
    setLogEntries((prev) => [
      ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
      {
        id: uid(),
        timestamp: nowTimestamp(),
        source: "SYS",
        message: "· Settings: Reconfigured dynamic camera feeds.",
      },
    ]);
  };

  // --- Derived Values ---
  const activeCamera =
    cameras.find((c) => c.id === activeCameraId) ?? cameras[0] ?? INITIAL_CAMERAS[0];
  const gridCameras = cameras.filter((c) => c.id !== activeCameraId);

  const getDetectorForCameraId = (id: string) => {
    if (cameras[0]?.id === id) return det1;
    if (cameras[1]?.id === id) return det2;
    if (cameras[2]?.id === id) return det3;
    if (cameras[3]?.id === id) return det4;
    return { detections: [], lastLatency: null, isProcessing: false, error: null, frameDimensions: null, threat: null };
  };

  const activeDetector = getDetectorForCameraId(activeCamera.id);

  const sortedSessionTotals = useMemo(() => {
    return [...sessionTotals.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessionTotals]);

  const isPrimaryPulsing = !!(activeDetector.threat?.isHarm && !threatAcknowledged);

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground transition-colors duration-300">
      {/* ── HEADER PANEL ── */}
      <MonitorHeader
        isPrimaryPulsing={isPrimaryPulsing}
        isProcessing={det1.isProcessing || det2.isProcessing || det3.isProcessing || det4.isProcessing}
        utcTime={utcTime}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        setShowThreatLogPanel={setShowThreatLogPanel}
        setShowSettingsPanel={setShowSettingsPanel}
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
              videoRef={getRefForCameraId(activeCamera.id)}
              overlays={
                <>
                  {/* Real Bounding Box Highlights */}
                  {activeDetector.frameDimensions &&
                    activeDetector.detections.map((det, index) => {
                      const fw = activeDetector.frameDimensions.width || 640;
                      const fh = activeDetector.frameDimensions.height || 480;

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
                        variant={activeDetector.isProcessing ? "warning" : "nominal"}
                        className="font-semibold"
                      >
                        {activeDetector.isProcessing ? "ANALYZING..." : "GEMMA 4 31B"}
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
                      {activeDetector.lastLatency !== null
                        ? `${activeDetector.lastLatency.toFixed(0)}ms`
                        : "N/A"}
                    </MonoLabel>
                  </div>

                  {/* FLOATING THREAT ALERT */}
                  <ThreatAlertCard
                    threat={activeDetector.threat}
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
                videoRef={getRefForCameraId(camera.id)}
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
        {/* ── SETTINGS CONFIGURATION SIDEBAR DRAWER ── */}
        <SettingsDrawer
          show={showSettingsPanel}
          onClose={() => setShowSettingsPanel(false)}
          cameras={cameras}
          onSaveCameras={handleSaveCameras}
        />
      </main>
    </div>
  );
}
