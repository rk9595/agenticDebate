"use client";

interface JudgeCardProps {
  content: string;
  score: number | null;
  streaming: boolean;
}

export default function JudgeCard({ content, score, streaming }: JudgeCardProps) {
  return (
    <div className="mt-2 ml-4 mb-1 border-l border-border pl-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          Referee
        </span>
        {score !== null && (
          <span className="text-[11px] font-mono tabular-nums text-foreground">
            {score}/10
          </span>
        )}
        {streaming && (
          <span className="inline-block w-[2px] h-3 bg-foreground animate-caret" />
        )}
      </div>
      <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
        {content}
      </p>
    </div>
  );
}
