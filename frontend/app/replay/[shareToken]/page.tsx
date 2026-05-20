"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getReplay } from "@/lib/api";
import DebateStage from "@/components/DebateStage";

export default function ReplayPage() {
  const params = useParams();
  const shareToken = params.shareToken as string;
  const [session, setSession] = useState<{
    id: string;
    topic: string;
    rules: { rounds: number };
    session_type?: "debate" | "meeting";
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getReplay(shareToken)
      .then(setSession)
      .catch(() => setError("Debate not found"));
  }, [shareToken]);

  if (error)
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-caption text-[11px] text-muted-foreground mb-2">404</div>
          <div className="text-display text-2xl font-bold tracking-tight mb-1">
            Replay not found
          </div>
          <p className="text-sm text-muted-foreground">
            This match either expired or the link is wrong.
          </p>
        </div>
      </main>
    );

  if (!session)
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-caption text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-[var(--live)] animate-live" />
          loading replay...
        </div>
      </main>
    );

  return (
    <DebateStage
      sessionId={session.id}
      topic={session.topic}
      totalRounds={session.rules.rounds}
      sessionType={session.session_type ?? "debate"}
      autoStart={true}
      isReplay={true}
    />
  );
}
