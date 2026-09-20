import { NextRequest, NextResponse } from "next/server";
import { getOrCreateSession, resetSession } from "@/lib/memory/session";
import { handleTurn } from "@/lib/orchestrator/run";
import { loadDocument } from "@/lib/orchestrator/state";
import { findSampleContract } from "@/lib/data/sampleContracts";
import { isLive, type KeyOverride } from "@/lib/typesafe/client";
import { isOpenAIConfigured } from "@/lib/openai/client";

export const runtime = "nodejs";

type Body =
  | { action: "message"; sessionId: string; message: string; typesafeOverride?: KeyOverride; openaiOverride?: KeyOverride }
  | { action: "load_document"; sessionId: string; typesafeOverride?: KeyOverride; openaiOverride?: KeyOverride; contractId: string }
  | {
      action: "load_document_text";
      sessionId: string;
      name: string;
      text: string;
      typesafeOverride?: KeyOverride;
      openaiOverride?: KeyOverride;
    }
  | { action: "reset"; sessionId: string; typesafeOverride?: KeyOverride; openaiOverride?: KeyOverride };

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("sessionId" in body) || !body.sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "reset": {
        const session = resetSession(body.sessionId);
        return NextResponse.json({
          session: publicSession(session),
          live: isLive(body.typesafeOverride),
          openaiConfigured: isOpenAIConfigured(body.openaiOverride),
        });
      }

      case "load_document": {
        const session = getOrCreateSession(body.sessionId);
        const contract = findSampleContract(body.contractId);
        if (!contract) return NextResponse.json({ error: "Unknown contract id" }, { status: 404 });
        loadDocument(session, { id: contract.id, name: contract.name, text: contract.text });
        return NextResponse.json({
          session: publicSession(session),
          live: isLive(body.typesafeOverride),
          openaiConfigured: isOpenAIConfigured(body.openaiOverride),
        });
      }

      case "load_document_text": {
        if (!body.text || !body.text.trim()) {
          return NextResponse.json({ error: "text is required" }, { status: 400 });
        }
        const session = getOrCreateSession(body.sessionId);
        loadDocument(session, { id: crypto.randomUUID(), name: body.name, text: body.text });
        return NextResponse.json({
          session: publicSession(session),
          live: isLive(body.typesafeOverride),
          openaiConfigured: isOpenAIConfigured(body.openaiOverride),
        });
      }

      case "message": {
        if (!body.message || !body.message.trim()) {
          return NextResponse.json({ error: "message is required" }, { status: 400 });
        }
        const session = getOrCreateSession(body.sessionId);
        const result = await handleTurn(session, body.message.trim(), body.typesafeOverride, body.openaiOverride);
        return NextResponse.json({
          result,
          session: publicSession(session),
          live: isLive(body.typesafeOverride),
          openaiConfigured: isOpenAIConfigured(body.openaiOverride),
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/chat] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function publicSession(session: ReturnType<typeof getOrCreateSession>) {
  return {
    id: session.id,
    history: session.history,
    contextFacts: session.contextFacts,
    activeDocument: session.activeDocument ?? null,
  };
}
