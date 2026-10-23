# GitHub sync and backup plan (after N)

Status: **step 2 (push) done 2026-10-23 15:06Z: GITHUB_SOURCE_SYNC_PASS** (results at the end). Step 3 (`.deploy-assets` backup): ASSET_BACKUP_LOCAL_PASS 2026-10-23 15:13Z; the off-machine copy is pending the owner. Steps 4–5 not executed; each needs the owner's separate approval. Nothing is merged into `main` or `deploy/c2-preview`, no worktree is removed, production is not touched.

## Current state (2026-10-23, read-only checks)

| | Commit | On `origin` |
|---|---|---|
| Worker production N `ace736be` | `0cfcd7d` (tree `2f38428c`) | no |
| Previous production P / P′ code | `e681cca` (tree `e2afc919`) | no |
| `hotfix/v1.1-cache-isolation` | `e681cca` | no (1 commit on top of `origin/deploy/c2-preview` `1ab6f7c`) |
| `fix/perf-image-cache` | `0cfcd7d` + docs/evidence | no (15 commits on top of `1ab6f7c`; `apps/` and `supabase/` identical to `0cfcd7d`) |
| `chore/consolidate-codex-prod` | evidence consolidation on `e681cca` | no (4 commits) |
| Backend production | `1ab6f7c` | yes (`deploy/c2-preview`, `integration/warm-editorial-v2`) |

Only this machine holds the Worker source, `apps/web/.deploy-assets/` (9.1 MB, git-ignored) and `apps/web/.env.production.local` (git-ignored).

Push side effects checked: CI (`.github/workflows/ci.yml`) runs on `pull_request` and on push to `main` only; Render (`render.yaml`) builds `deploy/c2-preview` with `autoDeployTrigger: "off"`; the Worker is uploaded by wrangler from this machine (no Git integration). Pushing new branch names triggers no build or deploy.

## 1. Secret check before pushing (done read-only; repeat right before the push)

On every commit not yet on `origin` (`git log -p <branches> --not --remotes=origin`):

- no added file named `.env*`, `.dev.vars`, `*.pem`, `*.key`, `*.p12`, `.npmrc`, dumps; the two "secret" file names are the scanner script and its report;
- no `sb_secret_`, JWT (`eyJ…`), private key, `postgres://user:pass@`, `ghp_`, `AKIA`, or `api_key/secret/password/token = '<long value>'`; matches are only PostgreSQL ACL role names, the scanner's own regex and fake test tokens;
- emails/IPs: only `example.test`, RFC 5737 documentation IPs, `127.0.0.1` and an npm package author;
- raw `wrangler tail` output (visitor IPs) stays in the session scratchpad; only summaries are committed.

Repeat just before pushing:

```
git log -p hotfix/v1.1-cache-isolation fix/perf-image-cache chore/consolidate-codex-prod --not --remotes=origin | grep -nE "^\+" | grep -iE "sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE|postgres(ql)?://[^:@/ ]+:[^@/ ]+@|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}"
git log --format= --name-only --diff-filter=A hotfix/v1.1-cache-isolation fix/perf-image-cache chore/consolidate-codex-prod --not --remotes=origin | sort -u | grep -iE "(^|/)\.env|\.dev\.vars|\.pem$|\.key$"
```

Both must print nothing (`gitleaks detect --log-opts="<range>"` is an optional second opinion; it is not installed here).

## 2. Push (owner approval)

New branch names only; never `main`, never `deploy/c2-preview`, no force:

```
cd E:\Tunhuabinhnham
git fetch origin
git push origin hotfix/v1.1-cache-isolation fix/perf-image-cache
```

Optional: `chore/consolidate-codex-prod` (Codex reviews and release evidence) in the same command. Recommended: annotated tags tying commits to Worker versions:

```
git tag -a worker-f4fd8f1a e681cca -m "Worker f4fd8f1a / P-prime b2d3421d code"
git tag -a worker-ace736be 0cfcd7d -m "Worker ace736be (N, production 2026-10-23)"
git push origin worker-f4fd8f1a worker-ace736be
```

## 3. Back up `.deploy-assets` (outside the repository)

```
cd /e/Tunhuabinhnham/apps/web
tar -czf /e/Tunhuabinhnham-backups/deploy-assets-20261023.tgz .deploy-assets
sha256sum /e/Tunhuabinhnham-backups/deploy-assets-20261023.tgz > /e/Tunhuabinhnham-backups/deploy-assets-20261023.tgz.sha256
```

