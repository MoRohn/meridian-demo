import { NextRequest, NextResponse } from "next/server";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { KeyOverride } from "@/lib/typesafe/client";

export const runtime = "nodejs";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

/**
 * Fired right after the Settings modal saves a key, so the header pills can
 * flip to "Live" the moment a key is confirmed to actually work not just
 * present. Each check is the cheapest possible authenticated round trip
 * (list models), never a real Jev / chat-completion call, so saving
 * a key doesn't burn a real judgment just to prove it's valid.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { typesafeOverride?: KeyOverride; openaiOverride?: KeyOverride };

    const [typesafeValid, openaiValid] = await Promise.all([
      validateTypesafeKey(body.typesafeOverride),
      validateOpenaiKey(body.openaiOverride),
    ]);

    return NextResponse.json({ typesafeValid, openaiValid });
  } catch (err) {
    console.error("[api/validate-keys] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function validateTypesafeKey(override?: KeyOverride): Promise<boolean | null> {
  const apiKey = override?.apiKey?.trim();
  if (!apiKey) return null; // no user-supplied key to validate
  try {
    const client = new TypeSafeClient({ apiKey });
    await client.models.list();
    return true;
  } catch {
    return false;
  }
}

async function validateOpenaiKey(override?: KeyOverride): Promise<boolean | null> {
  const apiKey = override?.apiKey?.trim();
  if (!apiKey) return null;
  try {
    const res = await fetch(OPENAI_MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    return res.ok;
  } catch {
    return false;
  }
}
