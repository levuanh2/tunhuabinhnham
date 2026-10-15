import math
import threading
import time
from typing import Literal


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
        now = time.monotonic()
        with self._lock:
            if key not in self._entries and len(self._entries) >= self._max_keys:
                # Memory is bounded: while full of live windows, new keys are refused, in O(1)
                # until the oldest window can have expired, then one prune.
                if now < self._full_until:
                    return max(1, math.ceil(self._full_until - now))
                self._entries = {
                    entry_key: entry
                    for entry_key, entry in self._entries.items()
                    if now - entry[0] < window_seconds
                }
                if len(self._entries) >= self._max_keys:
                    oldest = min(started for started, _ in self._entries.values())
                    self._full_until = oldest + window_seconds
                    return max(1, math.ceil(self._full_until - now))
            started, count = self._entries.get(key, (now, 0))
            if now - started >= window_seconds:
                started, count = now, 0
            count += 1
            self._entries[key] = (started, count)
            if count <= limit:
                return None
            return max(1, math.ceil(window_seconds - (now - started)))

    def release(self, key: str) -> None:
        """Give back one use taken by retry_after for a request that was not served."""
        # ponytail: if the window rolled over meanwhile, the new window is credited instead
        # (at most one extra use per refused request); tracking the window start would fix it.
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry[1] > 0:
                self._entries[key] = (entry[0], entry[1] - 1)


admin_rate_limiter = FixedWindowRateLimiter()
# Separate instances: pruning uses the caller's window, so keys with different windows
# must not share one.
contact_client_rate_limiter = FixedWindowRateLimiter()  # requests per visitor per minute
contact_client_hourly_rate_limiter = FixedWindowRateLimiter()  # stored clicks per visitor
contact_repeat_rate_limiter = FixedWindowRateLimiter()  # the same click, once per few seconds
contact_global_rate_limiter = FixedWindowRateLimiter()  # stored clicks, whole site


def take_contact_quota(
    client: str, click: str, *, per_hour: int, global_per_hour: int, repeat_seconds: int
) -> int | Literal["repeat"] | None:
    """Reserve what storing one contact click uses: None = store it, "repeat" = the same click
    was just stored (keep nothing), a number = Retry-After seconds.

    Only a click that will be stored takes from the per-visitor hourly cap and the site-wide
    cap, so one visitor gets at most per_hour of the global quota and refused or repeated
    requests use none of it. Each step is atomic; a refused later step gives the earlier ones
    back. Call release_contact_quota if storing then fails.
    """
    if contact_repeat_rate_limiter.retry_after(click, 1, max(repeat_seconds, 1)) is not None:
        return "repeat"
    retry = contact_client_hourly_rate_limiter.retry_after(client, per_hour, 3600)
    if retry is None:
        retry = contact_global_rate_limiter.retry_after("global", global_per_hour, 3600)
        if retry is not None:
            contact_client_hourly_rate_limiter.release(client)
    if retry is not None:
        contact_repeat_rate_limiter.release(click)
    return retry


def release_contact_quota(client: str, click: str) -> None:
    contact_repeat_rate_limiter.release(click)
    contact_client_hourly_rate_limiter.release(client)
    contact_global_rate_limiter.release("global")