Then copy both files to a second device (USB disk or cloud drive): `E:\Tunhuabinhnham-backups` is on the same disk as the repository. The archive holds only public build output (it is served to every visitor), so it needs no encryption.

## 4. Back up secrets (encrypted only)

`.env.production.local` holds four `NEXT_PUBLIC_*` values (API URL, site URL, Supabase URL, Supabase anon key); they are compiled into the public bundle, but the file is still kept out of Git and backed up encrypted:

```
gpg --symmetric --cipher-algo AES256 --output /e/Tunhuabinhnham-backups/env.production.local.20261023.gpg /e/Tunhuabinhnham/apps/web/.env.production.local
```

Keep the passphrase in a password manager, not next to the file. Check restore once: `gpg --decrypt <file> | diff - apps/web/.env.production.local`.

The real secrets are not on this machine and need their own record in the password manager: Render environment (database URL/password, Supabase service values, JWT settings), Supabase project keys and database password (the weak-password P0 remains open), Cloudflare and GitHub account recovery. The Worker has no wrangler secrets (`wrangler secret list` = `[]`).

## 5. Verify remote = production build

After the push:

1. `git ls-remote origin hotfix/v1.1-cache-isolation fix/perf-image-cache` shows `e681cca…` and the local `fix/perf-image-cache` head.
2. In a fresh clone: `git merge-base --is-ancestor 0cfcd7d origin/fix/perf-image-cache` succeeds and `git rev-parse 0cfcd7d^{tree}` = `2f38428cc351ede0b603f2dcbe7819c8bf28b76c`; `git rev-parse e681cca^{tree}` = `e2afc919506bfc3756bbb20f1c6c97a7e048444f`.
3. `npx wrangler versions view ace736be-c3d6-443e-a454-d7bae8c69681` shows tag `perf-n-0cfcd7d`.
4. Optional reproducibility check: in the fresh clone at `0cfcd7d`, restore `.env.production.local` from the encrypted backup, `npm ci`, `npm --workspace apps/web run build:cloudflare`, then compare `_next/static` file names and SHA-256 with `.deploy-assets/0cfcd7d` and the live site (`node docs/qa/evidence/perf-hotfix/soak/soak-gate.mjs` / `asset-hash` check). Build only; no upload.

## Result — step 2: GITHUB_SOURCE_SYNC_PASS (2026-10-23)

Owner approval: push exactly `hotfix/v1.1-cache-isolation` and `fix/perf-image-cache`, tags `worker-f4fd8f1a` → `e681cca`, `worker-ace736be` → `0cfcd7d`; no force, no `main`, no `deploy/c2-preview`.

Before the push (15:00–15:06Z):

| Check | Result |
|---|---|
| Repository / origin | `origin` = `https://github.com/levuanh2/tunhuabinhnham.git` (fetch and push), gh account `levuanh2` |
| Visibility / access | PRIVATE; collaborators: `levuanh2` (admin) only; 0 pending invitations, 0 deploy keys, 0 webhooks |
| Secrets in the 16 commits to push (93 files) | no `.env*`/key/dump/`.deploy-assets`/`.open-next` file; no `sb_secret_`, `sbp_`, JWT, private key, connection string with password, GitHub/AWS/Slack token, assigned password/secret/api key; only `127.0.0.1` as IP; the four `tail*` files are aggregate summaries (no IPs, headers, cookies or tokens) |
| GitHub Actions | only `.github/workflows/ci.yml` (blob `dc27f5c7`, identical to `origin/deploy/c2-preview`): `pull_request`, push to `main`, `workflow_dispatch`; no tag or other-branch trigger, no deploy step |
| Render / Cloudflare | `render.yaml`: branch `deploy/c2-preview`, `autoDeployTrigger: "off"`; Worker uploaded by wrangler (no Git integration); `deploy/c2-preview` not pushed |
| Ancestry | `hotfix/v1.1-cache-isolation` = `e681cca99361cf5d435ec6198591e0ac4ab5f151`; `origin/deploy/c2-preview` `1ab6f7c` → `e681cca` → `0cfcd7d90c0532fb5ae3b51c037835eb99b2f9a4` → `fix/perf-image-cache` `fb9f875`; `apps/`, `supabase/`, `render.yaml`, `.github/` identical between `0cfcd7d` and `fb9f875` |
| Baseline | Cloudflare last deployment 14:37:11Z (100% `ace736be`); GitHub deployments latest `7135798550` (2026-10-17, `1ab6f7c`); Actions runs total 1 |

