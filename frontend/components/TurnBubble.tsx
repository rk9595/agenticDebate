"use client";

interface TurnBubbleProps {
  participantName: string;
  position: "for" | "against";
  round: string;
  content: string;
  streaming?: boolean;
}

const POSITION_STYLES = {
  for: "bg-blue-50 border-blue-200",
  against: "bg-rose-50 border-rose-200",
};

const POSITION_LABEL_STYLES = {
  for: "text-blue-700 bg-blue-100",
  against: "text-rose-700 bg-rose-100",
};

export default function TurnBubble({ participantName, position, round, content, streaming }: TurnBubbleProps) {
  return (
    <div className={`rounded-xl border p-4 ${POSITION_STYLES[position]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${POSITION_LABEL_STYLES[position]}`}>
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
