"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getReplay } from "@/lib/api";
import DebateStage from "@/components/DebateStage";

export default function ReplayPage() {
  const params = useParams();
  const shareToken = params.shareToken as string;
  const [session, setSession] = useState<{ id: string; topic: string; rules: { rounds: number } } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getReplay(shareToken)
      .then(setSession)
      .catch(() => setError("Debate not found"));
  }, [shareToken]);

  if (error) return (
    <div className="min-h-screen flex items-center justify-center text-gray-500">{error}</div>
  );
  if (!session) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>
  );

  return (
    <DebateStage
      sessionId={session.id}
      topic={session.topic}
      totalRounds={session.rules.rounds}
      autoStart={true}
    />
  );
}
