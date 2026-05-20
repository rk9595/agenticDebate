"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSession, startSession } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MODEL_OPTIONS: Record<string, { label: string; models: string[] }> = {
  openai: { label: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "o1-mini", "o3-mini"] },
  anthropic: { label: "Anthropic", models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
  google: { label: "Google Gemini", models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"] },
  custom: { label: "Custom endpoint", models: [] },
};

const MEETING_ROLES: Record<string, { label: string; defaultPrompt: string }> = {
  ceo: {
    label: "CEO",
    defaultPrompt: "You are the CEO. Focus on strategic business impact, company vision, resource allocation, and executive decision-making. Be decisive and think long-term.",
  },
  pm: {
    label: "PM",
    defaultPrompt: "You are the Product Manager. Focus on user needs, product requirements, timelines, scope management, and feature prioritization. Balance stakeholder expectations.",
  },
  engineer: {
    label: "Engineer",
    defaultPrompt: "You are the Lead Engineer. Focus on technical feasibility, implementation complexity, system architecture, technical debt, and realistic delivery timelines.",
  },
  designer: {
    label: "Designer",
    defaultPrompt: "You are the UX Designer. Focus on user experience, interface consistency, accessibility standards, and design principles.",
  },
  legal: {
    label: "Legal",
    defaultPrompt: "You are Legal counsel. Focus on regulatory compliance, risk mitigation, liability concerns, and contractual obligations.",
  },
  custom: {
    label: "Custom",
    defaultPrompt: "",
  },
};

interface Participant {
  name: string;
  position: string;
  provider: "openai" | "anthropic" | "google" | "custom";
  model_id: string;
  api_key: string;
  system_prompt: string;
  base_url: string;
  custom_model: string;
}

interface JudgeConfig {
  enabled: boolean;
  provider: "openai" | "anthropic" | "google" | "custom";
  model_id: string;
  api_key: string;
  base_url: string;
  custom_model: string;
}

const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  enabled: false,
  provider: "anthropic",
  model_id: "claude-haiku-4-5-20251001",
  api_key: "",
  base_url: "",
  custom_model: "",
};

const DEFAULT_DEBATE_PARTICIPANT = (position: "for" | "against"): Participant => ({
  name: position === "for" ? "Proponent" : "Opponent",
  position,
  provider: "anthropic",
  model_id: "claude-sonnet-4-6",
  api_key: "",
  system_prompt: "",
  base_url: "",
  custom_model: "",
});

const DEFAULT_MEETING_PARTICIPANT = (role: string): Participant => ({
  name: MEETING_ROLES[role]?.label ?? role,
  position: role,
  provider: "anthropic",
  model_id: "claude-sonnet-4-6",
  api_key: "",
  system_prompt: MEETING_ROLES[role]?.defaultPrompt ?? "",
  base_url: "",
  custom_model: "",
});

const INITIAL_MEETING_ROLES = ["ceo", "pm", "engineer"];

const SAMPLE_TOPICS = [
  "AI will replace software engineers by 2030",
  "Remote work is better than in-office",
  "Open source AI is more dangerous than closed",
  "Crypto has no real-world utility",
];

