// Standalone cron-only Worker: wakes the Render Free backend on a schedule.
// Read-only GET to a DB-free liveness endpoint; no credentials, no retries.
// ponytail: no fetch handler and workers_dev disabled, so it has no public URL.

// Only these response headers are logged for a failed ping (never cookies, auth, or the body).
export const SAFE_HEADERS = ["server", "rndr-id", "x-render-origin-server", "retry-after", "cf-ray", "content-type"];
const ALERT_TIMEOUT_MS = 5000;

export function classify(status) {
  if (status >= 200 && status <= 299) return "ok";
  if (status === 429) return "http_429";
  if (status >= 500 && status <= 599) return "http_5xx";
  if (status >= 400 && status <= 499) return "http_4xx";
  return "http_other";
}

// Evidence only, never a verdict: x-render-origin-server is set when the app (uvicorn) answered.
// Its absence proves nothing, so it stays "unknown"; "confirmed" needs Render request logs.
function responder(headers) {
  return headers["x-render-origin-server"]
    ? { source: "origin_app", confidence: "probable" }
    : { source: "unknown", confidence: "unknown" };
}

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
    entry.outcome = classify(res.status);
    if (entry.outcome !== "ok") {
      entry.headers = Object.fromEntries(
        SAFE_HEADERS.filter((h) => res.headers.has(h)).map((h) => [h, res.headers.get(h)]),
      );
      Object.assign(entry, responder(entry.headers));
    }
  } catch (err) {
    entry.status = null;
    entry.outcome = err?.name === "TimeoutError" ? "timeout" : "network_error";
    entry.error = String(err?.name ?? "Error");
  }
  entry.durationMs = Date.now() - started;
  return entry;
}

// One attempt, short timeout, no retry; never throws. The webhook URL is a secret and is never logged.
export async function notify(webhookUrl, entry, fetchImpl = fetch) {
  if (!webhookUrl) return "disabled";
  const text = `render-keepalive FAILED: ${entry.outcome} status=${entry.status} at ${entry.ts} (${entry.durationMs} ms)`;
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, text }), // Discord reads content, Slack reads text
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok ? "sent" : `failed_http_${res.status}`;
  } catch (err) {
    return `failed_${String(err?.name ?? "Error")}`;
  }
}

export default {
  async scheduled(controller, env) {
    const entry = await ping(env.TARGET_URL, Number(env.TIMEOUT_MS));
    entry.cron = controller.cron;
    if (entry.outcome === "ok") {
      console.log(JSON.stringify(entry));
      return;
    }
    entry.alert = env.ALERT_WEBHOOK_URL ? "pending" : "disabled";
    console.error(JSON.stringify(entry)); // diagnostic log first, independent of the webhook
    if (entry.alert === "pending") {
      console.error(JSON.stringify({ ts: entry.ts, alert: await notify(env.ALERT_WEBHOOK_URL, entry) }));
    }
    // Fail the invocation after logging so Cron Events / Metrics show the failed health check.
    throw new Error(`keepalive ${entry.outcome} status=${entry.status}`);
  },
};
