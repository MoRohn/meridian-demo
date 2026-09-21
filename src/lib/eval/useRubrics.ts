import { useCallback, useEffect, useState } from "react";
import type { RubricInfo } from "./rubrics";

/** Shared across every "Scoring Rubric" button. Only a successful load is kept: a service that was off a minute ago is asked again. */
let loaded: RubricInfo[] | null = null;
let inFlight: Promise<RubricInfo[] | null> | null = null;

function load(): Promise<RubricInfo[] | null> {
  if (loaded) return Promise.resolve(loaded);
  inFlight ??= fetch("/api/rubrics", { cache: "no-store" })
    .then((r) => r.json())
    .then((d) => {
      loaded = (d?.rubrics as RubricInfo[] | null) ?? null;
      return loaded;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export type RubricsState = { status: "loading" } | { status: "ready"; rubrics: RubricInfo[] } | { status: "unavailable" };

/** The rubrics from the evaluation service, loaded when `enabled` (the modal is open). `retry` asks again after "unavailable". */
export function useRubrics(enabled: boolean): { state: RubricsState; retry: () => void } {
  const [state, setState] = useState<RubricsState>(() => (loaded ? { status: "ready", rubrics: loaded } : { status: "loading" }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // The reset to "loading" is deferred a tick so this effect never sets state synchronously in its body.
    Promise.resolve()
      .then(() => live && !loaded && setState({ status: "loading" }))
      .then(load)
      .then((r) => live && setState(r ? { status: "ready", rubrics: r } : { status: "unavailable" }));
    return () => {
      live = false;
    };
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
