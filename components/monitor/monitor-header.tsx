"use client";

import { History, RefreshCw, Settings } from "lucide-react";
import { AppHeader } from "@/components/app-header";

export interface MonitorHeaderProps {
  readonly isPrimaryPulsing: boolean;
  readonly isProcessing: boolean;
  readonly utcTime: string;
  readonly darkMode: boolean;
  readonly setDarkMode: (val: boolean) => void;
  readonly setShowThreatLogPanel: (val: boolean) => void;
  readonly setShowSettingsPanel: (val: boolean) => void;
}

export function MonitorHeader({
  isPrimaryPulsing,
  isProcessing,
  utcTime,
  darkMode,
  setDarkMode,
  setShowThreatLogPanel,
  setShowSettingsPanel,
}: MonitorHeaderProps) {
  return (
    <AppHeader
      isPrimaryPulsing={isPrimaryPulsing}
      utcTime={utcTime}
      darkMode={darkMode}
      setDarkMode={setDarkMode}
      rightActions={
        <>
          {isProcessing && (
            <div className="flex items-center gap-1 text-primary text-[10px] font-mono font-medium animate-pulse mr-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              INFERRING_THREATS
            </div>
          )}

          <button
            onClick={() => setShowThreatLogPanel(true)}
            className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1 text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer shadow-xs"
            type="button"
            title="View SQLite Threat Log history"
          >
            <History className="w-3.5 h-3.5 text-primary" />
            THREAT_LOG
          </button>

          <button
            onClick={() => setShowSettingsPanel(true)}
            className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1 text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground transition-all cursor-pointer shadow-xs"
            type="button"
            title="Configure cameras and custom feeds"
          >
            <Settings className="w-3.5 h-3.5 text-primary" />
            SETTINGS
          </button>
        </>
      }
    />
  );
}
