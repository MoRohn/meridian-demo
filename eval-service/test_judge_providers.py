"""The judge can be OpenAI (the default), Claude or Gemini, chosen per request from Meridian's Settings."""

import logging
import os

import pytest
from fastapi.testclient import TestClient

import judge
import judge_errors
import main
from test_main import VALID, StubGEval

CLAUDE_KEY = "sk-ant-api03-" + "a" * 40
GEMINI_KEY = "AIza" + "b" * 35
OPENAI_KEY = "sk-proj-" + "c" * 40


@pytest.fixture(autouse=True)
def _stub(monkeypatch):
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(judge, "GEval", StubGEval)
    StubGEval.score, StubGEval.reason, StubGEval.raises = 0.8, "Grounded in the clause.", None


client = TestClient(main.app)


def post(provider=None, model=None, key=None):
    headers = {}
    if provider:
        headers["X-Judge-Provider"] = provider
    if model:
        headers["X-Judge-Model"] = model
    if key:
        headers["X-Judge-Api-Key"] = key
    return client.post("/evaluate", json=VALID, headers=headers)


def used_model():
    return StubGEval.last_kwargs["model"]


def test_the_default_judge_is_still_openai_with_the_saved_key():
    r = post(key=OPENAI_KEY)
    assert r.status_code == 200
    assert r.json()["judge_model"] == judge.JUDGE_MODEL
    assert type(used_model()).__name__ == "OpenAIModel"


def test_a_different_openai_model_can_be_chosen():
    r = post(provider="openai", model="gpt-4o", key=OPENAI_KEY)
    assert r.json()["judge_model"] == "gpt-4o"


def test_claude_judges_with_its_own_key_and_the_response_names_the_model_that_judged():
    r = post(provider="anthropic", model="claude-haiku-4-5-20251001", key=CLAUDE_KEY)
    assert r.status_code == 200
    assert r.json()["judge_model"] == "claude-haiku-4-5-20251001"
    assert type(used_model()).__name__ == "AnthropicModel"
    assert "claude-haiku-4-5-20251001" in used_model().get_model_name()


def test_gemini_judges_with_its_own_key():
    r = post(provider="gemini", model="gemini-2.5-pro", key=GEMINI_KEY)
    assert r.status_code == 200
    assert r.json()["judge_model"] == "gemini-2.5-pro"
    assert type(used_model()).__name__ == "GeminiModel"


def test_each_provider_has_a_default_model_when_none_is_chosen():
    assert post(provider="anthropic", key=CLAUDE_KEY).json()["judge_model"] == judge.DEFAULT_MODELS["anthropic"]
    assert post(provider="gemini", key=GEMINI_KEY).json()["judge_model"] == judge.DEFAULT_MODELS["gemini"]


def test_provider_names_are_case_insensitive():
    assert post(provider="Anthropic", key=CLAUDE_KEY).status_code == 200


def test_a_key_that_arrives_with_a_request_is_never_written_to_the_environment():
    before = dict(os.environ)
    post(provider="anthropic", key=CLAUDE_KEY)
    post(provider="gemini", key=GEMINI_KEY)
    assert dict(os.environ) == before


@pytest.mark.parametrize("provider, env, label", [("anthropic", "ANTHROPIC_API_KEY", "Claude"), ("gemini", "GEMINI_API_KEY", "Gemini"), ("openai", "OPENAI_API_KEY", "OpenAI")])
def test_a_provider_with_no_key_anywhere_is_503_naming_it_and_where_to_put_one(provider, env, label):
    r = post(provider=provider)
    assert r.status_code == 503
    assert label in r.json()["detail"] and env in r.json()["detail"] and "Settings" in r.json()["detail"]


