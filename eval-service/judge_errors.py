"""
Turns the judge provider's failures into one stable code and one sentence a reader can act on.

DeepEval wraps provider errors in tenacity's RetryError, whose repr is "RetryError[<Future at 0x... state=finished
raised RateLimitError>]", which is no use in a UI, and forwards some provider messages verbatim (an auth error can echo
a masked key). Mapping by exception class NAME keeps this independent of which SDK version raised it.
"""

import collections
import contextlib
import logging
import re
import threading

# Anything shaped like a provider key, or an Authorization header value, is masked in text that may reach a reader.
# OpenAI and Anthropic keys start "sk-" (Anthropic's "sk-ant-"), Google's start "AIza".
_KEY_SHAPED = re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9_\-*]{4,}|\bAIza[0-9A-Za-z_\-]{16,}|Bearer\s+\S+", re.IGNORECASE)


# Keys currently in flight. Counted, because two concurrent requests may carry the same key.
_in_flight: collections.Counter[str] = collections.Counter()
_lock = threading.Lock()


@contextlib.contextmanager
def holding(secret: str | None):
    """While a request that carries `secret` is being served, every log line and error text has it masked."""
    if not secret:
        yield
        return
    with _lock:
        _in_flight[secret] += 1
    try:
        yield
    finally:
        with _lock:
            _in_flight[secret] -= 1
            if _in_flight[secret] <= 0:
                del _in_flight[secret]


def redact(text: str, secrets: tuple[str, ...] = ()) -> str:
    """Masks the exact secrets in use and anything key-shaped. Provider errors sometimes echo the key that was sent."""
    with _lock:
        active = tuple(_in_flight)
    for secret in (*secrets, *active):
        if secret:
            text = text.replace(secret, "[redacted]")
    return _KEY_SHAPED.sub("[redacted]", text)


MESSAGES: dict[str, tuple[str, str]] = {
    "RateLimitError": ("judge_rate_limited", "The judge model is rate limited. Wait a few seconds and try again."),
    "AuthenticationError": ("judge_auth", "The judge API key was rejected. Check the judge key saved in Meridian's Settings."),
    "PermissionDeniedError": ("judge_auth", "The judge API key was rejected. Check the judge key saved in Meridian's Settings."),
    "NotFoundError": ("judge_model_unavailable", "The judge model isn't available to this API key. Pick another judge model in Meridian's Settings."),
    "APIConnectionError": ("judge_unreachable", "Couldn't reach the judge model. Check the network and try again."),
    "APITimeoutError": ("judge_unreachable", "The judge model didn't answer in time. Try again."),
    "InternalServerError": ("judge_provider_error", "The judge provider returned an error. Try again shortly."),
    "ServiceUnavailableError": ("judge_provider_error", "The judge provider is unavailable. Try again shortly."),
}


def unwrap(exc: BaseException) -> BaseException:
    """Follows tenacity's RetryError (and chained causes) down to the error that actually happened."""
    for _ in range(5):
        attempt = getattr(exc, "last_attempt", None)
        inner = attempt.exception() if attempt is not None and hasattr(attempt, "exception") else None
        if inner is None:
            break
        exc = inner
    return exc


def _by_http_status(status: int) -> tuple[str, str] | None:
    """The same codes for a provider whose SDK reports a bare HTTP status (Google's ClientError and ServerError do)."""
    if status in (401, 403):
        return MESSAGES["AuthenticationError"]
    if status == 404:
        return MESSAGES["NotFoundError"]
    if status == 429:
        return MESSAGES["RateLimitError"]
    if status >= 500:
        return MESSAGES["InternalServerError"]
    return None


def explain(exc: BaseException, secrets: tuple[str, ...] = ()) -> tuple[str, str]:
    """(stable code, reader-facing message). `secrets` are masked wherever provider text is included."""
    inner = unwrap(exc)
    for cls in type(inner).__mro__:
        if cls.__name__ in MESSAGES:
            return MESSAGES[cls.__name__]
    status = getattr(inner, "code", None)
    if type(inner).__name__ in ("ClientError", "ServerError") and isinstance(status, int):
        mapped = _by_http_status(status)
        if mapped:
            return mapped
        # Google reports a rejected key as 400 "API key not valid", not 401.
        if "api key" in str(inner).lower() and ("not valid" in str(inner).lower() or "invalid" in str(inner).lower()):
            return MESSAGES["AuthenticationError"]
    if isinstance(inner, ValueError) and "invalid json" in str(inner).lower():
        return ("judge_bad_output", "The judge model returned an answer that couldn't be parsed. A stronger EVAL_JUDGE_MODEL usually fixes this.")
    return ("judge_error", redact(f"{type(inner).__name__}: {str(inner)[:200]}", secrets))


def install_log_redaction() -> None:
    """
    Redacts every log record, from every logger, at creation. Third-party loggers (DeepEval's retry policy logs the
    provider's error text, which can echo the key) are outside this code's control, so the only reliable place to stop a
    key reaching a log is the record factory itself.
    """
    factory = logging.getLogRecordFactory()
    if getattr(factory, "_meridian_redacting", False):
        return

    def redacting_factory(*args, **kwargs):
        record = factory(*args, **kwargs)
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - never let logging itself raise
            return record
        cleaned = redact(message)
        if cleaned != message:
            record.msg, record.args = cleaned, ()
        return record

    redacting_factory._meridian_redacting = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(redacting_factory)
