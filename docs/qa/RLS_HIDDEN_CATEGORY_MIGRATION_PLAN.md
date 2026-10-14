# V1-SEC-03: RLS migration plan for products in hidden categories (needs separate approval)

Status: **committed, not applied** (commit `14895d7`). The canonical SQL `supabase/migrations/20261014090000_rls_hidden_categories.sql` and the Alembic wrapper `0005` are in the repository, so `alembic upgrade head` on a `0004` database **will apply it**. The only normal production apply path is `python -m alembic -c apps/api/alembic.ini upgrade head`; never `supabase db push`.

## Finding

| Path | Hidden-category products / their images | Future-dated products / their images | Internal tables |
|---|---|---|---|
| FastAPI public API | hidden (`public_product_conditions`, `repositories/catalog.py:14-27`) | hidden | not exposed |
| PostgREST, `anon` | **readable** | hidden: the image policy's subquery reads `products` as the caller, so the products policy (with its `published_at` check) also applies | 401 (no grant, `42501`) |
| PostgREST, `authenticated` (signed-up, not an admin) | **readable**, same grants and policies as anon | hidden | 403 (`42501` for an authenticated request; not probed) |
| `service_role` | bypasses RLS by design; server-side only (Render env, `sync: false`) | | |
| Storage | public buckets: an object URL is readable when its random key is known; no listing or write policy for anon/authenticated | | |

Evidence:
- policies at `supabase/migrations/202610100001_initial.sql:107-110`;
- grants at `20261011041446_security_hardening.sql:27-35`;
- Codex: `c21-release-validation/FINAL_V1_BLOCKER_FIXES_REVIEW.md`, SEC-001.

Production probe, read-only GET with the publishable key from the public bundle, 2026-10-14:
- anon REST returns 1 product and 1 image, identical to FastAPI;
- `admin_users`, `contact_clicks`, `audit_logs` and `media_assets` return 401 to anon. The authenticated result (403) follows from the same revoked grants but was not probed: that needs a signed-in user.

**The exposure is latent**: no category is hidden today. As soon as the owner hides one, its products become readable through the Data API.

**Classification: P1** under the brief's rule that data the site deliberately hides must not be readable by anon or authenticated. The rows are published product details (no personal or secret data), so the impact is a broken "hide" promise, not a data breach.

## Forward migration

Canonical SQL `supabase/migrations/20261014090000_rls_hidden_categories.sql`, plus Alembic wrapper `apps/api/alembic/versions/0005_rls_hidden_categories.py` (below). There is no `begin`/`commit`: Alembic owns the transaction, so the policy change and the revision bookkeeping commit together.

```sql
alter policy "public read published products" on public.products using (
  publish_status = 'published' and is_visible and deleted_at is null
  and (published_at is null or published_at <= now())
  and (category_id is null or exists (select 1 from public.categories c
    where c.id = products.category_id and c.is_visible and c.deleted_at is null))
);
alter policy "public read product images" on public.product_images using (
  exists (select 1 from public.products p where p.id = product_id
    and p.publish_status = 'published' and p.is_visible and p.deleted_at is null
    and (p.published_at is null or p.published_at <= now())
    and (p.category_id is null or exists (select 1 from public.categories c
      where c.id = p.category_id and c.is_visible and c.deleted_at is null)))
);
```

Notes:
- The explicit `published_at` check in the new image policy is defence in depth: the products policy already filters it through the subquery.
- `alter policy` keeps the policy names, roles (`anon, authenticated`) and grants. It touches only these two policies, takes a brief lock, and moves no data.
- `categories` has an index on `id` (PK); `products.category_id` is indexed (`ix_products_category`, `202610100001_initial.sql:34`). The extra `exists` is an index lookup per row.
- The FastAPI and the web app do not read through these policies: the API connects with the database owner role (no `FORCE ROW LEVEL SECURITY` in any migration), so RLS does not apply to it. The site is unaffected.

## Rollback (restores the exact current definitions)

The rollback is a new canonical file `supabase/migrations/<timestamp>_rls_hidden_categories_rollback.sql` with its own Alembic revision `0006`. History stays linear; it does not use `alembic downgrade`, which is disabled for security revisions as in `0004`.

```sql
alter policy "public read published products" on public.products using (
  publish_status = 'published' and is_visible and deleted_at is null
  and (published_at is null or published_at <= now())
);
alter policy "public read product images" on public.product_images using (
  exists (select 1 from public.products p where p.id = product_id
    and p.publish_status = 'published' and p.is_visible and p.deleted_at is null)
);
```

## Alembic wrapper (same pattern as `0004_security_hardening.py`)

```python
"""policies: products and images of hidden categories are not public

Revision ID: 0005
Revises: 0004
"""

from pathlib import Path

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_path = (
        Path(__file__).resolve().parents[4]
        / "supabase"
        / "migrations"
        / "20261014090000_rls_hidden_categories.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise RuntimeError("Apply the reviewed rollback migration instead of downgrading.")
```

## Steps (after approval)

1. **Backup.** The Free plan has **no automatic daily backups**. Take a fresh logical dump (`supabase db dump`, schema and `--data-only`, or `pg_dump`), store it off the machine, and check that it restores into a local database.
2. **Pre-check** (read-only):
   - `python -m alembic -c apps/api/alembic.ini current` must show `0004 (head)` before the change. If the live database is still on `0003`, stop: `0004` needs its own approval first (see `docs/RENDER_DEPLOYMENT.md`).
   - `select policyname, roles, qual from pg_policies where tablename in ('products','product_images');` must match the rollback SQL.
3. **Done (`14895d7`):** the canonical SQL and the `0005` wrapper are committed, identical to the reviewed snippets; static tests in `test_security_migration.py`. Precondition: the backend suite is green at the commit being applied.
4. **Apply.** The only normal path is `python -m alembic -c apps/api/alembic.ini upgrade head`, with `DATABASE_URL` from the secure environment, never printed. If the SQL Editor is ever used in an emergency, the same files must be committed and `alembic stamp` reconciled, so the history stays canonical.
5. **Verify** (read-only):
   - `alembic current` shows `0005 (head)`, and `pg_policies` shows the new `qual` for both policies, roles `{anon,authenticated}`.
   - anon `GET /rest/v1/products?select=id` equals the ids FastAPI returns publicly.
   - anon `GET /rest/v1/product_images?select=id,product_id` equals the images nested in those FastAPI products. FastAPI returns images inside each product; flatten `items[].images[].id` to compare.
   - The internal tables still return 401 to anon.
6. **Site check:** product list, detail, gallery and an admin save are unchanged. FastAPI connects as the owner role, so these policies do not apply to it.
7. **Deny matrix** (needs approved disposable test data and a signed-in non-admin test user):
   - hide a category that contains a test product with an image;
   - for **anon** and for the **authenticated non-admin**, expect 0 rows from `products?id=eq.<test product>` and 0 rows from `product_images?product_id=eq.<test product>`;
   - show the category again;
   - both roles must see the product row and its image row again.
8. **If anything is wrong:** commit and apply the rollback migration `0006` the same way, then repeat step 5.
