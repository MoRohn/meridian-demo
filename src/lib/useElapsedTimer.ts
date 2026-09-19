"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityStatus } from "@/components/ActivityWindow";

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Drives a header pill's timer off the same status transitions that drive
 * an ActivityWindow: the instant `status` becomes "pending" it starts
 * ticking from zero (a real `setInterval`, not a guess), and the instant it
 * becomes "done" or "error" it freezes — on the real measured `finalMs`
 * from the server when one's available, or on the last ticked value
 * otherwise (a network failure before any response, for instance). Going
 * back to "idle" (a session reset) clears it to nothing, ready for the next
 * activity to start the cycle over.
 */
export function useElapsedTimer(status: ActivityStatus, finalMs: number | null): number | null {
  const [liveMs, setLiveMs] = useState(0);
  const startRef = useRef<number | null>(null);
  const prevStatus = useRef<ActivityStatus>("idle");

  useEffect(() => {
    if (status === "pending" && prevStatus.current !== "pending") {
      startRef.current = Date.now();
      setLiveMs(0);
      const id = setInterval(() => {
        if (startRef.current != null) setLiveMs(Date.now() - startRef.current);
      }, 100);
      prevStatus.current = status;
      return () => clearInterval(id);
    }
    prevStatus.current = status;
  }, [status]);

  if (status === "idle") return null;
  if (status === "pending") return liveMs;
  // done or error: prefer the server-measured value, fall back to the last tick.
  return finalMs ?? liveMs;
}