Push: `git push origin` of the two branch refs and the two annotated tags, all `[new branch]` / `[new tag]`, no force.

After the push (15:06–15:08Z):

| Check | Result |
|---|---|
| Remote refs (`git ls-remote` after fetch) | `hotfix/v1.1-cache-isolation` `e681cca9…`; `fix/perf-image-cache` `fb9f8751…`; `worker-f4fd8f1a` (tag `dd92e91a`) → `e681cca9…`; `worker-ace736be` (tag `fe67b4b6`) → `0cfcd7d9…` |
| SHA and tree, remote = local | `e681cca` tree `e2afc919506bfc3756bbb20f1c6c97a7e048444f`; `0cfcd7d` tree `2f38428cc351ede0b603f2dcbe7819c8bf28b76c`; `fb9f875` tree `6e47043a1bff95d4fbe98e2179d34c028869e695` |
| Restore from GitHub (fresh clone) | checkout `worker-ace736be` = `0cfcd7d`, 868 files, clean; checkout `worker-f4fd8f1a` = `e681cca`, 849 files, clean; no tracked `.env` (only 3 `.env.example`) and no `.deploy-assets` |
| Unintended deployments | Cloudflare: last deployment still 14:37:11Z, 100% `ace736be`, no new version; GitHub deployments (Render) latest still `7135798550`; Actions runs total still 1; 0 check runs / statuses on the pushed commits; API `/health/ready` 200 |

Incident during verification (no remote or production effect): the first restore check cloned into a path the shell did not resolve, so two `git checkout` of the tags ran in the main checkout (`E:\Tunhuabinhnham`) and left it detached at `e681cca`. The tree was clean (only untracked `.worktrees/`, `c21-security-worktree/`), nothing was lost; it was put back on `fix/perf-image-cache` at once and the check repeated in the session scratchpad. The stray clone (`E:	mp	mp.UaJYAyUztG`) was removed.

This result commit is local only (made after the verified push).

## Result — step 3 (owner's "BƯỚC 2"): ASSET_BACKUP_LOCAL_PASS (2026-10-23 15:13Z)

| | |
|---|---|
| Source | `E:\Tunhuabinhnhampps\web\.deploy-assets` (git-ignored): 227 files, 8,962,483 bytes; builds `0cfcd7d` 45, `1ab6f7c` 45, `3e8c5f0` 45, `70dac36` 45, `e681cca` 47 (+ `BUILD_ID`, `_headers`); 145 js, 5 css, 75 woff2; no symlinks |
| Archive | `E:\Tunhuabinhnham-backups\deploy-assets-20261023T151345Z.tar.gz`, 3,239,113 bytes (GNU tar, `--sort=name`, gzip) |
| Archive SHA-256 | `ad26f6acf3cf7d834ac518823386af596fb70718128c6f15e54fb0d5e3e9b082` (file `….tar.gz.sha256`) |
| Per-file manifest | `….manifest.sha256` (227 lines, `sha256sum` format; manifest SHA-256 `f8a823b4ed2cc9af85b7e1d018ff0239526d418087b911a3f66ca7ace4a495d7`) |
| Integrity | `sha256sum -c` OK; `gzip -t` OK; 227 files, 31 directories, 0 links, every entry under `.deploy-assets/`, no absolute or `..` paths |
| Restore | extracted into the session scratchpad (not over the source): 227 files, 8,962,483 bytes; paths + SHA-256 of every file identical to the source manifest; temp copy deleted |
| Source untouched | source re-hashed after the backup: identical |
| Sensitive content | no `.env`, key, dump, SQL or credential file names; no private key, connection string with password, `service_role`, JWT, `sb_secret_` key value. Matches reviewed: `sb_publishable_…` (the public Supabase key compiled into the browser bundle) in 5 copies of one chunk, and the supabase-js literal `startsWith("sb_secret_")` in `09g-92lhb07uq.js` (no key value); that chunk is byte-identical to the one served publicly on the site |
| Git | archive is outside the repository (`E:\Tunhuabinhnham-backups` is not a Git repo); nothing added to Git |
| Earlier backups | untouched (15 directories + the pre-0006 dump) |

Disk layout: `E:` and `K:` are two partitions of the same USB disk (Disk 1, ASMT 2235); `C:` is the internal NVMe. A copy on `K:` is not independent; the off-machine copy must go to another device or a cloud folder (e.g. OneDrive). The archive holds only public build output, so cloud storage is acceptable for it.

Off-machine copy: **pending (owner)**. Step complete only after the copy is verified at the destination.
