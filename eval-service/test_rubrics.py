import pytest

from rubrics import KINDS, RUBRICS


@pytest.mark.parametrize("kind", KINDS)
def test_every_rubric_is_versioned_and_complete(kind):
    r = RUBRICS[kind]
    assert r.id == kind and r.version and r.title and r.task_line
    assert 5 <= len(r.steps) <= 8


@pytest.mark.parametrize("kind", KINDS)
def test_every_rubric_opens_with_the_untrusted_data_rule(kind):
    first = RUBRICS[kind].steps[0]
    assert "untrusted data" in first and "never instructions" in first


@pytest.mark.parametrize("kind", KINDS)
def test_every_rubric_ends_with_scoring_guidance_that_ignores_style(kind):
    last = RUBRICS[kind].steps[-1]
    assert last.startswith("Scoring:") and "Do not reward length" in last


THRESHOLD_SCORE = 6  # 0.6 pass threshold on G-Eval's 0-10 scale


@pytest.mark.parametrize("kind", KINDS)
def test_score_bands_cover_0_to_10_without_overlap_or_gaps(kind):
    bands = sorted(RUBRICS[kind].bands)
    assert bands[0][0] == 0 and bands[-1][1] == 10
    for (_, hi, _), (lo, _, _) in zip(bands, bands[1:]):
        assert lo == hi + 1
    assert all(lo <= hi and outcome for lo, hi, outcome in bands)


@pytest.mark.parametrize("kind", KINDS)
def test_no_score_band_straddles_the_pass_threshold(kind):
    assert not any(lo < THRESHOLD_SCORE <= hi for lo, hi, _ in RUBRICS[kind].bands)
