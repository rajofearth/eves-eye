"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { CameraSettingsForm } from "@/components/monitor/camera-settings-form";
import type { MockCamera } from "@/lib/cameras";

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

  useEffect(() => {
    if (show) {
      setLocalCameras([...cameras]);
    }
  }, [show, cameras]);

  const handleSave = () => {
    onSaveCameras(localCameras);
    onClose();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-all duration-300 animate-in fade-in">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Backdrop click to dismiss drawer */}
      <div className="absolute inset-0" onClick={onClose} role="presentation" />

      <div className="relative w-[480px] h-full bg-card border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
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

        <div className="flex-1 overflow-y-auto p-5">
          <CameraSettingsForm
            cameras={localCameras}
            onChange={setLocalCameras}
          />
        </div>

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
