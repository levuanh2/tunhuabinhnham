import math
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager


class FixedWindowRateLimiter:
    """Small in-process guard for the single-worker Render service.

    Cloudflare remains the distributed rate-limit layer. This limiter bounds
    authenticated admin traffic if the Render origin is reached directly.
    State lives in memory: a restart or spin-down resets every counter, and more
    than one worker needs a shared store instead.
    """

    def __init__(self, max_keys: int = 10_000) -> None:
        self._entries: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()
        self._max_keys = max_keys
        self._full_until = 0.0  # while full: no entry can expire before this, skip pruning

    def retry_after(self, key: str, limit: int, window_seconds: int = 60) -> int | None:
        return self.take(key, limit, window_seconds)[0]

    def take(self, key: str, limit: int, window_seconds: int = 60) -> tuple[int | None, float]:
        """(None, window start) when admitted, the start being the token for release();
        (Retry-After seconds, 0.0) when refused."""
        now = time.monotonic()
        with self._lock:
            if key not in self._entries and len(self._entries) >= self._max_keys:
                # Memory is bounded: while full of live windows, new keys are refused, in O(1)
                # until the oldest window can have expired, then one prune.
                if now < self._full_until:
                    return max(1, math.ceil(self._full_until - now)), 0.0
                self._entries = {
                    entry_key: entry
                    for entry_key, entry in self._entries.items()
                    if now - entry[0] < window_seconds
                }
                if len(self._entries) >= self._max_keys:
                    oldest = min(started for started, _ in self._entries.values())
                    self._full_until = oldest + window_seconds
                    return max(1, math.ceil(self._full_until - now)), 0.0
            started, count = self._entries.get(key, (now, 0))
            if now - started >= window_seconds:
                started, count = now, 0
            if count >= limit:
                # Refused: nothing is counted, so a refusal never uses up a later admission.
                return max(1, math.ceil(window_seconds - (now - started))), 0.0
            self._entries[key] = (started, count + 1)
            return None, started

    def release(self, key: str, window_start: float) -> None:
        """Give back one use that take() admitted in the window starting at window_start, for
        a request that was not served. A newer window is never credited."""
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry[0] == window_start and entry[1] > 0:
                self._entries[key] = (entry[0], entry[1] - 1)


admin_rate_limiter = FixedWindowRateLimiter()
# Separate instances: pruning uses the caller's window, so keys with different windows
# must not share one.
contact_client_rate_limiter = FixedWindowRateLimiter()  # requests per visitor per minute
contact_client_hourly_rate_limiter = FixedWindowRateLimiter()  # stored clicks per visitor
contact_repeat_rate_limiter = FixedWindowRateLimiter()  # the same click, once per few seconds
contact_global_rate_limiter = FixedWindowRateLimiter()  # stored clicks, whole site


class ContactClickRepeated(Exception):
    """The same click (visitor, product, button) was just counted."""


class ContactQuotaExceeded(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__(retry_after)
        self.retry_after = retry_after


@contextmanager
def contact_click_quota(
    client: str, click: str, *, per_hour: int, global_per_hour: int, repeat_seconds: int
) -> Iterator[None]:
    """Hold what storing one contact click uses while the block stores it.

    Raises ContactClickRepeated or ContactQuotaExceeded before the block runs. Only a click
    that will be stored takes from the per-visitor hourly cap and the site-wide cap, so one
    visitor gets at most per_hour of the global quota and refused or repeated requests use none
    of it. If a later step is refused, or the block raises (any storage failure), exactly what
    was taken is given back.
    """
    steps = (
        (contact_repeat_rate_limiter, click, 1, max(repeat_seconds, 1)),
        (contact_client_hourly_rate_limiter, client, per_hour, 3600),
        (contact_global_rate_limiter, "global", global_per_hour, 3600),
    )
    taken: list[tuple[FixedWindowRateLimiter, str, float]] = []

    def give_back() -> None:
        for limiter, key, window_start in taken:
            limiter.release(key, window_start)

    for limiter, key, limit, window in steps:
        retry, window_start = limiter.take(key, limit, window)
        if retry is not None:
            give_back()
            if limiter is contact_repeat_rate_limiter:
                raise ContactClickRepeated
            raise ContactQuotaExceeded(retry)
        taken.append((limiter, key, window_start))
    try:
        yield
    except BaseException:
        give_back()
        raise
