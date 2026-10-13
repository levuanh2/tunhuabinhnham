# Task: Product slug redirect (301)

Status: **proposed, not started**. Owner decision 2026-10-13: implement **before** many real products go live.

Needs approval, because it adds a database migration (new table). It is a prerequisite for allowing admins to change the URL of a published product.

## Problem

There is no redirect from an old product URL today, so a once-published product keeps its slug forever (API 409 "Published product URL cannot change", form warning on first publish). A typo published once ("tu-nhua" vs "tu-nhuw") is permanent.

## Design

### Table `product_slug_history`

| Column | Notes |
|---|---|
| `slug` | primary key, the old URL segment; same pattern as `products.slug` |
| `product_id` | FK `products(id)` `on delete cascade` |
| `created_at` | |

### Uniqueness across current and historical slugs

A slug can be either a current slug or a historical one, never both, and never two products'.
- A new or changed product slug must not exist in `product_slug_history` for **another** product. Enforce this in the same transaction, locking the history row (`FOR UPDATE`).
- Taking back one's **own** old slug is allowed: the API deletes that history row and makes it current again.
- `-2`/`-3` generation in the admin form already handles 409. The API returns `Slug already exists` for history clashes too, so the form needs no change.

### Write path (`PATCH /admin/products/{id}` with a new slug)

1. Lock the product row (already done).
2. Insert the old slug into the history.
3. Delete any history row equal to the new slug that belongs to this product.
4. Update `products.slug`.

All of this happens in one transaction, and the audit log records the old and new slugs.

### Read path

`GET /api/v1/products/{slug}`:
- On a miss, look up the history.
- If found, and the product is publicly visible (same `public_product_conditions`), return `301` with the current slug, e.g. `{ redirect_to: "<current>" }` or a `Location` header; the exact contract is decided at implementation.
- Otherwise return 404. A hidden product must not leak its new URL.

`/san-pham/[slug]` page: on a redirect answer, call Next `permanentRedirect('/san-pham/<current>')` (308/301).

### No redirect loops or chains

- History always points to a **product id**, never to another slug. Every redirect therefore resolves in exactly one hop to the product's current slug.
- A slug cannot be current and historical at the same time (uniqueness rule above), so `A → B → A` cannot loop.
- Renaming back to an old slug removes it from the history (write path, step 3).

### SEO

- Canonical stays the current slug. The sitemap lists current slugs only.
- The permanent redirect transfers ranking; old links from Zalo, Facebook and Google keep working.
- The Workers Cache key is the path, so a cached 404 of an old path must not survive: the redirect response is not cached as public (or is purged with `public-html` on every slug change, as today).

### Soft-deleted products

History rows stay. Their redirect returns 404 while the product is deleted (it fails `public_product_conditions`). The slug stays reserved, like category slugs.

### Tests

- Old slug answers 301 to the current slug; old URL works after two renames (one hop each).
- No loop: rename back to an old slug.
- Another product cannot take a historical slug; concurrent rename and create are covered by the unique key.
- A hidden, draft or deleted product gives 404 on both old and new slugs.
- Sitemap and canonical use the current slug.
- Workers Cache: the old path is not served stale after a rename.

### Rollout

1. Migration in `supabase/migrations/` (reviewed, applied to staging first).
2. API, then web.
3. Only then remove the published-slug lock (the form warning becomes "the old link will redirect").
