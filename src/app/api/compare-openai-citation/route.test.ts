import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SAMPLE_CONTRACTS } from "@/lib/data/sampleContracts";
import { resetSession } from "@/lib/memory/session";
import { loadDocument } from "@/lib/orchestrator/state";
import { suggestCitations } from "@/lib/citations/suggest";

const runMock = vi.fn();
vi.mock("@/lib/openai/client", () => ({ runOpenAIEquivalent: (...a: unknown[]) => runMock(...a) }));
const { POST } = await import("./route");
const post = (body: object) =>
  POST(new NextRequest("http://localhost/api/compare-openai-citation", { method: "POST", body: JSON.stringify(body) }));

const quote = suggestCitations(SAMPLE_CONTRACTS[0].text)[0].quote;

beforeEach(() => {
  runMock.mockReset();
  runMock.mockResolvedValue({ ok: true, result: {} });
  resetSession("s");
});

describe("POST /api/compare-openai-citation: the document as a source", () => {
  it("has no section for a document quote until that document is loaded", async () => {
    const data = await (await post({ sessionId: "s", claim: "It renews.", quote })).json();
    expect(data.outcome.reason).toBe("not_configured");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("judges the claim against the loaded document's clause", async () => {
    loadDocument(resetSession("s"), { id: "d", name: "n", text: SAMPLE_CONTRACTS[0].text });
    await post({ sessionId: "s", claim: "It renews.", quote });
    expect(runMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(runMock.mock.calls[0][0])).toContain("automatically renews");
  });
});
