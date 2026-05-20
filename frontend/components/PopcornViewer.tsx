"use client";

interface PopcornViewerProps {
  /** true while a turn is actively streaming */
  excited?: boolean;
}

export default function PopcornViewer({ excited = false }: PopcornViewerProps) {
  return (
    <div className={`flex flex-col items-center gap-0.5 select-none ${excited ? "animate-popcorn-lean" : ""}`}>
      <svg
        width="64"
        height="72"
        viewBox="0 0 64 72"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        {/* ── Head ── */}
        <circle cx="32" cy="14" r="12" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
        {/* Hair */}
        <path d="M22 11 Q32 4 42 11" stroke="#9ca3af" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Eyes — shift left/right */}
        <g className="animate-popcorn-eyes">
          <circle cx="27" cy="13" r="3" fill="#374151" />
          <circle cx="37" cy="13" r="3" fill="#374151" />
          {/* Eye shine */}
          <circle cx="28.2" cy="12" r="1" fill="white" />
          <circle cx="38.2" cy="12" r="1" fill="white" />
        </g>

        {/* Mouth — chew animation */}
        <g className="animate-popcorn-chew">
          <ellipse cx="32" cy="19" rx="4" ry="2.5" fill="#374151" />
        </g>

        {/* ── Body ── */}
        <rect x="22" y="26" width="20" height="18" rx="5" fill="white" stroke="#d1d5db" strokeWidth="1.5" />

        {/* ── Right arm (eating arm) — pivots from shoulder ── */}
        <g transform="translate(42, 29)" className="animate-popcorn-arm">
          {/* Upper arm */}
          <rect x="0" y="0" width="6" height="12" rx="3" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
          {/* Forearm */}
          <rect x="-1" y="10" width="6" height="10" rx="3" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
          {/* Hand / popcorn */}
          <text x="-6" y="26" fontSize="14" style={{ fontFamily: "system-ui" }}>🍿</text>
        </g>

        {/* ── Left arm (resting) ── */}
        <rect x="16" y="28" width="6" height="14" rx="3" fill="white" stroke="#d1d5db" strokeWidth="1.5" />

        {/* ── Legs ── */}
        {/* Left leg */}
        <rect x="22" y="43" width="7" height="16" rx="3.5" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
        {/* Right leg */}
        <rect x="35" y="43" width="7" height="16" rx="3.5" fill="white" stroke="#d1d5db" strokeWidth="1.5" />

        {/* Feet */}
        <ellipse cx="25.5" cy="60" rx="5" ry="3" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
        <ellipse cx="38.5" cy="60" rx="5" ry="3" fill="white" stroke="#d1d5db" strokeWidth="1.5" />
      </svg>

      <span
        className="text-caption text-[9px] text-muted-foreground"
        style={{ letterSpacing: "0.1em" }}
      >
        {excited ? "ooh…" : "watching"}
      </span>
    </div>
  );
}
