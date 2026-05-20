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
  align = "left",
  variant = "fight",
}: TurnBubbleProps) {
  const color =
    variant === "fight"
      ? position === "for"
        ? "var(--for)"
        : "var(--against)"
      : MEETING_COLORS[colorIndex % MEETING_COLORS.length];

  const isRight = align === "right";

  return (
    <div
      className={`relative rounded-2xl border bg-card/70 backdrop-blur-sm overflow-hidden ${
        isRight ? "text-right" : ""
      }`}
      style={{
        borderColor: `color-mix(in oklch, ${color} 30%, var(--border))`,
        boxShadow: streaming
          ? `0 0 0 1px color-mix(in oklch, ${color} 35%, transparent), 0 8px 30px color-mix(in oklch, ${color} 12%, transparent)`
          : undefined,
      }}
    >
      {/* Top color strip */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{
          background: isRight
            ? `linear-gradient(270deg, ${color}, transparent)`
            : `linear-gradient(90deg, ${color}, transparent)`,
        }}
      />

      <div className="p-4">
        <div
          className={`flex items-center gap-2 mb-2 ${
            isRight ? "flex-row-reverse" : ""
          }`}
        >
          <span
            className="text-caption text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: `color-mix(in oklch, ${color} 18%, transparent)`,
              color,
            }}
          >
            {position}
          </span>
          <span className="text-sm font-bold tracking-tight">{participantName}</span>
          <span className="flex-1" />
          <span className="text-caption text-[10px] text-muted-foreground">{round}</span>
          {streaming && (
            <span className="flex items-center gap-1 text-caption text-[10px]" style={{ color }}>
              <span
                className="h-1.5 w-1.5 rounded-full animate-live"
                style={{ background: color }}
              />
              on air
            </span>
          )}
        </div>
        <p
          className={`text-foreground/90 text-[15px] leading-relaxed whitespace-pre-wrap ${
            isRight ? "text-right" : ""
          }`}
        >
          {content}
          {streaming && (
            <span
              className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom animate-caret"
              style={{ background: color }}
            />
          )}
        </p>
      </div>
    </div>
  );
}
