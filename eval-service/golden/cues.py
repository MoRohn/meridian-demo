"""
A rule-based third verifier for generated fixtures: deterministic checks on the text that share NO blind spots
with a language model.

Two LLM calls (drafter and labeler) from one model family can agree on the same mistake. These rules cannot
share that mistake, because they are plain patterns. They are deliberately conservative: each rule fires only on
evidence that DEFINITELY contradicts the spec (an "uncapped" phrase in a text specced as mutually capped), never
on absence of evidence that a model might have paraphrased. A contradiction rejects the case. A pass means only
"nothing here obviously contradicts the spec", not "the spec is right"; the blind LLM labeler and a human
reviewer remain the checks for that.

Validated against the human-written sample contracts in src/lib/data/sampleContracts.ts (test_cues.py).
"""

import re

_I = re.IGNORECASE


def _has(pattern: str, text: str) -> bool:
    return re.search(pattern, text, _I) is not None


UNCAPPED = r"\b(unlimited|uncapped|without (any )?limit|shall not be limited|no (cap|limit)|not (be )?subject to any (cap|limit))\b"
CAP_AMOUNT = r"(shall not exceed|capped at|limited to|not exceed|aggregate liability)[^.]{0,120}(\$\s?\d|\d+\s*(months|percent|%)|fees (paid|payable))"
BROAD_INDEMNITY = r"(regardless of (the theory of liability|fault)|without regard to fault|any and all claims)"
MUTUAL_INDEMNITY = r"(each party shall indemnify|mutual(ly)? indemnif|indemnify the other only)"
EXIT_PENALTY = r"(termination fee|early termination fee|termination charge|penalt(y|ies) (for|on) terminat|remainder of the (then-current )?term)"
EASY_EXIT = r"(either party may terminate[^.]{0,80}(convenience|written notice)|terminate[^.]{0,60}\b(thirty|30|sixty|60)\b[^.]{0,20}days)"
NO_EXIT = r"(may not terminate|no right to terminate|shall not terminate|only for cause)"
GOVERNING = r"(governed by|governing law|laws of the (state|commonwealth|province|country|republic)|exclusive jurisdiction|courts of)"
RENEWS = r"(automatically renew|renews? automatically|auto-?renew|automatic(ally)? (renewal|extend))"
NEGATED = r"\b(not|nor|never|no|without|neither)\b[^.;]{0,30}$"
NOTICE_WINDOW = r"\b(thirty|sixty|ninety|30|60|90)\b[^.]{0,40}(days|day)[^.]{0,60}(notice|prior to|before)|(notice|prior to|before)[^.]{0,60}\b(thirty|sixty|ninety|30|60|90)\b[^.]{0,10}(days|day)"
PERSONAL_DATA = r"(personal data|personal information|customer data|end users?'? (personal )?data|data subjects?)"
DATA_PROTECTION = r"(data protection|gdpr|privacy law|privacy (policy|compliance)|breach notification|security (measures|obligations|safeguards)|data processing (agreement|addendum))"


def _renews(text: str) -> bool:
    """True if the text renews automatically. A renewal phrase preceded by a negation ("does not automatically renew",
    "no automatic renewal") does not count: a non-renewing NDA must not be mistaken for a renewal trap."""
    return any(not re.search(NEGATED, text[max(0, m.start() - 40): m.start()], _I) for m in re.finditer(RENEWS, text, _I))


def risk_contradictions(spec: dict, text: str) -> list[str]:
    out = []
    uncapped, capped = _has(UNCAPPED, text), _has(CAP_AMOUNT, text)
    liability = spec["liability_exposure"]
    if liability == 0.0 and uncapped:
        out.append("liability specced as mutually capped but the text says it is unlimited")
    if liability == 1.0 and capped and not uncapped:
        out.append("liability specced as uncapped or vague but the text states a clear cap")
    indemnity = spec["indemnification_harshness"]
    if indemnity == 0.0 and _has(BROAD_INDEMNITY, text):
        out.append("indemnity specced as mutual but the text uses broad no-fault language")
    if indemnity == 1.0 and _has(MUTUAL_INDEMNITY, text) and not _has(BROAD_INDEMNITY, text):
        out.append("indemnity specced as broad and one-sided but the text is mutual and scoped")
    termination = spec["termination_rigidity"]
    if termination == 0.0 and (_has(EXIT_PENALTY, text) or _has(NO_EXIT, text)):
        out.append("termination specced as easy but the text imposes a fee or restriction")
    if termination == 1.0 and _has(EASY_EXIT, text) and not (_has(EXIT_PENALTY, text) or _has(NO_EXIT, text)):
        out.append("termination specced as rigid but the text allows easy penalty-free exit")
    return out


def compliance_contradictions(spec: dict, text: str) -> list[str]:
    out = []
    has_governing = _has(GOVERNING, text)
    if spec["missing_governing_law"] and has_governing:
        out.append("governing law specced as missing but the text states one")
    if not spec["missing_governing_law"] and not has_governing:
        out.append("governing law specced as present but the text states none")

    renews, window = _renews(text), _has(NOTICE_WINDOW, text)
    if spec["auto_renewal_trap"] and not renews:
        out.append("auto-renewal trap specced but the text never renews automatically")
    if not spec["auto_renewal_trap"] and renews and not window:
        out.append("auto-renewal specced as fine but the text renews with no notice window")

    uncapped, capped = _has(UNCAPPED, text), _has(CAP_AMOUNT, text)
    if spec["unlimited_liability"] and capped and not uncapped:
        out.append("liability specced as unlimited or unclear but the text states a clear cap")
    if not spec["unlimited_liability"] and (uncapped or not capped):
        out.append("liability specced as clearly capped but the text does not state a cap" if not capped else "liability specced as capped but the text also says unlimited")

    personal, protection = _has(PERSONAL_DATA, text), _has(DATA_PROTECTION, text)
    if spec["missing_data_protection_clause"] and (not personal or protection):
        out.append("missing data protection specced but the text has no personal data" if not personal else "missing data protection specced but the text has a protection clause")
    if not spec["missing_data_protection_clause"] and personal and not protection:
        out.append("data protection specced as fine but the text handles personal data with no protection clause")
    return out


def citation_contradictions(spec: dict, text: str) -> list[str]:
    """A supporting section must share SOME vocabulary with its claim; with none at all it is almost certainly silent
    on it. Compared by 5-letter stems so 'renewing' matches 'renews' and 'renewal'. Deliberately weak: a paraphrase
    with one shared stem passes, and the LLM labeler and a human decide the rest."""
    if spec["relation"] != "supports":
        return []
    stems = lambda t: {w[:5] for w in re.findall(r"[a-z]{5,}", t.lower())}
    return [] if stems(text) & stems(spec.get("claim", "")) else ["section specced as supporting the claim shares no vocabulary with it"]


def contradictions(kind: str, spec: dict, text: str) -> list[str]:
    return {"risk": risk_contradictions, "compliance": compliance_contradictions, "citation": citation_contradictions}[kind](spec, text)
