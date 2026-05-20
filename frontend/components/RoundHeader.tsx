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
    <div className="relative my-8">
      {/* Animated tape divider */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="relative flex items-center justify-center">
        <div className="bg-background px-5 py-2 flex items-center gap-3 rounded-full border border-border">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalRounds }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i + 1 === roundNum
                    ? "bg-foreground"
                    : i + 1 < roundNum
                      ? "bg-muted-foreground/60"
                      : "bg-border"
                }`}
              />
            ))}
          </div>
          <div className="h-3 w-px bg-border" />
          <span className="text-caption text-[10px] text-muted-foreground">
            round {roundNum}/{totalRounds}
          </span>
          <div className="h-3 w-px bg-border" />
          <span className="text-display text-sm font-black uppercase tracking-tight">{round}</span>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-3">
        {ROUND_DESCRIPTIONS[round] ?? ""}
      </p>
    </div>
  );
}
