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

interface Speaker {
  turnId: string;
  id: string;
  name: string;
  role: string;
  channel: string;
  content: string;
  streaming: boolean;
}

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

const SEAT_HUES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--for)",
  "var(--against)",
  "var(--judge)",
];

const CHANNEL_LABEL: Record<string, string> = {
  mafia: "🌙 mafia whisper",
  doctor: "🌙 doctor",
  detective: "🌙 detective",
  public: "",
};

const PHASE_LABEL: Record<string, string> = { night: "🌙 Night", day: "☀️ Day", vote: "🗳 Vote" };
const NIGHT_FX: Record<string, string> = { kill: "🔪", protect: "🛡", investigate: "🔍" };

export default function MafiaStage({ sessionId, shareToken, topic, autoStart, isReplay = false }: MafiaStageProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [phase, setPhase] = useState<{ phase: string; dayNum: number } | null>(null);
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [nightFx, setNightFx] = useState<Record<string, { action: string; result?: string }>>({});
  const [winner, setWinner] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "feed">("table");
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
    if (view === "feed") bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed, view]);

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
        setPlayers((prev) => prev.map((p) => (p.id === event.participant_id ? { ...p, role: event.role } : p)));
        break;

      case "phase_start":
        setPhase({ phase: event.phase, dayNum: Number(event.day_num) });
        setVotes({});
        setNightFx({});
        if (event.phase !== "vote") setSpeaker(null);
        setFeed((f) => [...f, { kind: "phase", key: nextKey(), phase: event.phase, dayNum: Number(event.day_num) }]);
        break;

      case "turn_start":
        setSpeaker({
          turnId: event.turn_id,
          id: event.participant_id,
          name: event.participant_name,
          role: event.position,
          channel: event.channel || "public",
          content: "",
          streaming: true,
        });
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
        setSpeaker((s) => (s && s.turnId === event.turn_id ? { ...s, content: s.content + event.token } : s));
        setFeed((f) =>
          f.map((it) => (it.kind === "turn" && it.turnId === event.turn_id ? { ...it, content: it.content + event.token } : it))
        );
        break;

      case "turn_end":
        setSpeaker((s) => (s && s.turnId === event.turn_id ? { ...s, streaming: false } : s));
        setFeed((f) => f.map((it) => (it.kind === "turn" && it.turnId === event.turn_id ? { ...it, streaming: false } : it)));
        break;

      case "night_action": {
        setNightFx((fx) => ({ ...fx, [event.target_id]: { action: event.action, result: event.result } }));
        const t = event.target_name;
        let text = "";
        let tone: "kill" | "save" | "info" = "info";
        if (event.action === "kill") { text = `The mafia move against ${t}…`; tone = "kill"; }
        else if (event.action === "protect") { text = `The doctor shields ${t} tonight.`; tone = "save"; }
        else if (event.action === "investigate") { text = `The detective investigates ${t} → ${event.result}.`; tone = "info"; }
        setFeed((f) => [...f, { kind: "note", key: nextKey(), text, tone }]);
        break;
      }

      case "death":
        setPlayers((prev) => prev.map((p) => (p.id === event.participant_id ? { ...p, alive: false, role: event.role } : p)));
        setFeed((f) => [...f, { kind: "note", key: nextKey(), text: `${event.name} was killed in the night — they were ${roleLabel(event.role)}.`, tone: "kill" }]);
        break;

      case "dawn":
        setFeed((f) => [...f, { kind: "note", key: nextKey(), text: event.saved ? "A target was attacked but the doctor saved them. No one died." : "The night passes. No one died.", tone: "save" }]);
        break;

      case "vote_cast":
        if (event.target_id) setVotes((v) => ({ ...v, [event.voter_id]: event.target_id }));
        setFeed((f) => [...f, { kind: "vote", key: nextKey(), voter: event.voter_name, target: event.target_name || "no one" }]);
        break;

      case "elimination":
        if (event.participant_id) {
          setPlayers((prev) => prev.map((p) => (p.id === event.participant_id ? { ...p, alive: false, role: event.role } : p)));
          setFeed((f) => [...f, { kind: "note", key: nextKey(), text: `${event.name} was voted out — they were ${roleLabel(event.role)}.`, tone: "lynch" }]);
        } else {
          setFeed((f) => [...f, { kind: "note", key: nextKey(), text: "The vote was tied. No one was eliminated.", tone: "info" }]);
        }
        break;

      case "game_end":
        setWinner(event.winner);
        setSpeaker(null);
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
              <div className="flex rounded border border-border overflow-hidden">
                {(["table", "feed"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`text-[11px] font-mono px-2.5 py-1 transition-colors ${
                      view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v === "table" ? "Watch" : "Feed"}
                  </button>
                ))}
              </div>
              <StatusPill status={status} isReplay={isReplay} />
              {shareUrl && (
                <button
                  onClick={copyShare}
                  className="text-[11px] font-mono px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  {copied ? "Copied" : "Share"}
                </button>
              )}
            </div>
          </div>

          <div className="py-3 flex items-end gap-4 border-t border-border">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-1">Table</div>
              <h1 className="text-[17px] md:text-[19px] font-medium tracking-tight leading-snug truncate">{topic}</h1>
            </div>
            {phase && (
              <div className="hidden sm:flex flex-col items-end shrink-0">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Phase</span>
                <span className="text-[17px] font-medium tracking-tight leading-none mt-1">
                  {PHASE_LABEL[phase.phase]} {phase.dayNum}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
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

        {status !== "idle" && players.length === 0 && (
          <div className="py-16 flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
              Dealing roles
            </div>
          </div>
        )}

        {players.length > 0 && view === "table" && (
          <TableView players={players} phase={phase} speaker={speaker} votes={votes} nightFx={nightFx} winner={winner} />
        )}

        {players.length > 0 && view === "feed" && (
          <>
            <Roster players={players} />
            <div className="space-y-2 mt-4">
              {feed.map((it) => (
                <FeedRow key={it.key} item={it} />
              ))}
            </div>
            {winner && <WinnerBanner winner={winner} />}
            <div ref={bottomRef} />
          </>
        )}

        {status === "error" && (
          <div className="mt-10 p-4 rounded-md border border-border text-[13px] text-[var(--against)]">
            {errorMsg || "Connection error. Refresh to retry."}
          </div>
        )}
      </div>
    </main>
  );
}

/* ───────────────────────── Table (watch) view ───────────────────────── */

function seatPos(i: number, n: number) {
  const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + 41 * Math.cos(angle), y: 50 + 39 * Math.sin(angle) };
}

function TableView({
  players,
  phase,
  speaker,
  votes,
  nightFx,
  winner,
}: {
  players: Player[];
  phase: { phase: string; dayNum: number } | null;
  speaker: Speaker | null;
  votes: Record<string, string>;
  nightFx: Record<string, { action: string; result?: string }>;
  winner: string | null;
}) {
  const n = players.length;
  const idx: Record<string, number> = {};
  players.forEach((p, i) => (idx[p.id] = i));
  const isNight = phase?.phase === "night";

  const voteTally: Record<string, number> = {};
  Object.values(votes).forEach((t) => (voteTally[t] = (voteTally[t] ?? 0) + 1));

  const bg = isNight
    ? "radial-gradient(ellipse at 50% 40%, oklch(0.28 0.05 270), oklch(0.16 0.02 270))"
    : phase?.phase === "vote"
      ? "radial-gradient(ellipse at 50% 40%, oklch(0.34 0.03 60), oklch(0.2 0.02 60))"
      : "radial-gradient(ellipse at 50% 40%, oklch(0.5 0.06 85), oklch(0.32 0.03 60))";

  return (
    <div className="space-y-3">
      <div
        className="relative w-full rounded-2xl border border-border overflow-hidden transition-[background] duration-700"
        style={{ background: bg, height: "min(64vh, 560px)" }}
      >
        {/* vote lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          {Object.entries(votes).map(([voter, target]) => {
            if (idx[voter] == null || idx[target] == null) return null;
            const a = seatPos(idx[voter], n);
            const b = seatPos(idx[target], n);
            return (
              <line
                key={voter}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="var(--against)" strokeWidth={1.5} strokeOpacity={0.8}
                vectorEffect="non-scaling-stroke" className="animate-vote-line"
              />
            );
          })}
        </svg>

        {/* center table */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] flex flex-col items-center justify-center text-center"
          style={{
            width: "46%",
            height: "44%",
            background: "radial-gradient(ellipse at 50% 40%, oklch(0.42 0.07 150 / 0.55), oklch(0.3 0.05 150 / 0.65))",
            boxShadow: "inset 0 0 40px oklch(0 0 0 / 0.4), 0 10px 30px oklch(0 0 0 / 0.3)",
            border: "2px solid oklch(0.5 0.05 150 / 0.4)",
          }}
        >
          <span className="text-[26px] md:text-[34px] leading-none">
            {phase ? PHASE_LABEL[phase.phase]?.split(" ")[0] : "🎴"}
          </span>
          {phase && (
            <span className="mt-1 text-[12px] md:text-[13px] font-mono uppercase tracking-[0.18em] text-white/85">
              {phase.phase} {phase.dayNum}
            </span>
          )}
          <span className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">
            {players.filter((p) => p.alive).length} alive
          </span>
        </div>

        {/* seats */}
        {players.map((p, i) => {
          const pos = seatPos(i, n);
          const speaking = speaker?.id === p.id && p.alive;
          const sleeping = isNight && p.alive && !speaking;
          const fx = nightFx[p.id];
          const tally = voteTally[p.id] ?? 0;
          return (
            <div
              key={p.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: speaking ? 10 : 1 }}
            >
              {fx && (
                <div className="absolute -top-5 text-[18px] animate-float-up" title={fx.result ?? fx.action}>
                  {NIGHT_FX[fx.action]}
                </div>
              )}
              {sleeping && <span className="absolute -top-3 -right-1 text-[12px] animate-zfloat">💤</span>}
              {tally > 0 && (
                <div className="absolute -top-2 -left-2 z-10 h-4 min-w-4 px-1 rounded-full bg-[var(--against)] text-white text-[10px] font-mono flex items-center justify-center animate-pop-in">
                  {tally}
                </div>
              )}

              <div className="relative">
                {speaking && (
                  <span
                    className="absolute inset-0 -m-2 rounded-full blur-md animate-glow"
                    style={{ background: ROLE_COLOR[speaker!.role] ?? "var(--foreground)" }}
                  />
                )}
                <Avatar hue={SEAT_HUES[i % SEAT_HUES.length]} role={p.role} talking={speaking} dead={!p.alive} />
              </div>

              <div className={`mt-1 flex flex-col items-center ${p.alive ? "" : "opacity-50"}`}>
                <span className="text-[11px] md:text-[12px] font-medium text-white leading-tight max-w-[78px] truncate">{p.name}</span>
                {p.role && (
                  <span
                    className="text-[9px] font-mono uppercase tracking-[0.1em] px-1 rounded"
                    style={{ color: ROLE_COLOR[p.role], background: "oklch(0 0 0 / 0.35)" }}
                  >
                    {p.role}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {winner && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm animate-pop-in">
            <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/60 mb-2">Game over</span>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: winner === "mafia" ? "var(--against)" : "var(--for)" }} />
              <span className="text-[30px] md:text-[40px] font-medium tracking-tight uppercase text-white">{winner} win</span>
            </div>
          </div>
        )}
      </div>

      {/* caption bar */}
      <CaptionBar speaker={speaker} phase={phase} winner={winner} />
    </div>
  );
}

function CaptionBar({ speaker, phase, winner }: { speaker: Speaker | null; phase: { phase: string; dayNum: number } | null; winner: string | null }) {
  let hint = "Waiting for the table…";
  if (winner) hint = `The ${winner} have won the game.`;
  else if (!speaker && phase) hint = phase.phase === "night" ? "Night falls. The town sleeps…" : phase.phase === "vote" ? "The town casts their votes…" : "The town awakens.";

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 min-h-[68px]">
      {speaker ? (
        <>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ROLE_COLOR[speaker.role] ?? "var(--foreground)" }} />
            <span className="text-[12px] font-medium tracking-tight">{speaker.name}</span>
            {CHANNEL_LABEL[speaker.channel] && (
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-muted/40 border border-border text-muted-foreground">
                {CHANNEL_LABEL[speaker.channel]}
              </span>
            )}
            {speaker.streaming && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--live)] animate-pulse" />}
          </div>
          <p className="text-[14px] md:text-[15px] leading-relaxed text-foreground">
            {speaker.content}
            {speaker.streaming && <span className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom bg-foreground animate-caret" />}
          </p>
        </>
      ) : (
        <p className="text-[14px] text-muted-foreground italic flex items-center h-[44px]">{hint}</p>
      )}
    </div>
  );
}

function Avatar({ hue, role, talking, dead }: { hue: string; role: string | null; talking: boolean; dead: boolean }) {
  return (
    <svg
      viewBox="0 0 64 70"
      className={`w-12 h-14 md:w-14 md:h-16 drop-shadow ${dead ? "grayscale opacity-60" : talking ? "animate-bob" : "animate-breathe"}`}
      style={dead ? { transform: "rotate(8deg)" } : undefined}
    >
      {/* antenna */}
      <line x1="32" y1="6" x2="32" y2="14" stroke={hue} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="5" r="3" fill={role ? ROLE_COLOR[role] : hue} />
      {/* head */}
      <rect x="12" y="13" width="40" height="36" rx="12" fill={hue} />
      {/* face plate */}
      <rect x="17" y="20" width="30" height="22" rx="9" fill="oklch(0.16 0.01 270 / 0.85)" />
      {/* eyes */}
      {dead ? (
        <g stroke="white" strokeWidth="2" strokeLinecap="round">
          <line x1="22" y1="27" x2="28" y2="33" /><line x1="28" y1="27" x2="22" y2="33" />
          <line x1="36" y1="27" x2="42" y2="33" /><line x1="42" y1="27" x2="36" y2="33" />
        </g>
      ) : (
        <g fill="white">
          <circle cx="25" cy="30" r="3" />
          <circle cx="39" cy="30" r="3" />
        </g>
      )}
      {/* mouth */}
      {!dead && (
        <rect
          x="27" y="37" width="10" height="4" rx="2" fill="white"
          className={talking ? "animate-talk" : ""}
          style={{ transformOrigin: "32px 39px" }}
        />
      )}
      {/* body */}
      <rect x="20" y="49" width="24" height="14" rx="6" fill={hue} fillOpacity="0.85" />
    </svg>
  );
}

/* ───────────────────────── Feed view bits ───────────────────────── */

function Roster({ players }: { players: Player[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
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
  );
}

function WinnerBanner({ winner }: { winner: string }) {
  return (
    <div className="mt-10 rounded-md border border-border bg-card p-6 md:p-8 text-center">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-3">Game over</div>
      <div className="flex items-center justify-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: winner === "mafia" ? "var(--against)" : "var(--for)" }} />
        <span className="text-[22px] font-medium tracking-tight uppercase">{winner} win</span>
      </div>
    </div>
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

  const accent = ROLE_COLOR[item.role] ?? "var(--muted-foreground)";
  const channelTag = CHANNEL_LABEL[item.channel];
  const secret = item.channel !== "public";
  return (
    <article
      className={`rounded-md border bg-card transition-colors ${item.streaming ? "border-foreground/40" : "border-border"} ${secret ? "bg-muted/30" : ""}`}
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
