"use client";

import { Camera, Maximize2, VideoOff } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef } from "react";

import { MonoLabel } from "@/components/ui/mono-label";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Simulated Camera Feed (Canvas Animated Noise & Scanlines)
// ---------------------------------------------------------------------------
export function SimulatedCameraFeed({
  name,
  isPrimary = false,
}: {
  name: string;
  isPrimary?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    canvas.width = 640;
    let width = 640;
    canvas.height = 480;
    let height = 480;

    const handleResize = () => {
      if (!canvas) return;
      const w = canvas.clientWidth || 640;
      canvas.width = w;
      width = w;
      const h = canvas.clientHeight || 480;
      canvas.height = h;
      height = h;
    };
    window.addEventListener("resize", handleResize);
    handleResize();

    let frame = 0;

    const render = () => {
      frame++;

      // Draw background dark slate/black gradient
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        10,
        width / 2,
        height / 2,
        Math.max(width, height) / 1.1,
      );
      gradient.addColorStop(0, "#090d16"); // Deep navy slate
      gradient.addColorStop(1, "#020306"); // Deep void black
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Draw subtle horizontal noise bars
      ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
      for (let i = 0; i < 4; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const w = Math.random() * 120 + 40;
        const h = Math.random() * 2 + 1;
        ctx.fillRect(x, y, w, h);
      }

      // Draw overall static/snow
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const noiseDensity = isPrimary ? 0.01 : 0.025;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.random() < noiseDensity) {
          const val = Math.random() * 30 + 10;
          data[i] = val; // R
          data[i + 1] = val + 4; // G (slight greenish/blue tint)
          data[i + 2] = val + 10; // B (more blue tint to match eves theme)
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // Draw scan lines
      ctx.fillStyle = "rgba(100, 150, 255, 0.04)";
      const scanlineHeight = 1.5;
      const scanlineSpacing = 3.5;
      for (let y = 0; y < height; y += scanlineSpacing) {
        ctx.fillRect(0, y, width, scanlineHeight);
      }

      // Draw horizontal static bar
      const barY = ((frame * 1.2) % (height + 120)) - 60;
      ctx.fillStyle = "rgba(100, 150, 255, 0.015)";
      ctx.fillRect(0, barY, width, 50);

      // Corner brackets (surveillance look)
      ctx.strokeStyle = "rgba(124, 58, 237, 0.25)"; // Violet boundary brackets
      ctx.lineWidth = 1.5;
      const margin = 24;
      const len = 16;

      // Top Left
      ctx.beginPath();
      ctx.moveTo(margin, margin + len);
      ctx.lineTo(margin, margin);
      ctx.lineTo(margin + len, margin);
      ctx.stroke();

      // Top Right
      ctx.beginPath();
      ctx.moveTo(width - margin, margin + len);
      ctx.lineTo(width - margin, margin);
      ctx.lineTo(width - margin - len, margin);
      ctx.stroke();

      // Bottom Left
      ctx.beginPath();
      ctx.moveTo(margin, height - margin - len);
      ctx.lineTo(margin, height - margin);
      ctx.lineTo(margin + len, height - margin);
      ctx.stroke();

      // Bottom Right
      ctx.beginPath();
      ctx.moveTo(width - margin, height - margin - len);
      ctx.lineTo(width - margin, height - margin);
      ctx.lineTo(width - margin - len, height - margin);
      ctx.stroke();

      // Center crosshair
      if (isPrimary) {
        ctx.strokeStyle = "rgba(124, 58, 237, 0.25)";
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 6, 0, Math.PI * 2);
        ctx.moveTo(width / 2 - 12, height / 2);
        ctx.lineTo(width / 2 - 4, height / 2);
        ctx.moveTo(width / 2 + 4, height / 2);
        ctx.lineTo(width / 2 + 12, height / 2);
        ctx.moveTo(width / 2, height / 2 - 12);
        ctx.lineTo(width / 2, height / 2 - 4);
        ctx.moveTo(width / 2, height / 2 + 4);
        ctx.lineTo(width / 2, height / 2 + 12);
        ctx.stroke();
      }

      // Title & UTC time overlay
      ctx.fillStyle = "rgba(124, 58, 237, 0.6)";
      ctx.font = "10px monospace";
      ctx.fillText(
        `MOCK FEED // ${name.toUpperCase()}`,
        margin + 6,
        margin + 20,
      );

      const utcStr = `${new Date().toUTCString().slice(17, 25)} UTC`;
      ctx.fillText(utcStr, width - margin - 80, margin + 20);

      // REC flashing indicator
      if (Math.floor(frame / 25) % 2 === 0) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.8)"; // Red blink
        ctx.beginPath();
        ctx.arc(margin + 12, height - margin - 12, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px monospace";
        ctx.fillText("REC", margin + 22, height - margin - 9);
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px monospace";
        ctx.fillText("REC", margin + 22, height - margin - 9);
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
    };
  }, [name, isPrimary]);

  return <canvas ref={canvasRef} className="w-full h-full object-cover" />;
}

