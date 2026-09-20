import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleTurn, buildTurnRequest } from "./run";
import { createSession, type SessionState } from "./state";
import { typesafeRequestBytes } from "../typesafe/measure";

beforeAll(() => {
  // No keys: the local evaluator answers and no model writes the reply, so nothing here touches the network.
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});
afterAll(() => vi.unstubAllEnvs());

function sessionWithExchanges(count: number): SessionState {
  const session = createSession("s");
  for (let i = 1; i <= count; i++) {
    session.history.push({ role: "user", text: `question ${i}` });
    session.history.push({ role: "assistant", text: `answer ${i}` });
  }
  return session;
}

describe("handleTurn context stats", () => {
  it("counts the message being answered, so the first message reads 1/1", async () => {
    const { context } = await handleTurn(createSession("s"), "hello there");
    expect(context.historyTurnsIncluded).toBe(1);
    expect(context.historyTurnsTotal).toBe(1);
  });

  it("counts turns (user messages), not history entries: one prior exchange makes the second message 2/2", async () => {
    const { context } = await handleTurn(sessionWithExchanges(1), "hello there");
    expect([context.historyTurnsIncluded, context.historyTurnsTotal]).toEqual([2, 2]);
  });

  it("reports the trimmed window when the conversation outgrows it", async () => {
    // Six history entries fit the window (three exchanges); a fourth exchange pushes the oldest out.
    const { context } = await handleTurn(sessionWithExchanges(4), "hello there");
    expect(context.historyTurnsIncluded).toBe(4); // three prior exchanges + the message being answered
    expect(context.historyTurnsTotal).toBe(5); // four prior exchanges + the message being answered
  });

  it("measures the whole request TypeSafe is sent (state and questions), the same basis as OpenAI's requestBytes", async () => {
    const session = sessionWithExchanges(1);
    const { stateJson, questions } = buildTurnRequest(session, "hello there");
    const { context } = await handleTurn(session, "hello there");
    expect(context.bytes).toBe(typesafeRequestBytes(stateJson, questions));
    expect(context.bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(stateJson), "utf8"));
  });
});
