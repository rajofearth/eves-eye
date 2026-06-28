"use client";

import { Terminal } from "lucide-react";
import type * as React from "react";
import { IntelLog, IntelLogEntry } from "@/components/ui/intel-log";
import { MonoLabel } from "@/components/ui/mono-label";

export interface LogEntry {
  id: string;
  timestamp: string;
  source: string;
  message: React.ReactNode;
  dimmed?: boolean;
}

export interface IntelLogStreamProps {
  readonly logEntries: readonly LogEntry[];
  readonly intelLogScrollRef: React.RefObject<HTMLDivElement | null>;
}

export function IntelLogStream({
  logEntries,
  intelLogScrollRef,
}: IntelLogStreamProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-md border border-border bg-card shadow-xs">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3.5">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <MonoLabel className="font-bold">INTEL_STREAM</MonoLabel>
        </div>
        <MonoLabel size="2xs" variant="muted" className="font-semibold">
          SYSTEM: SQLite_SYNC_ACTIVE
        </MonoLabel>
      </div>

      <div
        ref={intelLogScrollRef}
        className="flex-1 overflow-y-auto p-4 bg-zinc-950/20 dark:bg-black/20"
      >
        <IntelLog>
          {logEntries.map((entry) => (
            <IntelLogEntry
              key={entry.id}
              timestamp={entry.timestamp}
              source={entry.source}
              message={entry.message}
              dimmed={entry.dimmed}
            />
          ))}
          <IntelLogEntry timestamp="" source="" message="" cursor />
        </IntelLog>
      </div>
    </div>
  );
}
