# Rollback plan

Principle: every deployment step can be reversed without touching the database. Gate C2 adds **no migrations**; Supabase stays at revision `0004`. Data rollback means the incident procedure from Gate C1, which is never run automatically.

## Frontend: Cloudflare Worker (owner: Claude)

| Situation | Action | Time |
|---|---|---|
| New Worker version is broken (5xx, wrong content) | `npx wrangler deployments list --name tunhuabinhnham-web`, then `npx wrangler rollback <previous-version-id>` | instant, no rebuild |
| Wrong `NEXT_PUBLIC_*` value baked in | Roll back as above, then rebuild with corrected values and redeploy | rebuild about 1 min |
| First-ever deploy is unusable | Workers settings → disable the `workers.dev` route (or delete the Worker after owner approval). While on `workers.dev`, nobody depends on it | minutes |
| After custom-domain cutover | Remove the Worker custom domain/route; the previous DNS record (kept, see DNS plan) takes over again | DNS TTL |

Before each frontend deploy, record:
- [ ] the current Worker version id (`wrangler deployments list`);
- [ ] the integration commit SHA that was built;
- [ ] the `NEXT_PUBLIC_*` values used (names and non-secret values).

## Backend: Render (owner: Codex)

_To be completed by Codex: Render "Rollback to previous deploy", env var rollback, CORS rollback order, health-check gating._

## Order when both must roll back

1. Roll back the frontend first, so users stop hitting new API contracts.
2. Then roll back the backend.
3. Restore `FRONTEND_ORIGINS` only after the frontend origin it served is no longer in use.
