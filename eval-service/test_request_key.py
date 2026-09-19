"""
Using an API key that arrives WITH a request (the one saved in Meridian's Settings) as the judge's key.

The key must reach the provider for that one call, win over any environment key, stay isolated between concurrent
requests, and never appear anywhere else: not in responses, stats, health, logs, or error messages (even when the
provider echoes it). Runs the real DeepEval + OpenAI client against a local server that records what it receives.
"""

import json
import logging
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

import main

KEY_A = "sk-test-AAAA1111BBBB2222CCCC3333"
KEY_B = "sk-test-ZZZZ9999YYYY8888XXXX7777"
ENV_KEY = "sk-env-ENVKEY000011112222"
BODY = {"kind": "risk", "backend": "typesafe", "input": "Rate.", "actual_output": "Overall risk: 66%", "context": "1. Liability. Unlimited."}


def _ok():
    toks = ['{"', "score", '":', " ", "8", ",", ' "', "reason", '":', ' "', "r", '"}']
    lp = [{"token": t, "logprob": 0.0, "bytes": None, "top_logprobs": [{"token": t, "logprob": 0.0, "bytes": None}]} for t in toks]
    return {"id": "x", "object": "chat.completion", "created": 0, "model": "gpt-4o-mini",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps({"score": 8, "reason": "r"}), "refusal": None}, "logprobs": {"content": lp, "refusal": None}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}


class Recorder(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers["content-length"])).decode()
        auth = self.headers.get("authorization", "")
        Recorder.seen.append({"auth": auth, "body": json.loads(raw), "raw": raw})
        if "ECHO_KEY" in raw:  # a provider that repeats the caller's key in its error text
            payload, code = {"error": {"message": f"Bad request from {auth}", "type": "invalid_request_error"}}, 500
        elif "AUTH_FAIL" in raw:
            payload, code = {"error": {"message": f"Incorrect API key provided: {auth.replace('Bearer ', '')}", "code": "invalid_api_key"}}, 401
        else:
            payload, code = _ok(), 200
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture()
def upstream(monkeypatch):
    Recorder.seen = []
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Recorder)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("OPENAI_BASE_URL", f"http://127.0.0.1:{srv.server_port}/v1")
    monkeypatch.setenv("OPENAI_API_KEY", ENV_KEY)
    yield Recorder
    srv.shutdown()


client = TestClient(main.app)


def post(key=None, **patch):
    return client.post("/evaluate", json={**BODY, **patch}, headers={"x-judge-api-key": key} if key else {})


def test_a_key_sent_with_the_request_is_the_key_the_provider_receives(upstream):
    assert post(KEY_A).status_code == 200
    assert upstream.seen[-1]["auth"] == f"Bearer {KEY_A}"


def test_the_request_key_wins_over_the_environment_key(upstream):
    post(KEY_A)
    assert ENV_KEY not in upstream.seen[-1]["auth"]


def test_without_a_request_key_the_environment_key_is_still_used(upstream):
    assert post().status_code == 200 and upstream.seen[-1]["auth"] == f"Bearer {ENV_KEY}"


def test_a_request_key_alone_is_enough_when_the_service_has_no_key_of_its_own(upstream, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    assert post(KEY_A).status_code == 200
    assert post().status_code == 503, "and with no key anywhere it still refuses"


def test_the_judge_is_called_the_same_way_with_a_request_key_as_without(upstream):
    post()
    env_body = upstream.seen[-1]["body"]
    post(KEY_A)
    key_body = upstream.seen[-1]["body"]
    for field in ("model", "temperature", "logprobs", "top_logprobs"):
        assert key_body.get(field) == env_body.get(field), field
    assert key_body["temperature"] == 0.0 and key_body["top_logprobs"] == 1


def test_concurrent_requests_with_different_keys_never_see_each_others_key(upstream):
    def one(i):
        key = KEY_A if i % 2 == 0 else KEY_B
        return i, key, client.post("/evaluate", json={**BODY, "actual_output": f"Overall risk: 66% REQ<{i}>"}, headers={"x-judge-api-key": key}).status_code

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(one, range(64)))
    assert all(code == 200 for _, _, code in results)
    for i, key, _ in results:
        matches = [s for s in upstream.seen if f"REQ<{i}>" in s["raw"]]
        assert matches and all(s["auth"] == f"Bearer {key}" for s in matches), f"request {i} carried the wrong key"


def test_the_key_is_not_in_the_response_stats_health_or_logs(upstream, caplog):
    with caplog.at_level(logging.DEBUG):
        r = post(KEY_A)
        stats, health = client.get("/stats").text, client.get("/health").text
    for surface in (r.text, stats, health, caplog.text):
        assert KEY_A not in surface and "AAAA1111BBBB" not in surface


def test_a_provider_that_echoes_the_key_in_its_error_never_gets_it_back_to_the_reader(upstream, caplog):
    with caplog.at_level(logging.DEBUG):
        r = post(KEY_A, actual_output="Overall risk ECHO_KEY")
        stats = client.get("/stats").text
    assert r.status_code == 502
    for surface in (r.text, stats, caplog.text):
        assert KEY_A not in surface and "AAAA1111" not in surface


def test_a_rejected_key_is_reported_without_repeating_it(upstream):
    r = post(KEY_A, actual_output="Overall risk AUTH_FAIL")
    assert r.status_code == 502 and "judge_auth" in r.json()["detail"] and KEY_A not in r.text


@pytest.mark.parametrize("bad", ["short", "sk-" + "a" * 400, "sk-has space inside-1234567890", "sk-café-1234567890123456"])
def test_malformed_keys_are_rejected_without_being_echoed(upstream, bad):
    try:
        r = post(bad)
    except UnicodeEncodeError:  # a non-latin-1 header cannot even be sent; nothing to test beyond that
        return
    assert r.status_code == 400 and bad not in r.text
    assert upstream.seen == [], "a malformed key must never reach the provider"


def test_an_empty_header_is_treated_as_no_key(upstream):
    assert client.post("/evaluate", json=BODY, headers={"x-judge-api-key": ""}).status_code == 200
    assert upstream.seen[-1]["auth"] == f"Bearer {ENV_KEY}"


def test_redaction_also_catches_key_shaped_strings_the_service_was_never_given(upstream):
    """Defence in depth: any provider text containing something key-shaped is masked, not just the key in use."""
    import judge_errors
    assert "sk-proj-ABCDEFGH12345678" not in judge_errors.redact("failed for sk-proj-ABCDEFGH12345678 today")
    assert judge_errors.redact("plain text") == "plain text"
    assert judge_errors.redact("key=sk-live-SECRETSECRET1234", secrets=("SECRETSECRET1234",)).count("SECRETSECRET") == 0
