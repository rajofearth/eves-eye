"use client";

import { AlertTriangle, History, RefreshCw, X } from "lucide-react";
import { MonoLabel } from "@/components/ui/mono-label";

export interface SQLiteThreatLog {
  id: number;
  timestamp: string;
  camera_id: string;
  is_harm: number;
  severity: string;
  reason: string;
  snapshot_path: string | null;
}

export interface ThreatsDrawerProps {
  readonly showThreatLogPanel: boolean;
  readonly setShowThreatLogPanel: (val: boolean) => void;
  readonly threatLogList: readonly SQLiteThreatLog[];
  readonly loadingThreatLog: boolean;
  readonly fetchThreatLog: () => void;
  readonly setZoomImageUrl: (url: string | null) => void;
}

export function ThreatsDrawer({
  showThreatLogPanel,
  setShowThreatLogPanel,
  threatLogList,
  loadingThreatLog,
  fetchThreatLog,
  setZoomImageUrl,
}: ThreatsDrawerProps) {
  if (!showThreatLogPanel) return null;

  return (
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
            <MonoLabel className="font-bold">SQLITE_THREAT_LOGS</MonoLabel>
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
                Verified threat alert details will appear here once identified.
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
  );
}
