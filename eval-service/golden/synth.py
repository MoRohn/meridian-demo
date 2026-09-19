"""
Synthetic golden generation with the expected outcome fixed by construction.

The failure mode of LLM-generated goldens is the label: an LLM asked "is this answer correct?" about text
it wrote itself can be confidently wrong, and then the suite grades the judge against noise. So the LLM
never decides an outcome here.

    1. A SPEC (the ground truth) is chosen programmatically and reproducibly from a seed.
    2. A DRAFTER call writes only the source text that realizes the spec.
    3. A rule-based verifier and then a blind LABELER call check the text; the labeler sees ONLY that text,
       re-derives the spec independently, and any disagreement with the spec rejects the case. This filters
       label noise; it does not replace human review.
    4. The correct answer and the wrong answers are derived from the spec in TypeScript
       (src/lib/eval/syntheticCases.ts), through the same packet builders the UI uses.
    5. Nothing enters the gating suite until a human approves it.

    python golden/synth.py generate --kind risk --n 6 --seed 1     # needs OPENAI_API_KEY (real, billed calls)
    python golden/synth.py generate --kind compliance --n 6 --dry-run
    python golden/synth.py review                                   # print pending cases to read
    python golden/synth.py approve syn-risk-1a2b3c4d ...            # after reading them
    UPDATE_GOLDEN=1 npx vitest run src/lib/eval/golden.test.ts      # regenerate cases.json

Drafter, labeler and the judge under test must be three different models (enforced; --allow-same-model to override),
and a rule-based verifier (golden/cues.py) checks the text with no LLM blind spots. Same-family models can still share
blind spots, so human review is the real backstop.
"""

import argparse
import hashlib
import itertools
import json
import os
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

import envfile  # noqa: E402
import guard  # noqa: E402
from golden import cues  # noqa: E402

DEFINITIONS_PATH = HERE / "definitions.json"
SOURCES_PATH = HERE / "synthetic_sources.json"
REJECTIONS_PATH = HERE / "last_rejections.json"

# (system prompt, user prompt, temperature) -> parsed JSON object
Llm = Callable[[str, str, float], dict]

LEVELS = (0.0, 0.5, 1.0)
RELATIONS = ("supports", "contradicts", "says_nothing")
DOC_TYPES = (
    "SaaS subscription agreement", "consulting services agreement", "software licence agreement",
    "equipment lease", "data-sharing agreement", "distribution agreement",
)
TOPICS = (
    "automatic renewal notice", "liability caps", "termination for convenience", "personal data handling",
    "indemnification", "governing law", "payment terms", "confidentiality",
)
MIN_CHARS, MAX_CHARS = 80, 2500
# Words that would leak the answer key into the text or the scale into the scenario.
LEAKS = re.compile(r"\b(risk score|risk level|ratings?|the spec|scale|level [012]|golden|evaluator)\b", re.IGNORECASE)


def load_definitions() -> dict:
    return json.loads(DEFINITIONS_PATH.read_text())


def _key(obj) -> str:
    return json.dumps(obj, sort_keys=True)


def record_id(kind: str, spec: dict, variant: str) -> str:
    return f"syn-{kind}-" + hashlib.sha1(_key([spec, variant]).encode()).hexdigest()[:8]


# ---- specs ---------------------------------------------------------------------------------------


def candidate_specs(kind: str, defs: dict) -> list[tuple[dict, str]]:
    """Every (spec, variant) this kind can produce. `variant` is the scenario (document type or topic)."""
    if kind == "risk":
        ids = list(defs["risk"])
        combos = [dict(zip(ids, lv)) for lv in itertools.product(LEVELS, repeat=len(ids))]
        # An all-middle spec has no wrong direction to invert into, so it cannot yield a clear failing case.
        combos = [c for c in combos if any(v != 0.5 for v in c.values())]
        return [(c, d) for c in combos for d in DOC_TYPES]
    if kind == "compliance":
        ids = list(defs["compliance"])
        combos = [dict(zip(ids, flags)) for flags in itertools.product((False, True), repeat=len(ids))]
        return [(c, d) for c in combos for d in DOC_TYPES]
    if kind == "citation":
        return [({"relation": r}, t) for r in RELATIONS for t in TOPICS]
    raise ValueError(f"unknown kind {kind}")


def sample_specs(kind: str, n: int, seed: int, defs: dict, exclude: set[str] = frozenset()) -> list[tuple[dict, str]]:
    """A reproducible sample, skipping ids already generated so re-running with a new seed adds new cases."""
    pool = [c for c in candidate_specs(kind, defs) if record_id(kind, *c) not in exclude]
    random.Random(seed).shuffle(pool)
    return pool[:n]