def test_the_services_own_key_is_used_when_the_request_carries_none(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", CLAUDE_KEY)
    assert post(provider="anthropic").status_code == 200
    monkeypatch.setenv("GOOGLE_API_KEY", GEMINI_KEY)  # the alternate name Google's own tools use
    assert post(provider="gemini").status_code == 200


def test_one_providers_key_does_not_stand_in_for_another(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", OPENAI_KEY)
    assert post(provider="anthropic").status_code == 503


@pytest.mark.parametrize("provider", ["grok", "claude", "", "openai; drop", "../x"])
def test_an_unknown_provider_is_rejected(provider):
    r = post(provider=provider or "  ", key=OPENAI_KEY)
    assert r.status_code == 400 and "provider" in r.json()["detail"].lower()


@pytest.mark.parametrize("model", ["gpt 4o", "gpt-4o; rm -rf /", "x" * 101, "a\nb", "-leading", "<script>", "model?x=1"])
def test_a_model_id_that_is_not_shaped_like_one_is_rejected(model):
    r = client.post("/evaluate", json=VALID, headers={"X-Judge-Provider": "openai", "X-Judge-Model": model, "X-Judge-Api-Key": OPENAI_KEY})
    assert r.status_code == 400


@pytest.mark.parametrize("model", ["gpt-4o", "claude-sonnet-5", "gemini-2.5-flash", "claude-haiku-4-5-20251001", "models/gemini-2.5-pro", "ft:gpt-4o:org:name:id"])
def test_ordinary_model_ids_are_accepted(model):
    assert post(provider="openai", model=model, key=OPENAI_KEY).status_code == 200


def test_health_lists_who_can_judge_and_whether_the_service_has_its_own_key(monkeypatch):
    body = client.get("/health").json()
    assert set(body["providers"]) == {"openai", "anthropic", "gemini"}
    assert body["providers"]["anthropic"] == {"default_model": judge.DEFAULT_MODELS["anthropic"], "env_key": False}
    monkeypatch.setenv("ANTHROPIC_API_KEY", CLAUDE_KEY)
    assert client.get("/health").json()["providers"]["anthropic"]["env_key"] is True


def test_a_service_installed_without_a_providers_sdk_says_how_to_add_it(monkeypatch):
    def missing(*_a, **_k):
        raise ImportError("No module named 'anthropic'")

    monkeypatch.setattr(judge, "make_judge_model", missing)
    r = post(provider="anthropic", key=CLAUDE_KEY)
    assert r.status_code == 503 and "Claude SDK" in r.json()["detail"] and "eval-service:setup" in r.json()["detail"]


def test_build_metric_refuses_a_non_openai_judge_with_no_key():
    from rubrics import RUBRICS

    with pytest.raises(ValueError, match="needs an API key"):
        judge.build_metric(RUBRICS["risk"], "typesafe", "claude-sonnet-5", 0.6, api_key=None, provider="anthropic")


# ---- provider errors, in one voice ---------------------------------------------------------------


def http_error(name, code, message="boom"):
    err = type(name, (Exception,), {})(message)
    err.code = code
    return err


@pytest.mark.parametrize("code, expected", [(401, "judge_auth"), (403, "judge_auth"), (404, "judge_model_unavailable"), (429, "judge_rate_limited"), (500, "judge_provider_error"), (503, "judge_provider_error")])
def test_googles_http_status_errors_map_to_the_same_codes(code, expected):
    assert judge_errors.explain(http_error("ClientError" if code < 500 else "ServerError", code))[0] == expected


def test_googles_rejected_key_arrives_as_a_400_and_is_still_an_auth_failure():
    assert judge_errors.explain(http_error("ClientError", 400, "API key not valid. Please pass a valid API key."))[0] == "judge_auth"


def test_an_ordinary_400_is_not_mistaken_for_a_bad_key():
    assert judge_errors.explain(http_error("ClientError", 400, "Invalid argument: contents"))[0] == "judge_error"


def test_anthropics_errors_share_openais_class_names_and_so_the_same_codes():
    for name, code in [("AuthenticationError", "judge_auth"), ("RateLimitError", "judge_rate_limited"), ("NotFoundError", "judge_model_unavailable")]:
        assert judge_errors.explain(type(name, (Exception,), {})("x"))[0] == code


def test_the_auth_message_points_at_settings_not_at_an_openai_variable():
    _, message = judge_errors.explain(type("AuthenticationError", (Exception,), {})("x"))
    assert "Settings" in message and "OPENAI_API_KEY" not in message


# ---- keys never reach text or logs ------------------------------------------------------------


@pytest.mark.parametrize("key", [CLAUDE_KEY, GEMINI_KEY, OPENAI_KEY])
def test_every_providers_key_shape_is_masked_in_error_text(key):
    assert key not in judge_errors.redact(f"request failed for key {key} at host")
    assert key[:14] not in judge_errors.redact(f"Incorrect API key provided: {key}")


def test_a_claude_key_echoed_by_the_provider_does_not_reach_the_logs(caplog):
    caplog.set_level(logging.INFO)
    judge_errors.install_log_redaction()
    logging.getLogger("deepeval.retry").warning("anthropic said: invalid x-api-key %s", CLAUDE_KEY)
    assert CLAUDE_KEY not in caplog.text


def test_a_failing_claude_judge_reports_a_code_without_the_key():
    StubGEval.raises = Exception(f"boom {CLAUDE_KEY}")
    r = post(provider="anthropic", key=CLAUDE_KEY)
    assert r.status_code == 502 and CLAUDE_KEY not in r.text
