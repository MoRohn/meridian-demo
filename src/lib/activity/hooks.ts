"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { activityLog, currentActivity, type ActivityActor, type ActivityRecord } from "./log";

/** Every activity record, re-rendering when one starts or finishes. */
export function useActivities(): readonly ActivityRecord[] {
  return useSyncExternalStore(activityLog.subscribe, activityLog.list, activityLog.list);
}

/** The record a timer for this actor should show. See `currentActivity`. */
export function useCurrentActivity(actor: ActivityActor): ActivityRecord | null {
  return currentActivity(useActivities(), actor);
}

/** The clock for running timers: ticks while `active`, and does nothing (no interval) while nothing is running. */
export function useNow(active: boolean, intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
