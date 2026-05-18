"use client";

import { useSearchParams, useParams } from "next/navigation";
import DebateStage from "@/components/DebateStage";

export default function DebatePage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const id = params.id as string;
  const shareToken = searchParams.get("share") ?? undefined;
  const topic = searchParams.get("topic") ?? "Debate";
  const rounds = Number(searchParams.get("rounds") ?? 3);

  return (
    <DebateStage
      sessionId={id}
      shareToken={shareToken}
      topic={topic}
      totalRounds={rounds}
      autoStart={true}
    />
  );
}
