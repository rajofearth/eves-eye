import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * IntelLog — the scrolling terminal-style event stream.
 * Wraps a list of IntelLogEntry rows.
 */
function IntelLog({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="intel-log"
      className={cn(
        "flex flex-col gap-1.5 overflow-y-auto font-mono text-[10px]",
        className,
      )}
      {...props}
    />
  );
}

type LogSource = "SYS" | "VLM" | string;

interface IntelLogEntryProps extends React.ComponentProps<"div"> {
  timestamp: string;
  source: LogSource;
  message: React.ReactNode;
  /** Dim the row (old/processed events) */
  dimmed?: boolean;
  /** Animate the cursor (last/live entry) */
  cursor?: boolean;
}

function IntelLogEntry({
  timestamp,
  source,
  message,
  dimmed = false,
  cursor = false,
  className,
  ...props
}: IntelLogEntryProps) {
  const sourceColor =
    source === "SYS"
      ? "text-muted-foreground"
      : source === "VLM"
        ? "text-primary"
        : "text-amber-500 dark:text-amber-400";

  return (
    <div
      data-slot="intel-log-entry"
      className={cn(
        "flex gap-2 leading-relaxed text-left",
        dimmed && "opacity-50",
        className,
      )}
      {...props}
    >
      {cursor ? (
        <span className="w-16 animate-pulse text-muted-foreground">_</span>
      ) : (
        <>
          <span className="w-16 shrink-0 text-muted-foreground">
            [{timestamp}]
          </span>
          <span className={cn("w-12 shrink-0 font-semibold", sourceColor)}>
            {source}
          </span>
          <span className="text-foreground flex-1 break-all">{message}</span>
        </>
      )}
    </div>
  );
}

/**
 * IntelTag — inline highlighted entity tag within a log message.
 * e.g. <IntelTag>PERSON</IntelTag>
 */
function IntelTag({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "border border-border bg-muted/65 px-1 font-mono text-[9px] uppercase rounded-sm text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { IntelLog, IntelLogEntry, IntelTag };
