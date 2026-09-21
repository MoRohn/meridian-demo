import { beforeEach, describe, expect, it } from "vitest";
import { citationStore, emptySide, type CitationRun } from "./store";

const run = (sig: string): CitationRun => ({ sig, extraction: { checks: [] } as never, typesafe: emptySide("done"), openai: emptySide("skipped"), tokens: { typesafe: 1, openai: 1 } });

beforeEach(() => citationStore.reset());

describe("citationStore claims", () => {
  it("lets a text start once: the first claim wins, later ones do not", () => {
    expect(citationStore.claim("a")).toBe(true);
    expect(citationStore.claim("a")).toBe(false);
  });

  it("forgets the oldest run's claims when it is evicted, so that text can be checked again", () => {
    for (let i = 0; i < 12; i++) {
      citationStore.claim(`doc${i}`);
      citationStore.set(run(`doc${i}`));
    }
    citationStore.claim("doc0|openai|1"); // a late OpenAI start against the oldest run
    expect(citationStore.get("doc0")).toBeDefined();

    citationStore.claim("doc12");
    citationStore.set(run("doc12")); // the 13th run pushes doc0 out

    expect(citationStore.get("doc0")).toBeUndefined();
    expect(citationStore.claim("doc0")).toBe(true); // it starts again instead of showing nothing forever
    expect(citationStore.claim("doc0|openai|1")).toBe(true);
    expect(citationStore.claim("doc1")).toBe(false); // runs still remembered keep their claims
  });

  it("does not let claims grow without bound as runs come and go", () => {
    for (let i = 0; i < 200; i++) {
      citationStore.claim(`doc${i}`);
      citationStore.claim(`doc${i}|openai|1`);
      citationStore.set(run(`doc${i}`));
    }
    // Only the twelve remembered runs can still be claimed; every evicted one starts fresh.
    let alreadyClaimed = 0;
    for (let i = 0; i < 200; i++) if (!citationStore.claim(`doc${i}`)) alreadyClaimed += 1;
    expect(alreadyClaimed).toBe(12);
  });

  it("drops a run together with its OpenAI claims, and does not touch a run whose name only starts the same", () => {
    citationStore.claim("doc1");
    citationStore.claim("doc1|openai|2");
    citationStore.claim("doc10");
    citationStore.set(run("doc1"));
    citationStore.set(run("doc10"));
    citationStore.drop("doc1");
    expect(citationStore.claim("doc1")).toBe(true);
    expect(citationStore.claim("doc1|openai|2")).toBe(true);
    expect(citationStore.claim("doc10")).toBe(false);
    expect(citationStore.get("doc10")).toBeDefined();
  });
});
