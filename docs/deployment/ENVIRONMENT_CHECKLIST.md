# Environment checklist

**No secret values in this file.** It lists only names, where each variable is set, and whether it is secret. The values live in the platform dashboards (Render, Cloudflare build environment) and in the owner's password manager.

## Frontend: Cloudflare Worker (owner: Claude)

All web variables are `NEXT_PUBLIC_*`. They are **inlined at build time** (`npm --workspace apps/web run build:cloudflare`), so changing one requires a rebuild and redeploy. The Worker needs **no runtime secrets and no Wrangler secrets**.

| Variable | Secret? | Temporary-URL phase | After custom-domain cutover | Used by |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | no | `https://<render-service>.onrender.com/api/v1` | `https://api.<domain>/api/v1` (optional) | `lib/api.ts`, `lib/admin-api.ts`, `/api/revalidate` |
| `NEXT_PUBLIC_SITE_URL` | no | `https://tunhuabinhnham-web.<account-subdomain>.workers.dev` | `https://<domain>` | `metadataBase`, canonical/OG, `sitemap.xml`, `robots.txt` |
| `NEXT_PUBLIC_SUPABASE_URL` | no | `https://fyaourksnjeldsvuedox.supabase.co` | same | browser Supabase client, middleware, logout route |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | no (public by design, RLS-protected) | project publishable key | same | browser client, middleware, logout route |

Never put any of these in a `NEXT_PUBLIC_*` variable: `SUPABASE_SERVICE_ROLE_KEY` / secret key, `DATABASE_URL`, JWT secret.

Before every frontend build:
- [ ] `NEXT_PUBLIC_API_URL` points at the **public HTTPS** API (`global_fetch_strictly_public` blocks private addresses).
- [ ] `NEXT_PUBLIC_SITE_URL` equals the origin the site will be served from. A wrong value shows up in canonical tags and the sitemap.
- [ ] The build log has no `localhost` API URL: `grep -r "localhost:8" .open-next/ || echo clean`.
- [ ] The client bundle has no server secret: search `.open-next/assets` for `service_role`, `sb_secret_` and `postgresql://`. Expect no matches.

Cross-service settings that must change together with `NEXT_PUBLIC_SITE_URL`:
- [ ] Render API `FRONTEND_ORIGINS` contains the exact web origin (scheme + host, no trailing slash).
- [ ] Supabase → Authentication → URL Configuration → Redirect URLs contains the web origin (needed for password-reset links).

## Backend: Render web service (owner: Codex)

_To be completed by Codex in `gate-c2/backend` (names, secret flag, source, validation). See `RENDER_DEPLOY_PLAN.md`._
