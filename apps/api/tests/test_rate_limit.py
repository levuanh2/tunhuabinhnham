from app.core.rate_limit import FixedWindowRateLimiter


def test_fixed_window_rate_limiter_returns_retry_after() -> None:
    limiter = FixedWindowRateLimiter()
    assert limiter.retry_after("admin", limit=2) is None
    assert limiter.retry_after("admin", limit=2) is None
    retry_after = limiter.retry_after("admin", limit=2)
    assert retry_after is not None
    assert 1 <= retry_after <= 60
