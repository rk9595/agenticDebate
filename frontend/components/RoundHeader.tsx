"use client";

const ROUND_DESCRIPTIONS: Record<string, string> = {
  opening: "Each side presents their opening argument.",
  rebuttal: "Each side responds to the other's arguments.",
  closing: "Final statements — make your case.",
  briefing: "Each participant introduces their perspective on the agenda item.",
  discussion: "Participants respond to each other and refine their positions.",
  consensus: "Each participant states their final recommendation.",
};

interface RoundHeaderProps {
  round: string;
  roundNum: number;
  totalRounds: number;
}

export default function RoundHeader({ round, roundNum, totalRounds }: RoundHeaderProps) {
  const title = round.charAt(0).toUpperCase() + round.slice(1);

  return (
    <div className="my-10 flex items-center gap-4">
      <div className="h-px flex-1 bg-border" />
      <div className="flex items-center gap-3 text-center">
        <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
          {String(roundNum).padStart(2, "0")} / {String(totalRounds).padStart(2, "0")}
        </span>
        <span className="h-3 w-px bg-border" />
        <span className="text-[14px] font-medium tracking-tight">{title}</span>
      </div>
      <div className="h-px flex-1 bg-border" />
      <p className="hidden md:block text-[12px] text-muted-foreground basis-[40%] shrink-0 max-w-[24rem]">
        {ROUND_DESCRIPTIONS[round] ?? ""}
      </p>
    </div>
  );
}
