# V1-SEC-03: RLS migration plan for products in hidden categories (needs separate approval)

Status: **PLAN ONLY, not applied.** No policy was changed and no migration was run. The SQL below is not in `supabase/migrations/` so no `supabase db push` can apply it by accident.

## Finding

| Path | Hidden-category products / their images | Future-dated product images | Internal tables |
|---|---|---|---|
| FastAPI public API | hidden (`public_product_conditions`, `repositories/catalog.py:14-27`) | hidden | not exposed |
| PostgREST, `anon` | **readable** | **readable** (image policy has no `published_at` check) | 401 (no grant) |
| PostgREST, `authenticated` (signed-up, not an admin) | **readable**, same grants and policies as anon | **readable** | 401 |
| `service_role` | bypasses RLS by design; server-side only (Render env, `sync: false`) | | |
| Storage | public buckets: an object URL is readable when its random key is known; no listing or write policy for anon/authenticated | | |

Evidence:
- policies at `supabase/migrations/202610100001_initial.sql:107-110`;
- grants at `20261011041446_security_hardening.sql:27-35`;
- Codex: `c21-release-validation/FINAL_V1_BLOCKER_FIXES_REVIEW.md`, SEC-001.

Production probe, read-only GET with the publishable key from the public bundle, 2026-10-14:
- anon REST returns 1 product and 1 image, identical to FastAPI;
- `admin_users`, `contact_clicks`, `audit_logs` and `media_assets` return 401.

**The exposure is latent**: no category is hidden today. As soon as the owner hides one, its products become readable through the Data API.

**Classification: P1** under the brief's rule that data the site deliberately hides must not be readable by anon or authenticated. The rows are published product details (no personal or secret data), so the impact is a broken "hide" promise, not a data breach.

## Forward migration (proposed file `supabase/migrations/20261014090000_rls_hidden_categories.sql`)

```sql
begin;
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
commit;
```

Notes:
- `alter policy` keeps the policy names, roles (`anon, authenticated`) and grants. It touches only these two policies, takes a brief lock, and moves no data.
- `categories` has an index on `id` (PK); `products.category_id` is indexed (`ix_products_category`, `202610100001_initial.sql:34`). The extra `exists` is an index lookup per row.
- The FastAPI and the web app do not read through these policies: the API connects with the database owner role (no `FORCE ROW LEVEL SECURITY` in any migration), so RLS does not apply to it. The site is unaffected.

## Rollback (restores the exact current definitions)

```sql
begin;
alter policy "public read published products" on public.products using (
  publish_status = 'published' and is_visible and deleted_at is null
  and (published_at is null or published_at <= now())
);
alter policy "public read product images" on public.product_images using (
  exists (select 1 from public.products p where p.id = product_id
    and p.publish_status = 'published' and p.is_visible and p.deleted_at is null)
);
commit;
```

## Steps (after approval)

1. Take a backup or snapshot note (Free plan: daily backup; record the time).
2. Review: `select policyname, qual from pg_policies where tablename in ('products','product_images');` (read-only), and compare it with the rollback SQL.
3. Apply the forward SQL in the Supabase SQL editor, or add it as the migration file above and push it, as one transaction.
4. Verify read-only with the publishable key:
   - `GET /rest/v1/products?select=id` equals the FastAPI public list;
   - same for `product_images`;
   - the internal tables still return 401.
5. Verify the site: product list, detail, gallery and admin save (FastAPI owner connection) are unchanged.
6. Deny test, which needs a write and therefore approval: hide a category that has a test product, check that anon REST returns 0 rows for it, then show it again.
7. If anything is wrong: run the rollback SQL, then re-check step 4.
