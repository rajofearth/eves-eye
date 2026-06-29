"use client";

import {
  AlertTriangle,
  Clock,
  History,
  Moon,
  RefreshCw,
  Settings,
  Shield,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusIndicator } from "@/components/ui/status-dot";

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
  const pathname = usePathname();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/45 backdrop-blur-md px-4 py-1.5 z-20">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-primary/10 rounded-sm px-2 py-0.5 border border-primary/20">
          <Shield className="w-4 h-4 text-primary" />
          <span className="font-heading text-xs font-semibold uppercase tracking-wider text-primary font-bold">
            EVE&apos;S EYE
          </span>
        </div>

        {isPrimaryPulsing ? (
          <div className="inline-flex items-center gap-1.5 rounded-sm border border-red-500/30 bg-red-950/20 px-2 py-0.5 font-mono text-[10px] font-bold text-red-500 animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5" />
            THREAT ACTIVE
          </div>
        ) : (
          <StatusIndicator
            variant="nominal"
            pulse
            className="hidden md:inline-flex"
          >
            ONLINE
          </StatusIndicator>
        )}

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
  );
}
