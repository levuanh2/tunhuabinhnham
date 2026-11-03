// Canary comparison sample, not a load test: alternating version-pinned requests for the same uncached product URL
// shape (unique query = MISS render), 5 s apart, with UTC timestamps for matching Render `request_completed` lines.
// Usage: node canary-pair-probe.mjs <rounds> > out.json
const VERSIONS = { N: "fae6efa2-4153-411c-9987-55f2f6ccfb87", Pprime: "68103970-d684-49ad-84bf-e8909278323c" };
const SLUGS = ["tu-nhua-4-canh-4", "tu-nhua-4-canh-3", "tu-4-canh-2"];
const rows = []; const rounds = Number(process.argv[2] ?? 6);
for (let i = 0; i < rounds; i++) for (const [label, id] of Object.entries(VERSIONS)) {
  const url = `https://tunhuabinhnham.com/san-pham/${SLUGS[i % SLUGS.length]}?canary=${Date.now().toString(36)}${label}`;
  const start = new Date().toISOString(), t = Date.now();
  let r; try { r = await fetch(url, { headers: { "cloudflare-workers-version-overrides": `tunhuabinhnham-web="${id}"` }, signal: AbortSignal.timeout(60000) }); } catch (e) { rows.push({ label, start, error: e?.cause?.code ?? e?.name }); continue; }
  const html = await r.text();
  const related = (html.split("Sản phẩm cùng loại")[1]?.match(/href="\/san-pham\/[^"?#]+"/g) ?? []).length;
  rows.push({ label, start, ms: Date.now() - t, status: r.status, cache: r.headers.get("cf-cache-status"), colo: r.headers.get("cf-ray")?.split("-").pop(), related, assets: (html.match(/\/_next\/static\/chunks\/[^"]+\.css/) ?? [""])[0].slice(-20) });
  await new Promise(res => setTimeout(res, 5000));
}
console.log(JSON.stringify(rows, null, 1));
