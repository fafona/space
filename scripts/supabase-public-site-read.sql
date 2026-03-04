-- Allow anonymous visitors to read merchant homepage blocks.
-- Run this in Supabase Studio SQL Editor (same project used by this app).

grant select on public.pages to anon;

drop policy if exists pages_public_site_home_read on public.pages;
create policy pages_public_site_home_read on public.pages
for select
to anon
using (merchant_id is not null and slug = 'home');

