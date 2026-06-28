"use client";

import { AlertTriangle, Maximize2 } from "lucide-react";

export interface ThreatAlert {
  isHarm: boolean;
  severity: "critical" | "warning" | "nominal";
  reason: string;
  snapshotPath?: string;
}

export interface ThreatAlertCardProps {
  readonly threat: ThreatAlert | null;
  readonly threatAcknowledged: boolean;
  readonly setThreatAcknowledged: (val: boolean) => void;
  readonly setZoomImageUrl: (url: string | null) => void;
}

export function ThreatAlertCard({
  threat,
  threatAcknowledged,
  setThreatAcknowledged,
  setZoomImageUrl,
}: ThreatAlertCardProps) {
  if (!threat?.isHarm || threatAcknowledged) return null;

  return (
    <div className="absolute top-3 right-3 z-30 w-[340px] rounded-md border border-red-500 bg-red-950/95 backdrop-blur-md p-4 text-white shadow-2xl animate-in slide-in-from-top-4 duration-300">
      <div className="flex items-start gap-3">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400 animate-pulse">
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center justify-between">
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-red-400 font-bold">
              SECURITY THREAT IDENTIFIED
            </span>
            <span className="font-mono text-[8px] bg-red-600/30 px-1 py-0.5 rounded-xs text-red-300 font-bold uppercase">
              {threat.severity}
            </span>
          </div>

          {/* Threat Reason details */}
          <p className="mt-2 font-mono text-[10px] text-red-100 leading-normal uppercase tracking-wide">
            {threat.reason}
          </p>

          {/* Snapshot of the moment of alert (Thumbnail) */}
          {threat.snapshotPath && (
            <div className="relative mt-3 overflow-hidden rounded-xs border border-red-500/30 bg-black/50 shadow-inner group">
              {/* biome-ignore lint/performance/noImgElement: Custom local filesystem snapshot JPEG path */}
              <img
                src={threat.snapshotPath}
                alt="Alert Frame Snapshot"
                className="w-full h-24 object-cover object-center grayscale-[20%] hover:grayscale-0 transition-all duration-300"
              />
              <button
                onClick={() => setZoomImageUrl(threat.snapshotPath || null)}
                className="absolute bottom-1.5 right-1.5 bg-black/60 hover:bg-black/85 text-white p-1 rounded-xs flex items-center justify-center border border-white/10 transition-colors cursor-pointer"
                type="button"
                title="Expand Frame Snapshot"
              >
                <Maximize2 className="w-2.5 h-2.5" />
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-end">
            <button
              onClick={() => setThreatAcknowledged(true)}
              className="rounded-xs bg-red-600 hover:bg-red-500 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white shadow-sm transition-colors cursor-pointer"
              type="button"
            >
              ACKNOWLEDGE_THREAT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
