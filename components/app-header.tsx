"use client";

import {
  AlertTriangle,
  Clock,
  Moon,
  Shield,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StatusIndicator } from "@/components/ui/status-dot";

const NAV_LINKS = [
  { href: "/monitor", label: "Live_Monitor" },
  { href: "/analysis", label: "Video_Analysis" },
  { href: "/chat", label: "Intel_Chat" },
  { href: "/settings", label: "Settings" },
] as const;

export interface AppHeaderProps {
  readonly pageBadge?: string;
  readonly isPrimaryPulsing?: boolean;
  readonly utcTime?: string;
  readonly darkMode?: boolean;
  readonly setDarkMode?: (val: boolean) => void;
  readonly rightActions?: ReactNode;
}

export function AppHeader({
  pageBadge,
  isPrimaryPulsing = false,
  utcTime,
  darkMode,
  setDarkMode,
  rightActions,
}: AppHeaderProps) {
  const pathname = usePathname();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/45 backdrop-blur-md px-4 py-1.5 z-20">
      <div className="flex items-center gap-3">
        <Link
          href="/monitor"
          className="flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 rounded-sm px-2.5 py-0.5 border border-primary/20 transition-all font-bold"
        >
          <Shield className="w-4 h-4 text-primary" />
          <span className="font-heading text-xs font-semibold uppercase tracking-wider text-primary">
            EVE&apos;S EYE
          </span>
        </Link>

        {isPrimaryPulsing ? (
          <div className="inline-flex items-center gap-1.5 rounded-sm border border-red-500/30 bg-red-950/20 px-2 py-0.5 font-mono text-[10px] font-bold text-red-500 animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5" />
            THREAT ACTIVE
          </div>
        ) : pageBadge ? (
          <div className="hidden md:inline-flex items-center gap-1 bg-muted px-2 py-0.5 border border-border/80 text-[10px] font-mono text-muted-foreground uppercase rounded-xs">
            {pageBadge}
          </div>
        ) : pathname === "/monitor" ? (
          <StatusIndicator
            variant="nominal"
            pulse
            className="hidden md:inline-flex"
          >
            ONLINE
          </StatusIndicator>
        ) : null}

        <nav className="flex items-center gap-4 ml-4 pl-4 border-l border-border/80">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`font-mono text-[10px] font-bold uppercase tracking-wider transition-all pb-0.5 hover:text-foreground ${
                pathname === href
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {rightActions}

        {utcTime !== undefined && (
          <div className="flex items-center gap-1.5 bg-muted rounded-xs px-2.5 py-1 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 text-muted-foreground/80" />
            <span className="font-mono text-2xs font-medium tracking-wide uppercase">
              {utcTime || "CONNECTING CLOCK..."}
            </span>
          </div>
        )}

        {setDarkMode !== undefined && darkMode !== undefined && (
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
        )}
      </div>
    </header>
  );
}
