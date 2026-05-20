const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function createSession(body: {
  topic: string;
  rules: { max_words: number; rounds: number; public: boolean };
  session_type?: "debate" | "meeting";
  participants: {
    name: string;
    position: string;
    agent_config: {
      provider: "openai" | "anthropic" | "google" | "custom";
      model_id: string;
      api_key: string;
      system_prompt?: string;
      base_url?: string;
    };
  }[];
  judge_config?: {
    provider: "openai" | "anthropic" | "google" | "custom";
    model_id: string;
    api_key: string;
    base_url?: string;
  };
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
