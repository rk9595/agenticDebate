"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSession, startSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">AgenticDebate</h1>
          <p className="text-gray-500 mt-1">Pit LLMs against each other. Watch them argue.</p>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-lg w-fit mx-auto">
          <button
            onClick={() => switchMode("debate")}
            className={`px-5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              !isMeeting ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Debate
          </button>
          <button
            onClick={() => switchMode("meeting")}
            className={`px-5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isMeeting ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Meeting
          </button>
        </div>

        <Card className="p-6 space-y-6">
          <div>
            <Label htmlFor="topic" className="text-sm font-semibold">
              {isMeeting ? "Meeting agenda" : "Debate topic"}
            </Label>
            <Input
              id="topic"
              className="mt-1"
              placeholder={
                isMeeting
                  ? "Should we rebuild the auth system or patch it?"
                  : "AI will replace software engineers by 2030"
              }
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold">
                {isMeeting ? "Discussion rounds" : "Rounds"}
              </Label>
              <Select value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
                <SelectTrigger className="mt-1">
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
                <p className="text-xs text-gray-400 mt-1">+briefing +consensus = {rounds + 2} total phases</p>
              )}
            </div>
            <div>
              <Label className="text-sm font-semibold">Max words per turn</Label>
              <Select value={String(maxWords)} onValueChange={(v) => setMaxWords(Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[150, 300, 500, 800].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} words</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Participants */}
          {participants.map((p, idx) => (
            <div key={idx} className="space-y-3">
              <div className="flex items-center gap-2">
                {isMeeting ? (
                  <Select value={p.position} onValueChange={(v) => v && handleRoleChange(idx, v)}>
                    <SelectTrigger className="w-28 h-7 text-xs font-semibold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MEETING_ROLES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                    p.position === "for" ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"
                  }`}>{p.position}</span>
                )}
                <Input
                  className="text-sm font-medium"
                  value={p.name}
                  onChange={(e) => updateParticipant(idx, { name: e.target.value })}
                  placeholder="Agent name"
                />
                {isMeeting && participants.length > 2 && (
                  <button
                    onClick={() => removeParticipant(idx)}
                    className="text-gray-400 hover:text-red-500 text-lg leading-none flex-shrink-0"
                    title="Remove participant"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-500">Provider</Label>
                  <Select
                    value={p.provider}
                    onValueChange={(v) => {
                      const key = v ?? "";
                      updateParticipant(idx, {
                        provider: key as Participant["provider"],
                        model_id: (MODEL_OPTIONS as Record<string, { label: string; models: string[] }>)[key]?.models[0] ?? "",
                      });
                    }}
                  >
                    <SelectTrigger className="mt-1 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-gray-500">Model</Label>
                  {p.provider === "custom" ? (
                    <Input
                      className="mt-1 h-8 text-sm"
                      placeholder="model-name"
                      value={p.custom_model}
                      onChange={(e) => updateParticipant(idx, { custom_model: e.target.value })}
                    />
                  ) : (
                    <Select value={p.model_id} onValueChange={(v) => updateParticipant(idx, { model_id: v ?? "" })}>
                      <SelectTrigger className="mt-1 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS[p.provider].models.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs text-gray-500">API Key</Label>
                <Input
                  className="mt-1 h-8 text-sm font-mono"
                  type="password"
                  placeholder="sk-..."
                  value={p.api_key}
                  onChange={(e) => updateParticipant(idx, { api_key: e.target.value })}
                />
              </div>

              {p.provider === "custom" && (
                <div>
                  <Label className="text-xs text-gray-500">Base URL</Label>
                  <Input
                    className="mt-1 h-8 text-sm"
                    placeholder="http://localhost:11434/v1"
                    value={p.base_url}
                    onChange={(e) => updateParticipant(idx, { base_url: e.target.value })}
                  />
                </div>
              )}

              <div>
                <Label className="text-xs text-gray-500">
                  {isMeeting ? "Role instructions / persona" : "System prompt / persona (optional)"}
                </Label>
                <Textarea
                  className="mt-1 text-sm resize-none"
                  rows={2}
                  placeholder={
                    isMeeting
                      ? `Default: ${MEETING_ROLES[p.position]?.defaultPrompt?.slice(0, 60) ?? "Custom role instructions"}...`
                      : "You are an expert economist who argues from first principles..."
                  }
                  value={p.system_prompt}
                  onChange={(e) => updateParticipant(idx, { system_prompt: e.target.value })}
                />
              </div>

              {idx < participants.length - 1 && <Separator />}
            </div>
          ))}

          {/* Add participant button (meeting only) */}
          {isMeeting && participants.length < 6 && (
            <button
              onClick={addMeetingParticipant}
              className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
            >
              + Add participant ({participants.length}/6)
            </button>
          )}

          <Separator />

          {/* Judge agent */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold">Judge Agent</span>
                <p className="text-xs text-gray-400 mt-0.5">Scores each turn and picks a winner</p>
              </div>
              <button
                onClick={() => setJudge((j) => ({ ...j, enabled: !j.enabled }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  judge.enabled ? "bg-amber-500" : "bg-gray-200"
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                  judge.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                }`} />
              </button>
            </div>

            {judge.enabled && (
              <div className="mt-3 space-y-3 p-3 rounded-lg bg-amber-50 border border-amber-100">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-500">Provider</Label>
                    <Select
                      value={judge.provider}
                      onValueChange={(v) => {
                        const key = v as JudgeConfig["provider"];
                        setJudge((j) => ({
                          ...j,
                          provider: key,
                          model_id: (MODEL_OPTIONS as Record<string, { label: string; models: string[] }>)[key]?.models[0] ?? "",
                        }));
                      }}
                    >
                      <SelectTrigger className="mt-1 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(MODEL_OPTIONS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs text-gray-500">Model</Label>
                    {judge.provider === "custom" ? (
                      <Input
                        className="mt-1 h-8 text-sm"
                        placeholder="model-name"
                        value={judge.custom_model}
                        onChange={(e) => setJudge((j) => ({ ...j, custom_model: e.target.value }))}
                      />
                    ) : (
                      <Select
                        value={judge.model_id}
                        onValueChange={(v) => setJudge((j) => ({ ...j, model_id: v ?? "" }))}
                      >
                        <SelectTrigger className="mt-1 h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODEL_OPTIONS[judge.provider].models.map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-500">API Key</Label>
                  <Input
                    className="mt-1 h-8 text-sm font-mono"
                    type="password"
                    placeholder="sk-..."
                    value={judge.api_key}
                    onChange={(e) => setJudge((j) => ({ ...j, api_key: e.target.value }))}
                  />
                </div>

                {judge.provider === "custom" && (
                  <div>
                    <Label className="text-xs text-gray-500">Base URL</Label>
                    <Input
                      className="mt-1 h-8 text-sm"
                      placeholder="http://localhost:11434/v1"
                      value={judge.base_url}
                      onChange={(e) => setJudge((j) => ({ ...j, base_url: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <Button className="w-full" onClick={handleStart} disabled={loading}>
            {loading
              ? isMeeting ? "Starting meeting..." : "Starting debate..."
              : isMeeting ? `Start Meeting (${participants.length} participants)` : "Start Debate"}
          </Button>
        </Card>
      </div>
    </main>
  );
}
