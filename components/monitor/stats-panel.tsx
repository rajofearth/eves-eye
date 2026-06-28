"use client";

import { Cpu, Database } from "lucide-react";
import { ConfidenceBar } from "@/components/ui/confidence-bar";
import { MonoLabel } from "@/components/ui/mono-label";
import { StatusDot } from "@/components/ui/status-dot";

export interface StatsPanelProps {
  readonly systemLoad: number;
  readonly sortedSessionTotals: readonly [string, number][];
}

export function StatsPanel({
  systemLoad,
  sortedSessionTotals,
}: StatsPanelProps) {
  return (
    <div className="flex min-h-[160px] w-full flex-col overflow-hidden rounded-md border border-border bg-card sm:min-h-0 sm:w-[30%] shadow-xs">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-muted/30 px-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <MonoLabel className="truncate font-bold">SESSION_TOTALS</MonoLabel>
        </div>

        {/* CPU Load Metric (Fluctuating) */}
        <div
          className="flex items-center gap-2 max-w-[45%] shrink-0"
          title="System CPU workload"
        >
          <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
          <ConfidenceBar
            value={systemLoad}
            showLabel
            variant="silver"
            className="w-16 sm:w-20"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 pt-3">
        <MonoLabel
          size="2xs"
          variant="muted"
          className="shrink-0 font-semibold"
        >
          LOCAL_DB_TALLIES (SQLite)
        </MonoLabel>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {sortedSessionTotals.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <MonoLabel size="xs" variant="muted">
                AWAITING_DB_EVENTS...
              </MonoLabel>
            </div>
          ) : (
            sortedSessionTotals.map(([label, count]) => (
              <div
                key={label}
                className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-b-0 last:pb-0"
              >
                <div className="flex items-center gap-2">
                  <StatusDot variant="silver" size="xs" />
                  <span className="font-mono text-[10px] text-zinc-300 uppercase tracking-wide">
                    {label}
                  </span>
                </div>
                <span className="font-mono text-xs font-bold text-primary tabular-nums">
                  {count}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
