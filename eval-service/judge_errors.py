"""
Turns the judge provider's failures into one stable code and one sentence a reader can act on.

DeepEval wraps provider errors in tenacity's RetryError, whose repr is "RetryError[<Future at 0x... state=finished
raised RateLimitError>]", which is no use in a UI, and forwards some provider messages verbatim (an auth error can echo
a masked key). Mapping by exception class NAME keeps this independent of which SDK version raised it.
"""

MESSAGES: dict[str, tuple[str, str]] = {
    "RateLimitError": ("judge_rate_limited", "The judge model is rate limited. Wait a few seconds and try again."),
    "AuthenticationError": ("judge_auth", "The judge API key was rejected. Check OPENAI_API_KEY for the eval service."),
    "PermissionDeniedError": ("judge_auth", "The judge API key was rejected. Check OPENAI_API_KEY for the eval service."),
    "NotFoundError": ("judge_model_unavailable", "The judge model isn't available to this API key. Check EVAL_JUDGE_MODEL."),
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


def explain(exc: BaseException) -> tuple[str, str]:
    """(stable code, reader-facing message)."""
    inner = unwrap(exc)
    for cls in type(inner).__mro__:
        if cls.__name__ in MESSAGES:
            return MESSAGES[cls.__name__]
    if isinstance(inner, ValueError) and "invalid json" in str(inner).lower():
        return ("judge_bad_output", "The judge model returned an answer that couldn't be parsed. A stronger EVAL_JUDGE_MODEL usually fixes this.")
    return ("judge_error", f"{type(inner).__name__}: {str(inner)[:200]}")
