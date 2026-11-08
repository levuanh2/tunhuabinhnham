// Run: node apps/render-keepalive/check.mjs  (no network)
import assert from "node:assert/strict";
import worker, { ping, notify } from "./worker.mjs";

const TARGET = "https://api.example/health/live";
const HOOK = "https://hooks.example/SECRET-TOKEN-123";
const res = (status, headers = {}, body = "{}") => async () => new Response(status === 204 ? null : body, { status, headers });
const fail = (name) => async () => { throw Object.assign(new Error("x"), { name }); };

// Classification
assert.equal((await ping("u", 1000, res(200))).outcome, "ok");
assert.equal((await ping("u", 1000, res(204))).outcome, "ok");
assert.equal((await ping("u", 1000, res(429))).outcome, "http_429");
assert.equal((await ping("u", 1000, res(503))).outcome, "http_5xx");
assert.equal((await ping("u", 1000, res(404))).outcome, "http_4xx");
assert.equal((await ping("u", 1000, fail("TimeoutError"))).outcome, "timeout");
assert.equal((await ping("u", 1000, fail("TypeError"))).outcome, "network_error");
const okEntry = await ping("u", 1000, res(200));
assert.deepEqual(Object.keys(okEntry).sort(), ["durationMs", "outcome", "status", "target", "ts"]);

// Runs scheduled() with a stubbed global fetch and console; returns what happened, in order.
async function run(targetFetch, { hook, hookFetch } = {}) {
  const events = [];
  const calls = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realErr = console.error;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return String(url) === TARGET ? targetFetch(url, init) : hookFetch(url, init);
  };
  console.log = (s) => events.push(["log", s]);
  console.error = (s) => events.push(["error", s]);
  let thrown = null;
  try {
    await worker.scheduled({ cron: "*/10 0-17 * * *" }, { TARGET_URL: TARGET, TIMEOUT_MS: "1000", ALERT_WEBHOOK_URL: hook });
  } catch (err) {
    thrown = err;
    events.push(["throw", err.message]);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realErr;
  }
  const entry = JSON.parse(events.find(([k]) => k !== "throw")[1]);
  return { events, calls, thrown, entry, all: JSON.stringify(events) };
}

// 1. 200: success, nothing thrown, no webhook.
let r = await run(res(200));
assert.equal(r.thrown, null);
assert.equal(r.entry.outcome, "ok");
assert.equal(r.entry.status, 200);

// 2. 429: failed, status and only the safe headers logged.
r = await run(res(429, {
  server: "cloudflare", "rndr-id": "abc-123", "retry-after": "30", "cf-ray": "ray-1-SIN", "content-type": "text/plain",
  "set-cookie": "sid=COOKIEVAL", authorization: "Bearer AUTHVAL", "x-api-key": "KEYVAL",
}, "BODY-SECRET"));
assert.match(r.thrown.message, /http_429 status=429/);
assert.equal(r.entry.status, 429);
assert.equal(r.entry.outcome, "http_429");
assert.deepEqual(r.entry.headers, {
  server: "cloudflare", "rndr-id": "abc-123", "retry-after": "30", "cf-ray": "ray-1-SIN", "content-type": "text/plain",
});
assert.equal(r.entry.source, "unknown"); // missing x-render-origin-server is not proof of the proxy
assert.equal(r.entry.confidence, "unknown");
const fromApp = await ping("u", 1000, res(429, { "x-render-origin-server": "uvicorn" }));
assert.deepEqual([fromApp.source, fromApp.confidence], ["origin_app", "probable"]);

// 3. 500, 4. timeout, 5. network error: all fail the invocation.
for (const [f, outcome] of [[res(500), "http_5xx"], [fail("TimeoutError"), "timeout"], [fail("TypeError"), "network_error"]]) {
  r = await run(f);
  assert.ok(r.thrown, `${outcome} must fail the invocation`);
  assert.equal(r.entry.outcome, outcome);
}

// 6. No secret leaks: webhook URL, cookies, auth, keys, and body never reach the logs.
r = await run(res(429, { "set-cookie": "sid=COOKIEVAL", authorization: "Bearer AUTHVAL", "x-api-key": "KEYVAL" }, "BODY-SECRET"),
  { hook: HOOK, hookFetch: res(204) });
for (const leak of ["SECRET-TOKEN-123", "hooks.example", "COOKIEVAL", "AUTHVAL", "KEYVAL", "BODY-SECRET", "set-cookie"]) {
  assert.ok(!r.all.includes(leak), `log leaked ${leak}`);
}
let sentBody = "";
await notify(HOOK, r.entry, async (_u, init) => { sentBody = init.body; return new Response(null, { status: 204 }); });
for (const leak of ["SECRET-TOKEN-123", "COOKIEVAL", "BODY-SECRET", "rndr-id"]) assert.ok(!sentBody.includes(leak));

// 7. Diagnostic log is written before the invocation fails.
r = await run(fail("TimeoutError"));
const iLog = r.events.findIndex(([k]) => k === "error");
const iThrow = r.events.findIndex(([k]) => k === "throw");
assert.ok(iLog >= 0 && iLog < iThrow, "log must precede the failure");

// 8. No webhook call when ALERT_WEBHOOK_URL is not set.
r = await run(res(429));
assert.deepEqual(r.calls, [TARGET]);
assert.equal(r.entry.alert, "disabled");
assert.equal(await notify(undefined, r.entry), "disabled");

// 9. Webhook failure: exactly one attempt, no retry, original ping error still reported.
for (const hookFetch of [fail("TypeError"), res(500), fail("TimeoutError")]) {
  r = await run(res(429), { hook: HOOK, hookFetch });
  assert.equal(r.calls.filter((u) => u === HOOK).length, 1, "webhook must be tried once");
  assert.match(r.thrown.message, /http_429/);
  assert.match(r.events.at(-2)[1], /"alert":"failed_/);
}
r = await run(res(429), { hook: HOOK, hookFetch: res(204) });
assert.match(r.events.at(-2)[1], /"alert":"sent"/);

console.log("render-keepalive check: PASS");
