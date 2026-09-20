import { NextRequest, NextResponse } from "next/server";
import { getOrCreateSession, resetSession } from "@/lib/memory/session";
import { handleTurn } from "@/lib/orchestrator/run";
import { loadDocument } from "@/lib/orchestrator/state";
import { findSampleContract } from "@/lib/data/sampleContracts";
import { isLive, type KeyOverride } from "@/lib/typesafe/client";
import { isOpenAIConfigured } from "@/lib/openai/client";
import { MAX_DOCUMENT_CHARS, MAX_MESSAGE_CHARS, apiError, cleanDocumentName, guardApi, isValidSessionId } from "@/lib/api/guard";

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
  const blocked = guardApi(req);
  if (blocked) return blocked;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || !("sessionId" in body) || !body.sessionId) {
    return apiError("sessionId is required", 400);
  }
  // The session id is the only thing that names a session, so it has to look like one the browser minted (long and random),
  // not a short guessable string.
  if (!isValidSessionId(body.sessionId)) return apiError("sessionId is not valid", 400);

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
        if (!contract) return apiError("Unknown contract id", 404);
        loadDocument(session, { id: contract.id, name: contract.name, text: contract.text });
        return NextResponse.json({
          session: publicSession(session),
          live: isLive(body.typesafeOverride),
          openaiConfigured: isOpenAIConfigured(body.openaiOverride),
        });
      }

      case "load_document_text": {
        if (typeof body.text !== "string" || !body.text.trim()) return apiError("text is required", 400);
        if (body.text.length > MAX_DOCUMENT_CHARS) return apiError(`text is too long (max ${MAX_DOCUMENT_CHARS.toLocaleString("en-US")} characters)`, 413);
        const name = cleanDocumentName(body.name);
        if (!name) return apiError("name must be a short, non-empty string", 400);
        const session = getOrCreateSession(body.sessionId);
        loadDocument(session, { id: crypto.randomUUID(), name, text: body.text });
        return NextResponse.json({
          session: publicSession(session),
          live: isLive(body.typesafeOverride),
          openaiConfigured: isOpenAIConfigured(body.openaiOverride),
        });
      }

      case "message": {
        if (typeof body.message !== "string" || !body.message.trim()) return apiError("message is required", 400);
        if (body.message.length > MAX_MESSAGE_CHARS) return apiError(`message is too long (max ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters)`, 413);
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
        return apiError("Unknown action", 400);
    }
  } catch (err) {
    console.error("[api/chat] error:", err);
    return apiError("Internal error", 500);
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
