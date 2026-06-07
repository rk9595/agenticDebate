"use client";

interface TurnBubbleProps {
  participantName: string;
  position: string;
  round: string;
  content: string;
  streaming?: boolean;
  colorIndex?: number;
  align?: "left" | "right";
  variant?: "fight" | "meeting";
}

const MEETING_COLORS = [
  "var(--for)",
  "var(--against)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--judge)",
  "var(--chart-3)",
];

export default function TurnBubble({
  participantName,
  position,
  round,
  content,
  streaming,
  colorIndex = 0,
  variant = "fight",
}: TurnBubbleProps) {
  const accent =
    variant === "fight"
      ? position === "for"
        ? "var(--for)"
        : "var(--against)"
      : MEETING_COLORS[colorIndex % MEETING_COLORS.length];

  return (
    <article
      className={`rounded-md border bg-card transition-colors ${
        streaming ? "border-foreground/40" : "border-border"
      }`}
    >
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: accent }}
        />
        <span className="text-[13px] font-medium tracking-tight truncate">
          {participantName}
        </span>
        <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          {position}
        </span>
        <span className="ml-auto text-[11px] font-mono text-muted-foreground">
          {round}
        </span>
        {streaming && (
          <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-pulse" />
            live
          </span>
        )}
      </header>

      <div className="px-4 py-3">
        <p className="text-[14px] leading-relaxed text-foreground whitespace-pre-wrap">
          {content}
          {streaming && (
            <span className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom bg-foreground animate-caret" />
          )}
        </p>
      </div>
    </article>
  );
}
