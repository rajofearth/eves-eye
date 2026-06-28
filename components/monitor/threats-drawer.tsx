"use client"

import * as React from "react"
import { useState, useMemo } from "react"
import { AlertTriangle, History, RefreshCw, X, ChevronRight } from "lucide-react"
import { MonoLabel } from "@/components/ui/mono-label"
import { StatusDot } from "@/components/ui/status-dot"

export interface SQLiteThreatLog {
  id: number
  timestamp: string
  camera_id: string
  is_harm: number
  severity: string
  reason: string
  snapshot_path: string | null
}

export interface ThreatsDrawerProps {
  readonly showThreatLogPanel: boolean
  readonly setShowThreatLogPanel: (val: boolean) => void
  readonly threatLogList: readonly SQLiteThreatLog[]
  readonly loadingThreatLog: boolean
  readonly fetchThreatLog: () => void
  readonly setZoomImageUrl: (url: string | null) => void
}

type GroupedItem =
  | { type: "threat"; log: SQLiteThreatLog }
  | { type: "nominal"; log: SQLiteThreatLog }
  | { type: "nominal_group"; key: string; logs: SQLiteThreatLog[] }

export function ThreatsDrawer({
  showThreatLogPanel,
  setShowThreatLogPanel,
  threatLogList,
  loadingThreatLog,
  fetchThreatLog,
  setZoomImageUrl
}: ThreatsDrawerProps) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([])

  // Group consecutive nominal logs
  const groupedLogs = useMemo(() => {
    const result: GroupedItem[] = []
    let currentNominalGroup: SQLiteThreatLog[] = []

    for (const item of threatLogList) {
      if (item.is_harm === 0) {
        currentNominalGroup.push(item)
      } else {
        // Flush active nominal group before adding threat
        if (currentNominalGroup.length > 0) {
          if (currentNominalGroup.length === 1) {
            result.push({ type: "nominal", log: currentNominalGroup[0] })
          } else {
            const first = currentNominalGroup[0]
            const last = currentNominalGroup[currentNominalGroup.length - 1]
            result.push({
              type: "nominal_group",
              key: `group-${first.id}-${last.id}`,
              logs: [...currentNominalGroup]
            })
          }
          currentNominalGroup = []
        }
        result.push({ type: "threat", log: item })
      }
    }

    // Flush final nominal group
    if (currentNominalGroup.length > 0) {
      if (currentNominalGroup.length === 1) {
        result.push({ type: "nominal", log: currentNominalGroup[0] })
      } else {
        const first = currentNominalGroup[0]
        const last = currentNominalGroup[currentNominalGroup.length - 1]
        result.push({
          type: "nominal_group",
          key: `group-${first.id}-${last.id}`,
          logs: [...currentNominalGroup]
        })
      }
    }

    return result
  }, [threatLogList])

  const toggleGroup = (key: string) => {
    setExpandedGroupKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString("en-GB", { hour12: false })
  }

  if (!showThreatLogPanel) return null

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
            groupedLogs.map((item) => {
              if (item.type === "threat" || item.type === "nominal") {
                const log = item.log
                const isThreat = item.type === "threat"
                return (
                  <div
                    key={log.id}
                    className={`border rounded-md p-3.5 bg-zinc-950/10 dark:bg-black/10 transition-colors ${
                      isThreat
                        ? "border-red-500/20 hover:border-red-500/40"
                        : "border-border/60 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[9px] text-zinc-300 font-bold bg-muted px-1.5 py-0.5 rounded-xs leading-none">
                        {log.camera_id}
                      </span>

                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-[8px] px-1 py-0.5 rounded-xs font-bold uppercase leading-none ${
                            isThreat
                              ? "bg-red-500/25 text-red-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isThreat ? "THREAT" : "NOMINAL"}
                        </span>
                        <span className="font-mono text-[8px] text-muted-foreground/60 leading-none">
                          {formatTime(log.timestamp)}
                        </span>
                      </div>
                    </div>

                    <p className="font-mono text-[10px] text-zinc-200 leading-normal uppercase">
                      {log.reason}
                    </p>

                    {log.snapshot_path && (
                      <div className="relative mt-2.5 overflow-hidden rounded-xs border border-border bg-black/40 group">
                        {/* biome-ignore lint/performance/noImgElement: Custom local filesystem snapshot JPEG path */}
                        {/* biome-ignore lint/a11y/useKeyWithClickEvents: Clickable image to zoom */}
                        <img
                          src={log.snapshot_path}
                          alt="Captured Threat Moment"
                          className="w-full h-24 object-cover object-center grayscale-[15%] group-hover:grayscale-0 transition-all duration-300 cursor-pointer"
                          onClick={() => setZoomImageUrl(log.snapshot_path)}
                        />
                        <div className="absolute bottom-1.5 right-1.5 bg-black/60 text-white px-1 font-mono text-[8px] rounded-xs border border-white/5 pointer-events-none">
                          ALERT_FRAME
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              // Renders wrapped consecutive nominal log group
              const group = item
              const isExpanded = expandedGroupKeys.includes(group.key)
              const firstLog = group.logs[0]
              const lastLog = group.logs[group.logs.length - 1]

              return (
                <div
                  key={group.key}
                  className="border border-border/40 rounded-md overflow-hidden bg-muted/5"
                >
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between font-mono text-[10px] text-zinc-300 hover:text-white hover:bg-muted/15 transition-all text-left cursor-pointer"
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot variant="silver" size="xs" />
                      <span className="font-bold uppercase tracking-wide">
                        NOMINAL_BLOCK ({group.logs.length} EVENTS)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground font-medium">
                        {formatTime(lastLog.timestamp)} - {formatTime(firstLog.timestamp)}
                      </span>
                      <ChevronRight
                        className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
                          isExpanded ? "rotate-90 text-primary" : ""
                        }`}
                      />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/20 p-3 space-y-2 bg-zinc-950/20">
                      {group.logs.map((subItem) => (
                        <div
                          key={subItem.id}
                          className="text-[9px] text-muted-foreground font-mono flex items-center justify-between border-b border-border/10 pb-2 last:border-b-0 last:pb-0"
                        >
                          <span className="text-zinc-400 font-semibold">
                            {formatTime(subItem.timestamp)}
                          </span>
                          <span className="uppercase text-[8px] bg-muted px-1 rounded-xs text-zinc-400 font-medium">
                            {subItem.camera_id}
                          </span>
                          <span
                            className="truncate max-w-[200px] text-left uppercase text-zinc-500"
                            title={subItem.reason}
                          >
                            {subItem.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
