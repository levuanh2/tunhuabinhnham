# Production recovery checklist

Scope: restore or rebuild the production of Tủ Nhựa Bình Nhâm if this machine, its USB disk or a cloud deployment is lost. No secret values are written here; names only.

Production on 2026-10-23: Worker `tunhuabinhnham-web` version `ace736be-c3d6-443e-a454-d7bae8c69681` (source `0cfcd7d`), backend Render `tunhuabinhnham-api` at `1ab6f7c`, Supabase project `fyaourksnjeldsvuedox` at Alembic `0006`.

## 1. What is backed up, and where

| Item | Location | Notes |
|---|---|---|
| Worker source N | GitHub `levuanh2/tunhuabinhnham` (private): tag `worker-ace736be` → `0cfcd7d`; branch `fix/perf-image-cache` | tree `2f38428c…` |
| Previous Worker source (P / P′ code) | tag `worker-f4fd8f1a` → `e681cca`; branch `hotfix/v1.1-cache-isolation` | tree `e2afc919…` |
| Backend source | `deploy/c2-preview` = `1ab6f7c` (Render's branch) | auto-deploy off |
| Database schema | `supabase/migrations/` and `apps/api/alembic/versions/` in Git | schema only, no data |
| Previous builds' static assets | `E:\Tunhuabinhnham-backups\deploy-assets-20261023T151345Z.tar.gz` (+ `.sha256`, `.manifest.sha256`), copy off the machine (see §6) | 5 builds: `0cfcd7d`, `e681cca`, `1ab6f7c`, `3e8c5f0`, `70dac36` |
| Frontend build environment | `E:\Tunhuabinhnham-backups\env.production.local.<UTC>.gpg` (+ `.sha256`), GPG AES-256, copy off the machine | passphrase only in the owner's password manager |
| Worker versions | Cloudflare keeps uploaded versions (10 listed on 2026-10-23, incl. `ace736be`, `b2d3421d`, `f4fd8f1a`) | fastest rollback, no rebuild |

## 2. Not backed up here (restore from the provider or the password manager)

| Name | Where it lives | Sensitive |
|---|---|---|
| `DATABASE_URL` (Supabase pooler, with password) | Render env; Supabase dashboard → Database | **yes** |
| `SUPABASE_SECRET_KEY` (alias `SUPABASE_SERVICE_ROLE_KEY`) | Render env; Supabase → API keys | **yes** |
| Supabase database password, JWT signing keys | Supabase dashboard | **yes** |
| Cloudflare login / API token for `wrangler` | Cloudflare account (owner) | **yes** |
| Render, GitHub, Supabase, Cloudflare account recovery (2FA codes) | owner's password manager | **yes** |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL` | Render env (`sync: false`); Supabase → API settings | no |
| `CORS_ORIGINS`, `FRONTEND_URL` | Render env (`sync: false`) | no |
| Other backend settings (`APP_ENV`, pool sizes, rate limits, `PUBLIC_CACHE_SECONDS`, `CLIENT_IP_HEADER`, …) | `render.yaml` in Git | no |
| Worker bindings (`ASSETS`, `IMAGES`, `WORKER_SELF_REFERENCE`, cache entrypoints) | `apps/web/wrangler.jsonc` in Git; the Worker has no wrangler secrets | no |
| Custom domain, www → apex and http → https redirects, DNS | Cloudflare dashboard | no |
| Supabase Auth settings (site URL, redirect URLs, admin users), Storage buckets/policies | Supabase dashboard; policies also in migrations | no |
| **Database data and Storage images** | Supabase only | — |

Frontend build variables (all public, compiled into the browser bundle): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the code also accepts `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). They are in the encrypted file and can also be rebuilt from the Supabase dashboard and the known URLs.

## 3. Fast path: Cloudflare still has the versions

Roll back without building (`apps/web`, owner):

- After N: `npx wrangler versions deploy b2d3421d-5d82-47e7-b7eb-fa427f4872dc@100% --yes --message "rollback to P-prime b2d3421d"` (never to `f4fd8f1a`: it lacks N's assets for open tabs).
- Check: `npx wrangler deployments status`, then the soak gate (§5 step 9).

## 4. Restore the files on a new machine

1. Install Git for Windows (signed by Johannes Schindelin; includes GnuPG), Node.js 22 (built with v22.18.0; the repo pins no version), and `gh`.
2. `git clone https://github.com/levuanh2/tunhuabinhnham.git E:\Tunhuabinhnham` and `git checkout worker-ace736be` (or the tag being rebuilt). Check `git rev-parse HEAD^{tree}` = `2f38428cc351ede0b603f2dcbe7819c8bf28b76c`.
3. Copy the backup files from the off-machine copy into `E:\Tunhuabinhnham-backups\` and check them:
   `sha256sum -c deploy-assets-20261023T151345Z.tar.gz.sha256` and `sha256sum -c env.production.local.<UTC>.gpg.sha256`.
4. Assets: `cd /e/Tunhuabinhnham/apps/web && tar -xzf /e/Tunhuabinhnham-backups/deploy-assets-20261023T151345Z.tar.gz` (creates `.deploy-assets/`), then `sha256sum -c /e/Tunhuabinhnham-backups/deploy-assets-20261023T151345Z.manifest.sha256` (227 OK).
5. Environment: open the password manager entry, then
   `gpg --pinentry-mode loopback --no-symkey-cache --output /e/Tunhuabinhnham/apps/web/.env.production.local --decrypt /e/Tunhuabinhnham-backups/env.production.local.<UTC>.gpg`
   and paste the passphrase at the prompt. Do not put the passphrase on the command line. The file is git-ignored (`.gitignore`: `.env.*`); never commit or upload it.

## 5. Rebuild and pre-deploy checks (owner approves every upload/deploy)

Follow `TASK_P1_ASSET_VERSION_SKEW.md` → "Standard procedure for frontend releases". In short, from `apps/web` on the tag:

1. `npm ci` at the repository root (the tag's own lockfile).
2. `npx opennextjs-cloudflare build`.
3. Image allowlist must print `fyaourksnjeldsvuedox.supabase.co` (a build without `NEXT_PUBLIC_SUPABASE_URL` breaks every image):
   `node -e 'console.log(require("./.open-next/server-functions/default/apps/web/.next/required-server-files.json").config.images.remotePatterns.map(p => p.hostname).join(","))'`
4. Reproducibility check (optional): the build's `_next/static` file names and bytes should equal `.deploy-assets/0cfcd7d`.
5. Keep open tabs working: `node scripts/merge-previous-assets.mjs .open-next/assets .deploy-assets/<live build> .deploy-assets/<older retained>` (exit 0).
6. `npm --workspace apps/web test` and lint; secret scan of `.open-next/assets` (no `sb_secret_` value, private key, connection string).
7. `npx wrangler versions upload --tag <tag> --message "<source sha>"` → preview URL; smoke the preview (`docs/qa/evidence/perf-hotfix/preview/` and `production/` tools).
8. Owner: `npx wrangler versions deploy <version>@100%` with `npx wrangler tail tunhuabinhnham-web` running.
9. Gate: `node docs/qa/evidence/perf-hotfix/soak/soak-gate.mjs https://tunhuabinhnham.com .deploy-assets/<new> .deploy-assets/<previous> --soak 300`; then `production/n-smoke.mjs`, `preview/image-cache-probe.mjs`, `preview/preview-browser.mjs`.

Backend: Render Manual Deploy of `1ab6f7c` from `deploy/c2-preview` (no clear cache); env vars from §2. Database: never downgrade below `0006`; restoring data is a Supabase-side operation.

## 6. Limits of this backup

- No database data or Storage images. The only local logical dump is `tunhuabinhnham-public-pre-0006-20261015T155656Z.dump` (public schema, before migration 0006): outdated, for reference only. Check the Supabase plan's own backups in the dashboard.
- No backend or provider secrets (§2). They must be in the owner's password manager.
- The encrypted file is only as safe as its passphrase, and useless without it.
- `E:` and `K:` are partitions of the same USB disk; copies there are not independent. `C:\Users\Vu Anh\OneDrive` is a cloud copy only if the OneDrive client is signed in and shows the files as synced.
- `.deploy-assets` must be refreshed in the backup after each release (new build archive).
