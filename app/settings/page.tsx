"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CameraSettingsForm } from "@/components/monitor/camera-settings-form";
import { MonoLabel } from "@/components/ui/mono-label";
import {
  INITIAL_CAMERAS,
  type MockCamera,
  isCameraMonitored,
  loadCameras,
  saveCameras,
} from "@/lib/cameras";

function nowTimestamp(): string {
  return new Date().toUTCString().slice(17, 25) + " UTC";
}

export default function SettingsPage() {
  const [cameras, setCameras] = useState<MockCamera[]>(INITIAL_CAMERAS);
  const [darkMode, setDarkMode] = useState(true);
  const [utcTime, setUtcTime] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCameras(loadCameras());
  }, []);

  useEffect(() => {
    const updateClock = () => setUtcTime(nowTimestamp());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [darkMode]);

  const handleSave = () => {
    saveCameras(cameras);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const monitoredCount = cameras.filter((c) =>
    isCameraMonitored(c, c.sourceType === "device"),
  ).length;

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground transition-colors duration-300">
      <AppHeader
        pageBadge="CAMERA_CONFIGURATION"
        utcTime={utcTime}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
      />

      <main className="flex flex-1 flex-col overflow-hidden p-4 lg:p-6">
        <div className="mx-auto w-full max-w-3xl flex flex-col gap-4 min-h-0 flex-1">
          <div className="shrink-0 border border-border rounded-md bg-card/40 px-4 py-3 flex items-center justify-between">
            <div>
              <MonoLabel size="xs" className="font-bold uppercase tracking-wider">
                Feed Registry
              </MonoLabel>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                Configure up to 4 camera slots. Gemma monitors any slot with an
                active webcam or video loop for threats.
              </p>
            </div>
            <div className="text-right">
              <MonoLabel size="2xs" variant="muted">
                MONITORED
              </MonoLabel>
              <p className="font-mono text-sm font-bold text-primary">
                {monitoredCount}/4
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 rounded-md border border-border bg-card/20 p-4">
            <CameraSettingsForm cameras={cameras} onChange={setCameras} />
          </div>

          <div className="shrink-0 flex items-center justify-between border-t border-border pt-4">
            <div className="flex flex-wrap gap-2">
              {cameras.map((cam) => (
                <span
                  key={cam.id}
                  className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded border ${
                    isCameraMonitored(cam, cam.sourceType === "device")
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {cam.cameraId}:{" "}
                  {isCameraMonitored(cam, cam.sourceType === "device")
                    ? "ACTIVE"
                    : "IDLE"}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {saved && (
                <span className="text-[10px] font-mono text-emerald-500 uppercase animate-in fade-in">
                  Configuration saved
                </span>
              )}
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
      </main>
    </div>
  );
}
