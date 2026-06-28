"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getStreamUrl } from "@/lib/api";

interface Player {
  id: string;
  name: string;
  role: string | null;
  alive: boolean;
}

type FeedItem =
  | { kind: "phase"; key: string; phase: string; dayNum: number }
  | { kind: "turn"; key: string; turnId: string; name: string; role: string; channel: string; content: string; streaming: boolean }
  | { kind: "note"; key: string; text: string; tone: "kill" | "save" | "info" | "lynch" }
  | { kind: "vote"; key: string; voter: string; target: string };

interface MafiaStageProps {
  sessionId: string;
  shareToken?: string;
  topic: string;
  autoStart?: boolean;
  isReplay?: boolean;
}

const ROLE_COLOR: Record<string, string> = {
  mafia: "var(--against)",
  doctor: "var(--for)",
  detective: "var(--judge)",
  villager: "var(--muted-foreground)",
};

const CHANNEL_LABEL: Record<string, string> = {
  mafia: "Mafia · night",
  doctor: "Doctor · night",
  detective: "Detective · night",
  public: "",
};

const PHASE_LABEL: Record<string, string> = {
  night: "🌙 Night",
  day: "☀️ Day",
  vote: "🗳 Vote",
};

export default function MafiaStage({ sessionId, shareToken, topic, autoStart, isReplay = false }: MafiaStageProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [phase, setPhase] = useState<{ phase: string; dayNum: number } | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (autoStart) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed]);

  useEffect(() => {
    if (shareToken) setShareUrl(`${window.location.origin}/replay/${shareToken}`);
  }, [shareToken]);

  function nextKey() {
    seqRef.current += 1;
    return `k${seqRef.current}`;
  }

  function connect() {
    if (esRef.current) return;
    setStatus("running");
    const es = new EventSource(getStreamUrl(sessionId));
    esRef.current = es;
    es.onmessage = (e) => handleEvent(JSON.parse(e.data));
    es.onerror = () => {
      setStatus("error");
      es.close();
    };
  }

  function handleEvent(event: Record<string, string>) {
    switch (event.type) {
      case "game_start": {
        const list = (event.players as unknown as { id: string; name: string }[]) ?? [];
        setPlayers(list.map((p) => ({ id: p.id, name: p.name, role: null, alive: true })));
        break;
      }

      case "role_assignment":
        setPlayers((prev) =>
          prev.map((p) => (p.id === event.participant_id ? { ...p, role: event.role } : p))
        );
        break;

      case "phase_start":
        setPhase({ phase: event.phase, dayNum: Number(event.day_num) });
        setFeed((f) => [...f, { kind: "phase", key: nextKey(), phase: event.phase, dayNum: Number(event.day_num) }]);
        break;

      case "turn_start":
        setFeed((f) => [
          ...f,
          {
            kind: "turn",
            key: nextKey(),
            turnId: event.turn_id,
            name: event.participant_name,
            role: event.position,
            channel: event.channel || "public",
            content: "",
            streaming: true,
          },
        ]);
        break;

      case "token":
        setFeed((f) =>
          f.map((it) =>
            it.kind === "turn" && it.turnId === event.turn_id ? { ...it, content: it.content + event.token } : it
          )
        );
        break;

      case "turn_end":
        setFeed((f) =>
          f.map((it) => (it.kind === "turn" && it.turnId === event.turn_id ? { ...it, streaming: false } : it))
        );
        break;

      case "night_action": {
        const t = event.target_name;
        let text = "";
        let tone: "kill" | "save" | "info" = "info";
        if (event.action === "kill") {
          text = `The mafia move against ${t}…`;
          tone = "kill";
        } else if (event.action === "protect") {
          text = `The doctor shields ${t} tonight.`;
          tone = "save";
        } else if (event.action === "investigate") {
          text = `The detective investigates ${t} → ${event.result}.`;
          tone = "info";
        }
        setFeed((f) => [...f, { kind: "note", key: nextKey(), text, tone }]);
        break;
      }

      case "death":
        setPlayers((prev) => prev.map((p) => (p.id === event.participant_id ? { ...p, alive: false, role: event.role } : p)));
        setFeed((f) => [
          ...f,
          { kind: "note", key: nextKey(), text: `${event.name} was killed in the night — they were ${roleLabel(event.role)}.`, tone: "kill" },
        ]);
        break;

      case "dawn":
        setFeed((f) => [
          ...f,
          { kind: "note", key: nextKey(), text: event.saved ? "A target was attacked but the doctor saved them. No one died." : "The night passes. No one died.", tone: "save" },
        ]);
        break;

      case "vote_cast":
        setFeed((f) => [...f, { kind: "vote", key: nextKey(), voter: event.voter_name, target: event.target_name || "no one" }]);
        break;

      case "elimination":
        if (event.participant_id) {
          setPlayers((prev) => prev.map((p) => (p.id === event.participant_id ? { ...p, alive: false, role: event.role } : p)));
          setFeed((f) => [
            ...f,
            { kind: "note", key: nextKey(), text: `${event.name} was voted out — they were ${roleLabel(event.role)}.`, tone: "lynch" },
          ]);
        } else {
          setFeed((f) => [...f, { kind: "note", key: nextKey(), text: "The vote was tied. No one was eliminated.", tone: "info" }]);
        }
        break;

      case "game_end":
        setWinner(event.winner);
        break;

      case "debate_end":
        setStatus("completed");
        esRef.current?.close();
        break;

      case "error":
        setStatus("error");
        setErrorMsg(event.message || "An error occurred.");
        break;
    }
  }

  function copyShare() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center h-12 gap-4">
            <Link href="/" className="flex items-center gap-2 text-[14px] font-medium tracking-tight hover:opacity-80">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
              <span>AgenticDebate</span>
            </Link>
            <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Mafia</span>
            <div className="ml-auto flex items-center gap-2">
              <StatusPill status={status} isReplay={isReplay} />
              {shareUrl && (
                <button
                  onClick={copyShare}
                  className="text-[11px] font-mono px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  {copied ? "Copied" : "Share replay"}
                </button>
              )}
            </div>
          </div>

          <div className="py-4 flex items-end gap-4 border-t border-border">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-1">Table</div>
              <h1 className="text-[18px] md:text-[20px] font-medium tracking-tight leading-snug truncate">{topic}</h1>
            </div>
            {phase && (
              <div className="hidden md:flex flex-col items-end shrink-0">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Phase</span>
                <span className="text-[18px] font-medium tracking-tight leading-none mt-1">
                  {PHASE_LABEL[phase.phase]} {phase.dayNum}
                </span>
              </div>
            )}
          </div>

          {/* Roster */}
          {players.length > 0 && (
            <div className="flex flex-wrap gap-1.5 py-3 border-t border-border">
              {players.map((p) => (
                <span
                  key={p.id}
                  className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border ${
                    p.alive ? "border-border" : "border-border/50 opacity-40 line-through"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.role ? ROLE_COLOR[p.role] : "var(--muted-foreground)" }} />
                  {p.name}
                  {p.role && <span className="uppercase tracking-[0.1em] text-muted-foreground">{p.role}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-10">
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[13px] text-muted-foreground mb-5">The table is set. Roles are dealt at kickoff.</p>
            <button
              onClick={connect}
              className="rounded-md bg-foreground text-background px-6 py-2.5 text-[14px] font-medium tracking-tight hover:opacity-90 active:opacity-80 transition-opacity"
            >
              Deal & start →
            </button>
          </div>
        )}

        {feed.length === 0 && status === "running" && (
          <div className="py-16 flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
              Dealing roles
            </div>
          </div>
        )}

        <div className="space-y-2">
          {feed.map((it) => (
            <FeedRow key={it.key} item={it} />
          ))}
        </div>

        {winner && (
          <div className="mt-10 rounded-md border border-border bg-card p-6 md:p-8 text-center">
            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-3">Game over</div>
            <div className="flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: winner === "mafia" ? "var(--against)" : "var(--for)" }} />
              <span className="text-[22px] font-medium tracking-tight uppercase">{winner} win</span>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="mt-10 p-4 rounded-md border border-border text-[13px] text-[var(--against)]">
            {errorMsg || "Connection error. Refresh to retry."}
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </main>
  );
}

function roleLabel(role: string | undefined): string {
  if (!role) return "unknown";
  return role === "mafia" ? "MAFIA" : `the ${role}`;
}

function FeedRow({ item }: { item: FeedItem }) {
  if (item.kind === "phase") {
    return (
      <div className="flex items-center gap-3 pt-6 pb-2">
        <span className="text-[12px] font-mono uppercase tracking-[0.14em] text-foreground">
          {PHASE_LABEL[item.phase]} {item.dayNum}
        </span>
        <span className="flex-1 h-px bg-border" />
      </div>
    );
  }

  if (item.kind === "note") {
    const color =
      item.tone === "kill" ? "var(--against)" : item.tone === "save" ? "var(--for)" : item.tone === "lynch" ? "var(--judge)" : "var(--muted-foreground)";
    return (
      <div className="flex items-center gap-2 py-1.5 pl-1">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-[13px] text-muted-foreground italic">{item.text}</span>
      </div>
    );
  }

  if (item.kind === "vote") {
    return (
      <div className="text-[12px] font-mono text-muted-foreground pl-4 py-0.5">
        {item.voter} → <span className="text-foreground">{item.target}</span>
      </div>
    );
  }

  // turn
  const accent = ROLE_COLOR[item.role] ?? "var(--muted-foreground)";
  const channelTag = CHANNEL_LABEL[item.channel];
  const secret = item.channel !== "public";
  return (
    <article
      className={`rounded-md border bg-card transition-colors ${item.streaming ? "border-foreground/40" : "border-border"} ${
        secret ? "bg-muted/30" : ""
      }`}
    >
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: accent }} />
        <span className="text-[13px] font-medium tracking-tight truncate">{item.name}</span>
        {channelTag && (
          <span className="text-[10px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
            {channelTag}
          </span>
        )}
        {item.streaming && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
            live
          </span>
        )}
      </header>
      <div className="px-4 py-3">
        <p className="text-[14px] leading-relaxed text-foreground whitespace-pre-wrap">
          {item.content}
          {item.streaming && <span className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom bg-foreground animate-caret" />}
        </p>
      </div>
    </article>
  );
}

function StatusPill({ status, isReplay }: { status: "idle" | "running" | "completed" | "error"; isReplay: boolean }) {
  if (isReplay && status !== "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.12em] px-2.5 py-1 rounded border border-border text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        Replay
      </span>
    );
  }
  const map = {
    running: { label: "Live", pulse: true, dot: "var(--live)" },
    completed: { label: "Final", pulse: false, dot: "var(--muted-foreground)" },
    error: { label: "Error", pulse: false, dot: "var(--against)" },
    idle: { label: "Ready", pulse: false, dot: "var(--foreground)" },
  } as const;
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.12em] px-2.5 py-1 rounded border border-border text-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${s.pulse ? "animate-pulse" : ""}`} style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}
