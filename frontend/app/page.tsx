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

interface Participant {
  name: string;
  position: "for" | "against";
  provider: "openai" | "anthropic" | "google" | "custom";
  model_id: string;
  api_key: string;
  system_prompt: string;
  base_url: string;
  custom_model: string;
}

const DEFAULT_PARTICIPANT = (position: "for" | "against"): Participant => ({
  name: position === "for" ? "Proponent" : "Opponent",
  position,
  provider: "anthropic",
  model_id: "claude-sonnet-4-6",
  api_key: "",
  system_prompt: "",
  base_url: "",
  custom_model: "",
});

export default function Home() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [maxWords, setMaxWords] = useState(300);
  const [rounds, setRounds] = useState(3);
  const [participants, setParticipants] = useState<Participant[]>([
    DEFAULT_PARTICIPANT("for"),
    DEFAULT_PARTICIPANT("against"),
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function updateParticipant(idx: number, patch: Partial<Participant>) {
    setParticipants((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  async function handleStart() {
    if (!topic.trim()) return setError("Topic is required");
    for (const p of participants) {
      if (!p.api_key.trim()) return setError(`API key missing for ${p.name}`);
      if (!p.model_id && !p.custom_model) return setError(`Model required for ${p.name}`);
    }
    setError("");
    setLoading(true);
    try {
      const { id, share_token } = await createSession({
        topic,
        rules: { max_words: maxWords, rounds, public: true },
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
      });
      await startSession(id);
      router.push(`/debate/${id}?share=${share_token}&topic=${encodeURIComponent(topic)}&rounds=${rounds}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start debate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">AgenticDebate</h1>
          <p className="text-gray-500 mt-1">Pit LLMs against each other. Watch them argue.</p>
        </div>

        <Card className="p-6 space-y-6">
          <div>
            <Label htmlFor="topic" className="text-sm font-semibold">Debate topic</Label>
            <Input
              id="topic"
              className="mt-1"
              placeholder="AI will replace software engineers by 2030"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold">Rounds</Label>
              <Select value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} rounds</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

          {participants.map((p, idx) => (
            <div key={idx} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                  p.position === "for" ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"
                }`}>{p.position}</span>
                <Input
                  className="text-sm font-medium"
                  value={p.name}
                  onChange={(e) => updateParticipant(idx, { name: e.target.value })}
                  placeholder="Agent name"
                />
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
                <Label className="text-xs text-gray-500">System prompt / persona (optional)</Label>
                <Textarea
                  className="mt-1 text-sm resize-none"
                  rows={2}
                  placeholder="You are an expert economist who argues from first principles..."
                  value={p.system_prompt}
                  onChange={(e) => updateParticipant(idx, { system_prompt: e.target.value })}
                />
              </div>

              {idx < participants.length - 1 && <Separator />}
            </div>
          ))}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <Button className="w-full" onClick={handleStart} disabled={loading}>
            {loading ? "Starting debate..." : "Start Debate"}
          </Button>
        </Card>
      </div>
    </main>
  );
}
