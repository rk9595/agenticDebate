"use client";

interface TurnBubbleProps {
  participantName: string;
  position: string;
  round: string;
  content: string;
  streaming?: boolean;
  colorIndex?: number;
}

const COLOR_PALETTE = [
  { bg: "bg-blue-50 border-blue-200", label: "text-blue-700 bg-blue-100" },
  { bg: "bg-rose-50 border-rose-200", label: "text-rose-700 bg-rose-100" },
  { bg: "bg-emerald-50 border-emerald-200", label: "text-emerald-700 bg-emerald-100" },
  { bg: "bg-purple-50 border-purple-200", label: "text-purple-700 bg-purple-100" },
  { bg: "bg-amber-50 border-amber-200", label: "text-amber-700 bg-amber-100" },
  { bg: "bg-cyan-50 border-cyan-200", label: "text-cyan-700 bg-cyan-100" },
];

export default function TurnBubble({ participantName, position, round, content, streaming, colorIndex = 0 }: TurnBubbleProps) {
  const colors = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
  return (
    <div className={`rounded-xl border p-4 ${colors.bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${colors.label}`}>
          {position}
        </span>
        <span className="font-semibold text-sm text-gray-800">{participantName}</span>
        <span className="text-xs text-gray-400 ml-auto capitalize">{round}</span>
      </div>
      <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
        {content}
        {streaming && <span className="inline-block w-1.5 h-4 bg-gray-500 ml-0.5 animate-pulse rounded-sm" />}
      </p>
    </div>
  );
}
