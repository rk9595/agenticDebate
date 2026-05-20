"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getStreamUrl } from "@/lib/api";
import PopcornViewer from "./PopcornViewer";
import TurnBubble from "./TurnBubble";
import RoundHeader from "./RoundHeader";
import JudgeCard from "./JudgeCard";

interface Judgment {
  id: string;
  content: string;
  score: number | null;
  streaming: boolean;
}

interface Turn {
  id: string;
  participantId: string;
  participantName: string;
  position: string;
  round: string;
  roundNum: number;
  content: string;
  streaming: boolean;
  colorIndex: number;
  judgment?: Judgment;
}

interface RoundGroup {
  round: string;
  roundNum: number;
  turns: Turn[];
}

interface DebateStageProps {
  sessionId: string;
  shareToken?: string;
  topic: string;
  totalRounds: number;
  sessionType?: "debate" | "meeting";
  autoStart?: boolean;
  isReplay?: boolean;
}

export default function DebateStage({
  sessionId,
  shareToken,
  topic,
  totalRounds,
  sessionType = "debate",
  autoStart,
  isReplay = false,
}: DebateStageProps) {
  const [groups, setGroups] = useState<RoundGroup[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [currentRound, setCurrentRound] = useState<{ round: string; num: number } | null>(null);
  const [verdict, setVerdict] = useState<{ winner: string | null; reasoning: string; streaming: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const verdictIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const colorMapRef = useRef<Record<string, number>>({});
  const colorCounterRef = useRef(0);

  useEffect(() => {
    if (autoStart) connect();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [groups]);

  function getColorIndex(participantId: string): number {
    if (colorMapRef.current[participantId] === undefined) {
      colorMapRef.current[participantId] = colorCounterRef.current++;
    }
    return colorMapRef.current[participantId];
  }

  function connect() {
    if (esRef.current) return;
    setStatus("running");
    const es = new EventSource(getStreamUrl(sessionId));
    esRef.current = es;

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      handleEvent(event);
    };
    es.onerror = () => {
      setStatus("error");
      es.close();
    };
  }

  function handleEvent(event: Record<string, string>) {
    switch (event.type) {
      case "round_start":
        setCurrentRound({ round: event.round, num: Number(event.round_num) });
        setGroups((prev) => [
          ...prev,
          { round: event.round, roundNum: Number(event.round_num), turns: [] },
        ]);
        break;

      case "turn_start": {
        const colorIndex = getColorIndex(event.participant_id);
        setGroups((prev) => {
          const next = [...prev];
          const last = { ...next[next.length - 1], turns: [...next[next.length - 1].turns] };
          last.turns.push({
            id: event.turn_id,
            participantId: event.participant_id,
            participantName: event.participant_name,
            position: event.position,
            round: event.round,
            roundNum: currentRound?.num ?? 0,
            content: "",
            streaming: true,
            colorIndex,
          });
          next[next.length - 1] = last;
          return next;
        });
        break;
      }

      case "token":
        setGroups((prev) => {
          const next = [...prev];
          const lastGroup = { ...next[next.length - 1], turns: [...next[next.length - 1].turns] };
          const turnIdx = lastGroup.turns.findIndex((t) => t.id === event.turn_id);
          if (turnIdx !== -1) {
            lastGroup.turns[turnIdx] = {
              ...lastGroup.turns[turnIdx],
              content: lastGroup.turns[turnIdx].content + event.token,
            };
          }
          next[next.length - 1] = lastGroup;
          return next;
        });
        break;

      case "turn_end":
        setGroups((prev) => {
          const next = [...prev];
          const lastGroup = { ...next[next.length - 1], turns: [...next[next.length - 1].turns] };
          const turnIdx = lastGroup.turns.findIndex((t) => t.id === event.turn_id);
          if (turnIdx !== -1) {
            lastGroup.turns[turnIdx] = { ...lastGroup.turns[turnIdx], streaming: false };
          }
          next[next.length - 1] = lastGroup;
          return next;
        });
        break;

      case "judgment_start":
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            turns: g.turns.map((t) =>
              t.id === event.turn_id
                ? { ...t, judgment: { id: event.judgment_id, content: "", score: null, streaming: true } }
                : t
            ),
          }))
        );
        break;

      case "judgment_token":
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            turns: g.turns.map((t) =>
              t.judgment?.id === event.judgment_id
                ? { ...t, judgment: { ...t.judgment, content: t.judgment.content + event.token } }
                : t
            ),
          }))
        );
        break;

      case "judgment_end":
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            turns: g.turns.map((t) =>
              t.judgment?.id === event.judgment_id
                ? { ...t, judgment: { ...t.judgment, score: event.score ? Number(event.score) : null, streaming: false } }
                : t
            ),
          }))
        );
        break;

      case "verdict_start":
        verdictIdRef.current = event.judgment_id;
        setVerdict({ winner: null, reasoning: "", streaming: true });
        break;

      case "verdict_token":
        if (verdictIdRef.current === event.judgment_id) {
          setVerdict((prev) => (prev ? { ...prev, reasoning: prev.reasoning + event.token } : prev));
        }
        break;

      case "verdict_end":
        setVerdict({ winner: event.winner ?? null, reasoning: event.reasoning ?? "", streaming: false });
        break;

      case "debate_end":
        setStatus("completed");
        esRef.current?.close();
        break;

      case "error":
        setStatus("error");
        break;
    }
  }

  const shareUrl =
    typeof window !== "undefined" && shareToken
      ? `${window.location.origin}/replay/${shareToken}`
      : null;

  function copyShare() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isMeeting = sessionType === "meeting";
  const displayTotalRounds = isMeeting ? totalRounds + 2 : totalRounds;

  // Aggregate per-fighter scores from judgments for the scoreboard
  const scoreboard = useMemo(() => {
    const tally: Record<string, { name: string; position: string; score: number; turns: number }> = {};
    for (const g of groups) {
      for (const t of g.turns) {
        const key = t.position;
        tally[key] = tally[key] ?? { name: t.participantName, position: t.position, score: 0, turns: 0 };
        tally[key].name = t.participantName;
        if (t.judgment?.score != null) {
          tally[key].score += t.judgment.score;
          tally[key].turns += 1;
        }
      }
    }
    return tally;
  }, [groups]);

  const forSide = scoreboard["for"];
  const againstSide = scoreboard["against"];

  // True when any turn is actively streaming right now
  const anyStreaming = groups.some((g) => g.turns.some((t) => t.streaming));

  return (
    <main className="min-h-screen flex flex-col">
      {/* Scoreboard top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          {/* Brand row */}
          <div className="flex items-center justify-between h-10 border-b border-border/50">
            <Link href="/" className="text-display text-xs font-bold tracking-tight hover:opacity-80">
              AGENTIC<span className="text-muted-foreground">/</span>DEBATE
            </Link>
            <div className="flex items-center gap-2">
              <StatusPill status={status} isReplay={isReplay} />
              {shareUrl && (
                <button
                  onClick={copyShare}
                  className="text-caption text-[10px] px-2.5 py-1 rounded-full border border-border hover:border-foreground/40 transition-colors"
                >
                  {copied ? "✓ copied" : "share replay"}
                </button>
              )}
            </div>
          </div>

          {/* Title + round indicator */}
          <div className="py-3 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-caption text-[10px] text-muted-foreground mb-0.5">
                {isMeeting ? "meeting agenda" : "the motion"}
              </div>
              <h1 className="text-display text-lg md:text-xl font-bold tracking-tight truncate">
                {topic}
              </h1>
            </div>
            {currentRound && (
              <div className="hidden md:flex flex-col items-end">
                <span className="text-caption text-[10px] text-muted-foreground">round</span>
                <span className="text-display text-2xl font-black leading-none tabular-nums">
                  {currentRound.num}
                  <span className="text-muted-foreground/60 text-base">/{displayTotalRounds}</span>
                </span>
              </div>
            )}
          </div>

          {/* Live scoreboard strip (debates only) */}
          {!isMeeting && (forSide || againstSide) && (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3 border-t border-border/50">
              <ScoreSide
                side={forSide}
                color="var(--for)"
                label="FOR"
                align="left"
              />
              <span className="text-display text-xs font-bold text-muted-foreground">VS</span>
              <ScoreSide
                side={againstSide}
                color="var(--against)"
                label="AGAINST"
                align="right"
              />
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-6">
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-caption text-[11px] text-muted-foreground mb-3">
              {isMeeting ? "ready to begin" : "fighters in their corners"}
            </div>
            <button
              onClick={connect}
              className="group relative rounded-2xl overflow-hidden bg-foreground text-background px-8 py-4"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--for)]/30 via-transparent to-[var(--against)]/30 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="relative text-display text-base font-black tracking-tight">
                {isMeeting ? "BEGIN MEETING →" : "RING THE BELL →"}
              </span>
            </button>
          </div>
        )}

        {groups.length === 0 && status === "running" && (
          <div className="py-16 flex flex-col items-center gap-3 text-center">
            <PopcornViewer excited={anyStreaming} />
            <span className="text-caption text-[10px] text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--live)] animate-live mr-1.5" />
              waiting for opening arguments…
            </span>
          </div>
        )}

        {/* Popcorn viewer between rounds — shown when running but nothing streaming */}
        {status === "running" && groups.length > 0 && !anyStreaming && (
          <div className="flex justify-center py-6">
            <PopcornViewer excited={false} />
          </div>
        )}

        <div className="space-y-6">
          {groups.map((group, gi) => (
            <section key={gi}>
              <RoundHeader
                round={group.round}
                roundNum={group.roundNum}
                totalRounds={displayTotalRounds}
              />

              {isMeeting ? (
                <div className="space-y-3">
                  {group.turns.map((turn) => (
                    <div key={turn.id}>
                      <TurnBubble
                        participantName={turn.participantName}
                        position={turn.position}
                        round={turn.round}
                        content={turn.content}
                        streaming={turn.streaming}
                        colorIndex={turn.colorIndex}
                        variant="meeting"
                      />
                      {turn.judgment && (
                        <JudgeCard
                          content={turn.judgment.content}
                          score={turn.judgment.score}
                          streaming={turn.judgment.streaming}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3 md:gap-4">
                  {/* FOR column */}
                  <div className="space-y-3">
                    {group.turns
                      .filter((t) => t.position === "for")
                      .map((turn) => (
                        <div key={turn.id}>
                          <TurnBubble
                            participantName={turn.participantName}
                            position={turn.position}
                            round={turn.round}
                            content={turn.content}
                            streaming={turn.streaming}
                            colorIndex={turn.colorIndex}
                            variant="fight"
                            align="left"
                          />
                          {turn.judgment && (
                            <JudgeCard
                              content={turn.judgment.content}
                              score={turn.judgment.score}
                              streaming={turn.judgment.streaming}
                            />
                          )}
                        </div>
                      ))}
                  </div>
                  {/* AGAINST column */}
                  <div className="space-y-3 md:mt-8">
                    {group.turns
                      .filter((t) => t.position === "against")
                      .map((turn) => (
                        <div key={turn.id}>
                          <TurnBubble
                            participantName={turn.participantName}
                            position={turn.position}
                            round={turn.round}
                            content={turn.content}
                            streaming={turn.streaming}
                            colorIndex={turn.colorIndex}
                            variant="fight"
                            align="right"
                          />
                          {turn.judgment && (
                            <JudgeCard
                              content={turn.judgment.content}
                              score={turn.judgment.score}
                              streaming={turn.judgment.streaming}
                            />
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Verdict */}
        {verdict && <Verdict verdict={verdict} />}

        {status === "completed" && !verdict && (
          <div className="mt-8 p-5 rounded-xl border border-border bg-card/60 text-center text-sm text-muted-foreground">
            {isMeeting ? "Meeting concluded." : "Match concluded."}{" "}
            {shareUrl && "Share the link above for the replay."}
          </div>
        )}

        {status === "error" && (
          <div className="mt-8 p-4 rounded-xl border border-[var(--against)]/40 bg-[var(--against)]/10 text-sm text-[var(--against)]">
            Connection error. Refresh to retry.
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </main>
  );
}

/* ───────────────────────── Sub-components ───────────────────────── */

function StatusPill({
  status,
  isReplay,
}: {
  status: "idle" | "running" | "completed" | "error";
  isReplay: boolean;
}) {
  if (isReplay && status !== "running") {
    return (
      <span className="flex items-center gap-1.5 text-caption text-[10px] px-2.5 py-1 rounded-full border border-border text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        replay
      </span>
    );
  }

  const map = {
    running: { color: "var(--live)", label: "live", pulse: true },
    completed: { color: "var(--muted-foreground)", label: "final", pulse: false },
    error: { color: "var(--against)", label: "error", pulse: false },
    idle: { color: "var(--judge)", label: "ready", pulse: false },
  } as const;

  const s = map[status];
  return (
    <span
      className="flex items-center gap-1.5 text-caption text-[10px] font-bold px-2.5 py-1 rounded-full border"
      style={{
        borderColor: `color-mix(in oklch, ${s.color} 40%, var(--border))`,
        color: s.color,
        background: `color-mix(in oklch, ${s.color} 8%, transparent)`,
      }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.pulse ? "animate-live" : ""}`}
        style={{ background: s.color }}
      />
      {s.label}
    </span>
  );
}

function ScoreSide({
  side,
  color,
  label,
  align,
}: {
  side?: { name: string; score: number; turns: number };
  color: string;
  label: string;
  align: "left" | "right";
}) {
  const avg = side && side.turns > 0 ? side.score / side.turns : null;
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="text-caption text-[10px] font-bold" style={{ color }}>
        {label}
      </span>
      <div
        className={`flex items-baseline gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span className="text-display text-base font-bold tracking-tight">
          {side?.name ?? "—"}
        </span>
        <span className="text-display text-xl font-black tabular-nums" style={{ color }}>
          {avg != null ? avg.toFixed(1) : "—"}
        </span>
      </div>
    </div>
  );
}

function Verdict({
  verdict,
}: {
  verdict: { winner: string | null; reasoning: string; streaming: boolean };
}) {
  const winnerColor =
    verdict.winner === "for"
      ? "var(--for)"
      : verdict.winner === "against"
        ? "var(--against)"
        : "var(--judge)";

  return (
    <div className="mt-10 relative">
      <div
        className="absolute -inset-1 rounded-3xl blur-2xl opacity-50"
        style={{ background: `radial-gradient(closest-side, ${winnerColor}, transparent)` }}
      />
      <div
        className="relative rounded-3xl border-2 bg-card/85 backdrop-blur-md p-6 md:p-8"
        style={{
          borderColor: `color-mix(in oklch, ${winnerColor} 50%, var(--border))`,
        }}
      >
        <div className="flex items-center justify-center gap-3 mb-4">
          <span className="text-caption text-[10px] text-muted-foreground">
            referee&apos;s decision
          </span>
          {verdict.streaming && (
            <span
              className="h-1.5 w-1.5 rounded-full animate-live"
              style={{ background: winnerColor }}
            />
          )}
        </div>

        {!verdict.streaming && verdict.winner && (
          <div className="text-center mb-5">
            <div className="text-caption text-[11px] text-muted-foreground">
              and the winner is...
            </div>
            <div
              className="text-display text-4xl md:text-6xl font-black tracking-tighter uppercase mt-1"
              style={{ color: winnerColor }}
            >
              {verdict.winner}
            </div>
          </div>
        )}

        <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap max-w-2xl mx-auto">
          {verdict.reasoning}
          {verdict.streaming && (
            <span
              className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom animate-caret"
              style={{ background: winnerColor }}
            />
          )}
        </p>
      </div>
    </div>
  );
}
