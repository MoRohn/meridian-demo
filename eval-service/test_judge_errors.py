from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import judge
import judge_errors
import main
from test_main import VALID, StubGEval


class RetryError(Exception):
    """Stands in for tenacity.RetryError: carries the real failure in last_attempt."""
    def __init__(self, inner):
        self.last_attempt = type("F", (), {"exception": lambda _s: inner})()
        super().__init__(f"RetryError[<Future at 0x1 state=finished raised {type(inner).__name__}>]")


def named(name, msg="boom"):
    return type(name, (Exception,), {})(msg)


@pytest.mark.parametrize("name,code", [
    ("RateLimitError", "judge_rate_limited"), ("AuthenticationError", "judge_auth"), ("PermissionDeniedError", "judge_auth"),
    ("NotFoundError", "judge_model_unavailable"), ("APIConnectionError", "judge_unreachable"), ("APITimeoutError", "judge_unreachable"),
    ("InternalServerError", "judge_provider_error"),
])
def test_provider_errors_map_to_stable_codes_even_when_wrapped_in_a_retry_error(name, code):
    assert judge_errors.explain(named(name))[0] == code
    assert judge_errors.explain(RetryError(named(name)))[0] == code


def test_the_repr_of_a_retry_error_never_reaches_the_reader():
    _, message = judge_errors.explain(RetryError(named("RateLimitError")))
    assert "Future" not in message and "RetryError" not in message and "rate limited" in message


def test_an_auth_error_never_echoes_the_providers_message_which_can_contain_a_key_fragment():
    _, message = judge_errors.explain(named("AuthenticationError", "Incorrect API key provided: sk-proj-****abcd"))
    assert "sk-" not in message


def test_unparseable_judge_output_is_explained_without_deepevals_wording():
    code, message = judge_errors.explain(ValueError("Evaluation LLM outputted an invalid JSON. Please use a better evaluation model."))
    assert code == "judge_bad_output" and "better evaluation model" not in message


def test_unknown_errors_keep_their_type_and_a_bounded_message():
    code, message = judge_errors.explain(KeyError("reason" * 100))
    assert code == "judge_error" and message.startswith("KeyError") and len(message) < 260


# ---- through the HTTP service -------------------------------------------------------------------


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setattr(judge, "GEval", StubGEval)
    StubGEval.raises, StubGEval.score, StubGEval.reason = None, 0.8, "r"
    return TestClient(main.app)


def test_a_rate_limited_judge_returns_502_with_a_readable_message_and_code(client):
    StubGEval.raises = RetryError(named("RateLimitError"))
    r = client.post("/evaluate", json=VALID)
    assert r.status_code == 502
    assert "judge_rate_limited" in r.json()["detail"] and "Future" not in r.json()["detail"]


@pytest.mark.parametrize("bad", [99.0, 9.9, -0.1, 1.0000001, float("nan"), float("inf")])
def test_an_out_of_range_score_is_rejected_not_passed(client, bad):
    """Regression: a judge answering 99 produced score=9.9 with success=True."""
    StubGEval.score = bad
    r = client.post("/evaluate", json=VALID)
    assert r.status_code == 502 and "judge_bad_score" in r.json()["detail"]


@pytest.mark.parametrize("edge", [0.0, 1.0, 0.6])
def test_scores_on_the_boundary_of_the_range_are_accepted(client, edge):
    StubGEval.score = edge
    assert client.post("/evaluate", json=VALID).status_code == 200


def test_failures_are_counted_under_their_code_in_stats(client):
    StubGEval.raises = RetryError(named("APIConnectionError"))
    client.post("/evaluate", json=VALID)
    assert client.get("/stats").json()["last_error"] == "judge_unreachable"


def test_every_failure_code_the_service_can_emit_has_a_title_in_the_ui():
    """The UI titles each failure by its code (src/lib/eval/serviceError.ts); a new code without a title would fall back to a generic one."""
    ts = (Path(__file__).parent.parent / "src" / "lib" / "eval" / "serviceError.ts").read_text()
    codes = {code for code, _ in judge_errors.MESSAGES.values()} | {"judge_bad_output", "judge_bad_score"}
    assert [c for c in sorted(codes) if f"{c}:" not in ts] == []


# ---- request-key redaction machinery ---------------------------------------------------------


def test_a_key_in_flight_is_masked_only_while_its_request_is_being_served():
    key = "plainhexkeywithoutaprefix0123456789"
    assert judge_errors.redact(f"failed: {key}") == f"failed: {key}"  # not key-shaped and not in flight: untouched
    with judge_errors.holding(key):
        assert key not in judge_errors.redact(f"failed: {key}")
    assert judge_errors.redact(f"failed: {key}") == f"failed: {key}"


def test_two_concurrent_requests_with_the_same_key_keep_it_masked_until_both_finish():
    key = "sharedkey_0123456789abcdef"
    with judge_errors.holding(key):
        with judge_errors.holding(key):
            pass
        assert key not in judge_errors.redact(key), "the outer request is still in flight"
    assert key in judge_errors.redact(key)


def test_log_redaction_covers_records_from_any_logger_including_formatted_args(caplog):
    import logging
    judge_errors.install_log_redaction()
    judge_errors.install_log_redaction()  # idempotent
    with caplog.at_level(logging.INFO):
        with judge_errors.holding("customkey_ABCDEFGH12345678"):
            logging.getLogger("some.third.party").info("retrying after %s", "Error: customkey_ABCDEFGH12345678 rejected")
            logging.getLogger("other").warning("Authorization: Bearer sk-abc123def456ghi789")
        logging.getLogger("other").info("ordinary line with %d%% of the text intact", 100)
    assert "customkey_ABCDEFGH12345678" not in caplog.text and "sk-abc123def456ghi789" not in caplog.text
    assert "ordinary line with 100% of the text intact" in caplog.text


def test_a_logging_call_with_bad_format_arguments_does_not_crash_the_service():
    import logging
    judge_errors.install_log_redaction()
    logging.getLogger("x").info("needs %d but got %s", "not-a-number", None)  # logging swallows format errors; ours must too
