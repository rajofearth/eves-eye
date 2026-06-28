"use client";

import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Database,
  Download,
  Eye,
  FileText,
  Maximize2,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  Sun,
  Upload,
  UserCheck,
  Video,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MonoLabel } from "@/components/ui/mono-label";
import { StatusDot, StatusIndicator } from "@/components/ui/status-dot";

// ---------------------------------------------------------------------------
// Mock Constants
// ---------------------------------------------------------------------------
interface PipelineStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: "pending" | "active" | "complete" | "error";
  progress?: number;
}

interface FaceCrop {
  id: string;
  label: string | null;
  status: "processed" | "critical" | "processing" | "empty";
  avatarCode: string;
}

interface EventRow {
  time: string;
  cam: string;
  cls: string;
  conf: string;
  note: string;
  tone: "normal" | "warning" | "critical";
  seconds: number;
}

const MOCK_EVENTS: EventRow[] = [
  {
    time: "14:21:10.05",
    cam: "NORTH_ENT",
    cls: "PERSON",
    conf: "0.94",
    note: "SUBJECT SPOTTED IN REAR PARKING CORRIDOR.",
    tone: "normal",
    seconds: 15,
  },
  {
    time: "14:21:45.22",
    cam: "NORTH_ENT",
    cls: "SUSPICIOUS",
    conf: "0.88",
    note: "SUBJECT LOITERING NEAR ACCESS DOOR B. CROWBAR IDENTIFIED.",
    tone: "critical",
    seconds: 40,
  },
  {
    time: "14:22:01.00",
    cam: "NORTH_ENT",
    cls: "VEHICLE",
    conf: "0.91",
    note: "WHITE UTILITY VAN PARKED IN IDLE ZONE.",
    tone: "warning",
    seconds: 65,
  },
  {
    time: "14:22:04.15",
    cam: "NORTH_ENT",
    cls: "PERSON",
    conf: "0.96",
    note: "CO-CONSPIRATOR SPOTTED ENTERING SCANNING FRAME.",
    tone: "normal",
    seconds: 85,
  },
];

