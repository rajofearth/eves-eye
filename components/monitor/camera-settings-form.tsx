"use client";

import { useEffect, useState } from "react";
import { Camera, RefreshCw, Tv, Upload, Video } from "lucide-react";
import type { MockCamera } from "@/lib/cameras";

interface AnalyzedVideo {
  id: string;
  filename: string;
  status: string;
}

interface CameraSettingsFormProps {
  readonly cameras: MockCamera[];
  readonly onChange: (updated: MockCamera[]) => void;
}

export function CameraSettingsForm({
  cameras,
  onChange,
}: CameraSettingsFormProps) {
  const [videos, setVideos] = useState<AnalyzedVideo[]>([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [uploadingCamId, setUploadingCamId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  useEffect(() => {
    void fetchVideos();
  }, []);

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
    onChange(
      cameras.map((c) => {
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
      }),
    );
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
        const newVideo: AnalyzedVideo = {
          id: data.jobId,
          filename: file.name.toUpperCase(),
          status: data.status,
        };
        setVideos((prev) => [newVideo, ...prev]);

        handleFieldChange(
          camId,
          "videoUrl",
          `/uploads/videos/${data.jobId}/video.mp4`,
        );

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
            void fetchVideos();
          }
        }
      } catch {
        clearInterval(timer);
      }
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {isLoadingVideos && videos.length === 0 && (
        <p className="text-[10px] font-mono text-muted-foreground uppercase">
          Loading video cache...
        </p>
      )}

      {cameras.map((cam) => (
        <div
          key={cam.id}
          className="border border-border/80 rounded-md p-4 bg-zinc-950/20 space-y-4"
        >
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

          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-zinc-400 uppercase">
              Source Feed Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  handleFieldChange(cam.id, "sourceType", "device")
                }
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
                onClick={() =>
                  handleFieldChange(cam.id, "sourceType", "video")
                }
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
  );
}
