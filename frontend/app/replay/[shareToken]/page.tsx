"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getReplay } from "@/lib/api";
import DebateStage from "@/components/DebateStage";
import MafiaStage from "@/components/MafiaStage";

export default function ReplayPage() {
  const params = useParams();
  const shareToken = params.shareToken as string;
  const [session, setSession] = useState<{
    id: string;
    topic: string;
    rules: { rounds: number };
    session_type?: "debate" | "meeting" | "mafia";
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getReplay(shareToken)
      .then(setSession)
      .catch(() => setError("Debate not found"));
  }, [shareToken]);

  if (error)
    return (
      <main className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-center max-w-sm px-6">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-2">
            404
          </div>
          <h1 className="text-[22px] font-medium tracking-tight mb-2">
            Replay not found
          </h1>
          <p className="text-[14px] text-muted-foreground">
            This session either expired or the link is wrong.
          </p>
        </div>
      </main>
    );

  if (!session)
    return (
      <main className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
          Loading replay
        </div>
      </main>
    );

  if (session.session_type === "mafia") {
    return <MafiaStage sessionId={session.id} topic={session.topic} autoStart={true} isReplay={true} />;
  }

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
