// Run: node apps/render-keepalive/check.mjs  (no network)
import assert from "node:assert/strict";
import { ping } from "./worker.mjs";

const res = (status) => async () => new Response("{}", { status });
const fail = (name) => async () => { throw Object.assign(new Error("x"), { name }); };

assert.equal((await ping("u", 1000, res(200))).outcome, "ok");
assert.equal((await ping("u", 1000, res(503))).outcome, "http_5xx");
assert.equal((await ping("u", 1000, res(404))).outcome, "http_other");
assert.equal((await ping("u", 1000, fail("TimeoutError"))).outcome, "timeout");
assert.equal((await ping("u", 1000, fail("TypeError"))).outcome, "network_error");
const e = await ping("u", 1000, res(200));
assert.deepEqual(Object.keys(e).sort(), ["durationMs", "outcome", "status", "target", "ts"]);
console.log("render-keepalive check: PASS");
