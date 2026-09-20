import { useCallback, useEffect, useState } from "react";
import type { EvalHealth } from "./health";

const TTL_MS = 15_000;
let cached: { at: number; promise: Promise<EvalHealth> } | null = null;

/** One shared, briefly cached request so the four evaluation panels do not each poll the service. */
function fetchHealth(force: boolean): Promise<EvalHealth> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = fetch("/api/evaluate", { cache: "no-store" })
    .then((r) => r.json())
    .then((d) => d.health as EvalHealth)
    .catch((): EvalHealth => ({ status: "offline" }));
  cached = { at: Date.now(), promise };
  return promise;
}

/** The eval service's state, or null until the first answer. `refresh` forces a new check (e.g. after a failed run). */
export function useEvalHealth(): { health: EvalHealth | null; refresh: () => void } {
  const [health, setHealth] = useState<EvalHealth | null>(null);
  useEffect(() => {
    let live = true;
    fetchHealth(false).then((h) => live && setHealth(h));
    return () => {
      live = false;
    };
  }, []);
  const refresh = useCallback(() => {
    fetchHealth(true).then(setHealth);
  }, []);
  return { health, refresh };
}