# ---- prompts -------------------------------------------------------------------------------------

DRAFTER_SYSTEM = (
    "You are an experienced commercial contract drafter producing realistic test fixtures. "
    "Reply with a single JSON object and nothing else."
)
LABELER_SYSTEM = (
    "You are a meticulous contracts analyst. You are shown only a text and must classify it strictly by what it "
    "says, never by what it might be expected to say. Reply with a single JSON object and nothing else."
)


def drafter_prompt(kind: str, spec: dict, variant: str, defs: dict) -> tuple[str, str]:
    if kind == "risk":
        lines = [
            f"{i}. {defs['risk'][dim]['label'].upper()}: {defs['risk'][dim]['levels'][LEVELS.index(level)]}"
            for i, (dim, level) in enumerate(spec.items(), 1)
        ]
        user = (
            f"Draft a {variant} excerpt of 180-260 words as numbered clauses. It must contain exactly these provisions "
            "and nothing else that bears on liability, indemnification or termination:\n" + "\n".join(lines) + "\n\n"
            'Use realistic legal language with specific figures and party names where natural. Never mention risk, '
            'ratings, levels, scales or these instructions. Return {"text": "<the excerpt>"}.'
        )
    elif kind == "compliance":
        lines = []
        for i, (cid, present) in enumerate(spec.items(), 1):
            d = defs["compliance"][cid]
            stance = "MUST exhibit" if present else "must NOT exhibit (it handles this properly, or the situation does not arise)"
            lines.append(f"{i}. The agreement {stance} this problem: {d['definition']}")
        user = (
            f"Draft a {variant} excerpt of 200-300 words as numbered clauses.\n" + "\n".join(lines) + "\n\n"
            "Do not add other clauses that would change any of those answers. Use realistic legal language. Never mention "
            'compliance checks, flags or these instructions. Return {"text": "<the excerpt>"}.'
        )
    else:
        stance = {
            "supports": "clearly states what the claim asserts",
            "contradicts": "states the opposite of what the claim asserts",
            "says_nothing": "is on the same general topic but does not address what the claim asserts",
        }[spec["relation"]]
        user = (
            f"Write a 60-110 word section of an internal contract playbook about {variant}. Start it with a heading such as "
            f'"Section 7.2: <title>." Then write ONE single-sentence claim that someone might make about the playbook, chosen '
            f"so that the section {stance}. Never mention the relation, verdicts or these instructions.\n"
            'Return {"section": "<the section>", "claim": "<the claim>"}.'
        )
    return DRAFTER_SYSTEM, user


def labeler_prompt(kind: str, text: str, defs: dict, claim: str | None = None) -> tuple[str, str]:
    if kind == "risk":
        blocks = [
            f'"{dim}": how {d["label"].lower()} reads. Choose 0, 1 or 2:\n' + "\n".join(f"   {i} = {lv}" for i, lv in enumerate(d["levels"]))
            for dim, d in defs["risk"].items()
        ]
        user = "TEXT:\n" + text + "\n\nClassify the text on each dimension using only what it says.\n" + "\n".join(blocks) + "\nReturn one JSON object mapping each dimension name to 0, 1 or 2."
    elif kind == "compliance":
        blocks = [f'"{cid}": true if the text exhibits this problem, else false. Problem: {d["definition"]}' for cid, d in defs["compliance"].items()]
        user = "TEXT:\n" + text + "\n\nJudge only what this text says; do not assume clauses that are not in it.\n" + "\n".join(blocks) + "\nReturn one JSON object mapping each name to true or false."
    else:
        user = (
            f"SECTION:\n{text}\n\nCLAIM: {claim}\n\nHow does the section relate to the claim? "
            '"supports" (states what the claim asserts), "contradicts" (states the opposite), or "says_nothing" (does not address it). '
            'Return {"relation": "<one of those three>"}.'
        )
    return LABELER_SYSTEM, user


# ---- parsing and checks ---------------------------------------------------------------------------


def parse_labels(kind: str, data: dict, defs: dict) -> dict | None:
    """Normalizes the labeler's answer to the spec's own shape, or None if it is malformed."""
    try:
        if kind == "risk":
            out = {}
            for dim in defs["risk"]:
                v = data[dim]
                if isinstance(v, bool) or v not in (0, 1, 2):
                    return None
                out[dim] = v / 2
            return out
        if kind == "compliance":
            out = {cid: data[cid] for cid in defs["compliance"]}
            return out if all(isinstance(v, bool) for v in out.values()) else None
        return {"relation": data["relation"]} if data["relation"] in RELATIONS else None
    except (KeyError, TypeError):
        return None