// ---------------------------------------------------------------------------
// Webcam Surface (Standard HTML5 Video Stream)
// ---------------------------------------------------------------------------
export function WebcamSurface({
  stream,
  error,
  isPrimary = false,
  videoRef,
}: {
  stream: MediaStream | null;
  error: string | null;
  isPrimary?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const activeVideoRef = videoRef ?? localVideoRef;

  useEffect(() => {
    if (activeVideoRef.current && stream) {
      activeVideoRef.current.srcObject = stream;
    }
  }, [stream, activeVideoRef]);

  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 p-4 text-center select-none">
        <VideoOff className="w-8 h-8 text-destructive animate-pulse mb-2" />
        <MonoLabel variant="critical" size="xs">
          CAMERA BLOCKED
        </MonoLabel>
        <span className="font-mono text-[9px] text-muted-foreground mt-1 max-w-[200px]">
          {error}
        </span>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/95 select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <MonoLabel size="xs">AWAITING SYSTEM AUTHORIZATION...</MonoLabel>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black select-none">
      <video
        ref={activeVideoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "w-full h-full object-cover transition-all duration-700",
          isPrimary
            ? "grayscale-[10%] brightness-95"
            : "grayscale-[40%] brightness-75 contrast-125",
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Camera Surface Component
// ---------------------------------------------------------------------------
export interface CameraSurfaceProps {
  readonly camera: {
    id: string;
    name: string;
    cameraId: string;
    sourceType: "device" | "simulated";
  } | null;
  readonly isPrimary?: boolean;
  readonly isSelected?: boolean;
  readonly stream?: MediaStream | null;
  readonly error?: string | null;
  readonly onSelect?: (cameraId: string) => void;
  readonly overlays?: React.ReactNode;
  readonly videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export function CameraSurface({
  camera,
  isPrimary = false,
  isSelected = false,
  stream = null,
  error = null,
  onSelect,
  overlays,
  videoRef,
}: CameraSurfaceProps) {
  const handleClick = () => {
    if (!camera || !onSelect) return;
    onSelect(camera.id);
  };

  // Header display (for primary view)
  const chromeHeader = isPrimary ? (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-card/60 backdrop-blur-md px-3.5">
      <div className="flex items-center gap-2">
        <Camera className="w-3.5 h-3.5 text-primary" />
        <MonoLabel variant="silver" size="xs" className="font-semibold">
          {camera?.cameraId ?? "NO_ACTIVE_CAMERA"}
        </MonoLabel>
        {camera?.name && (
          <span className="truncate font-mono text-[9px] uppercase tracking-wider text-muted-foreground border-l border-border pl-2">
            {camera.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {camera ? (
          <>
            <StatusDot
              variant={
                camera.sourceType === "device" && stream ? "nominal" : "silver"
              }
              pulse
              size="xs"
            />
            <MonoLabel
              variant={
                camera.sourceType === "device" && stream ? "nominal" : "silver"
              }
              size="2xs"
            >
              {camera.sourceType === "device"
                ? stream
                  ? "LIVE"
                  : "CONNECTING"
                : "MOCK_ACTIVE"}
            </MonoLabel>
          </>
        ) : (
          <MonoLabel variant="muted" size="2xs">
            EMPTY
          </MonoLabel>
        )}
      </div>
    </div>
  ) : (
    // Corner badges for grid views
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between bg-gradient-to-b from-black/85 via-black/30 to-transparent p-2">
      <div className="flex flex-col gap-0.5">
        <span className="bg-black/70 rounded-xs px-1 text-[8px] font-mono text-zinc-300 uppercase leading-none py-0.5 font-semibold">
          {camera?.cameraId ?? "UNASSIGNED"}
        </span>
        {camera?.name && (
          <span className="max-w-[120px] truncate bg-black/60 rounded-xs px-1 text-[8px] font-mono text-muted-foreground uppercase leading-none py-0.5 mt-0.5">
            {camera.name}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="bg-black/70 rounded-xs px-1 text-[8px] font-mono text-muted-foreground uppercase leading-none py-0.5 font-semibold">
          {camera ? (camera.sourceType === "device" ? "DEV" : "SIM") : "EMPTY"}
        </span>
      </div>
    </div>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: Must be a div to prevent nested button validation errors in overlays
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-all duration-300",
        !isPrimary &&
          camera &&
          "cursor-pointer hover:border-primary/50 hover:shadow-xs",
        isSelected &&
          "border-primary shadow-[0_0_8px_rgba(139,92,246,0.15)] ring-1 ring-primary/20",
      )}
      onClick={!isPrimary && camera ? handleClick : undefined}
      onKeyDown={
        !isPrimary && camera
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                handleClick();
              }
            }
          : undefined
      }
      role="button"
      tabIndex={0}
    >
      {chromeHeader}

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-950">
        {camera ? (
          camera.sourceType === "device" ? (
            <WebcamSurface
              stream={stream}
              error={error}
              isPrimary={isPrimary}
              videoRef={videoRef}
            />
          ) : (
            <SimulatedCameraFeed name={camera.name} isPrimary={isPrimary} />
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-950 px-4 text-center select-none">
            <VideoOff className="w-7 h-7 text-muted-foreground/30" />
            <MonoLabel variant="default" size="2xs">
              SLOT_UNASSIGNED
            </MonoLabel>
            <span className="font-mono text-[8px] text-muted-foreground/50 max-w-[150px]">
              This stream slot is waiting for an active camera feed.
            </span>
          </div>
        )}

        {camera && overlays}

        {/* Action badge on grid items */}
        {!isPrimary && camera && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex gap-1">
            <MonoLabel
              size="2xs"
              className="bg-black/75 rounded-xs px-1.5 py-0.5 border border-white/5 flex items-center gap-1 font-semibold text-zinc-300 hover:text-white"
            >
              <Maximize2 className="w-2.5 h-2.5" />
              PROMOTE
            </MonoLabel>
          </div>
        )}
      </div>
    </div>
  );
}
