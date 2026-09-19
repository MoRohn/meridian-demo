"""
The rule-based verifier, validated on REAL human-written contracts (the app's sample contracts) whose true answers
are known: it must stay silent on the truthful spec and fire on the inverted one. Passing on hand-made strings would
prove little; these texts were not written to please the rules.
"""

import json
from pathlib import Path

import pytest

from golden import cues

T = json.loads((Path(__file__).parent / "golden" / "sample_contract_texts.json").read_text())
DIMS = ("liability_exposure", "indemnification_harshness", "termination_rigidity")
CHECKS = ("auto_renewal_trap", "unlimited_liability", "missing_data_protection_clause", "missing_governing_law")


def risk(l, i, t):
    return dict(zip(DIMS, (l, i, t)))


def comp(*flags):
    return dict(zip(CHECKS, flags))


# (contract, true risk spec, true compliance spec)
TRUTH = {
    "saas-msa-onesided": (risk(1, 1, 1), comp(True, True, True, True)),
    "mutual-nda": (risk(0, 0, 0), comp(False, False, False, False)),
    "employment-noncompete": (risk(1, 1, 0.5), comp(False, True, True, True)),
}


@pytest.mark.parametrize("cid", TRUTH)
def test_silent_on_the_truthful_spec_of_every_real_contract(cid):
    r, c = TRUTH[cid]
    assert cues.contradictions("risk", r, T[cid]) == []
    assert cues.contradictions("compliance", c, T[cid]) == []


def test_fires_on_every_dimension_when_a_real_contract_is_specced_backwards():
    saas = cues.contradictions("risk", risk(0, 0, 0), T["saas-msa-onesided"])
    assert len(saas) == 3 and any("unlimited" in m for m in saas) and any("no-fault" in m for m in saas) and any("fee" in m for m in saas)
    nda = cues.contradictions("risk", risk(1, 1, 1), T["mutual-nda"])
    assert len(nda) == 3


@pytest.mark.parametrize("cid,flipped", [
    ("saas-msa-onesided", comp(False, False, False, False)),
    ("mutual-nda", comp(True, True, True, True)),
    ("employment-noncompete", comp(True, False, False, False)),
])
def test_fires_on_every_check_when_a_real_contract_is_flagged_backwards(cid, flipped):
    assert len(cues.contradictions("compliance", flipped, T[cid])) >= 3


@pytest.mark.parametrize("phrase", ["does not automatically renew", "shall not renew automatically", "will never auto-renew", "no automatic renewal applies"])
def test_a_negated_renewal_is_not_treated_as_a_renewal(phrase):
    text = f"1. Term. This Agreement {phrase}. 2. Law. Governed by the laws of the State of Delaware."
    assert not any("auto-renewal" in m for m in cues.contradictions("compliance", comp(False, True, False, False), text) if "renews" in m)


def test_renewal_with_a_real_notice_window_is_fine_but_without_one_is_a_trap():
    ok = "This Agreement automatically renews unless either party gives at least sixty (60) days written notice before renewal."
    trap = "This Agreement automatically renews each year unless a party gives notice."
    assert not any("renews" in m for m in cues.contradictions("compliance", comp(False, True, False, True), ok))
    assert any("no notice window" in m for m in cues.contradictions("compliance", comp(False, True, False, True), trap))


def test_the_rules_never_fire_on_mere_absence_of_evidence_for_risk_levels():
    silent = "1. Services. Provider shall perform the services described in each Order Form."
    for level in (0, 0.5, 1):
        assert cues.contradictions("risk", risk(level, level, level), silent) == []


def test_citation_rule_is_stem_based_and_only_fires_on_zero_shared_vocabulary():
    section = "Section 7.2: Notice. Any agreement that auto-renews must give thirty days written notice before renewal."
    assert cues.contradictions("citation", {"relation": "supports", "claim": "Auto-renewing contracts need an opt-out window."}, section) == []
    assert cues.contradictions("citation", {"relation": "supports", "claim": "Payments must be made in euros."}, section)
    assert cues.contradictions("citation", {"relation": "contradicts", "claim": "Payments must be made in euros."}, section) == []
