import math
import threading
import time


class FixedWindowRateLimiter:
    """Small in-process guard for the single-worker Render service.

    Cloudflare remains the distributed rate-limit layer. This limiter bounds
    authenticated admin traffic if the Render origin is reached directly.
    """

    def __init__(self) -> None:
        self._entries: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    def retry_after(self, key: str, limit: int, window_seconds: int = 60) -> int | None:
        now = time.monotonic()
        with self._lock:
            started, count = self._entries.get(key, (now, 0))
            if now - started >= window_seconds:
                started, count = now, 0
            count += 1
            self._entries[key] = (started, count)
            if len(self._entries) > 10_000:
                self._entries = {
                    entry_key: entry
                    for entry_key, entry in self._entries.items()
                    if now - entry[0] < window_seconds
                }
            if count <= limit:
                return None
            return max(1, math.ceil(window_seconds - (now - started)))


admin_rate_limiter = FixedWindowRateLimiter()
# Separate instances: pruning uses the caller's window, so keys with different windows
# must not share one.
contact_client_rate_limiter = FixedWindowRateLimiter()
contact_global_rate_limiter = FixedWindowRateLimiter()
