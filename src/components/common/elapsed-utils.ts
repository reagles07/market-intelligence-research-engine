import { useEffect, useRef, useState } from "react";

/** Seconds elapsed since `active` became true; resets when it goes false. */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setSeconds(0);
      return;
    }
    // Start immediately — the first tick must not wait a second.
    startedAt.current = Date.now();
    setSeconds(0);
    const id = setInterval(() => {
      if (startedAt.current === null) return;
      setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}

/** 37 -> "00:37", 128 -> "2m 08s". */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins === 0) return `00:${String(secs).padStart(2, "0")}`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

/** Calm reassurance after a minute — never a percentage, never an ETA. */
export function elapsedMessage(totalSeconds: number, step?: string | null): string {
  const base =
    totalSeconds >= 60
      ? `Still working — ${formatElapsed(totalSeconds)} elapsed`
      : `Working — ${formatElapsed(totalSeconds)}`;
  return step ? `${base} · ${step}` : base;
}
