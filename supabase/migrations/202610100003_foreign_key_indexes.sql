-- Incremental indexes for foreign-key maintenance and common audit queries.
-- CREATE INDEX IF NOT EXISTS is non-destructive and preserves all rows.
create index if not exists ix_contact_clicks_product_id
  on public.contact_clicks(product_id);

create index if not exists ix_media_assets_uploaded_by
  on public.media_assets(uploaded_by);

create index if not exists ix_audit_logs_admin_user_id
  on public.audit_logs(admin_user_id);
