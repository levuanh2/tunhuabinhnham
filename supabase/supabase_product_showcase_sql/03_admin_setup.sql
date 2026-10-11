-- ADMIN SETUP (RUN ONLY AFTER creating your admin account in Supabase Auth > Users)
-- Replace admin@example.com with the exact email of the account you just created.
-- IMPORTANT: Only run in the trusted SQL Editor; never expose this statement to clients.

insert into public.admin_users (user_id, role, is_active)
select id, 'admin', true
from auth.users
where lower(email) = lower('admin@example.com')
on conflict (user_id) do update
set role = excluded.role, is_active = excluded.is_active;

-- Verify one matching admin row was created:
select au.user_id, u.email, au.role, au.is_active
from public.admin_users au
join auth.users u on u.id = au.user_id
where lower(u.email) = lower('admin@example.com');
