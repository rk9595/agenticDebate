"use client";

interface JudgeCardProps {
  content: string;
  score: number | null;
  streaming: boolean;
}

export default function JudgeCard({ content, score, streaming }: JudgeCardProps) {
  return (
    <div className="ml-4 mt-1 mb-3 border-l-2 border-amber-300 pl-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold text-amber-600 uppercase tracking-wide">Judge</span>
        {score !== null && (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
            {score}/10
          </span>
        )}
        {streaming && (
          <span className="inline-block w-1.5 h-3 bg-amber-400 animate-pulse rounded-sm" />
        )}
      </div>
      <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  );
}
