import math
import threading
import time


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


admin_rate_limiter = FixedWindowRateLimiter()
# Separate instances: pruning uses the caller's window, so keys with different windows
# must not share one.
contact_client_rate_limiter = FixedWindowRateLimiter()
contact_global_rate_limiter = FixedWindowRateLimiter()
