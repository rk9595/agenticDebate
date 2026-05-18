"use client";

import { useEffect, useRef, useState } from "react";
import { getStreamUrl } from "@/lib/api";
import TurnBubble from "./TurnBubble";
import RoundHeader from "./RoundHeader";
import { Button } from "./ui/button";

interface Turn {
  id: string;
  participantId: string;
  participantName: string;
  position: "for" | "against";
  round: string;
  roundNum: number;
  content: string;
  streaming: boolean;
}

interface RoundGroup {
  round: string;
  roundNum: number;
  turns: Turn[];
}

interface DebateStageProps {
  sessionId: string;
  shareToken?: string;
  topic: string;
  totalRounds: number;
  autoStart?: boolean;
}

export default function DebateStage({ sessionId, shareToken, topic, totalRounds, autoStart }: DebateStageProps) {
  const [groups, setGroups] = useState<RoundGroup[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [currentRound, setCurrentRound] = useState<{ round: string; num: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (autoStart) connect();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [groups]);

  function connect() {
    if (esRef.current) return;
    setStatus("running");
    const es = new EventSource(getStreamUrl(sessionId));
    esRef.current = es;

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      handleEvent(event);
    };
    es.onerror = () => {
      setStatus("error");
      es.close();
    };
  }

  function handleEvent(event: Record<string, string>) {
    switch (event.type) {
      case "round_start":
        setCurrentRound({ round: event.round, num: Number(event.round_num) });
        setGroups((prev) => [
          ...prev,
          { round: event.round, roundNum: Number(event.round_num), turns: [] },
        ]);
        break;

      case "turn_start":
        setGroups((prev) => {
          const next = [...prev];
          const last = { ...next[next.length - 1], turns: [...next[next.length - 1].turns] };
          last.turns.push({
            id: event.turn_id,
            participantId: event.participant_id,
            participantName: event.participant_name,
            position: event.position as "for" | "against",
            round: event.round,
            roundNum: currentRound?.num ?? 0,
            content: "",
            streaming: true,
          });
          next[next.length - 1] = last;
          return next;
        });
        break;

      case "token":
        setGroups((prev) => {
          const next = [...prev];
          const lastGroup = { ...next[next.length - 1], turns: [...next[next.length - 1].turns] };
          const turnIdx = lastGroup.turns.findIndex((t) => t.id === event.turn_id);
          if (turnIdx !== -1) {
            lastGroup.turns[turnIdx] = {
              ...lastGroup.turns[turnIdx],
              content: lastGroup.turns[turnIdx].content + event.token,
            };
          }
          next[next.length - 1] = lastGroup;
          return next;
        });
        break;

      case "turn_end":
        setGroups((prev) => {
          const next = [...prev];
          const lastGroup = { ...next[next.length - 1], turns: [...next[next.length - 1].turns] };
          const turnIdx = lastGroup.turns.findIndex((t) => t.id === event.turn_id);
          if (turnIdx !== -1) {
            lastGroup.turns[turnIdx] = { ...lastGroup.turns[turnIdx], streaming: false };
          }
          next[next.length - 1] = lastGroup;
          return next;
        });
        break;

      case "debate_end":
        setStatus("completed");
        esRef.current?.close();
        break;

      case "error":
        setStatus("error");
        break;
    }
  }

  const shareUrl = shareToken ? `${window.location.origin}/replay/${shareToken}` : null;

  function copyShare() {
    if (shareUrl) navigator.clipboard.writeText(shareUrl);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{topic}</h1>
        <div className="flex items-center gap-3 mt-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            status === "running" ? "bg-green-100 text-green-700" :
            status === "completed" ? "bg-gray-100 text-gray-600" :
            status === "error" ? "bg-red-100 text-red-700" :
            "bg-yellow-100 text-yellow-700"
          }`}>
            {status === "running" ? "Live" : status}
          </span>
          {shareUrl && (
            <Button variant="outline" size="sm" onClick={copyShare}>
              Copy share link
            </Button>
          )}
        </div>
      </div>

      {status === "idle" && (
        <Button onClick={connect} className="mb-6">
          Watch debate
        </Button>
      )}

      <div className="space-y-8">
        {groups.map((group, gi) => (
          <div key={gi}>
            <RoundHeader round={group.round} roundNum={group.roundNum} totalRounds={totalRounds} />
            <div className="space-y-4 mt-3">
              {group.turns.map((turn) => (
                <TurnBubble
                  key={turn.id}
                  participantName={turn.participantName}
                  position={turn.position}
                  round={turn.round}
                  content={turn.content}
                  streaming={turn.streaming}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {status === "completed" && (
        <div className="mt-8 p-4 rounded-xl bg-gray-50 border text-center text-gray-600 text-sm">
          Debate concluded. {shareUrl && "Share the link above to let others watch the replay."}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
