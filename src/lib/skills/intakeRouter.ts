import type { QuestionSpec, Skill } from "../typesafe/types";
import type { TurnContext } from "../orchestrator/state";

export const INTENTS = {
  analyze_contract: "Wants a contract or clause reviewed for risk",
  check_compliance: "Wants specific compliance/policy flags checked (privacy, renewal terms, liability)",
  verify_citation: "Wants a legal citation or quoted authority checked against a source",
  summarize_context: "Wants a recap of the context and what's been established so far",
  ask_legal_question: "Has an open-ended legal question outside document review",
  small_talk: "Greeting, thanks, or chit-chat with no task",
} as const;

export type Intent = keyof typeof INTENTS;

/**
 * The front door of the orchestrator: one Choice over the intents this app
 * can act on, plus a Score for urgency. This is the "intent routing" pattern
 * (docs.typesafe.ai/patterns/intent-routing) — a fast, cheap classification
 * step that decides which deterministic code path or specialist skill
 * handles the turn, run in the SAME request as every other skill's
 * speculative questions (docs.typesafe.ai/patterns/fan-out), not a
 * separate round trip.
 */
export const intakeRouterSkill: Skill<TurnContext> = {
  name: "intake_router",
  description: "Classifies what the user is trying to do this turn and how urgent it is.",
  isApplicable: () => true,
  buildQuestions(): Record<string, QuestionSpec> {
    return {
      intent: {
        type: "choice",
        instructions: "What is the user asking the assistant to do in `latest_message`, read in the context of `conversation`?",
        criteria: INTENTS,
      },
      urgency: {
        type: "score",
        instructions: "How time-sensitive does `latest_message` sound?",
        criteria: [
          "Routine, no deadline mentioned",
          "Some time pressure (a date or 'soon' mentioned)",
          "Urgent — an imminent deadline, signature, or filing is at stake",
        ],
      },
    };
  },
};