export default function Home() {
  const router = useRouter();
  const [sessionType, setSessionType] = useState<"debate" | "meeting">("debate");
  const [topic, setTopic] = useState("");
  const [maxWords, setMaxWords] = useState(300);
  const [rounds, setRounds] = useState(3);
  const [participants, setParticipants] = useState<Participant[]>([
    DEFAULT_DEBATE_PARTICIPANT("for"),
    DEFAULT_DEBATE_PARTICIPANT("against"),
  ]);
  const [judge, setJudge] = useState<JudgeConfig>(DEFAULT_JUDGE_CONFIG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchMode(mode: "debate" | "meeting") {
    setSessionType(mode);
    setError("");
    if (mode === "debate") {
      setParticipants([DEFAULT_DEBATE_PARTICIPANT("for"), DEFAULT_DEBATE_PARTICIPANT("against")]);
      setRounds(3);
    } else {
      setParticipants(INITIAL_MEETING_ROLES.map(DEFAULT_MEETING_PARTICIPANT));
      setRounds(2);
    }
  }

  function updateParticipant(idx: number, patch: Partial<Participant>) {
    setParticipants((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function addDebateParticipant() {
    const forCount = participants.filter((p) => p.position === "for").length;
    const againstCount = participants.filter((p) => p.position === "against").length;
    const position = forCount <= againstCount ? "for" : "against";
    setParticipants((prev) => [...prev, DEFAULT_DEBATE_PARTICIPANT(position)]);
  }

  function addMeetingParticipant() {
    const usedRoles = new Set(participants.map((p) => p.position));
    const nextRole = Object.keys(MEETING_ROLES).find((r) => r !== "custom" && !usedRoles.has(r)) ?? "custom";
    setParticipants((prev) => [...prev, DEFAULT_MEETING_PARTICIPANT(nextRole)]);
  }

  function removeParticipant(idx: number) {
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleRoleChange(idx: number, role: string) {
    const existing = participants[idx];
    const isDefaultPrompt = Object.values(MEETING_ROLES).some((r) => r.defaultPrompt === existing.system_prompt);
    updateParticipant(idx, {
      position: role,
      name: MEETING_ROLES[role]?.label ?? existing.name,
      system_prompt: isDefaultPrompt ? (MEETING_ROLES[role]?.defaultPrompt ?? "") : existing.system_prompt,
    });
  }

  async function handleStart() {
    if (!topic.trim()) return setError("Topic is required");
    for (const p of participants) {
      if (!p.api_key.trim()) return setError(`API key missing for ${p.name}`);
      if (!p.model_id && !p.custom_model) return setError(`Model required for ${p.name}`);
    }
    if (judge.enabled) {
      if (!judge.api_key.trim()) return setError("API key missing for Judge");
      if (!judge.model_id && !judge.custom_model) return setError("Model required for Judge");
    }
    setError("");
    setLoading(true);
    try {
      const { id, share_token } = await createSession({
        topic,
        rules: { max_words: maxWords, rounds, public: true },
        session_type: sessionType,
        participants: participants.map((p) => ({
          name: p.name,
          position: p.position,
          agent_config: {
            provider: p.provider,
            model_id: p.provider === "custom" ? p.custom_model : p.model_id,
            api_key: p.api_key,
            system_prompt: p.system_prompt || undefined,
            base_url: p.base_url || undefined,
          },
        })),
        ...(judge.enabled && {
          judge_config: {
            provider: judge.provider,
            model_id: judge.provider === "custom" ? judge.custom_model : judge.model_id,
            api_key: judge.api_key,
            base_url: judge.base_url || undefined,
          },
        }),
      });
      await startSession(id);
      router.push(
        `/debate/${id}?share=${share_token}&topic=${encodeURIComponent(topic)}&rounds=${rounds}&type=${sessionType}`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }

  const isMeeting = sessionType === "meeting";
  const meetingPaletteIdx = (i: number) => i % 4;

  return (
    <main className="min-h-screen text-foreground">
      {/* Top broadcast bar */}
      <header className="border-b border-border/60 backdrop-blur-md bg-background/70 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-[var(--live)] animate-live" />
            <span className="text-caption text-[10px] text-muted-foreground">live arena</span>
          </div>
          <div className="text-display text-sm font-bold tracking-tight">
            AGENTIC<span className="text-muted-foreground">/</span>DEBATE
          </div>
          <div className="text-caption text-[10px] text-muted-foreground">byok · streaming</div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-display text-5xl md:text-6xl font-black leading-[0.95] tracking-tighter">
            Any model.{" "}
            <span className="bg-gradient-to-r from-[var(--for)] via-foreground to-[var(--against)] bg-clip-text text-transparent">
              Any topic.
            </span>
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            Add models, drop a topic, stream the fight. Bring a judge or call it yourself.
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex p-1 rounded-full border border-border bg-card/60 backdrop-blur">
            {(["debate", "meeting"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`px-5 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                  sessionType === m
                    ? "bg-foreground text-background shadow-lg"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Topic banner */}
        <div className="relative mb-8">
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-[var(--for)]/30 via-transparent to-[var(--against)]/30 blur-sm" />
          <div className="relative rounded-2xl border border-border bg-card/80 backdrop-blur-md p-1">
            <div className="rounded-xl bg-background/40 px-5 py-4">
              <Label htmlFor="topic" className="text-caption text-[10px] text-muted-foreground">
                {isMeeting ? "meeting agenda" : "the motion"}
              </Label>
              <Input
                id="topic"
                className="mt-1 border-0 bg-transparent px-0 text-lg md:text-xl font-semibold tracking-tight placeholder:text-muted-foreground/40 focus-visible:ring-0 h-auto"
                placeholder={
                  isMeeting
                    ? "Should we rebuild the auth system or patch it?"
                    : SAMPLE_TOPICS[0]
                }
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              {!isMeeting && !topic && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {SAMPLE_TOPICS.slice(1).map((s) => (
                    <button
                      key={s}
                      onClick={() => setTopic(s)}
                      className="text-[11px] px-2 py-0.5 rounded-full border border-border/80 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fighters / Participants */}
        {!isMeeting ? (
          <div className="mb-6">
            <div className="grid md:grid-cols-2 gap-4">
              {participants.map((p, idx) => (
                <FighterCard
                  key={idx}
                  p={p}
                  update={(patch) => updateParticipant(idx, patch)}
                  onRemove={participants.length > 2 ? () => removeParticipant(idx) : undefined}
                />
              ))}
            </div>
            {participants.length < 6 && (
              <button
                onClick={addDebateParticipant}
                className="w-full mt-3 py-3 border border-dashed border-border rounded-xl text-caption text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                + add fighter ({participants.length}/6)
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            {participants.map((p, idx) => (
              <MeetingCard
                key={idx}
                p={p}
                paletteIdx={meetingPaletteIdx(idx)}
                update={(patch) => updateParticipant(idx, patch)}
                onRoleChange={(r) => handleRoleChange(idx, r)}
                onRemove={participants.length > 2 ? () => removeParticipant(idx) : undefined}
              />
            ))}
          </div>
        )}

        {isMeeting && participants.length < 6 && (
          <button
            onClick={addMeetingParticipant}
            className="w-full mb-6 py-3 border border-dashed border-border rounded-xl text-caption text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
          >
            + add participant ({participants.length}/6)
          </button>
        )}

        {/* Rules bar */}
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 mb-6">
          <div className="text-caption text-[10px] text-muted-foreground mb-3">match rules</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-caption text-[10px] text-muted-foreground">
                {isMeeting ? "discussion rounds" : "rounds"}
              </Label>
              <Select value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
                <SelectTrigger className="mt-1 bg-background/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(isMeeting ? [1, 2, 3, 4] : [2, 3, 4, 5]).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {isMeeting ? `${n} discussion ${n === 1 ? "round" : "rounds"}` : `${n} rounds`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isMeeting && (
                <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                  + briefing + consensus = {rounds + 2} phases
                </p>
              )}
            </div>
            <div>
              <Label className="text-caption text-[10px] text-muted-foreground">
                max words / turn
              </Label>
              <Select value={String(maxWords)} onValueChange={(v) => setMaxWords(Number(v))}>
                <SelectTrigger className="mt-1 bg-background/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[150, 300, 500, 800].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} words
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Judge */}
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-[var(--judge)]/15 border border-[var(--judge)]/40 flex items-center justify-center text-[var(--judge)] text-sm">
                ⚖
              </div>
              <div>
                <div className="text-sm font-bold">Referee</div>
                <p className="text-[11px] text-muted-foreground">
                  An impartial model scores each turn and calls the winner
                </p>
              </div>
            </div>
            <button
              onClick={() => setJudge((j) => ({ ...j, enabled: !j.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                judge.enabled ? "bg-[var(--judge)]" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${
                  judge.enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {judge.enabled && (
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-caption text-[10px] text-muted-foreground">provider</Label>
                  <Select
                    value={judge.provider}
                    onValueChange={(v) => {
                      const key = v as JudgeConfig["provider"];
                      setJudge((j) => ({
                        ...j,
                        provider: key,
                        model_id: MODEL_OPTIONS[key]?.models[0] ?? "",
                      }));
                    }}
                  >
                    <SelectTrigger className="mt-1 h-8 bg-background/60">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-caption text-[10px] text-muted-foreground">model</Label>
                  {judge.provider === "custom" ? (
                    <Input
                      className="mt-1 h-8 bg-background/60"
                      placeholder="model-name"
                      value={judge.custom_model}
                      onChange={(e) => setJudge((j) => ({ ...j, custom_model: e.target.value }))}
                    />
                  ) : (
                    <Select
                      value={judge.model_id}
                      onValueChange={(v) => setJudge((j) => ({ ...j, model_id: v ?? "" }))}
                    >
                      <SelectTrigger className="mt-1 h-8 bg-background/60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS[judge.provider].models.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-caption text-[10px] text-muted-foreground">api key</Label>
                <Input
                  className="mt-1 h-8 font-mono bg-background/60"
                  type="password"
                  placeholder="sk-..."
                  value={judge.api_key}
                  onChange={(e) => setJudge((j) => ({ ...j, api_key: e.target.value }))}
                />
              </div>
              {judge.provider === "custom" && (
                <div>
                  <Label className="text-caption text-[10px] text-muted-foreground">base url</Label>
                  <Input
                    className="mt-1 h-8 bg-background/60"
                    placeholder="http://localhost:11434/v1"
                    value={judge.base_url}
                    onChange={(e) => setJudge((j) => ({ ...j, base_url: e.target.value }))}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg border border-[var(--against)]/40 bg-[var(--against)]/10 text-[var(--against)] text-sm">
            {error}
          </div>
        )}

        {/* The button. */}
        <button
          onClick={handleStart}
          disabled={loading}
          className="group relative w-full overflow-hidden rounded-2xl border border-border bg-foreground text-background py-5 px-6 transition-all hover:scale-[1.005] active:scale-[0.995] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--for)]/25 via-transparent to-[var(--against)]/25 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center justify-center gap-3">
            <span className="text-display text-lg font-black tracking-tight">
              {loading
                ? isMeeting
                  ? "STARTING MEETING…"
                  : "FIGHTERS ENTERING THE RING…"
                : isMeeting
                  ? `START MEETING · ${participants.length} PARTICIPANTS`
                  : "START THE FIGHT"}
            </span>
            {!loading && <span className="text-display font-black">→</span>}
          </div>
        </button>

        <p className="mt-6 text-center text-[10px] text-caption text-muted-foreground/70">
          keys never leave your machine encrypted · sessions persist · share replays
        </p>
      </div>
    </main>
  );
}

/* ───────────────────────── Fighter card (debate) ───────────────────────── */

function FighterCard({
  p,
  update,
  onRemove,
}: {
  p: Participant;
  update: (patch: Partial<Participant>) => void;
  onRemove?: () => void;
}) {
  const isFor = p.position === "for";
  const color = isFor ? "var(--for)" : "var(--against)";
  const corner = isFor ? "BLUE CORNER" : "RED CORNER";

  return (
    <div
      className="relative rounded-2xl border bg-card/80 backdrop-blur overflow-hidden"
      style={{ borderColor: `color-mix(in oklch, ${color} 35%, var(--border))` }}
    >
      {/* Corner indicator */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <span
            className="text-caption text-[10px] font-bold"
            style={{ color }}
          >
            {corner}
          </span>
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
              style={{
                background: `color-mix(in oklch, ${color} 18%, transparent)`,
                color,
              }}
            >
              {p.position}
            </span>
            {onRemove && (
              <button
                onClick={onRemove}
                className="text-muted-foreground hover:text-[var(--against)] text-xl leading-none"
                title="Remove"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <Input
          className="mb-4 h-10 text-base font-bold tracking-tight bg-background/40 border-border/60"
          value={p.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Fighter name"
        />

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label className="text-caption text-[10px] text-muted-foreground">provider</Label>
            <Select
              value={p.provider}
              onValueChange={(v) => {
                const key = v as Participant["provider"];
                update({
                  provider: key,
                  model_id: MODEL_OPTIONS[key]?.models[0] ?? "",
                });
              }}
            >
              <SelectTrigger className="mt-1 h-8 bg-background/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-caption text-[10px] text-muted-foreground">model</Label>
            {p.provider === "custom" ? (
              <Input
                className="mt-1 h-8 font-mono text-xs bg-background/40"
                placeholder="model-name"
                value={p.custom_model}
                onChange={(e) => update({ custom_model: e.target.value })}
              />
            ) : (
              <Select value={p.model_id} onValueChange={(v) => update({ model_id: v ?? "" })}>
                <SelectTrigger className="mt-1 h-8 bg-background/40 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS[p.provider].models.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="mb-3">
          <Label className="text-caption text-[10px] text-muted-foreground">api key</Label>
          <Input
            className="mt-1 h-8 text-xs font-mono bg-background/40"
            type="password"
            placeholder="sk-..."
            value={p.api_key}
            onChange={(e) => update({ api_key: e.target.value })}
          />
        </div>

        {p.provider === "custom" && (
          <div className="mb-3">
            <Label className="text-caption text-[10px] text-muted-foreground">base url</Label>
            <Input
              className="mt-1 h-8 text-xs font-mono bg-background/40"
              placeholder="http://localhost:11434/v1"
              value={p.base_url}
              onChange={(e) => update({ base_url: e.target.value })}
            />
          </div>
        )}

        <div>
          <Label className="text-caption text-[10px] text-muted-foreground">persona (optional)</Label>
          <Textarea
            className="mt-1 text-xs resize-none bg-background/40"
            rows={2}
            placeholder={
              isFor
                ? "An optimistic technologist who quotes data..."
                : "A pragmatic skeptic who pokes holes in hype..."
            }
            value={p.system_prompt}
            onChange={(e) => update({ system_prompt: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Meeting card ───────────────────────── */

const MEETING_PALETTE = [
  "var(--for)",
  "var(--against)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function MeetingCard({
  p,
  paletteIdx,
  update,
  onRoleChange,
  onRemove,
}: {
  p: Participant;
  paletteIdx: number;
  update: (patch: Partial<Participant>) => void;
  onRoleChange: (role: string) => void;
  onRemove?: () => void;
}) {
  const color = MEETING_PALETTE[paletteIdx];

  return (
    <div
      className="relative rounded-2xl border bg-card/80 backdrop-blur p-5"
      style={{ borderColor: `color-mix(in oklch, ${color} 30%, var(--border))` }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
      />
      <div className="flex items-center gap-2 mb-4">
        <Select value={p.position} onValueChange={(v) => v && onRoleChange(v)}>
          <SelectTrigger className="w-28 h-7 text-xs font-bold bg-background/40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MEETING_ROLES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="text-sm font-semibold h-7 bg-background/40"
          value={p.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-[var(--against)] text-xl leading-none px-1"
            title="Remove"
          >
            ×
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <Label className="text-caption text-[10px] text-muted-foreground">provider</Label>
          <Select
            value={p.provider}
            onValueChange={(v) => {
              const key = v as Participant["provider"];
              update({
                provider: key,
                model_id: MODEL_OPTIONS[key]?.models[0] ?? "",
              });
            }}
          >
            <SelectTrigger className="mt-1 h-8 bg-background/40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-caption text-[10px] text-muted-foreground">model</Label>
          {p.provider === "custom" ? (
            <Input
              className="mt-1 h-8 font-mono text-xs bg-background/40"
              placeholder="model-name"
              value={p.custom_model}
              onChange={(e) => update({ custom_model: e.target.value })}
            />
          ) : (
            <Select value={p.model_id} onValueChange={(v) => update({ model_id: v ?? "" })}>
              <SelectTrigger className="mt-1 h-8 bg-background/40 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS[p.provider].models.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono text-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="mb-3">
        <Label className="text-caption text-[10px] text-muted-foreground">api key</Label>
        <Input
          className="mt-1 h-8 text-xs font-mono bg-background/40"
          type="password"
          placeholder="sk-..."
          value={p.api_key}
          onChange={(e) => update({ api_key: e.target.value })}
        />
      </div>

      {p.provider === "custom" && (
        <div className="mb-3">
          <Label className="text-caption text-[10px] text-muted-foreground">base url</Label>
          <Input
            className="mt-1 h-8 text-xs font-mono bg-background/40"
            placeholder="http://localhost:11434/v1"
            value={p.base_url}
            onChange={(e) => update({ base_url: e.target.value })}
          />
        </div>
      )}

      <div>
        <Label className="text-caption text-[10px] text-muted-foreground">role instructions</Label>
        <Textarea
          className="mt-1 text-xs resize-none bg-background/40"
          rows={2}
          placeholder={`Default: ${MEETING_ROLES[p.position]?.defaultPrompt?.slice(0, 60) ?? "Custom role instructions"}...`}
          value={p.system_prompt}
          onChange={(e) => update({ system_prompt: e.target.value })}
        />
      </div>
    </div>
  );
}