export default function AnalysisPage() {
  const pathname = usePathname();
  // --- Page States ---
  const [selectedVideoName, setSelectedVideoName] = useState<string | null>(
    null,
  );
  const [uploadPhase, setUploadPhase] = useState<
    "idle" | "uploading" | "extracting" | "analyzing" | "completed"
  >("idle");
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [utcTime, setUtcTime] = useState<string>("");
  const [showToast, setShowToast] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(true);

  // Sync dark class on root html tag
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Clock updates ---
  useEffect(() => {
    const updateClock = () => {
      const d = new Date();
      setUtcTime(`${d.toUTCString().slice(17, 25)} UTC`);
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Mock Pipeline Process Animation ---
  const startMockPipeline = (filename: string) => {
    setSelectedVideoName(filename);
    setUploadPhase("uploading");
    setPipelineProgress(0);

    let progress = 0;
    const uploadInterval = setInterval(() => {
      progress += 15;
      if (progress >= 100) {
        clearInterval(uploadInterval);
        setUploadPhase("extracting");
        setPipelineProgress(50);

        // Extraction phase
        setTimeout(() => {
          setUploadPhase("analyzing");
          setPipelineProgress(75);

          // Analysis phase
          let analysisProgress = 75;
          const analysisInterval = setInterval(() => {
            analysisProgress += 5;
            setPipelineProgress(analysisProgress);
            if (analysisProgress >= 100) {
              clearInterval(analysisInterval);
              setUploadPhase("completed");
              setIsPlaying(true);
            }
          }, 300);
        }, 1200);
      } else {
        setPipelineProgress(progress);
      }
    }, 150);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      startMockPipeline(file.name.toUpperCase());
    }
  };

  const handleFileBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      startMockPipeline(file.name.toUpperCase());
    }
  };

  // --- Simulated Video Player Playback ---
  useEffect(() => {
    if (isPlaying && uploadPhase === "completed") {
      videoIntervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= 100) {
            return 0; // Loop video
          }
          return prev + 1;
        });
      }, 200);
    } else {
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
      }
    }

    return () => {
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
      }
    };
  }, [isPlaying, uploadPhase]);

  // --- Reset/Fresh actions ---
  const handleReset = () => {
    setSelectedVideoName(null);
    setUploadPhase("idle");
    setPipelineProgress(0);
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const triggerToast = (msg: string) => {
    setShowToast(msg);
    setTimeout(() => setShowToast(null), 3000);
  };

  // --- Build Dynamic Pipeline Steps ---
  const pipelineSteps = useMemo<PipelineStep[]>(() => {
    const isDone = (phase: typeof uploadPhase) => {
      const order = [
        "idle",
        "uploading",
        "extracting",
        "analyzing",
        "completed",
      ];
      return order.indexOf(uploadPhase) > order.indexOf(phase);
    };
    const isActive = (phase: typeof uploadPhase) => uploadPhase === phase;

    return [
      {
        id: "uploading",
        label: "Payload Pre-processing",
        icon: <Upload className="w-3.5 h-3.5" />,
        status: isDone("uploading")
          ? "complete"
          : isActive("uploading")
            ? "active"
            : "pending",
        progress: isActive("uploading") ? pipelineProgress : undefined,
      },
      {
        id: "extracting",
        label: "Temporal Frame Extraction",
        icon: <Video className="w-3.5 h-3.5" />,
        status: isDone("extracting")
          ? "complete"
          : isActive("extracting")
            ? "active"
            : "pending",
        progress: isActive("extracting") ? 50 : undefined,
      },
      {
        id: "analyzing",
        label: "VLM Object Scanning (Gemma)",
        icon: <Eye className="w-3.5 h-3.5" />,
        status: isDone("analyzing")
          ? "complete"
          : isActive("analyzing")
            ? "active"
            : "pending",
        progress: isActive("analyzing") ? pipelineProgress : undefined,
      },
      {
        id: "completed",
        label: "Intelligence Report Generation",
        icon: <FileText className="w-3.5 h-3.5" />,
        status: uploadPhase === "completed" ? "complete" : "pending",
      },
    ];
  }, [uploadPhase, pipelineProgress]);

  // --- Face crops mock ---
  const faceCrops = useMemo<FaceCrop[]>(() => {
    if (uploadPhase === "idle" || uploadPhase === "uploading") {
      return Array(3).fill({ status: "empty", label: null, avatarCode: "" });
    }
    if (uploadPhase === "extracting" || uploadPhase === "analyzing") {
      return [
        {
          id: "face-1",
          status: "processed",
          label: "UID: P-4921",
          avatarCode: "F1",
        },
        {
          id: "face-2",
          status: "processing",
          label: "ANALYZING...",
          avatarCode: "F2",
        },
        { id: "face-3", status: "empty", label: null, avatarCode: "" },
      ];
    }
    return [
      {
        id: "face-1",
        status: "processed",
        label: "UID: P-4921",
        avatarCode: "F1",
      },
      {
        id: "face-2",
        status: "critical",
        label: "UID: UNKNOWN",
        avatarCode: "XX",
      },
      {
        id: "face-3",
        status: "processed",
        label: "UID: P-5510",
        avatarCode: "F3",
      },
    ];
  }, [uploadPhase]);

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground transition-colors duration-300">
      {/* ── HEADER PANEL ── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/45 backdrop-blur-md px-4 py-1.5 z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/monitor"
            className="flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 rounded-sm px-2.5 py-0.5 border border-primary/20 transition-all font-bold"
          >
            <Shield className="w-4 h-4 text-primary" />
            <span className="font-heading text-xs font-semibold uppercase tracking-wider text-primary">
              EVE&apos;S EYE
            </span>
          </Link>

          <div className="hidden md:inline-flex items-center gap-1 bg-muted px-2 py-0.5 border border-border/80 text-[10px] font-mono text-muted-foreground uppercase rounded-xs">
            VIDEO_INTELLIGENCE_ANALYZER
          </div>

          <nav className="flex items-center gap-4 ml-4 pl-4 border-l border-border/80">
            <Link
              href="/monitor"
              className={`font-mono text-[10px] font-bold uppercase tracking-wider transition-all pb-0.5 hover:text-foreground ${
                pathname === "/monitor"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
            >
              Live_Monitor
            </Link>
            <Link
              href="/analysis"
              className={`font-mono text-[10px] font-bold uppercase tracking-wider transition-all pb-0.5 hover:text-foreground ${
                pathname === "/analysis"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
            >
              Video_Analysis
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
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

      {/* ── MAIN LAYOUT CONTENT ── */}
      <main className="flex flex-1 gap-3 overflow-hidden p-3 lg:gap-4 lg:p-4">
        {/* ── LEFT SIDEBAR: PAYLOAD DROPZONE & PIPELINE ── */}
        <aside className="w-72 flex flex-col gap-3 shrink-0 h-full min-h-0">
          {/* Source Payload card */}
          <div className="bg-card border border-border rounded-md p-4 flex flex-col gap-3 shadow-xs shrink-0">
            <MonoLabel
              size="xs"
              variant="muted"
              className="font-bold uppercase tracking-wider"
            >
              Source Payload
            </MonoLabel>

            {/* Drop zone */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Drag and drop container */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: Mock dropzone upload button */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all bg-zinc-950/15 p-6 flex flex-col items-center justify-center text-center gap-2 cursor-pointer h-32 rounded-sm select-none"
            >
              <Upload
                className={`w-7 h-7 text-muted-foreground ${uploadPhase === "uploading" ? "animate-bounce text-primary" : ""}`}
              />
              <span className="text-[10px] font-mono text-zinc-400 leading-normal max-w-[200px] uppercase">
                {selectedVideoName ? (
                  <span className="text-primary font-bold">
                    {selectedVideoName}
                  </span>
                ) : (
                  <>
                    Drag &amp; drop video payload
                    <br />
                    or{" "}
                    <span className="text-primary underline">
                      browse folder
                    </span>
                  </>
                )}
              </span>
            </div>

            <div className="flex justify-between items-center text-[9px] font-mono text-muted-foreground">
              <span>LIMIT: 2GB (MP4, MKV)</span>
              <span>H.264/H.265</span>
            </div>

            {/* Action buttons */}
            {selectedVideoName && (
              <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[9px] font-mono font-bold text-muted-foreground hover:text-white uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Replace
                </button>
                <span className="text-border/60">|</span>
                <button
                  type="button"
                  onClick={() => startMockPipeline(selectedVideoName)}
                  className="text-[9px] font-mono font-bold text-muted-foreground hover:text-white uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Fresh Run
                </button>
                <span className="text-border/60">|</span>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-[9px] font-mono font-bold text-red-500 hover:text-red-400 uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Clear Cache
                </button>
              </div>
            )}
          </div>

          {/* Analysis Pipeline Card */}
          <div className="flex-1 bg-card border border-border rounded-md p-4 flex flex-col overflow-hidden shadow-xs">
            <div className="flex justify-between items-center mb-3 shrink-0">
              <MonoLabel
                size="xs"
                variant="muted"
                className="font-bold uppercase tracking-wider"
              >
                Analysis Pipeline
              </MonoLabel>
              {selectedVideoName && (
                <span className="px-1.5 py-0.5 bg-muted border border-border text-[8px] font-mono text-muted-foreground rounded-xs leading-none">
                  {uploadPhase === "completed"
                    ? "IDLE_COMPLETE"
                    : "RUNNING_VLM"}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              <ul className="flex flex-col font-mono text-2xs space-y-1">
                {pipelineSteps.map((step, idx) => {
                  const isLast = idx === pipelineSteps.length - 1;
                  const isActive = step.status === "active";
                  const isComplete = step.status === "complete";

                  return (
                    <li
                      key={step.id}
                      className="flex flex-col relative select-none"
                    >
                      <div
                        className={`flex items-center gap-3 py-2 px-2.5 rounded-sm border ${
                          isActive
                            ? "bg-primary/5 border-primary/30 text-white font-bold"
                            : isComplete
                              ? "bg-muted/10 border-border/40 text-zinc-400"
                              : "bg-transparent border-transparent text-muted-foreground"
                        }`}
                      >
                        <div
                          className={`p-1 rounded-full ${isComplete ? "text-emerald-500" : isActive ? "text-primary animate-pulse" : "text-muted-foreground"}`}
                        >
                          {step.icon}
                        </div>
                        <span className="uppercase text-[9px] tracking-wide">
                          {step.label}
                        </span>
                        {isActive && step.progress !== undefined && (
                          <span className="ml-auto text-[8px] text-primary">
                            {step.progress}%
                          </span>
                        )}
                        {isComplete && (
                          <span className="ml-auto text-[8px] text-emerald-500 font-bold">
                            100%
                          </span>
                        )}
                      </div>
                      {!isLast && (
                        <div className="pl-5.5 py-1">
                          <div
                            className={`w-px h-3.5 border-l ${isComplete ? "border-emerald-500/40" : "border-border/60"}`}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </aside>

        {/* ── CENTER/RIGHT CONTAINER: VIDEO PLAYER & METRICS ── */}
        <section className="flex-1 flex flex-col gap-3 min-w-0 h-full">
          {/* Main Video Viewport Panel (flex-3) */}
          <div className="flex-3 bg-card border border-border rounded-md relative overflow-hidden flex flex-col min-h-0 shadow-xs">
            {/* Header toolbar */}
            <div className="h-8 border-b border-border bg-muted/40 px-3 flex items-center justify-between shrink-0">
              <span className="font-mono text-[9px] text-zinc-300 font-bold uppercase tracking-wider">
                {selectedVideoName
                  ? `MEDIA_FEED // ${selectedVideoName}`
                  : "PLAYER_AWAITING_INPUT"}
              </span>
              <div className="flex items-center gap-2">
                <StatusDot
                  variant={uploadPhase === "completed" ? "nominal" : "silver"}
                  pulse={uploadPhase !== "idle"}
                  size="xs"
                />
                <span className="font-mono text-[8px] text-muted-foreground uppercase leading-none">
                  {uploadPhase.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Video Screen Container */}
            <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden group">
              {selectedVideoName ? (
                <>
                  {/* Simulated surveillance grid lines */}
                  <div
                    className="absolute inset-margin border border-white/5 pointer-events-none z-10"
                    style={{ margin: "24px" }}
                  />
                  <div className="absolute top-8 left-8 text-primary/60 font-mono text-[8px] tracking-widest z-10">
                    CAM-02-NORTH // ANALYZING_VLM
                  </div>
                  <div className="absolute top-8 right-8 text-primary/60 font-mono text-[8px] tracking-widest z-10">
                    24-FRAME_BUFFER
                  </div>

                  {/* Pulsing REC indicator */}
                  <div className="absolute bottom-8 left-8 flex items-center gap-1.5 z-10">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-mono text-[8px] text-red-500 font-bold">
                      ANALYZING
                    </span>
                  </div>

                  <div className="absolute bottom-8 right-8 text-zinc-500 font-mono text-[8px] z-10">
                    TIME_REF: {currentTime}s / 100s
                  </div>

                  {/* Bounding box mock highlights - visible when playing */}
                  {currentTime >= 10 && currentTime <= 40 && (
                    <div className="absolute top-[28%] left-[40%] w-36 h-60 border-2 border-primary bg-primary/5 rounded-xs pointer-events-none transition-all duration-100 z-10">
                      <div className="absolute top-0 left-0 bg-primary px-1.5 py-0.5 text-primary-foreground font-mono text-[8px] font-bold uppercase tracking-wider translate-y-[-100%] rounded-t-xs">
                        PERSON 94%
                      </div>
                    </div>
                  )}

                  {currentTime >= 35 && currentTime <= 75 && (
                    <div className="absolute top-[40%] left-[18%] w-28 h-44 border-2 border-red-500 bg-red-500/5 rounded-xs pointer-events-none transition-all duration-100 z-10">
                      <div className="absolute top-0 left-0 bg-red-500 px-1.5 py-0.5 text-white font-mono text-[8px] font-bold uppercase tracking-wider translate-y-[-100%] rounded-t-xs flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        CRITICAL: CROWBAR 88%
                      </div>
                    </div>
                  )}

                  {/* Dark placeholders representing video feed */}
                  <div className="w-full h-full bg-radial from-zinc-900 to-black flex items-center justify-center opacity-85 select-none">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <Video className="w-10 h-10 text-primary/40 animate-pulse" />
                      <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest leading-normal">
                        SURVEILLANCE_PAYLOAD_MOUNTED
                        <br />
                        <span className="text-[8px] text-muted-foreground">
                          SCANNING COGNITIVE FRAMES
                        </span>
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center p-6 select-none bg-zinc-950/40">
                  <Upload className="w-10 h-10 text-muted-foreground/30 animate-pulse" />
                  <MonoLabel size="xs" variant="muted" className="font-bold">
                    AWAITING_SOURCE_PAYLOAD
                  </MonoLabel>
                  <span className="font-mono text-[9px] text-muted-foreground/50 max-w-[220px] uppercase leading-normal">
                    Please drag a video file onto the drop zone or browse files
                    to begin intelligence extraction.
                  </span>
                </div>
              )}
            </div>

            {/* Custom Video Controls bar */}
            {selectedVideoName && uploadPhase === "completed" && (
              <div className="h-10 border-t border-border bg-muted/30 px-3 flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="p-1 rounded-sm hover:bg-muted text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  type="button"
                  title={isPlaying ? "Pause Feed" : "Play Feed"}
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Scrubber timeline */}
                <div className="flex-1 flex items-center relative h-6 group/timeline">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={currentTime}
                    onChange={(e) => {
                      setCurrentTime(Number(e.target.value));
                      setIsPlaying(false); // pause on scrubbing
                    }}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
                  />

                  {/* Event markers on timeline */}
                  <div
                    className="absolute left-[15%] w-1.5 h-1.5 rounded-full bg-primary/70 pointer-events-none"
                    title="Event spotted (15s)"
                  />
                  <div
                    className="absolute left-[40%] w-1.5 h-1.5 rounded-full bg-red-500/80 pointer-events-none"
                    title="Threat spotted (40s)"
                  />
                  <div
                    className="absolute left-[65%] w-1.5 h-1.5 rounded-full bg-amber-500/70 pointer-events-none"
                    title="Vehicle spotted (65s)"
                  />
                </div>

                <span className="font-mono text-[9px] text-zinc-400 select-none">
                  {currentTime}s / 100s
                </span>
              </div>
            )}
          </div>

          {/* VLM Summary strip (only visible when analysis completes) */}
          {uploadPhase === "completed" && (
            <div className="border border-border bg-card/65 rounded-md p-4 shrink-0 shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[9px] text-zinc-400 font-bold uppercase tracking-wider">
                  AI Context Intelligence
                </span>
                <span className="font-mono text-[8px] text-emerald-500 font-bold uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  Gemma 4 Summarized
                </span>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-zinc-300 uppercase tracking-wide">
                SURVEILLANCE INTEL: Captured a subject loitering near restricted
                access door B. Verified item held matches crowbar dimensions.
                Co-conspirator spotted entering east corridor at 14:22:04.
                Synced local index references to threat log database.
              </p>
            </div>
          )}

          {/* Bottom row (flex-2) */}
          <div className="flex-2 flex gap-3 overflow-hidden min-h-0">
            {/* Face Track Cluster Panel */}
            <div className="w-80 bg-card border border-border rounded-md flex flex-col overflow-hidden shrink-0 shadow-xs">
              <div className="h-8 border-b border-border bg-muted/40 px-3 flex items-center justify-between shrink-0">
                <span className="font-mono text-[9px] text-zinc-300 font-bold uppercase tracking-wider">
                  Face Track Cluster
                </span>
                <span className="material-symbols-outlined text-[14px] text-muted-foreground">
                  <UserCheck className="w-3.5 h-3.5 text-primary" />
                </span>
              </div>

              <div className="flex-1 p-3 grid grid-cols-3 gap-2 overflow-y-auto content-start">
                {faceCrops.map((crop, idx) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: static mock array
                    key={`face-${idx}`}
                    className={`aspect-square border rounded-md relative flex flex-col items-center justify-center bg-zinc-950/15 ${
                      crop.status === "critical"
                        ? "border-red-500/35 bg-red-950/10"
                        : crop.status === "processed"
                          ? "border-primary/25"
                          : crop.status === "processing"
                            ? "border-amber-500/25 animate-pulse"
                            : "border-border/30"
                    }`}
                  >
                    {crop.status === "empty" ? (
                      <div className="font-mono text-[7px] text-muted-foreground uppercase">
                        EMPTY_SLOT
                      </div>
                    ) : crop.status === "processing" ? (
                      <div className="font-mono text-[7px] text-amber-500 font-bold uppercase tracking-wider text-center px-1">
                        EXTRACTING
                      </div>
                    ) : (
                      <>
                        <div
                          className={`w-8 h-8 rounded-full border flex items-center justify-center font-mono font-bold text-xs ${
                            crop.status === "critical"
                              ? "bg-red-500/20 border-red-500 text-red-400"
                              : "bg-primary/20 border-primary text-primary"
                          }`}
                        >
                          {crop.avatarCode}
                        </div>
                        <div
                          className={`absolute bottom-0 w-full text-center py-0.5 rounded-b-md font-mono text-[7px] font-bold ${
                            crop.status === "critical"
                              ? "bg-red-950/80 text-red-400 border-t border-red-500/20"
                              : "bg-muted/80 text-zinc-400 border-t border-border/30"
                          }`}
                        >
                          {crop.label}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Analysis Event Log Table */}
            <div className="flex-1 bg-card border border-border rounded-md flex flex-col overflow-hidden shadow-xs">
              <div className="h-8 border-b border-border bg-muted/40 px-3 flex items-center justify-between shrink-0">
                <span className="font-mono text-[9px] text-zinc-300 font-bold uppercase tracking-wider">
                  Analysis Event Log
                </span>

                {uploadPhase === "completed" && (
                  <button
                    onClick={() =>
                      triggerToast("REPORT EXPORTED: check public/reports/")
                    }
                    className="bg-primary text-primary-foreground px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider rounded-xs hover:bg-primary/95 transition-all flex items-center gap-1.5 cursor-pointer"
                    type="button"
                  >
                    <Download className="w-2.5 h-2.5" />
                    EXPORT_REPORT
                  </button>
                )}
              </div>

              {/* Table header */}
              <div className="grid grid-cols-12 gap-2 px-3 py-1.5 border-b border-border bg-muted/20 font-mono text-[8px] text-muted-foreground uppercase tracking-wider shrink-0 select-none">
                <div className="col-span-2">TIME</div>
                <div className="col-span-2">CAMERA</div>
                <div className="col-span-2">CLASS</div>
                <div className="col-span-1 text-right">CONF</div>
                <div className="col-span-5 pl-3">VLM NOTE</div>
              </div>

              {/* Table body */}
              <div className="flex-1 overflow-y-auto font-mono text-[9px]">
                {uploadPhase === "idle" ? (
                  <div className="flex h-full items-center justify-center select-none">
                    <span className="font-mono text-[8px] text-muted-foreground/50 uppercase">
                      AWAITING_PIPELINE_INIT...
                    </span>
                  </div>
                ) : (
                  MOCK_EVENTS.map((row) => {
                    const isPassed =
                      currentTime >= row.seconds || uploadPhase === "completed";
                    if (!isPassed) return null;

                    return (
                      <button
                        type="button"
                        key={`${row.time}-${row.cls}`}
                        onClick={() => {
                          setCurrentTime(row.seconds);
                          setIsPlaying(false);
                        }}
                        className={`grid grid-cols-12 gap-2 px-3 py-1.5 border-b border-border/40 items-center relative transition-colors cursor-pointer w-full text-left font-mono text-[9px] ${
                          row.tone === "critical"
                            ? "bg-red-950/20 hover:bg-red-950/35 text-red-400"
                            : row.tone === "warning"
                              ? "bg-amber-950/20 hover:bg-amber-950/35 text-amber-400"
                              : "hover:bg-muted/15 text-zinc-300"
                        }`}
                      >
                        <div className="col-span-2">{row.time}</div>
                        <div className="col-span-2 truncate text-zinc-400">
                          {row.cam}
                        </div>
                        <div
                          className={`col-span-2 font-bold ${row.tone === "critical" ? "text-red-500 animate-pulse" : ""}`}
                        >
                          {row.cls}
                        </div>
                        <div className="col-span-1 text-right text-zinc-400">
                          {row.conf}
                        </div>
                        <div
                          className="col-span-5 pl-3 truncate text-zinc-400"
                          title={row.note}
                        >
                          {row.note}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileBrowse}
      />

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed bottom-4 right-4 z-50 bg-emerald-950 border border-emerald-500 text-emerald-400 px-4 py-2 text-xs font-mono rounded-md shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
          {showToast}
        </div>
      )}
    </div>
  );
}
