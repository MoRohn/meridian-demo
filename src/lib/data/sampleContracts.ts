export interface SampleContract {
  id: string;
  name: string;
  blurb: string;
  text: string;
}

/**
 * Short, self-contained clause sets — long enough for the risk/compliance
 * skills to have real signal, short enough to read in the demo UI. Each one
 * is written to trip a different mix of the composite-risk dimensions and
 * compliance checks so the panel doesn't look identical across documents.
 */
export const SAMPLE_CONTRACTS: SampleContract[] = [
  {
    id: "saas-msa-onesided",
    name: "SaaS Master Services Agreement (vendor-drafted)",
    blurb: "Uncapped indemnity, silent on liability cap, auto-renews.",
    text: `MASTER SERVICES AGREEMENT (excerpt)

1. Term and Renewal. This Agreement commences on the Effective Date and continues for
one (1) year. Thereafter, this Agreement automatically renews for successive one-year
terms unless either party provides written notice of non-renewal.

2. Fees. Customer shall pay the fees set forth in the applicable Order Form within
thirty (30) days of invoice.

3. Indemnification. Customer shall indemnify, defend, and hold harmless Provider, its
officers, directors, and employees from and against any and all claims, damages,
liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of
or related to Customer's use of the Services, Customer Data, or any breach of this
Agreement by Customer, regardless of the theory of liability and without regard to
fault.

4. Limitation of Liability. IN NO EVENT SHALL PROVIDER BE LIABLE FOR ANY INDIRECT,
INCIDENTAL, OR CONSEQUENTIAL DAMAGES. Provider's total liability arising out of this
Agreement shall not be limited except as required by applicable law.

5. Data Processing. Provider may process Customer Data, including personal data of
Customer's end users, as necessary to provide the Services.

6. Termination. Customer may terminate this Agreement for convenience only upon
eighteen (18) months' prior written notice and payment of an early termination fee
equal to the fees for the remainder of the then-current term.`,
  },
  {
    id: "mutual-nda",
    name: "Mutual Non-Disclosure Agreement",
    blurb: "Reasonably balanced — good contrast case for the risk dashboard.",
    text: `MUTUAL NON-DISCLOSURE AGREEMENT (excerpt)

1. Purpose. The parties wish to explore a potential business relationship and may
disclose confidential information to one another for that purpose.

2. Confidentiality Obligations. Each party shall protect the other's Confidential
Information using at least the same degree of care it uses for its own confidential
information, and shall not disclose it to third parties without prior written consent.

3. Term. This Agreement remains in effect for two (2) years from the Effective Date.
Confidentiality obligations survive for three (3) years after disclosure. This
Agreement does not automatically renew.

4. Indemnification. Each party shall indemnify the other only for direct damages
arising from that party's own breach of its confidentiality obligations under this
Agreement.

5. Limitation of Liability. Neither party's aggregate liability under this Agreement
shall exceed fifty thousand dollars ($50,000); liability is capped at that amount in
all cases regardless of the value of Confidential Information exchanged.

6. Termination. Either party may terminate this Agreement for convenience upon thirty
(30) days' written notice.

7. Governing Law. This Agreement is governed by the laws of the State of Delaware,
without regard to conflict-of-laws principles.`,
  },
  {
    id: "employment-noncompete",
    name: "Employment Agreement (with restrictive covenants)",
    blurb: "No governing law clause, murky liability language.",
    text: `EMPLOYMENT AGREEMENT (excerpt)

1. Position and Duties. Employee shall serve as Senior Engineer and perform duties as
assigned by the Company.

2. Compensation. Employee shall receive an annual salary payable in accordance with the
Company's standard payroll practices.

3. Confidentiality and Data Handling. Employee may access Company systems containing
customer personal data in the course of employment and agrees to handle such data
appropriately.

4. Restrictive Covenants. For a period of twenty-four (24) months following
termination, Employee shall not work for any competing business anywhere in the world,
and shall indemnify the Company for any losses the Company attributes to a violation of
this covenant, however calculated.

5. Termination. The Company may terminate this Agreement at any time. Upon
termination, all outstanding obligations under Section 4 continue to apply in full
force.`,
  },
];

export function findSampleContract(id: string): SampleContract | undefined {
  return SAMPLE_CONTRACTS.find((c) => c.id === id);
}