def text_problems(text: str) -> list[str]:
    """Reasons a drafted text is unusable as a fixture (empty, out of range, leaking, or attack-shaped)."""
    problems = []
    if not isinstance(text, str) or not (MIN_CHARS <= len(text) <= MAX_CHARS):
        return [f"length outside {MIN_CHARS}-{MAX_CHARS} characters"]
    problems += [f"leaks the phrase '{m.group(0)}'" for m in LEAKS.finditer(text)][:3]
    if guard.scan(text):
        problems.append("trips the injection guard (LLM-authored fixtures must be clean)")
    return problems


def extract_quote(section: str) -> str | None:
    """A deterministic verbatim quote: the first full sentence after the heading. Verified to be in the section."""
    body = section.split("\n", 1)[1] if "\n" in section else section
    for sentence in body.replace("\n", " ").split(". "):
        sentence = sentence.strip()
        if len(sentence) >= 40:
            quote = sentence if sentence.endswith(".") else sentence + "."
            return quote if quote in section.replace("\n", " ") else None
    return None


# ---- pipeline ------------------------------------------------------------------------------------


def generate_one(kind: str, spec: dict, variant: str, defs: dict, draft: Llm, label: Llm, models: tuple[str, str]) -> dict:
    """Returns {'record': ...} on success or {'rejected': reason, 'id': ...}."""
    rid = record_id(kind, spec, variant)

    def reject(reason: str) -> dict:
        return {"id": rid, "kind": kind, "variant": variant, "rejected": reason}

    system, user = drafter_prompt(kind, spec, variant, defs)
    try:
        drafted = draft(system, user, 0.7)
    except Exception as exc:  # noqa: BLE001 - a provider error rejects one case, not the run
        return reject(f"drafter call failed: {type(exc).__name__}: {exc}")

    full_spec = dict(spec)
    if kind == "citation":
        text, claim = drafted.get("section", ""), drafted.get("claim", "")
        if not isinstance(claim, str) or not claim.strip():
            return reject("no claim returned")
        quote = extract_quote(text) if isinstance(text, str) else None
        if not quote:
            return reject("no verbatim quote could be extracted")
        full_spec.update(claim=claim.strip(), quote=quote, sectionId=rid.replace("syn-citation-", "S-"))
    else:
        text, claim = drafted.get("text", ""), None

    if problems := text_problems(text):
        return reject("; ".join(problems))
    if claim is not None and (problems := text_problems(claim + " " * MIN_CHARS)):  # claim is short by design; pad past the length floor
        return reject("claim " + "; ".join(problems))

    # Rule-based check first: it is free, and it has no LLM blind spots in common with the drafter or labeler.
    if kind == "citation":
        rule_hits = cues.contradictions(kind, full_spec, text)
    else:
        rule_hits = cues.contradictions(kind, spec, text)
    if rule_hits:
        return reject("rule-based check contradicts the spec: " + "; ".join(rule_hits))

    system, user = labeler_prompt(kind, text, defs, claim)
    try:
        labels = parse_labels(kind, label(system, user, 0.0), defs)
    except Exception as exc:  # noqa: BLE001
        return reject(f"labeler call failed: {type(exc).__name__}: {exc}")
    if labels is None:
        return reject("labeler returned a malformed answer")
    expected = {"relation": spec["relation"]} if kind == "citation" else spec
    if labels != expected:
        return reject(f"labeler disagreed: spec {_key(expected)} vs labeled {_key(labels)}")

    return {
        "record": {
            "id": rid, "kind": kind, "source": text, "spec": full_spec, "reviewed": False,
            "provenance": {"generator_model": models[0], "labeler_model": models[1], "labeler_agrees": True,
                           "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        }
    }


def load_sources(path: Path | None = None) -> list[dict]:
    path = path or SOURCES_PATH  # resolved per call, so tests and callers can redirect the module path
    return json.loads(path.read_text()) if path.is_file() else []


def save_sources(records: list[dict], path: Path | None = None) -> None:
    path = path or SOURCES_PATH
    path.write_text(json.dumps(sorted(records, key=lambda r: r["id"]), indent=2) + "\n")


def approve(records: list[dict], ids: list[str] | None) -> tuple[list[dict], list[str]]:
    """Marks records reviewed. `ids=None` approves every pending record (an explicit, deliberate bulk act)."""
    approved = []
    for r in records:
        if not r["reviewed"] and (ids is None or r["id"] in ids):
            r["reviewed"] = True
            approved.append(r["id"])
    return records, approved


# ---- CLI -----------------------------------------------------------------------------------------


def check_model_separation(generator: str, labeler: str, judge: str) -> list[str]:
    """Drafter, labeler and the judge under test should be three different models; shared models share blind spots
    (and a judge grading text its own model wrote favors it)."""
    problems = []
    if generator == labeler:
        problems.append(f"drafter and labeler are both {generator}: their agreement cannot catch a shared blind spot")
    if judge in (generator, labeler):
        problems.append(f"the judge under test ({judge}) is also a drafter or labeler: expect self-preference bias")
    return problems


def openai_llm(model: str) -> Llm:
    from openai import OpenAI

    client = OpenAI()

    def call(system: str, user: str, temperature: float) -> dict:
        r = client.chat.completions.create(
            model=model, temperature=temperature, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return json.loads(r.choices[0].message.content)

    return call


def cmd_generate(args) -> int:
    defs = load_definitions()
    records = load_sources()
    specs = sample_specs(args.kind, args.n, args.seed, defs, exclude={r["id"] for r in records})
    if args.dry_run:
        for spec, variant in specs:
            print(record_id(args.kind, spec, variant), variant, _key(spec))
        print(f"\n{len(specs)} cases planned; each needs 1 drafter + 1 labeler call.")
        return 0
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set (export it, or put it in eval-service/.env); generation needs a real LLM.", file=sys.stderr)
        return 2
    gen_model = os.environ.get("EVAL_GENERATOR_MODEL", "gpt-4o")
    label_model = os.environ.get("EVAL_LABELER_MODEL", "gpt-4.1")
    judge_model = os.environ.get("EVAL_JUDGE_MODEL", "gpt-4o-mini")
    if problems := check_model_separation(gen_model, label_model, judge_model):
        for p in problems:
            print(("warning: " if args.allow_same_model else "error: ") + p, file=sys.stderr)
        if not args.allow_same_model:
            print("Set EVAL_GENERATOR_MODEL / EVAL_LABELER_MODEL / EVAL_JUDGE_MODEL to three different models, or pass --allow-same-model.", file=sys.stderr)
            return 2
    print(f"Generating {len(specs)} {args.kind} case(s); drafter={gen_model} labeler={label_model}")
    draft, label = openai_llm(gen_model), openai_llm(label_model)
    kept, rejected = [], []
    for spec, variant in specs:
        out = generate_one(args.kind, spec, variant, defs, draft, label, (gen_model, label_model))
        (kept if "record" in out else rejected).append(out.get("record") or out)
        print("  " + (f"kept     {out['record']['id']}" if "record" in out else f"rejected {out['id']}: {out['rejected']}"), flush=True)
    save_sources(records + kept)
    REJECTIONS_PATH.write_text(json.dumps(rejected, indent=2) + "\n")
    print(f"\nkept {len(kept)} (pending review), rejected {len(rejected)} (see {REJECTIONS_PATH.name}).")
    print("Next: python golden/synth.py review")
    return 0


def cmd_review(_args) -> int:
    pending = [r for r in load_sources() if not r["reviewed"]]
    for r in pending:
        print("=" * 78)
        print(f"{r['id']}  ({r['kind']})   spec: {_key(r['spec'])}")
        print("-" * 78)
        print(r["source"])
    print(f"\n{len(pending)} pending. Read each: does the text really realize its spec? Then approve by id.")
    return 0


def cmd_approve(args) -> int:
    if not args.ids and not args.all:
        print("Name the ids to approve (from `review`), or pass --all to approve every pending case.", file=sys.stderr)
        return 2
    records, approved = approve(load_sources(), None if args.all else args.ids)
    save_sources(records)
    print(f"approved {len(approved)}: {', '.join(approved) or 'none'}")
    if approved:
        print("Now: UPDATE_GOLDEN=1 npx vitest run src/lib/eval/golden.test.ts")
    return 0


def main_cli(argv=None) -> int:
    envfile.load_env()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate")
    g.add_argument("--kind", choices=["risk", "compliance", "citation"], required=True)
    g.add_argument("--n", type=int, default=6)
    g.add_argument("--seed", type=int, default=1)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--allow-same-model", action="store_true", help="downgrade the three-distinct-models rule to a warning")
    g.set_defaults(fn=cmd_generate)
    sub.add_parser("review").set_defaults(fn=cmd_review)
    a = sub.add_parser("approve")
    a.add_argument("ids", nargs="*")
    a.add_argument("--all", action="store_true")
    a.set_defaults(fn=cmd_approve)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main_cli())
