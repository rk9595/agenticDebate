"use client";

const ROUND_DESCRIPTIONS: Record<string, string> = {
  opening: "Each side presents their opening argument",
  rebuttal: "Each side responds to the other's arguments",
  closing: "Final statements — make your case",
  briefing: "Each participant introduces their perspective on the agenda item",
  discussion: "Participants respond to each other and refine their positions",
  consensus: "Each participant states their final recommendation",
};

interface RoundHeaderProps {
  round: string;
  roundNum: number;
  totalRounds: number;
}

export default function RoundHeader({ round, roundNum, totalRounds }: RoundHeaderProps) {
  return (
    <div className="flex flex-col items-center py-4">
      <div className="text-xs text-gray-400 uppercase tracking-widest mb-1">
        Round {roundNum} of {totalRounds}
      </div>
      <div className="text-lg font-bold capitalize text-gray-900">{round}</div>
      <div className="text-sm text-gray-500 mt-0.5">{ROUND_DESCRIPTIONS[round] ?? ""}</div>
    </div>
  );
}
