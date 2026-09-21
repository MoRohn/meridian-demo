import { NextResponse, type NextRequest } from "next/server";
import { guardApi } from "@/lib/api/guard";
import { parseRubrics } from "@/lib/eval/rubrics";

export const runtime = "nodejs";

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || "http://localhost:8008";

/**
 * The scoring rubrics for the "Scoring Rubric" view, read from the evaluation service (eval-service/rubrics.py is the only
 * place their wording lives, so the app can never show rules the judge does not follow). Same server-to-server pattern as
 * /api/evaluate. `rubrics` is null when the service is not running or answers with nothing usable; it never throws.
 */
export async function GET(req: NextRequest) {
  const blocked = guardApi(req);
  if (blocked) return blocked;
  try {
    const res = await fetch(`${EVAL_SERVICE_URL}/rubrics`, { signal: AbortSignal.timeout(3_000), cache: "no-store" });
    return NextResponse.json({ rubrics: res.ok ? parseRubrics(await res.json()) : null });
  } catch {
    return NextResponse.json({ rubrics: null });
  }
}
