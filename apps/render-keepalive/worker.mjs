// Standalone cron-only Worker: wakes the Render Free backend on a schedule.
// Read-only GET to a DB-free liveness endpoint; no credentials, no retries.
// ponytail: no fetch handler and workers_dev disabled, so it has no public URL.

export async function ping(url, timeoutMs, fetchImpl = fetch) {
  const started = Date.now();
  const entry = { ts: new Date(started).toISOString(), target: url };
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "user-agent": "tunhuabinhnham-render-keepalive" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    entry.status = res.status;
    entry.outcome = res.ok ? "ok" : res.status >= 500 ? "http_5xx" : "http_other";
  } catch (err) {
    entry.status = null;
    entry.outcome = err?.name === "TimeoutError" ? "timeout" : "network_error";
    entry.error = String(err?.name ?? "Error");
  }
  entry.durationMs = Date.now() - started;
  return entry;
}

export default {
  async scheduled(controller, env) {
    const entry = await ping(env.TARGET_URL, Number(env.TIMEOUT_MS));
    entry.cron = controller.cron;
    (entry.outcome === "ok" ? console.log : console.error)(JSON.stringify(entry));
  },
};
