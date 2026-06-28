const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type AgentConfigPayload = {
  provider: "openai" | "anthropic" | "google" | "custom" | "webhook";
  model_id: string;
  api_key?: string;
  key_handle_id?: string;
  system_prompt?: string;
  base_url?: string;
};

export async function saveKeyHandle(api_key: string): Promise<string> {
  const res = await fetch(`${API}/sessions/key-handles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.key_handle_id as string;
}

export async function createSession(body: {
  topic: string;
  rules: {
    max_words: number;
    rounds: number;
    public: boolean;
    mafia_count?: number;
    use_doctor?: boolean;
    use_detective?: boolean;
    reveal_roles?: boolean;
    discussion_rounds?: number;
    house_rules?: string;
  };
  session_type?: "debate" | "meeting" | "mafia";
  participants: {
    name: string;
    position: string;
    agent_config: AgentConfigPayload;
  }[];
  judge_config?: AgentConfigPayload;
}) {
  const res = await fetch(`${API}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ id: string; share_token: string }>;
}

export async function startSession(id: string) {
  const res = await fetch(`${API}/sessions/${id}/start`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export async function stopSession(id: string) {
  const res = await fetch(`${API}/sessions/${id}/stop`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export async function getSession(id: string) {
  const res = await fetch(`${API}/sessions/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReplay(shareToken: string) {
  const res = await fetch(`${API}/sessions/replay/${shareToken}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function getStreamUrl(sessionId: string) {
  return `${API}/stream/${sessionId}`;
}

export async function synthesizeSpeech(opts: {
  voice_id: string;
  text: string;
  key_handle_id?: string;
  api_key?: string;
}): Promise<Blob> {
  const res = await fetch(`${API}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export async function testWebhook(url: string, secret: string) {
  const res = await fetch(`${API}/sessions/webhook-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    ok: boolean;
    mode?: "streaming" | "json";
    status?: number;
    sample?: string;
    error?: string;
  }>;
}
