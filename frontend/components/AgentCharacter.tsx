"use client";

import { useEffect, useState } from "react";

interface AgentCharacterProps {
  color: string;
  size?: number;
  isActive?: boolean;
}

export default function AgentCharacter({ color, size = 52, isActive = false }: AgentCharacterProps) {
  const [blinking, setBlinking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);

  // Random blink every 2-5 s
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    function scheduleBlink() {
      t = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 120);
      }, 2000 + Math.random() * 3000);
    }
    scheduleBlink();
    return () => clearTimeout(t);
  }, []);

  // Mouth flap while speaking
  useEffect(() => {
    if (!isActive) { setMouthOpen(false); return; }
    const iv = setInterval(() => setMouthOpen((p) => !p), 180 + Math.random() * 80);
    return () => clearInterval(iv);
  }, [isActive]);

  const eyeH = blinking ? 1 : 7;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 58"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={isActive ? "animate-agent-bounce" : "animate-agent-float"}
      aria-hidden
    >
      {/* Antenna */}
      <line x1="26" y1="1" x2="26" y2="9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="26" cy="1" r="2.5" fill={color} />

      {/* Head */}
      <rect x="4" y="9" width="44" height="30" rx="9" fill="white" stroke={color} strokeWidth="1.5" />
      {/* Head inner tint */}
      <rect x="4" y="9" width="44" height="30" rx="9" fill={color} fillOpacity="0.05" />

      {/* Eyes */}
      <rect
        x="11"
        y={24 - eyeH / 2}
        width="11"
        height={eyeH}
        rx="3"
        fill={color}
        className={isActive ? "animate-agent-glow" : ""}
      />
      <rect
        x="30"
        y={24 - eyeH / 2}
        width="11"
        height={eyeH}
        rx="3"
        fill={color}
        className={isActive ? "animate-agent-glow" : ""}
      />
      {/* Eye shine */}
      {!blinking && (
        <>
          <rect x="14" y={21 - eyeH / 2 + 1} width="3" height="2" rx="1" fill="white" fillOpacity="0.8" />
          <rect x="33" y={21 - eyeH / 2 + 1} width="3" height="2" rx="1" fill="white" fillOpacity="0.8" />
        </>
      )}

      {/* Mouth */}
      {mouthOpen ? (
        <rect x="19" y="33" width="14" height="5" rx="2.5" fill={color} fillOpacity="0.85" />
      ) : (
        <path
          d="M19 36 Q26 39.5 33 36"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      )}

      {/* Neck connector */}
      <rect x="20" y="39" width="12" height="4" rx="0" fill={color} fillOpacity="0.15" />

      {/* Body */}
      <rect x="10" y="43" width="32" height="14" rx="6" fill="white" stroke={color} strokeWidth="1.5" />
      <rect x="10" y="43" width="32" height="14" rx="6" fill={color} fillOpacity="0.05" />

      {/* Chest LED */}
      <circle cx="26" cy="50" r="3.5" fill={color} fillOpacity={isActive ? 0.9 : 0.35} />
      {isActive && <circle cx="26" cy="50" r="6" fill={color} fillOpacity="0.2" />}

      {/* Side bolts */}
      <circle cx="16" cy="50" r="2" fill={color} fillOpacity="0.3" />
      <circle cx="36" cy="50" r="2" fill={color} fillOpacity="0.3" />
    </svg>
  );
}
