export interface CitationExample {
  id: string;
  label: string;
  claim: string;
  quote: string | null;
  sectionId?: string;
  /** What this example is designed to demonstrate — shown in the UI as a hint, not sent to the model. */
  expect: "verified" | "unsupported" | "contradicted" | "fabricated";
}

/**
 * Four canned examples that exercise every branch of the citation-check
 * flow, mirroring the mix used in the cookbook this pattern is based on:
 * an accurate quote, a quote that's accurate but doesn't back the claim
 * built on it, a quote that contradicts its own claim, and a quote that
 * was never in the source at all.
 */
export const CITATION_EXAMPLES: CitationExample[] = [
  {
    id: "verified",
    label: "Accurate: should verify",
    claim: "Auto-renewing contracts need at least a 30-day opt-out window or Legal Ops has to sign off.",
    quote:
      "Any agreement that auto-renews must give the counterparty at least thirty (30) days' written notice before the renewal date during which either party may decline renewal without penalty.",
    sectionId: "2.1",
    expect: "verified",
  },
  {
    id: "contradicted",
    label: "Contradicted: quote says the opposite",
    claim: "Silence on a liability cap is fine as long as nothing bad has happened yet.",
    quote:
      "Silence on liability is not equivalent to a cap - an agreement that does not state a limitation of liability is treated as carrying uncapped exposure.",
    sectionId: "4.2",
    expect: "contradicted",
  },
  {
    id: "unsupported",
    label: "Unsupported: quote is real but off-topic for this claim",
    claim: "Termination fees are never allowed under the playbook, full stop.",
    quote:
      "Standard agreements should permit termination for convenience by either party with no more than ninety (90) days' notice and no termination fee.",
    sectionId: "6.3",
    expect: "unsupported",
  },
  {
    id: "fabricated",
    label: "Fabricated: quote does not exist in the source",
    claim: "The playbook caps indemnification at $10,000 for all vendor agreements.",
    quote: "In no case shall indemnification obligations under any vendor agreement exceed ten thousand dollars.",
    expect: "fabricated",
  },
];
