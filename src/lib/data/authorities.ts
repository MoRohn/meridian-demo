/**
 * A small reference corpus for the citation-verification demo, modeled on
 * the "Double-checking citations" cookbook
 * (docs.typesafe.ai/cookbooks/citation_check): a source document split into
 * addressable sections, so a quoted claim can be located and then judged
 * against its actual context.
 *
 * This is an invented internal contract playbook, not real case law or a
 * real statute — deliberately so, since the point of the demo is the
 * verification mechanism (locate a quote, then judge whether its context
 * supports the claim built on it), which works identically against any
 * source document, real or not.
 */
export const AUTHORITY_TITLE = "Meridian Legal Ops: Internal Contract Playbook v3 (fictional, for demo purposes)";

export const AUTHORITY_SECTIONS: Record<string, string> = {
  "2.1": `Section 2.1: Auto-Renewal Notice. Any agreement that auto-renews must give the
counterparty at least thirty (30) days' written notice before the renewal date during
which either party may decline renewal without penalty. Agreements with a notice window
shorter than thirty (30) days, or that impose a fee for declining renewal, require
Legal Ops sign-off before signature.`,
  "3.4": `Section 3.4: Indemnification Symmetry. Indemnification obligations should be
mutual and scoped to each party's own breaches, negligence, or violations of the
agreement. A one-way indemnity that covers the counterparty's ordinary business
liability, or that applies "regardless of fault," is a red flag and should be redlined
before signature.`,
  "4.2": `Section 4.2: Liability Caps. Every commercial agreement must state a liability cap
for both parties. A cap tied to fees paid in the preceding twelve (12) months is the
default position. Silence on liability is not equivalent to a cap - an agreement that
does not state a limitation of liability is treated as carrying uncapped exposure.`,
  "5.1": `Section 5.1: Personal Data Clauses. Any agreement under which a counterparty will
process personal data on the company's behalf, or vice versa, must include a data
protection clause addressing permitted use, security obligations, and breach
notification. This requirement applies regardless of contract type.`,
  "6.3": `Section 6.3: Termination for Convenience. Standard agreements should permit
termination for convenience by either party with no more than ninety (90) days' notice
and no termination fee. Longer notice periods or termination fees require a documented
business justification and Legal Ops approval.`,
};
