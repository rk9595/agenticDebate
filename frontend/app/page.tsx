"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSession, startSession, testWebhook } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MODEL_OPTIONS: Record<string, { label: string; models: string[] }> = {
  openai: { label: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "o1-mini", "o3-mini"] },
  anthropic: { label: "Anthropic", models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
  google: { label: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"] },
  custom: { label: "Custom", models: [] },
  webhook: { label: "Webhook", models: [] },
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

type ProviderKey = "openai" | "anthropic" | "google" | "custom" | "webhook";

interface Participant {
  name: string;
  position: string;
  provider: ProviderKey;
  model_id: string;
  api_key: string;
  system_prompt: string;
  base_url: string;
  custom_model: string;
}

interface JudgeConfig {
  enabled: boolean;
  provider: ProviderKey;
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
      if (p.provider === "webhook") {
        if (!p.base_url.trim()) return setError(`Webhook URL missing for ${p.name}`);
      } else {
        if (!p.api_key.trim()) return setError(`API key missing for ${p.name}`);
        if (!p.model_id && !p.custom_model) return setError(`Model required for ${p.name}`);
      }
    }
    if (judge.enabled) {
      if (judge.provider === "webhook") {
        if (!judge.base_url.trim()) return setError("Webhook URL missing for Judge");
      } else {
        if (!judge.api_key.trim()) return setError("API key missing for Judge");
        if (!judge.model_id && !judge.custom_model) return setError("Model required for Judge");
      }
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
            model_id:
              p.provider === "webhook"
                ? ""
                : p.provider === "custom"
                ? p.custom_model
                : p.model_id,
            api_key: p.api_key,
            system_prompt: p.system_prompt || undefined,
            base_url: p.base_url || undefined,
          },
        })),
        ...(judge.enabled && {
          judge_config: {
            provider: judge.provider,
            model_id:
              judge.provider === "webhook"
                ? ""
                : judge.provider === "custom"
                ? judge.custom_model
                : judge.model_id,
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

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ─── Header ─── */}
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto w-full px-6 h-14 flex items-center">
          <div className="flex items-center gap-2 text-[15px] font-medium tracking-tight">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground" />
            <span>AgenticDebate</span>
          </div>
          <nav className="ml-8 hidden sm:flex items-center gap-5 text-[13px] text-muted-foreground">
            {(["debate", "meeting"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`transition-colors ${
                  sessionType === m ? "text-foreground" : "hover:text-foreground"
                }`}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
            BYOK
          </div>
        </div>
      </header>

      {/* ─── Body ─── */}
      <div className="flex-1 w-full max-w-3xl mx-auto px-6 py-12 flex flex-col gap-10">
        {/* Title */}
        <section className="space-y-2">
          <h1 className="text-[28px] leading-tight tracking-tight font-medium">
            {isMeeting ? "Run a meeting." : "Stage a debate."}
          </h1>
          <p className="text-[14px] text-muted-foreground">
            {isMeeting
              ? "Assemble a cross-functional team of LLMs and watch them argue through your agenda."
              : "Pit any number of language models against each other on a motion — add up to six. Bring your own keys."}
          </p>
        </section>

        {/* Motion */}
        <section className="space-y-3">
          <label htmlFor="topic" className="block text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {isMeeting ? "Agenda" : "Motion"}
          </label>
          <Input
            id="topic"
            className="h-auto border-0 border-b border-border rounded-none bg-transparent px-0 py-2 text-[20px] tracking-tight placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:border-foreground transition-colors"
            placeholder={isMeeting ? "Should we rebuild the auth system or patch it?" : SAMPLE_TOPICS[0]}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          {!isMeeting && !topic && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SAMPLE_TOPICS.slice(1).map((s) => (
                <button
                  key={s}
                  onClick={() => setTopic(s)}
                  className="text-[12px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Participants */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              {isMeeting ? "Participants" : "Sides"}
            </h2>
            <span className="text-[11px] font-mono text-muted-foreground">
              {participants.length} / 6
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {!isMeeting
              ? participants.map((p, idx) => (
                  <FighterCard
                    key={idx}
                    p={p}
                    idx={idx}
                    update={(patch) => updateParticipant(idx, patch)}
                    onRemove={participants.length > 2 ? () => removeParticipant(idx) : undefined}
                  />
                ))
              : participants.map((p, idx) => (
                  <MeetingCard
                    key={idx}
                    p={p}
                    idx={idx}
                    update={(patch) => updateParticipant(idx, patch)}
                    onRoleChange={(r) => handleRoleChange(idx, r)}
                    onRemove={participants.length > 2 ? () => removeParticipant(idx) : undefined}
                  />
                ))}
          </div>

          {participants.length < 6 && (
            <button
              onClick={isMeeting ? addMeetingParticipant : addDebateParticipant}
              className="w-full py-2.5 border border-dashed border-border rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            >
              + Add {isMeeting ? "participant" : "side"}
            </button>
          )}
        </section>

        {/* Settings */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Settings
          </h2>
          <div className="rounded-md border border-border divide-y divide-border">
            <SettingRow label="Rounds" hint={isMeeting ? "+2 phases" : undefined}>
              <Select value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
                <SelectTrigger className="h-8 w-24 text-[13px] bg-transparent border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(isMeeting ? [1, 2, 3, 4] : [2, 3, 4, 5]).map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow label="Words per turn">
              <Select value={String(maxWords)} onValueChange={(v) => setMaxWords(Number(v))}>
                <SelectTrigger className="h-8 w-24 text-[13px] bg-transparent border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[150, 300, 500, 800].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow label="Referee" hint={judge.enabled ? "scoring on" : "off"}>
              <button
                onClick={() => setJudge((j) => ({ ...j, enabled: !j.enabled }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  judge.enabled ? "bg-foreground" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform ${
                    judge.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </SettingRow>

            {judge.enabled && (
              <div className="p-3 bg-muted/30 flex flex-wrap gap-2">
                <Select
                  value={judge.provider}
                  onValueChange={(v) => {
                    const key = v as JudgeConfig["provider"];
                    setJudge((j) => ({ ...j, provider: key, model_id: MODEL_OPTIONS[key]?.models[0] ?? "" }));
                  }}
                >
                  <SelectTrigger className="h-8 w-32 text-[13px] bg-card border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {judge.provider === "webhook" ? (
                  <>
                    <Input
                      className="h-8 flex-1 min-w-[140px] text-[13px] font-mono bg-card border-border"
                      placeholder="https://your-judge.com/judge"
                      value={judge.base_url}
                      onChange={(e) => setJudge((j) => ({ ...j, base_url: e.target.value }))}
                    />
                    <Input
                      className="h-8 flex-1 min-w-[140px] text-[13px] font-mono bg-card border-border"
                      type="password"
                      placeholder="secret (optional)"
                      value={judge.api_key}
                      onChange={(e) => setJudge((j) => ({ ...j, api_key: e.target.value }))}
                    />
                    <div className="basis-full">
                      <WebhookTest url={judge.base_url} secret={judge.api_key} />
                    </div>
                  </>
                ) : (
                  <>
                    {judge.provider === "custom" ? (
                      <Input
                        className="h-8 flex-1 min-w-[140px] text-[13px] font-mono bg-card border-border"
                        placeholder="model"
                        value={judge.custom_model}
                        onChange={(e) => setJudge((j) => ({ ...j, custom_model: e.target.value }))}
                      />
                    ) : (
                      <Select value={judge.model_id} onValueChange={(v) => setJudge((j) => ({ ...j, model_id: v ?? "" }))}>
                        <SelectTrigger className="h-8 flex-1 min-w-[140px] text-[13px] font-mono bg-card border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODEL_OPTIONS[judge.provider].models.map((m) => (
                            <SelectItem key={m} value={m} className="font-mono text-[13px]">{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <Input
                      className="h-8 flex-1 min-w-[140px] text-[13px] font-mono bg-card border-border"
                      type="password"
                      placeholder="api key"
                      value={judge.api_key}
                      onChange={(e) => setJudge((j) => ({ ...j, api_key: e.target.value }))}
                    />

                    {judge.provider === "custom" && (
                      <Input
                        className="h-8 flex-1 min-w-[140px] text-[13px] bg-card border-border"
                        placeholder="base url"
                        value={judge.base_url}
                        onChange={(e) => setJudge((j) => ({ ...j, base_url: e.target.value }))}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="text-[13px] text-[var(--against)] -mt-4">
            {error}
          </div>
        )}

        {/* CTA */}
        <div className="flex flex-col items-stretch gap-3">
          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full rounded-md bg-foreground text-background py-3 text-[14px] font-medium tracking-tight transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Starting…"
              : isMeeting
              ? `Start meeting →`
              : "Start debate →"}
          </button>
          <p className="text-center text-[11px] font-mono text-muted-foreground/70">
            Keys encrypted · Sessions persist · Shareable replays
          </p>
        </div>
      </div>
    </main>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function WebhookTest({ url, secret }: { url: string; secret: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function run() {
    if (!url.trim()) return;
    setTesting(true);
    setResult(null);
    try {
      const r = await testWebhook(url, secret);
      if (r.ok) {
        const trimmed = (r.sample || "").trim();
        const preview = trimmed.length > 80 ? trimmed.slice(0, 80) + "…" : trimmed;
        setResult({ ok: true, msg: `${r.mode} · ${preview}` });
      } else {
        setResult({ ok: false, msg: r.error || `HTTP ${r.status ?? "?"}` });
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={run}
        disabled={testing || !url.trim()}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 disabled:opacity-40 disabled:hover:text-muted-foreground"
      >
        <span className="inline-block w-2 text-center">{testing ? "·" : "↻"}</span>
        {testing ? "Testing…" : "Test webhook"}
      </button>
      {result && (
        <div
          className={`text-[11px] font-mono leading-tight break-all ${
            result.ok ? "text-foreground/70" : "text-[var(--against)]"
          }`}
        >
          {result.ok ? "✓" : "✗"} {result.msg}
        </div>
      )}
    </div>
  );
}

function IndexBadge({ idx, accent }: { idx: number; accent?: string }) {
  return (
    <div
      className="shrink-0 h-7 w-7 rounded-md border border-border flex items-center justify-center text-[11px] font-mono"
      style={accent ? { color: accent, borderColor: `color-mix(in oklch, ${accent} 35%, var(--border))` } : undefined}
    >
      {String(idx + 1).padStart(2, "0")}
    </div>
  );
}

/* ───────────────────────── Fighter card (debate) ───────────────────────── */

function FighterCard({
  p,
  idx,
  update,
  onRemove,
}: {
  p: Participant;
  idx: number;
  update: (patch: Partial<Participant>) => void;
  onRemove?: () => void;
}) {
  const [showPersona, setShowPersona] = useState(false);
  const isFor = p.position === "for";
  const accent = isFor ? "var(--for)" : "var(--against)";

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-3 transition-colors hover:border-foreground/20">
      <div className="flex items-center gap-3">
        <IndexBadge idx={idx} accent={accent} />
        <div className="flex-1 min-w-0">
          <Input
            className="h-7 text-[14px] font-medium border-0 bg-transparent px-0 placeholder:text-muted-foreground/40 focus-visible:ring-0"
            value={p.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Name"
          />
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full" style={{ background: accent }} />
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              {isFor ? "for" : "against"}
            </span>
          </div>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground transition-colors text-[14px] leading-none shrink-0"
            aria-label="Remove"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <Select
          value={p.provider}
          onValueChange={(v) => {
            const k = v as Participant["provider"];
            update({ provider: k, model_id: MODEL_OPTIONS[k]?.models[0] ?? "" });
          }}
        >
          <SelectTrigger className="h-8 w-28 text-[12px] bg-transparent border-border shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {p.provider === "webhook" ? (
          <Input
            className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
            placeholder="https://your-agent.com/debate"
            value={p.base_url}
            onChange={(e) => update({ base_url: e.target.value })}
          />
        ) : p.provider === "custom" ? (
          <Input
            className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
            placeholder="model"
            value={p.custom_model}
            onChange={(e) => update({ custom_model: e.target.value })}
          />
        ) : (
          <Select value={p.model_id} onValueChange={(v) => update({ model_id: v ?? "" })}>
            <SelectTrigger className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS[p.provider].models.map((m) => (
                <SelectItem key={m} value={m} className="font-mono text-[12px]">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-2">
        {p.provider === "webhook" ? (
          <Input
            className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
            type="password"
            placeholder="secret (optional)"
            value={p.api_key}
            onChange={(e) => update({ api_key: e.target.value })}
          />
        ) : (
          <>
            <Input
              className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
              type="password"
              placeholder="api key"
              value={p.api_key}
              onChange={(e) => update({ api_key: e.target.value })}
            />
            {p.provider === "custom" && (
              <Input
                className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
                placeholder="base url"
                value={p.base_url}
                onChange={(e) => update({ base_url: e.target.value })}
              />
            )}
          </>
        )}
      </div>

      {p.provider === "webhook" && <WebhookTest url={p.base_url} secret={p.api_key} />}

      <button
        onClick={() => setShowPersona((s) => !s)}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <span className="inline-block w-2 text-center">{showPersona ? "−" : "+"}</span>
        Persona
      </button>
      {showPersona && (
        <Textarea
          className="text-[12px] resize-none bg-transparent border-border"
          rows={3}
          placeholder={isFor ? "An optimistic technologist…" : "A pragmatic skeptic…"}
          value={p.system_prompt}
          onChange={(e) => update({ system_prompt: e.target.value })}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Meeting card ───────────────────────── */

function MeetingCard({
  p,
  idx,
  update,
  onRoleChange,
  onRemove,
}: {
  p: Participant;
  idx: number;
  update: (patch: Partial<Participant>) => void;
  onRoleChange: (role: string) => void;
  onRemove?: () => void;
}) {
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-3 transition-colors hover:border-foreground/20">
      <div className="flex items-center gap-3">
        <IndexBadge idx={idx} />
        <div className="flex-1 min-w-0">
          <Input
            className="h-7 text-[14px] font-medium border-0 bg-transparent px-0 placeholder:text-muted-foreground/40 focus-visible:ring-0"
            value={p.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Name"
          />
          <Select value={p.position} onValueChange={(v) => v && onRoleChange(v)}>
            <SelectTrigger className="h-5 px-0 w-auto gap-1 border-0 bg-transparent text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground focus:ring-0 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MEETING_ROLES).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground transition-colors text-[14px] leading-none shrink-0"
            aria-label="Remove"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <Select
          value={p.provider}
          onValueChange={(v) => {
            const k = v as Participant["provider"];
            update({ provider: k, model_id: MODEL_OPTIONS[k]?.models[0] ?? "" });
          }}
        >
          <SelectTrigger className="h-8 w-28 text-[12px] bg-transparent border-border shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {p.provider === "webhook" ? (
          <Input
            className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
            placeholder="https://your-agent.com/debate"
            value={p.base_url}
            onChange={(e) => update({ base_url: e.target.value })}
          />
        ) : p.provider === "custom" ? (
          <Input
            className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
            placeholder="model"
            value={p.custom_model}
            onChange={(e) => update({ custom_model: e.target.value })}
          />
        ) : (
          <Select value={p.model_id} onValueChange={(v) => update({ model_id: v ?? "" })}>
            <SelectTrigger className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS[p.provider].models.map((m) => (
                <SelectItem key={m} value={m} className="font-mono text-[12px]">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-2">
        {p.provider === "webhook" ? (
          <Input
            className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
            type="password"
            placeholder="secret (optional)"
            value={p.api_key}
            onChange={(e) => update({ api_key: e.target.value })}
          />
        ) : (
          <>
            <Input
              className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
              type="password"
              placeholder="api key"
              value={p.api_key}
              onChange={(e) => update({ api_key: e.target.value })}
            />
            {p.provider === "custom" && (
              <Input
                className="h-8 flex-1 text-[12px] font-mono bg-transparent border-border"
                placeholder="base url"
                value={p.base_url}
                onChange={(e) => update({ base_url: e.target.value })}
              />
            )}
          </>
        )}
      </div>

      {p.provider === "webhook" && <WebhookTest url={p.base_url} secret={p.api_key} />}

      <button
        onClick={() => setShowInstructions((s) => !s)}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <span className="inline-block w-2 text-center">{showInstructions ? "−" : "+"}</span>
        Instructions
      </button>
      {showInstructions && (
        <Textarea
          className="text-[12px] resize-none bg-transparent border-border"
          rows={3}
          placeholder={`${MEETING_ROLES[p.position]?.defaultPrompt?.slice(0, 60) ?? "Role instructions"}…`}
          value={p.system_prompt}
          onChange={(e) => update({ system_prompt: e.target.value })}
        />
      )}
    </div>
  );
}
