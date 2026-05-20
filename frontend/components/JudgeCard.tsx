"use client";

interface JudgeCardProps {
  content: string;
  score: number | null;
  streaming: boolean;
}

export default function JudgeCard({ content, score, streaming }: JudgeCardProps) {
  return (
    <div className="mt-2 ml-6 mr-6 mb-3 relative">
      {/* Left rule */}
      <div className="absolute left-[-12px] top-3 bottom-3 w-[2px] bg-[var(--judge)]/60 rounded-full" />
      <div className="rounded-lg border border-[var(--judge)]/25 bg-[var(--judge)]/[0.06] px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-caption text-[10px] font-bold text-[var(--judge)]">referee</span>
          {score !== null && (
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--judge)]/15 text-[var(--judge)]">
              {score}/10
            </span>
          )}
          {streaming && (
            <span className="inline-block w-1.5 h-3 bg-[var(--judge)] rounded-sm animate-caret" />
          )}
        </div>
        <p className="text-xs text-foreground/75 leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}
