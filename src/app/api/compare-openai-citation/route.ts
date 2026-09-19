import { NextRequest, NextResponse } from "next/server";
import { buildRelationRequest } from "@/lib/skills/citationVerifier";
import { AUTHORITY_SECTIONS } from "@/lib/data/authorities";
import { runOpenAIEquivalent } from "@/lib/openai/client";
import type { KeyOverride } from "@/lib/typesafe/client";

export const runtime = "nodejs";

/**
 * The citation-check counterpart to /api/compare-openai: same idea (an
 * independent request the client fires alongside the real TypeSafe check),
 * different task category. The Model Comparison capability isn't scoped to
 * chat turns only — every distinct judgment this app makes (conversation
 * fan-out, and this one, the locate-then-ask relation check) gets its own
 * live TypeSafe-vs-OpenAI comparison, not just whichever one happened to be
 * built first.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { claim?: string; quote?: string | null; sectionId?: string; override?: KeyOverride };
    if (!body?.claim?.trim()) {
      return NextResponse.json({ error: "claim is required" }, { status: 400 });
    }

    const request = buildRelationRequest(AUTHORITY_SECTIONS, body.claim.trim(), body.quote ?? null, body.sectionId);
    if (request.status === "missing") {
      // No section to compare against — same "no model call needed" logic
      // as the real check. Report as not_configured-shaped so the UI can
      // show a plain "nothing to compare" state rather than an error.
      return NextResponse.json({ outcome: { ok: false, reason: "not_configured", message: "fabricated — no section to check against" } });
    }

    const outcome = await runOpenAIEquivalent(request.state, request.questions, body.override);
    return NextResponse.json({ outcome });
  } catch (err) {
    console.error("[api/compare-openai-citation] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
