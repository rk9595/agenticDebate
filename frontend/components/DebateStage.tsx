"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getStreamUrl } from "@/lib/api";
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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
        setErrorMsg(event.message || "An error occurred.");
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

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ─── Top bar ─── */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6">
          {/* Brand + status */}
          <div className="flex items-center h-12 gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-[14px] font-medium tracking-tight hover:opacity-80"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
              <span>AgenticDebate</span>
            </Link>
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

          {/* Topic + round counter */}
          <div className="py-4 flex items-end gap-4 border-t border-border">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-1">
                {isMeeting ? "Agenda" : "Motion"}
              </div>
              <h1 className="text-[18px] md:text-[20px] font-medium tracking-tight leading-snug truncate">
                {topic}
              </h1>
            </div>
            {currentRound && (
              <div className="hidden md:flex flex-col items-end shrink-0">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Round
                </span>
                <span className="text-[22px] font-medium tracking-tight leading-none tabular-nums mt-1">
                  {currentRound.num}
                  <span className="text-muted-foreground/50 text-[15px]">
                    /{displayTotalRounds}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Live scoreboard strip (debates only) */}
          {!isMeeting && (forSide || againstSide) && (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-3 border-t border-border">
              <ScoreSide side={forSide} accent="var(--for)" label="For" align="left" />
              <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                vs
              </span>
              <ScoreSide side={againstSide} accent="var(--against)" label="Against" align="right" />
            </div>
          )}
        </div>
      </header>

      {/* ─── Body ─── */}
      <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[13px] text-muted-foreground mb-5">
              {isMeeting ? "Ready when you are." : "Both sides are set. Ready to start."}
            </p>
            <button
              onClick={connect}
              className="rounded-md bg-foreground text-background px-6 py-2.5 text-[14px] font-medium tracking-tight hover:opacity-90 active:opacity-80 transition-opacity"
            >
              {isMeeting ? "Start meeting →" : "Start debate →"}
            </button>
          </div>
        )}

        {groups.length === 0 && status === "running" && (
          <div className="py-16 flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
              Waiting for opening
            </div>
          </div>
        )}

        <div className="space-y-2">
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
                  <div className="space-y-3 md:mt-10">
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

        {verdict && <Verdict verdict={verdict} />}

        {status === "completed" && !verdict && (
          <div className="mt-10 p-5 rounded-md border border-border bg-card text-center text-[13px] text-muted-foreground">
            {isMeeting ? "Meeting concluded." : "Match concluded."}{" "}
            {shareUrl && "Share the link above for the replay."}
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
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.pulse ? "animate-pulse" : ""}`}
        style={{ background: s.dot }}
      />
      {s.label}
    </span>
  );
}

function ScoreSide({
  side,
  accent,
  label,
  align,
}: {
  side?: { name: string; score: number; turns: number };
  accent: string;
  label: string;
  align: "left" | "right";
}) {
  const avg = side && side.turns > 0 ? side.score / side.turns : null;
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <div
        className={`flex items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div
        className={`flex items-baseline gap-2 mt-1 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span className="text-[14px] font-medium tracking-tight truncate">
          {side?.name ?? "—"}
        </span>
        <span className="text-[16px] font-medium tabular-nums">
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
  const accent =
    verdict.winner === "for"
      ? "var(--for)"
      : verdict.winner === "against"
        ? "var(--against)"
        : "var(--foreground)";

  return (
    <div className="mt-12 rounded-md border border-border bg-card p-6 md:p-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          Verdict
        </span>
        {verdict.streaming && (
          <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
        )}
      </div>

      {!verdict.streaming && verdict.winner && (
        <div className="mb-5 flex items-baseline gap-3">
          <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Winner
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
            <span className="text-[20px] font-medium tracking-tight uppercase">
              {verdict.winner}
            </span>
          </span>
        </div>
      )}

      <p className="text-[14px] text-foreground/85 leading-relaxed whitespace-pre-wrap max-w-2xl">
        {verdict.reasoning}
        {verdict.streaming && (
          <span className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom bg-foreground animate-caret" />
        )}
      </p>
    </div>
  );
}
