"use client";

import {
  AlertTriangle,
  Bot,
  Clock,
  Film,
  MessageSquare,
  Moon,
  Plus,
  Send,
  Shield,
  Sun,
  Trash2,
  User,
  Video,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface VideoJob {
  id: string;
  filename: string;
  status: string;
  total_frames: number;
  summary: string | null;
  created_at: string;
  threat_count: number;
  warning_count: number;
  duration_sec: number | null;
  thumbnail_face: string | null;
}

interface ChatSession {
  id: string;
  title: string;
  videoJobIds: string[];
  created_at: string;
}

interface ToolCallRecord {
  call: { name: string; args: Record<string, unknown> };
  result: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCallRecord[] | null;
  created_at: string;
}

interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolEvents: {
    type: "tool_call" | "tool_result";
    call?: { name: string; args: Record<string, unknown> };
    result?: string;
    imageBase64?: string;
    mimeType?: string;
  }[];
  streaming: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDur(sec: number | null) {
  if (!sec) return "?s";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const toolLabel: Record<string, string> = {
  get_time_window: "TIME WINDOW SCAN",
  get_threats: "THREAT TIMELINE",
  get_face_roster: "FACE ROSTER",
  get_frame_snapshot: "FRAME SNAPSHOT",
};

// ── Tool Card ────────────────────────────────────────────────────────────────

function ToolEventCard({
  event,
}: {
  event: StreamMessage["toolEvents"][0];
}) {
  const [expanded, setExpanded] = useState(false);

  if (event.type === "tool_call") {
    return (
      <div className="my-1.5 rounded border border-primary/30 bg-primary/5 px-3 py-2 font-mono text-[10px]">
        <div className="flex items-center gap-2 text-primary">
          <Zap className="w-3 h-3" />
          <span className="font-bold uppercase">
            TOOL → {toolLabel[event.call?.name ?? ""] ?? event.call?.name}
          </span>
        </div>
        <div className="mt-1 text-muted-foreground">
          {Object.entries(event.call?.args ?? {})
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join("  ·  ")}
        </div>
      </div>
    );
  }

  // tool_result
  return (
    <div className="my-1.5 rounded border border-border bg-muted/30 px-3 py-2 font-mono text-[10px]">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="font-bold uppercase text-emerald-400">↳ RESULT</span>
        <span className="flex-1 truncate opacity-60">
          {event.result?.slice(0, 80)}
        </span>
        <span className="opacity-40">{expanded ? "▲" : "▾"}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <pre className="whitespace-pre-wrap text-[9px] text-muted-foreground leading-relaxed">
            {event.result}
          </pre>
          {event.imageBase64 && (
            <img
              src={`data:${event.mimeType};base64,${event.imageBase64}`}
              alt="Frame snapshot"
              className="rounded border border-border max-h-48 object-contain"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: StreamMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center ${
          isUser
            ? "border-border bg-muted"
            : "border-primary/30 bg-primary/10"
        }`}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-primary" />
        )}
      </div>

      <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        {/* Tool events (assistant only) */}
        {!isUser && msg.toolEvents.length > 0 && (
          <div className="w-full">
            {msg.toolEvents.map((ev, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              <ToolEventCard key={i} event={ev} />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {msg.content && (
          <div
            className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
              isUser
                ? "bg-primary text-primary-foreground font-medium"
                : "bg-card border border-border text-foreground"
            }`}
          >
            <span className="whitespace-pre-wrap">{msg.content}</span>
            {msg.streaming && (
              <span className="inline-block w-1.5 h-3.5 bg-primary ml-1 animate-pulse rounded-xs" />
            )}
          </div>
        )}

        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase">
          {isUser ? "ANALYST" : "EVE"}
        </span>
      </div>
    </div>
  );
}

// ── Video Picker Modal ───────────────────────────────────────────────────────

function VideoPickerModal({
  allVideos,
  tagged,
  onAdd,
  onClose,
}: {
  allVideos: VideoJob[];
  tagged: string[];
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider">
              SELECT_INTELLIGENCE_PAYLOAD
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {allVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <Video className="w-10 h-10 text-muted-foreground/30" />
              <p className="font-mono text-xs text-muted-foreground uppercase">
                No analysed videos found.
              </p>
              <Link
                href="/analysis"
                className="font-mono text-xs text-primary hover:underline uppercase"
              >
                Go to Video Analysis →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {allVideos.map((v) => {
                const isTagged = tagged.includes(v.id);
                return (
                  <button
                    type="button"
                    key={v.id}
                    onClick={() => !isTagged && onAdd(v.id)}
                    disabled={isTagged}
                    className={`flex flex-col gap-2 rounded-lg border p-3.5 text-left transition-all cursor-pointer ${
                      isTagged
                        ? "border-primary/40 bg-primary/5 opacity-60 cursor-not-allowed"
                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Film className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="font-mono text-[10px] font-bold truncate text-foreground uppercase">
                          {v.filename}
                        </span>
                      </div>
                      {isTagged && (
                        <span className="shrink-0 font-mono text-[8px] text-primary border border-primary/30 rounded-xs px-1 py-0.5">
                          TAGGED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {v.threat_count > 0 && (
                        <span className="flex items-center gap-1 font-mono text-[9px] text-red-400">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {v.threat_count} CRITICAL
                        </span>
                      )}
                      {v.warning_count > 0 && (
                        <span className="flex items-center gap-1 font-mono text-[9px] text-amber-400">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {v.warning_count} WARNING
                        </span>
                      )}
                      {v.threat_count === 0 && v.warning_count === 0 && (
                        <span className="font-mono text-[9px] text-emerald-400">
                          NOMINAL
                        </span>
                      )}
                      <span className="font-mono text-[9px] text-muted-foreground ml-auto">
                        {formatDur(v.duration_sec)}
                      </span>
                    </div>
                    {v.summary && (
                      <p className="font-mono text-[9px] text-muted-foreground leading-relaxed line-clamp-2">
                        {v.summary}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const pathname = usePathname();
  const [darkMode, setDarkMode] = useState(true);
  const [utcTime, setUtcTime] = useState("");

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Videos
  const [allVideos, setAllVideos] = useState<VideoJob[]>([]);
  const [taggedVideoIds, setTaggedVideoIds] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  // Messages
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Dark mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // ── UTC Clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setUtcTime(`${d.toUTCString().slice(17, 25)} UTC`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Load sessions & videos ─────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    const r = await fetch("/api/chat/sessions");
    const d = await r.json();
    if (d.ok) setSessions(d.sessions);
  }, []);

  const loadVideos = useCallback(async () => {
    const r = await fetch("/api/chat/videos");
    const d = await r.json();
    if (d.ok) setAllVideos(d.videos);
  }, []);

  useEffect(() => {
    loadSessions();
    loadVideos();
  }, [loadSessions, loadVideos]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Load a session ─────────────────────────────────────────────────────────
  const openSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    const r = await fetch(`/api/chat/sessions/${sessionId}`);
    const d = await r.json();
    if (!d.ok) return;

    setTaggedVideoIds(d.session.videoJobIds || []);

    const loaded: StreamMessage[] = (d.messages as ChatMessage[]).map((m) => ({
      id: String(m.id),
      role: m.role,
      content: m.content,
      toolEvents: (m.toolCalls || []).flatMap((tc) => [
        { type: "tool_call" as const, call: tc.call },
        { type: "tool_result" as const, result: tc.result },
      ]),
      streaming: false,
    }));
    setMessages(loaded);
  }, []);

  // ── New session ────────────────────────────────────────────────────────────
  const newSession = useCallback(async () => {
    const r = await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Intel Session", videoJobIds: [] }),
    });
    const d = await r.json();
    if (d.ok) {
      await loadSessions();
      await openSession(d.sessionId);
    }
  }, [loadSessions, openSession]);

  // ── Delete session ─────────────────────────────────────────────────────────
  const deleteSession = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
        setTaggedVideoIds([]);
      }
      await loadSessions();
    },
    [activeSessionId, loadSessions],
  );

  // ── Tag video ──────────────────────────────────────────────────────────────
  const addVideo = useCallback(
    async (videoId: string) => {
      if (!activeSessionId) return;
      const next = [...taggedVideoIds, videoId];
      setTaggedVideoIds(next);
      setShowPicker(false);
      await fetch(`/api/chat/sessions/${activeSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoJobIds: next }),
      });
    },
    [activeSessionId, taggedVideoIds],
  );

  const removeVideo = useCallback(
    async (videoId: string) => {
      if (!activeSessionId) return;
      const next = taggedVideoIds.filter((id) => id !== videoId);
      setTaggedVideoIds(next);
      await fetch(`/api/chat/sessions/${activeSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoJobIds: next }),
      });
    },
    [activeSessionId, taggedVideoIds],
  );

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!input.trim() || !activeSessionId || isSending) return;

    const text = input.trim();
    setInput("");
    setIsSending(true);

    // Add user message optimistically
    const userMsg: StreamMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      toolEvents: [],
      streaming: false,
    };

    const assistantMsgId = `a-${Date.now()}`;
    const assistantMsg: StreamMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      toolEvents: [],
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: text,
          videoJobIds: taggedVideoIds,
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              delta?: string;
              call?: { name: string; args: Record<string, unknown> };
              result?: string;
              imageBase64?: string;
              mimeType?: string;
            };

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                if (event.type === "text") {
                  return { ...m, content: m.content + (event.delta ?? "") };
                }
                if (
                  event.type === "tool_call" ||
                  event.type === "tool_result"
                ) {
                  return {
                    ...m,
                    toolEvents: [
                      ...m.toolEvents,
                      {
                        type: event.type as "tool_call" | "tool_result",
                        call: event.call,
                        result: event.result,
                        imageBase64: event.imageBase64,
                        mimeType: event.mimeType,
                      },
                    ],
                  };
                }
                if (event.type === "done") {
                  return { ...m, streaming: false };
                }
                return m;
              }),
            );
          } catch {
            // ignore parse error
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                streaming: false,
              }
            : m,
        ),
      );
    } finally {
      setIsSending(false);
      // Refresh sessions to update title
      loadSessions();
    }
  }, [input, activeSessionId, isSending, taggedVideoIds, loadSessions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const taggedVideos = allVideos.filter((v) => taggedVideoIds.includes(v.id));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground transition-colors duration-300">
      {/* ── HEADER ── */}
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

          <div className="hidden md:inline-flex items-center gap-1 bg-muted px-2 py-0.5 border border-border/80 text-[10px] font-mono text-muted-foreground uppercase rounded-xs">
            INTEL_CHAT
          </div>

          <nav className="flex items-center gap-4 ml-4 pl-4 border-l border-border/80">
            {[
              { href: "/monitor", label: "Live_Monitor" },
              { href: "/analysis", label: "Video_Analysis" },
              { href: "/chat", label: "Intel_Chat" },
            ].map(({ href, label }) => (
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
          <div className="flex items-center gap-1.5 bg-muted rounded-xs px-2.5 py-1 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 text-muted-foreground/80" />
            <span className="font-mono text-[10px] font-medium tracking-wide uppercase">
              {utcTime || "CONNECTING..."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Toggle Theme"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex flex-1 min-h-0">
        {/* ── LEFT SIDEBAR — Session History ── */}
        <aside className="w-56 shrink-0 border-r border-border bg-card/30 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50">
            <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              SESSIONS
            </span>
            <button
              type="button"
              onClick={newSession}
              className="flex items-center gap-1 rounded-xs border border-primary/30 bg-primary/10 hover:bg-primary/20 px-2 py-0.5 font-mono text-[9px] font-bold text-primary uppercase transition-colors cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" />
              NEW
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-3">
                <MessageSquare className="w-6 h-6 text-muted-foreground/30" />
                <p className="font-mono text-[9px] text-muted-foreground/60 uppercase">
                  No sessions yet
                </p>
              </div>
            ) : (
              sessions.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className={`group w-full flex flex-col gap-0.5 px-3 py-2 text-left transition-colors cursor-pointer ${
                    activeSessionId === s.id
                      ? "bg-primary/10 border-r-2 border-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span
                      className={`font-mono text-[10px] font-medium leading-tight flex-1 min-w-0 truncate ${
                        activeSessionId === s.id
                          ? "text-primary"
                          : "text-foreground"
                      }`}
                    >
                      {s.title}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => deleteSession(s.id, e)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:text-red-400 text-muted-foreground transition-all cursor-pointer"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[8px] text-muted-foreground/50">
                      {formatDate(s.created_at)}
                    </span>
                    {s.videoJobIds.length > 0 && (
                      <span className="font-mono text-[8px] text-primary/60">
                        {s.videoJobIds.length} VID
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* ── MAIN AREA ── */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {activeSessionId ? (
            <>
              {/* ── VIDEO CONTEXT STRIP ── */}
              <div className="shrink-0 border-b border-border bg-card/20 px-4 py-2.5 flex items-center gap-2 overflow-x-auto">
                <span className="font-mono text-[9px] text-muted-foreground uppercase shrink-0">
                  CONTEXT:
                </span>

                {taggedVideos.map((v) => (
                  <div
                    key={v.id}
                    className="shrink-0 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 group"
                  >
                    <Film className="w-3 h-3 text-primary" />
                    <div className="flex flex-col">
                      <span className="font-mono text-[9px] font-bold text-foreground uppercase truncate max-w-28">
                        {v.filename}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {v.threat_count > 0 && (
                          <span className="font-mono text-[8px] text-red-400">
                            {v.threat_count}🔴
                          </span>
                        )}
                        {v.warning_count > 0 && (
                          <span className="font-mono text-[8px] text-amber-400">
                            {v.warning_count}🟡
                          </span>
                        )}
                        <span className="font-mono text-[8px] text-muted-foreground">
                          {formatDur(v.duration_sec)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVideo(v.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 text-muted-foreground/50 transition-all cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="shrink-0 flex items-center gap-1.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-transparent hover:bg-primary/5 px-2.5 py-1.5 font-mono text-[9px] text-muted-foreground hover:text-primary transition-all uppercase cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  ADD VIDEO
                </button>

                {taggedVideoIds.length === 0 && (
                  <span className="font-mono text-[9px] text-muted-foreground/40 italic ml-1">
                    No videos tagged — add one to give the analyst context
                  </span>
                )}
              </div>

              {/* ── CHAT TRANSCRIPT ── */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                    <div className="w-16 h-16 rounded-full border border-primary/20 bg-primary/5 flex items-center justify-center">
                      <Bot className="w-8 h-8 text-primary/40" />
                    </div>
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground uppercase tracking-wide">
                        EVE&apos;S EYE INTEL ANALYST
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-1 max-w-xs">
                        Add a video to the context and ask about threats, faces,
                        specific time periods, or request a visual frame snapshot.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                      {[
                        "Summarise all threats",
                        "Who was detected at 0:45?",
                        "Show me the faces found",
                        "What happened between 30s and 60s?",
                      ].map((q) => (
                        <button
                          type="button"
                          key={q}
                          onClick={() => {
                            setInput(q);
                            textareaRef.current?.focus();
                          }}
                          className="rounded-full border border-border px-3 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all cursor-pointer"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))}
                <div ref={bottomRef} />
              </div>

              {/* ── INPUT BAR ── */}
              <div className="shrink-0 border-t border-border bg-card/30 px-4 py-3">
                <div className="flex items-end gap-2 rounded-xl border border-border bg-card focus-within:border-primary/50 transition-colors px-3 py-2">
                  {taggedVideoIds.length > 0 && (
                    <div className="shrink-0 flex items-center gap-1 mb-1.5">
                      <Film className="w-3 h-3 text-primary" />
                      <span className="font-mono text-[9px] text-primary font-bold">
                        {taggedVideoIds.length}
                      </span>
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      taggedVideoIds.length === 0
                        ? "Add a video to the context first..."
                        : "Ask about threats, faces, specific timestamps, or request frame snapshots…"
                    }
                    disabled={isSending || taggedVideoIds.length === 0}
                    rows={1}
                    className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50 max-h-32 font-sans leading-relaxed py-1"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={
                      isSending ||
                      !input.trim() ||
                      taggedVideoIds.length === 0
                    }
                    className="shrink-0 mb-0.5 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-mono text-[10px] font-bold text-primary-foreground uppercase transition-all hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isSending ? (
                      <>
                        <span className="w-2.5 h-2.5 border border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                        TRANSMITTING
                      </>
                    ) : (
                      <>
                        <Send className="w-3 h-3" />
                        TRANSMIT
                      </>
                    )}
                  </button>
                </div>
                <p className="mt-1.5 font-mono text-[8px] text-muted-foreground/40 text-center uppercase">
                  Enter to send · Shift+Enter for newline · Gemma 4 (31B) via
                  Cerebras
                </p>
              </div>
            </>
          ) : (
            /* ── NO SESSION SELECTED ── */
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-5 text-center max-w-sm">
                <div className="w-20 h-20 rounded-full border border-primary/20 bg-primary/5 flex items-center justify-center">
                  <MessageSquare className="w-9 h-9 text-primary/30" />
                </div>
                <div>
                  <p className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
                    INTEL CHAT
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                    Select a session from the sidebar or create a new one to
                    start interrogating your video intelligence data.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={newSession}
                  className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 px-4 py-2 font-mono text-xs font-bold text-primary uppercase transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  NEW SESSION
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── VIDEO PICKER MODAL ── */}
      {showPicker && (
        <VideoPickerModal
          allVideos={allVideos}
          tagged={taggedVideoIds}
          onAdd={addVideo}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
