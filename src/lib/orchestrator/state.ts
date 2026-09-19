export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ContextFacts {
  contractType?: string;
  jurisdiction?: string;
}

export interface ActiveDocument {
  id: string;
  name: string;
  text: string;
}

/**
 * The conversational context a session accumulates turn over turn. This is
 * the "memory" layer: facts inferred in earlier turns (contract type,
 * jurisdiction, which document is under discussion) persist and get folded
 * into the `state` sent to Jev on every subsequent turn, instead of
 * being re-derived or re-asked for.
 */
export interface SessionState {
  id: string;
  createdAt: number;
  history: ChatTurn[];
  contextFacts: ContextFacts;
  activeDocument?: ActiveDocument;
}

/** The per-turn view skills receive: session memory plus the message just received. */
export interface TurnContext {
  latestMessage: string;
  session: SessionState;
}

export function createSession(id: string): SessionState {
  return { id, createdAt: Date.now(), history: [], contextFacts: {} };
}

export function loadDocument(session: SessionState, doc: ActiveDocument): void {
  session.activeDocument = doc;
  // A new document resets what we know about it — the contract-type skill
  // will fire again on the next turn since contextFacts.contractType is cleared.
  session.contextFacts.contractType = undefined;
}

const HISTORY_WINDOW = 6;

/**
 * Builds the `state` object every skill's questions are evaluated against.
 * Named fields (rather than one flat blob of text) let each question's
 * `instructions` point at a specific part with a `` `path.like.this` ``
 * reference — see https://docs.typesafe.ai/primitives#reference-specific-fields.
 */
export function buildStateJson(ctx: TurnContext) {
  const { session, latestMessage } = ctx;
  return {
    context: {
      contract_type: session.contextFacts.contractType ?? "unknown",
      jurisdiction: session.contextFacts.jurisdiction ?? "unknown",
    },
    conversation: session.history.slice(-HISTORY_WINDOW).map((t) => ({
      from: t.role,
      text: t.text,
    })),
    latest_message: latestMessage,
    active_document: session.activeDocument
      ? { name: session.activeDocument.name, text: session.activeDocument.text }
      : null,
  };
}
