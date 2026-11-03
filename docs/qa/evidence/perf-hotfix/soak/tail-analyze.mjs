import fs from "node:fs";
const t = fs.readFileSync(process.argv[2], "utf8"); const ev = []; let depth = 0, start = -1, inStr = false, esc = false;
for (let i = 0; i < t.length; i++) { const ch = t[i];
  if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
  if (ch === '"') inStr = true; else if (ch === "{") { if (!depth) start = i; depth++; } else if (ch === "}") { depth--; if (!depth) { try { ev.push(JSON.parse(t.slice(start, i + 1))); } catch {} } } }
const out = { events: ev.length, versions: {}, outcomes: {}, exceptions: [], status: {}, static404: [], s5xx: [], cpu: [], imageCpu: [], imageStatus: {}, transformErrors: [], from: null, to: null };
for (const e of ev) {
  const v = e.scriptVersion?.id?.slice(0, 8) ?? "?"; out.versions[v] = (out.versions[v] ?? 0) + 1;
  out.outcomes[e.outcome] = (out.outcomes[e.outcome] ?? 0) + 1;
  for (const x of e.exceptions ?? []) out.exceptions.push(`${x.name}: ${String(x.message).slice(0, 100)}`);
  const s = e.event?.response?.status; out.status[s] = (out.status[s] ?? 0) + 1;
  const u = e.event?.request?.url ?? "";
  if (s === 404 && u.includes("/_next/static/")) out.static404.push(u.slice(0, 100));
  if (s >= 500) out.s5xx.push(`${s} ${u.slice(0, 100)}`);
  if (typeof e.cpuTime === "number") out.cpu.push(e.cpuTime);
  if (u.includes("/_next/image")) { out.imageStatus[s] = (out.imageStatus[s] ?? 0) + 1; if (typeof e.cpuTime === "number") out.imageCpu.push(e.cpuTime); }
  // IMAGES_TRANSFORM_ERROR 9523 / 9422, Worker errors 1102 / 1027, OpenNext image failures
  for (const l of e.logs ?? []) { const m = JSON.stringify(l.message ?? ""); if (/9523|9422|IMAGES_TRANSFORM|1102|1027|exceeded|image/i.test(m) && l.level !== "log") out.transformErrors.push(m.slice(0, 120)); }
  const ts = e.eventTimestamp; if (ts) { out.from = Math.min(out.from ?? ts, ts); out.to = Math.max(out.to ?? ts, ts); }
}
out.cpu.sort((a, b) => a - b); const p = q => out.cpu[Math.floor(q * (out.cpu.length - 1))];
Object.assign(out, { cpuP50: p(.5), cpuP90: p(.9), cpuP99: p(.99), cpuMax: out.cpu.at(-1), from: out.from && new Date(out.from).toISOString(), to: out.to && new Date(out.to).toISOString() });
out.imageCpu.sort((a, b) => a - b); const ip = q => out.imageCpu[Math.floor(q * (out.imageCpu.length - 1))];
Object.assign(out, { imageRequests: out.imageCpu.length, imageCpuP50: ip(.5), imageCpuP90: ip(.9) });
delete out.cpu; delete out.imageCpu; out.transformErrors = [...new Set(out.transformErrors)]; out.exceptions = [...new Set(out.exceptions)];
console.log(JSON.stringify(out, null, 1));
