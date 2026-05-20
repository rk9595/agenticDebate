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
    <main className="min-h-screen flex flex-col text-foreground">
      {/* Top bar — brand + mode toggle + meta */}
      <header className="border-b border-border/60 backdrop-blur-md bg-background/80 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-11 flex items-center gap-4">
          <div className="text-display text-sm font-black tracking-tight shrink-0">
            AGENTIC<span className="text-muted-foreground font-light">/</span>DEBATE
          </div>
          <p className="hidden sm:block text-[11px] text-muted-foreground truncate">
            Add models · drop a topic · stream the fight
          </p>
          <div className="ml-auto flex items-center gap-3">
            {/* Mode toggle inline */}
            <div className="inline-flex p-0.5 rounded-full border border-border bg-muted/40">
              {(["debate", "meeting"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${
                    sessionType === m
                      ? "bg-foreground text-background shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-caption text-[10px] text-muted-foreground">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--live)] animate-live" />
              byok
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 flex flex-col gap-3">

        {/* Topic input */}
        <div className="relative">
          <div className="absolute -inset-px rounded-xl bg-gradient-to-r from-[var(--for)]/25 via-transparent to-[var(--against)]/25 blur-sm" />
          <div className="relative rounded-xl border border-border bg-card px-4 py-3">
            <Label htmlFor="topic" className="text-caption text-[10px] text-muted-foreground">
              {isMeeting ? "meeting agenda" : "the motion"}
            </Label>
            <Input
              id="topic"
              className="mt-0.5 border-0 bg-transparent px-0 text-base font-semibold tracking-tight placeholder:text-muted-foreground/40 focus-visible:ring-0 h-7"
              placeholder={isMeeting ? "Should we rebuild the auth system or patch it?" : SAMPLE_TOPICS[0]}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            {!isMeeting && !topic && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SAMPLE_TOPICS.slice(1).map((s) => (
                  <button
                    key={s}
                    onClick={() => setTopic(s)}
                    className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Fighters / Participants */}
        <div>
          <div className="grid md:grid-cols-2 gap-3">
            {!isMeeting
              ? participants.map((p, idx) => (
                  <FighterCard
                    key={idx}
                    p={p}
                    update={(patch) => updateParticipant(idx, patch)}
                    onRemove={participants.length > 2 ? () => removeParticipant(idx) : undefined}
                  />
                ))
              : participants.map((p, idx) => (
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
          {participants.length < 6 && (
            <button
              onClick={isMeeting ? addMeetingParticipant : addDebateParticipant}
              className="w-full mt-2 py-2 border border-dashed border-border rounded-xl text-caption text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              + add {isMeeting ? "participant" : "fighter"} ({participants.length}/6)
            </button>
          )}
        </div>

        {/* Settings strip — rounds · words · judge */}
        <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Rounds */}
            <div className="flex items-center gap-2">
              <span className="text-caption text-[10px] text-muted-foreground whitespace-nowrap">
                {isMeeting ? "rounds" : "rounds"}
              </span>
              <Select value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
                <SelectTrigger className="h-7 w-24 text-xs bg-muted/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(isMeeting ? [1, 2, 3, 4] : [2, 3, 4, 5]).map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isMeeting && (
                <span className="text-[10px] text-muted-foreground/70 font-mono">
                  +2 phases
                </span>
              )}
            </div>

            <div className="h-3 w-px bg-border hidden sm:block" />

            {/* Max words */}
            <div className="flex items-center gap-2">
              <span className="text-caption text-[10px] text-muted-foreground whitespace-nowrap">words/turn</span>
              <Select value={String(maxWords)} onValueChange={(v) => setMaxWords(Number(v))}>
                <SelectTrigger className="h-7 w-24 text-xs bg-muted/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[150, 300, 500, 800].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="h-3 w-px bg-border hidden sm:block" />

            {/* Judge toggle */}
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[var(--judge)] text-sm">⚖</span>
              <span className="text-caption text-[10px] text-muted-foreground">referee</span>
              <button
                onClick={() => setJudge((j) => ({ ...j, enabled: !j.enabled }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  judge.enabled ? "bg-[var(--judge)]" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform ${
                    judge.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Judge config — inline 3-col when enabled */}
          {judge.enabled && (
            <div className="flex gap-2 pt-2 border-t border-border flex-wrap">
              <Select
                value={judge.provider}
                onValueChange={(v) => {
                  const key = v as JudgeConfig["provider"];
                  setJudge((j) => ({ ...j, provider: key, model_id: MODEL_OPTIONS[key]?.models[0] ?? "" }));
                }}
              >
                <SelectTrigger className="h-7 w-28 text-xs bg-muted/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {judge.provider === "custom" ? (
                <Input
                  className="h-7 flex-1 text-xs font-mono bg-muted/40"
                  placeholder="model-name"
                  value={judge.custom_model}
                  onChange={(e) => setJudge((j) => ({ ...j, custom_model: e.target.value }))}
                />
              ) : (
                <Select value={judge.model_id} onValueChange={(v) => setJudge((j) => ({ ...j, model_id: v ?? "" }))}>
                  <SelectTrigger className="h-7 flex-1 text-xs font-mono bg-muted/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS[judge.provider].models.map((m) => (
                      <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Input
                className="h-7 flex-1 text-xs font-mono bg-muted/40"
                type="password"
                placeholder="api key"
                value={judge.api_key}
                onChange={(e) => setJudge((j) => ({ ...j, api_key: e.target.value }))}
              />

              {judge.provider === "custom" && (
                <Input
                  className="h-7 flex-1 text-xs bg-muted/40"
                  placeholder="base url"
                  value={judge.base_url}
                  onChange={(e) => setJudge((j) => ({ ...j, base_url: e.target.value }))}
                />
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="px-4 py-2.5 rounded-lg border border-[var(--against)]/40 bg-[var(--against)]/10 text-[var(--against)] text-sm">
            {error}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleStart}
          disabled={loading}
          className="group relative w-full overflow-hidden rounded-xl border border-border bg-foreground text-background py-3.5 px-6 transition-all hover:scale-[1.005] active:scale-[0.995] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--for)]/25 via-transparent to-[var(--against)]/25 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center justify-center gap-2">
            <span className="text-display text-sm font-black tracking-tight">
              {loading
                ? isMeeting ? "STARTING…" : "ENTERING THE RING…"
                : isMeeting ? `START MEETING · ${participants.length} PARTICIPANTS` : "START THE FIGHT →"}
            </span>
          </div>
        </button>

        <p className="text-center text-[10px] text-caption text-muted-foreground/60 pb-2">
          keys encrypted · sessions persist · share replays
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
  const [showPersona, setShowPersona] = useState(false);
  const isFor = p.position === "for";
  const color = isFor ? "var(--for)" : "var(--against)";
  const corner = isFor ? "BLUE CORNER" : "RED CORNER";

  return (
    <div
      className="relative rounded-xl border bg-card overflow-hidden"
      style={{ borderColor: `color-mix(in oklch, ${color} 30%, var(--border))` }}
    >
      <div className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

      <div className="p-3 space-y-2">
        {/* Row 1: corner label + name + position badge + remove */}
        <div className="flex items-center gap-2">
          <span className="text-caption text-[9px] font-bold shrink-0" style={{ color }}>{corner}</span>
          <Input
            className="h-6 text-xs font-semibold bg-muted/40 border-0 px-2"
            value={p.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Name"
          />
          <span
            className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0"
            style={{ background: `color-mix(in oklch, ${color} 15%, transparent)`, color }}
          >
            {p.position}
          </span>
          {onRemove && (
            <button onClick={onRemove} className="text-muted-foreground hover:text-[var(--against)] leading-none shrink-0">×</button>
          )}
        </div>

        {/* Row 2: provider + model */}
        <div className="flex gap-2">
          <Select value={p.provider} onValueChange={(v) => { const k = v as Participant["provider"]; update({ provider: k, model_id: MODEL_OPTIONS[k]?.models[0] ?? "" }); }}>
            <SelectTrigger className="h-7 w-28 text-xs bg-muted/40 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(MODEL_OPTIONS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
          {p.provider === "custom" ? (
            <Input className="h-7 flex-1 text-xs font-mono bg-muted/40" placeholder="model-name" value={p.custom_model} onChange={(e) => update({ custom_model: e.target.value })} />
          ) : (
            <Select value={p.model_id} onValueChange={(v) => update({ model_id: v ?? "" })}>
              <SelectTrigger className="h-7 flex-1 text-xs font-mono bg-muted/40"><SelectValue /></SelectTrigger>
              <SelectContent>{MODEL_OPTIONS[p.provider].models.map((m) => <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>

        {/* Row 3: api key (+ base url inline if custom) */}
        <div className="flex gap-2">
          <Input className="h-7 flex-1 text-xs font-mono bg-muted/40" type="password" placeholder="api key" value={p.api_key} onChange={(e) => update({ api_key: e.target.value })} />
          {p.provider === "custom" && (
            <Input className="h-7 flex-1 text-xs font-mono bg-muted/40" placeholder="base url" value={p.base_url} onChange={(e) => update({ base_url: e.target.value })} />
          )}
        </div>

        {/* Persona expand */}
        <button onClick={() => setShowPersona((s) => !s)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <span>{showPersona ? "▾" : "▸"}</span> persona
        </button>
        {showPersona && (
          <Textarea
            className="text-xs resize-none bg-muted/40 border-border/60"
            rows={2}
            placeholder={isFor ? "An optimistic technologist..." : "A pragmatic skeptic..."}
            value={p.system_prompt}
            onChange={(e) => update({ system_prompt: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Meeting card ───────────────────────── */

const MEETING_PALETTE = ["var(--for)", "var(--against)", "var(--chart-4)", "var(--chart-5)"];

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
  const [showInstructions, setShowInstructions] = useState(false);
  const color = MEETING_PALETTE[paletteIdx];

  return (
    <div
      className="relative rounded-xl border bg-card overflow-hidden"
      style={{ borderColor: `color-mix(in oklch, ${color} 28%, var(--border))` }}
    >
      <div className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

      <div className="p-3 space-y-2">
        {/* Row 1: role select + name + remove */}
        <div className="flex items-center gap-2">
          <Select value={p.position} onValueChange={(v) => v && onRoleChange(v)}>
            <SelectTrigger className="w-24 h-6 text-[10px] font-bold bg-muted/40 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(MEETING_ROLES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-6 flex-1 text-xs font-semibold bg-muted/40 border-0 px-2" value={p.name} onChange={(e) => update({ name: e.target.value })} />
          {onRemove && <button onClick={onRemove} className="text-muted-foreground hover:text-[var(--against)] leading-none shrink-0">×</button>}
        </div>

        {/* Row 2: provider + model */}
        <div className="flex gap-2">
          <Select value={p.provider} onValueChange={(v) => { const k = v as Participant["provider"]; update({ provider: k, model_id: MODEL_OPTIONS[k]?.models[0] ?? "" }); }}>
            <SelectTrigger className="h-7 w-28 text-xs bg-muted/40 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(MODEL_OPTIONS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
          {p.provider === "custom" ? (
            <Input className="h-7 flex-1 text-xs font-mono bg-muted/40" placeholder="model-name" value={p.custom_model} onChange={(e) => update({ custom_model: e.target.value })} />
          ) : (
            <Select value={p.model_id} onValueChange={(v) => update({ model_id: v ?? "" })}>
              <SelectTrigger className="h-7 flex-1 text-xs font-mono bg-muted/40"><SelectValue /></SelectTrigger>
              <SelectContent>{MODEL_OPTIONS[p.provider].models.map((m) => <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>

        {/* Row 3: api key */}
        <div className="flex gap-2">
          <Input className="h-7 flex-1 text-xs font-mono bg-muted/40" type="password" placeholder="api key" value={p.api_key} onChange={(e) => update({ api_key: e.target.value })} />
          {p.provider === "custom" && (
            <Input className="h-7 flex-1 text-xs font-mono bg-muted/40" placeholder="base url" value={p.base_url} onChange={(e) => update({ base_url: e.target.value })} />
          )}
        </div>

        {/* Instructions expand */}
        <button onClick={() => setShowInstructions((s) => !s)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <span>{showInstructions ? "▾" : "▸"}</span> instructions
        </button>
        {showInstructions && (
          <Textarea
            className="text-xs resize-none bg-muted/40 border-border/60"
            rows={2}
            placeholder={`${MEETING_ROLES[p.position]?.defaultPrompt?.slice(0, 60) ?? "Role instructions"}...`}
            value={p.system_prompt}
            onChange={(e) => update({ system_prompt: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}
