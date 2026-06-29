"use client";

import { useEffect, useState } from "react";
import { X, Video, Tv, Camera, Upload, RefreshCw } from "lucide-react";
import { MonoLabel } from "@/components/ui/mono-label";

interface MockCamera {
  id: string;
  name: string;
  cameraId: string;
  sourceType: "device" | "simulated" | "video";
  videoUrl?: string;
}

interface AnalyzedVideo {
  id: string;
  filename: string;
  status: string;
}

interface SettingsDrawerProps {
  readonly show: boolean;
  readonly onClose: () => void;
  readonly cameras: MockCamera[];
  readonly onSaveCameras: (updated: MockCamera[]) => void;
}

export function SettingsDrawer({
  show,
  onClose,
  cameras,
  onSaveCameras,
}: SettingsDrawerProps) {
  const [localCameras, setLocalCameras] = useState<MockCamera[]>([]);
  const [videos, setVideos] = useState<AnalyzedVideo[]>([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [uploadingCamId, setUploadingCamId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  // Sync state when drawer is opened
  useEffect(() => {
    if (show) {
      setLocalCameras([...cameras]);
      void fetchVideos();
    }
  }, [show, cameras]);

  const fetchVideos = async () => {
    setIsLoadingVideos(true);
    try {
      const res = await fetch("/api/chat/videos");
      const data = await res.json();
      if (data.ok) {
        setVideos(data.videos || []);
      }
    } catch (err) {
      console.error("Failed to load videos:", err);
    } finally {
      setIsLoadingVideos(false);
    }
  };

  const handleFieldChange = (
    id: string,
    key: keyof MockCamera,
    value: string,
  ) => {
    setLocalCameras((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (key === "sourceType") {
          const type = value as "device" | "simulated" | "video";
          return {
            ...c,
            sourceType: type,
            videoUrl: type === "video" ? c.videoUrl || "" : undefined,
          };
        }
        return { ...c, [key]: value };
      })
    );
  };

  const handleSave = () => {
    onSaveCameras(localCameras);
    onClose();
  };

  const handleUploadVideo = async (
    e: React.ChangeEvent<HTMLInputElement>,
    camId: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingCamId(camId);
    setUploadProgress("Uploading...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/analysis/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.ok) {
        setUploadProgress("Analyzing...");
        // Add new video to local dropdown dynamically
        const newVideo: AnalyzedVideo = {
          id: data.jobId,
          filename: file.name.toUpperCase(),
          status: data.status,
        };
        setVideos((prev) => [newVideo, ...prev]);

        // Assign video to camera automatically
        handleFieldChange(
          camId,
          "videoUrl",
          `/uploads/videos/${data.jobId}/video.mp4`,
        );

        // Poll for completion status in background
        pollVideoStatus(data.jobId);
      } else {
        alert(data.error || "Upload failed");
      }
    } catch (err) {
      alert("Error: " + String(err));
    } finally {
      setUploadingCamId(null);
      setUploadProgress("");
    }
  };

  const pollVideoStatus = (jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/analysis/status?jobId=${jobId}`);
        const data = await res.json();
        if (data.ok) {
          if (data.job.status === "completed" || data.job.status === "error") {
            clearInterval(timer);
            void fetchVideos(); // Refresh videos dropdown
          }
        }
      } catch (err) {
        clearInterval(timer);
      }
    }, 1500);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-all duration-300 animate-in fade-in">
      {/* Click outside to close */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Backdrop click to dismiss drawer */}
      <div className="absolute inset-0" onClick={onClose} role="presentation" />

      {/* Drawer Body */}
      <div className="relative w-[480px] h-full bg-card border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-2">
            <span className="font-heading text-xs font-semibold uppercase tracking-wider text-primary font-bold">
              CAMERA_CONFIGURATION
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            type="button"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {localCameras.map((cam) => (
            <div
              key={cam.id}
              className="border border-border/80 rounded-md p-4 bg-zinc-950/20 space-y-4"
            >
              {/* Camera Header */}
              <div className="flex items-center justify-between">
                <span className="bg-black/70 rounded-xs px-2 py-0.5 text-[10px] font-mono text-zinc-300 uppercase font-semibold border border-white/5">
                  {cam.cameraId}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground uppercase">
                  {cam.sourceType === "device"
                    ? "Webcam"
                    : cam.sourceType === "video"
                      ? "Video Loop"
                      : "Simulation"}
                </span>
              </div>

              {/* Camera Name Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-zinc-400 uppercase">
                  Camera Label
                </label>
                <input
                  type="text"
                  value={cam.name}
                  onChange={(e) =>
                    handleFieldChange(cam.id, "name", e.target.value)
                  }
                  className="w-full bg-zinc-900 border border-border rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none focus:border-primary/50"
                  placeholder="e.g. PERIMETER NORTH"
                />
              </div>

              {/* Source Type Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-zinc-400 uppercase">
                  Source Feed Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleFieldChange(cam.id, "sourceType", "device")}
                    className={`flex items-center justify-center gap-1.5 py-1.5 border rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer ${
                      cam.sourceType === "device"
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-zinc-900/50 border-border text-muted-foreground hover:bg-zinc-800"
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Webcam
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleFieldChange(cam.id, "sourceType", "simulated")
                    }
                    className={`flex items-center justify-center gap-1.5 py-1.5 border rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer ${
                      cam.sourceType === "simulated"
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-zinc-900/50 border-border text-muted-foreground hover:bg-zinc-800"
                    }`}
                  >
                    <Tv className="w-3.5 h-3.5" />
                    Simulated
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFieldChange(cam.id, "sourceType", "video")}
                    className={`flex items-center justify-center gap-1.5 py-1.5 border rounded text-[10px] font-mono font-bold uppercase transition-all cursor-pointer ${
                      cam.sourceType === "video"
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-zinc-900/50 border-border text-muted-foreground hover:bg-zinc-800"
                    }`}
                  >
                    <Video className="w-3.5 h-3.5" />
                    Video File
                  </button>
                </div>
              </div>

              {/* Video File Config (Visible only if sourceType is "video") */}
              {cam.sourceType === "video" && (
                <div className="space-y-3 bg-zinc-900/40 border border-border/40 rounded p-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-zinc-400 uppercase">
                      Select Video Cache
                    </label>
                    <select
                      value={cam.videoUrl || ""}
                      onChange={(e) =>
                        handleFieldChange(cam.id, "videoUrl", e.target.value)
                      }
                      className="w-full bg-zinc-900 border border-border rounded px-2.5 py-1.5 text-xs font-mono text-zinc-200 outline-none focus:border-primary/50 cursor-pointer"
                    >
                      <option value="">-- SELECT VIDEO FILE --</option>
                      {videos.map((vid) => (
                        <option
                          key={vid.id}
                          value={`/uploads/videos/${vid.id}/video.mp4`}
                        >
                          {vid.filename} ({vid.status.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <div className="text-[8px] font-mono text-muted-foreground uppercase leading-tight">
                      Or mount a new raw mp4 video payload to analyze &amp; loop
                    </div>
                    <label className="relative shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-muted border border-border rounded text-[10px] font-mono font-bold uppercase cursor-pointer text-zinc-300 hover:text-white transition-all select-none">
                      {uploadingCamId === cam.id ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                          {uploadProgress}
                        </>
                      ) : (
                        <>
                          <Upload className="w-3 h-3 text-primary" />
                          Upload Feed
                        </>
                      )}
                      <input
                        type="file"
                        accept="video/*"
                        disabled={uploadingCamId !== null}
                        onChange={(e) => handleUploadVideo(e, cam.id)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="h-16 shrink-0 border-t border-border bg-card/65 backdrop-blur-xs flex items-center justify-end px-5 gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border bg-transparent hover:bg-muted text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground rounded transition-all cursor-pointer"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-mono font-bold uppercase tracking-wider rounded transition-all cursor-pointer shadow-lg shadow-primary/20"
            type="button"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
