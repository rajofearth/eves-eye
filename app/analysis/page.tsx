"use client";

import {
  AlertTriangle,
  Clock,
  Download,
  Eye,
  FileText,
  Moon,
  Pause,
  Play,
  Shield,
  Sparkles,
  Sun,
  Upload,
  UserCheck,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MonoLabel } from "@/components/ui/mono-label";
import { StatusDot } from "@/components/ui/status-dot";

interface PipelineStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: "pending" | "active" | "complete" | "error";
  progress?: number;
}

interface FaceCrop {
  id: string;
  faceId: string;
  avatarPath: string;
  timestampSec: number;
}

interface DBVideoDetection {
  id: number;
  frameIndex: number;
  timestampSec: number;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

interface DBVideoThreat {
  id: number;
  startSec: number;
  endSec: number;
  severity: "warning" | "critical";
  reason: string;
}

interface DBVideoEvent {
  id: number;
  timeSec: number;
  cls: string;
  conf: number;
  note: string;
  tone: "normal" | "warning" | "critical";
}

export default function AnalysisPage() {
  const pathname = usePathname();
  const [showToast, setShowToast] = useState<string | null>(null);

  const triggerToast = useCallback((msg: string) => {
    setShowToast(msg);
    setTimeout(() => setShowToast(null), 3000);
  }, []);

  // --- Theme State ---
  const [darkMode, setDarkMode] = useState<boolean>(true);

  // Sync dark class on root html tag
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  // --- Real Job States ---
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<
    | "idle"
    | "uploading"
    | "pending"
    | "extracting"
    | "analyzing"
    | "summarizing"
    | "completed"
    | "error"
  >("idle");

  const [pipelineProgress, setPipelineProgress] = useState<number>(0);
  const [detections, setDetections] = useState<DBVideoDetection[]>([]);
  const [faces, setFaces] = useState<FaceCrop[]>([]);
  const [threats, setThreats] = useState<DBVideoThreat[]>([]);
  const [events, setEvents] = useState<DBVideoEvent[]>([]);
  const [vlmSummary, setVlmSummary] = useState<string>("");
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const [completedFrames, setCompletedFrames] = useState<number>(0);

  // --- Video Player States ---
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.7);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  const [utcTime, setUtcTime] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // Tracks the exact rendered area of the video element inside its container
  // (accounts for object-contain letterbox/pillarbox offsets)
  const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // --- Compute letterbox-corrected video rect ---
  // The <video> uses object-contain so the actual rendered pixels don't fill the
  // whole container when aspect ratios differ. We need to know the true video rect
  // so bounding boxes align with visible pixels.
  useEffect(() => {
    const container = videoContainerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const compute = () => {
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const vW = video.videoWidth || 16;
      const vH = video.videoHeight || 9;
      const containerAR = cW / cH;
      const videoAR = vW / vH;

      let renderW: number;
      let renderH: number;
      if (videoAR > containerAR) {
        // Letterboxed (bars on top/bottom)
        renderW = cW;
        renderH = cW / videoAR;
      } else {
        // Pillarboxed (bars on left/right)
        renderH = cH;
        renderW = cH * videoAR;
      }

      setVideoRect({
        left: (cW - renderW) / 2,
        top: (cH - renderH) / 2,
        width: renderW,
        height: renderH,
      });
    };

    const ro = new ResizeObserver(compute);
    ro.observe(container);

    video.addEventListener("loadedmetadata", compute);
    compute();

    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", compute);
    };
  }, [selectedVideoUrl]);

  // Sync volume/mute to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // Auto-play when frame analysis begins
  useEffect(() => {
    if (
      (uploadPhase === "analyzing" || uploadPhase === "summarizing") &&
      videoRef.current &&
      selectedVideoUrl
    ) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
      void videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [uploadPhase, selectedVideoUrl, volume, isMuted]);

  useEffect(() => {
    const updateClock = () => {
      const d = new Date();
      setUtcTime(`${d.toUTCString().slice(17, 25)} UTC`);
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Poll Job Status ---
  useEffect(() => {
    if (
      !activeJobId ||
      uploadPhase === "completed" ||
      uploadPhase === "error"
    ) {
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/analysis/status?jobId=${activeJobId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.ok) {
          const status = data.job.status;
          setUploadPhase(status);
          setTotalFrames(data.job.totalFrames || 0);
          setCompletedFrames(data.job.completedFrames || 0);
          setDetections(data.detections || []);
          setFaces(data.faces || []);
          setThreats(data.threats || []);
          setEvents(data.events || []);

          if (data.job.summary) {
            setVlmSummary(data.job.summary);
          }

          // Update progress metrics
          if (status === "extracting") {
            setPipelineProgress(30);
          } else if (status === "analyzing") {
            const pct = Math.round(
              (data.job.completedFrames / Math.max(data.job.totalFrames, 1)) *
                100,
            );
            setPipelineProgress(pct);
          } else if (status === "summarizing") {
            setPipelineProgress(95);
          } else if (status === "completed") {
            setPipelineProgress(100);
            triggerToast("VIDEO ANALYSIS COMPLETE");
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    // Poll every 350ms for near-instant real-time updates
    poll();
    const interval = setInterval(poll, 350);
    return () => clearInterval(interval);
  }, [activeJobId, uploadPhase, triggerToast]);

  // --- Upload Video Form Action ---
  const handleUploadVideo = async (file: File, isFresh = false) => {
    setSelectedVideoFile(file);
    setUploadPhase("uploading");
    setPipelineProgress(0);

    // Clear old UI states immediately so previously analyzed video data doesn't persist
    setDetections([]);
    setFaces([]);
    setThreats([]);
    setEvents([]);
    setVlmSummary("");

    // Generate local preview URL
    const previewUrl = URL.createObjectURL(file);
    setSelectedVideoUrl(previewUrl);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (isFresh) {
        formData.append("fresh", "true");
      }

      const res = await fetch("/api/analysis/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();

      if (data.ok) {
        setActiveJobId(data.jobId);
        setUploadPhase("pending");
        if (data.status === "completed") {
          triggerToast("CACHE HIT: Loaded pre-analyzed video report");
        } else {
          triggerToast("PAYLOAD MOUNTED: Starting background processing");
        }
      } else {
        throw new Error(data.error || "Failed to initialize analysis");
      }
    } catch (err) {
      setUploadPhase("error");
      const errMsg = err instanceof Error ? err.message : String(err);
      setVlmSummary(`Failed to process upload: ${errMsg}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleUploadVideo(file);
    }
  };

  const handleFileBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleUploadVideo(file);
    }
  };

  // --- Video Element Sync ---
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      void videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleReset = () => {
    if (selectedVideoUrl) {
      URL.revokeObjectURL(selectedVideoUrl);
    }
    setSelectedVideoFile(null);
    setSelectedVideoUrl(null);
    setActiveJobId(null);
    setUploadPhase("idle");
    setPipelineProgress(0);
    setDetections([]);
    setFaces([]);
    setThreats([]);
    setEvents([]);
    setVlmSummary("");
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  const handleClearCache = async () => {
    if (activeJobId) {
      try {
        await fetch("/api/analysis/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: activeJobId }),
        });
        triggerToast("CACHE CLEARED: Removed report & files from storage");
      } catch (err) {
        console.error("Failed to clear cache:", err);
      }
    }
    handleReset();
  };

  // --- Dynamic Pipeline Steps ---
  const pipelineSteps = useMemo<PipelineStep[]>(() => {
    const isDone = (phase: typeof uploadPhase) => {
      const order = [
        "idle",
        "uploading",
        "pending",
        "extracting",
        "analyzing",
        "summarizing",
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
      },
      {
        id: "analyzing",
        label: "Parallel VLM Analysis",
        icon: <Eye className="w-3.5 h-3.5" />,
        status: isDone("analyzing")
          ? "complete"
          : isActive("analyzing") || isActive("summarizing")
            ? "active"
            : "pending",
        progress:
          isActive("analyzing") || isActive("summarizing")
            ? pipelineProgress
            : undefined,
      },
      {
        id: "completed",
        label: "Intelligence Report Generation",
        icon: <FileText className="w-3.5 h-3.5" />,
        status:
          uploadPhase === "completed" || threats.length > 0 || events.length > 0
            ? "complete"
            : "pending",
      },
    ];
  }, [uploadPhase, pipelineProgress, threats, events]);

  // --- Active Frame Bounding Boxes ---
  const activeDetections = useMemo(() => {
    const floorTime = Math.floor(currentTime);
    // Filter active bounding boxes for the current second
    return detections.filter(
      (d) => d.frameIndex === floorTime && d.x1 > 0 && d.y1 > 0,
    );
  }, [detections, currentTime]);

  // --- Deduplicated Face gallery ---
  const uniqueFaceCrops = useMemo(() => {
    const uniqueMap = new Map<string, FaceCrop>();
    for (const f of faces) {
      uniqueMap.set(f.faceId, f);
    }
    return Array.from(uniqueMap.values());
  }, [faces]);

  // --- Export Report Action ---
  const handleExportReport = () => {
    triggerToast("INTELLIGENCE REPORT EXPORTED");
  };

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
            <Link
              href="/chat"
              className={`font-mono text-[10px] font-bold uppercase tracking-wider transition-all pb-0.5 hover:text-foreground ${
                pathname === "/chat"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
            >
              Intel_Chat
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
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Drag and drop video container */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: Double click upload option */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all bg-zinc-950/15 p-6 flex flex-col items-center justify-center text-center gap-2 cursor-pointer h-32 rounded-sm select-none"
            >
              <Upload
                className={`w-7 h-7 text-muted-foreground ${uploadPhase !== "idle" && uploadPhase !== "completed" && uploadPhase !== "error" ? "animate-bounce text-primary" : ""}`}
              />
              <span className="text-[10px] font-mono text-zinc-400 leading-normal max-w-[200px] uppercase">
                {selectedVideoFile ? (
                  <span className="text-primary font-bold">
                    {selectedVideoFile.name.toUpperCase()}
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
            {selectedVideoFile && (
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
                  onClick={() => selectedVideoFile && handleUploadVideo(selectedVideoFile, true)}
                  className="text-[9px] font-mono font-bold text-muted-foreground hover:text-white uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Fresh Run
                </button>
                <span className="text-border/60">|</span>
                <button
                  type="button"
                  onClick={handleClearCache}
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
              {activeJobId && (
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
                {selectedVideoFile
                  ? `MEDIA_FEED // ${selectedVideoFile.name.toUpperCase()}`
                  : "PLAYER_AWAITING_INPUT"}
              </span>
              <div className="flex items-center gap-2">
                <StatusDot
                  variant={
                    uploadPhase === "completed"
                      ? "nominal"
                      : uploadPhase === "error"
                        ? "critical"
                        : "silver"
                  }
                  pulse={
                    uploadPhase !== "idle" &&
                    uploadPhase !== "completed" &&
                    uploadPhase !== "error"
                  }
                  size="xs"
                />
                <span className="font-mono text-[8px] text-muted-foreground uppercase leading-none">
                  {uploadPhase.toUpperCase()}{" "}
                  {completedFrames > 0 && uploadPhase === "analyzing"
                    ? `(${completedFrames}/${totalFrames})`
                    : ""}
                </span>
              </div>
            </div>

            {/* Video Screen Container */}
            <div
              ref={videoContainerRef}
              className="flex-1 bg-black relative flex items-center justify-center overflow-hidden"
            >
              {selectedVideoUrl ? (
                <>
                  {/* Bounding box overlay — positioned over the actual rendered
                      video pixels, not the entire black container */}
                  <div
                    className="absolute pointer-events-none z-10"
                    style={{
                      left: videoRect.left,
                      top: videoRect.top,
                      width: videoRect.width,
                      height: videoRect.height,
                    }}
                  >
                    {activeDetections.map((det) => {
                      // Coordinates from SQLite are stored as 0-1000 normalised values
                      const left = det.x1 / 10;
                      const top = det.y1 / 10;
                      const width = (det.x2 - det.x1) / 10;
                      const height = (det.y2 - det.y1) / 10;

                      return (
                        <div
                          key={det.id}
                          className="absolute border-2 border-primary bg-primary/5 rounded-xs pointer-events-none transition-all duration-100"
                          style={{
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${width}%`,
                            height: `${height}%`,
                          }}
                        >
                          <div className="absolute top-0 left-0 bg-primary px-1.5 py-0.5 text-primary-foreground font-mono text-[8px] font-bold uppercase tracking-wider translate-y-[-100%] rounded-t-xs">
                            {det.label} {Math.round(det.confidence * 100)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* HTML5 Video element */}
                  {/* biome-ignore lint/a11y/useMediaCaption: Mock internal overlay handles audio output visually */}
                  <video
                    ref={videoRef}
                    src={selectedVideoUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onClick={togglePlay}
                    className="w-full h-full object-contain cursor-pointer"
                  />

                  {/* Warning Overlay Card if threat active */}
                  {threats.some(
                    (t) =>
                      currentTime >= t.startSec &&
                      currentTime <= t.endSec &&
                      t.severity === "critical",
                  ) && (
                    <div className="absolute bottom-12 left-4 border border-red-500 bg-red-950/80 backdrop-blur-md p-3 max-w-xs z-10 rounded-md shadow-2xl animate-in slide-in-from-left duration-200">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse" />
                        <span className="font-mono text-2xs font-bold text-red-400 uppercase">
                          ACTIVE_THREAT_DETECTED
                        </span>
                      </div>
                      <p className="font-mono text-[9px] text-zinc-200 uppercase leading-normal">
                        {
                          threats.find(
                            (t) =>
                              currentTime >= t.startSec &&
                              currentTime <= t.endSec &&
                              t.severity === "critical",
                          )?.reason
                        }
                      </p>
                    </div>
                  )}
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
            {selectedVideoUrl && (
              <div className="h-12 border-t border-border bg-muted/30 px-3 flex items-center gap-2 shrink-0">
                <button
                  onClick={togglePlay}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm hover:bg-muted text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  type="button"
                  title={isPlaying ? "Pause Feed" : "Play Feed"}
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>

                <div className="flex-1 min-w-0 flex items-center">
                  <div className="relative w-full h-7 flex items-center group/seek">
                    {/* Track Background & Progress Overlay */}
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 group-hover/seek:h-1.5 transition-all rounded-full bg-zinc-800/80 overflow-hidden">
                      {/* Played Progress fill */}
                      <div
                        className="absolute left-0 top-0 h-full bg-primary/20 border-r border-primary transition-all"
                        style={{
                          width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                        }}
                      />
                      {/* Threat/warning segments track */}
                      {threats.map((t) => {
                        const maxTime = duration || 100;
                        const left = (t.startSec / maxTime) * 100;
                        const width = ((t.endSec - t.startSec) / maxTime) * 100;
                        const color =
                          t.severity === "critical"
                            ? "bg-red-500/70"
                            : "bg-amber-500/70";

                        return (
                          <div
                            key={t.id}
                            className={`absolute top-0 h-full ${color}`}
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(width, 0.5)}%`,
                            }}
                            title={`${t.severity.toUpperCase()}: ${t.reason}`}
                          />
                        );
                      })}
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={duration || 100}
                      step="0.1"
                      value={currentTime}
                      onChange={(e) => handleSeek(Number(e.target.value))}
                      className="relative z-10 w-full h-7 appearance-none cursor-pointer bg-transparent focus:outline-none
                        [&::-webkit-slider-runnable-track]:bg-transparent
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:scale-0 group-hover/seek:[&::-webkit-slider-thumb]:scale-100
                        [&::-moz-range-track]:bg-transparent
                        [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:scale-0 group-hover/seek:[&::-moz-range-thumb]:scale-100"
                    />
                  </div>
                </div>

                <span className="font-mono text-[9px] text-zinc-400 select-none shrink-0 tabular-nums w-[52px] text-right">
                  {Math.floor(currentTime)}s/{Math.floor(duration)}s
                </span>

                <div className="flex items-center gap-1.5 shrink-0 border-l border-border/60 pl-2 ml-0.5">
                  <button
                    type="button"
                    onClick={() => setIsMuted((m) => !m)}
                    className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-muted text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setVolume(next);
                      if (next > 0) setIsMuted(false);
                    }}
                    style={{
                      background: `linear-gradient(to right, hsl(var(--primary)) ${(isMuted ? 0 : volume) * 100}%, hsl(var(--muted-foreground)/0.2) ${(isMuted ? 0 : volume) * 100}%)`,
                    }}
                    className="w-[72px] h-1 rounded-full appearance-none cursor-pointer focus:outline-none transition-all hover:h-1.5
                      [&::-webkit-slider-runnable-track]:bg-transparent
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm
                      [&::-moz-range-track]:bg-transparent
                      [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-sm"
                    title="Volume"
                  />
                </div>
              </div>
            )}
          </div>

          {/* VLM Summary strip */}
          {vlmSummary && (
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
                {vlmSummary}
              </p>
            </div>
          )}

          {/* Bottom row (flex-2) */}
          <div className="flex-2 flex gap-3 overflow-hidden min-h-0">
            {/* People in Video Panel */}
            <div className="w-80 bg-card border border-border rounded-md flex flex-col overflow-hidden shrink-0 shadow-xs">
              <div className="h-8 border-b border-border bg-muted/40 px-3 flex items-center justify-between shrink-0">
                <span className="font-mono text-[9px] text-zinc-300 font-bold uppercase tracking-wider">
                  People in Video
                </span>
                <UserCheck className="w-3.5 h-3.5 text-primary" />
              </div>

              <div className="flex-1 p-3 grid grid-cols-3 gap-2 overflow-y-auto content-start">
                {uniqueFaceCrops.map((crop) => (
                  <button
                    key={crop.id}
                    onClick={() => handleSeek(crop.timestampSec)}
                    className="group flex flex-col items-center gap-1.5 rounded-md border border-border bg-zinc-950/30 p-2 hover:border-primary/60 transition-all cursor-pointer"
                    type="button"
                    title={`Jump to ${crop.timestampSec}s — ${crop.faceId}`}
                  >
                    {/* biome-ignore lint/performance/noImgElement: cropped face from sharp output */}
                    <img
                      src={crop.avatarPath}
                      alt={crop.faceId}
                      className="h-16 w-16 rounded-full border-2 border-primary/30 object-cover object-center bg-zinc-900"
                    />
                    <span className="font-mono text-[7px] font-bold text-zinc-300 uppercase truncate w-full text-center">
                      {crop.faceId}
                    </span>
                  </button>
                ))}
                {uniqueFaceCrops.length === 0 &&
                  uploadPhase !== "analyzing" &&
                  uploadPhase !== "summarizing" && (
                    <div className="col-span-3 text-center py-8 font-mono text-[8px] text-muted-foreground uppercase">
                      NO_PEOPLE_IDENTIFIED
                    </div>
                  )}
                {(uploadPhase === "analyzing" || uploadPhase === "summarizing") &&
                  uniqueFaceCrops.length === 0 && (
                  <div className="col-span-3 flex flex-col items-center justify-center py-6 gap-1 border border-amber-500/25 rounded-md bg-amber-500/5 animate-pulse">
                    <div className="font-mono text-[7px] text-amber-500 font-bold uppercase tracking-wider text-center px-1">
                      IDENTIFYING...
                    </div>
                  </div>
                )}
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
                    onClick={handleExportReport}
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
                <div className="col-span-2">CLASS</div>
                <div className="col-span-1 text-right">CONF</div>
                <div className="col-span-7 pl-3">INTELLIGENCE LOG NOTE</div>
              </div>

              {/* Table body */}
              <div className="flex-1 overflow-y-auto font-mono text-[9px]">
                {events.length === 0 ? (
                  <div className="flex h-full items-center justify-center select-none">
                    <span className="font-mono text-[8px] text-muted-foreground/50 uppercase">
                      {uploadPhase === "analyzing" || uploadPhase === "summarizing"
                        ? "GENERATING_INTEL_EVENTS..."
                        : "AWAITING_PIPELINE_INIT..."}
                    </span>
                  </div>
                ) : (
                  events.map((row) => {
                    const isPassed =
                      currentTime >= row.timeSec || uploadPhase === "completed";
                    if (!isPassed) return null;

                    const tone = row.tone;

                    return (
                      <button
                        type="button"
                        key={row.id}
                        onClick={() => handleSeek(row.timeSec)}
                        className={`grid grid-cols-12 gap-2 px-3 py-1.5 border-b border-border/40 items-center relative transition-colors cursor-pointer w-full text-left font-mono text-[9px] ${
                          tone === "critical"
                            ? "bg-red-950/20 hover:bg-red-950/35 text-red-400"
                            : tone === "warning"
                              ? "bg-amber-950/20 hover:bg-amber-950/35 text-amber-400"
                              : "hover:bg-muted/15 text-zinc-300"
                        }`}
                      >
                        <div className="col-span-2">
                          {Math.floor(row.timeSec)}s
                        </div>
                        <div
                          className={`col-span-2 font-bold ${tone === "critical" ? "text-red-500 animate-pulse" : ""}`}
                        >
                          {row.cls}
                        </div>
                        <div className="col-span-1 text-right text-zinc-400">
                          {Math.round(row.conf * 100)}%
                        </div>
                        <div className="col-span-7 pl-3 truncate text-zinc-400">
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
