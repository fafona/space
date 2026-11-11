-- New, isolated template snapshots. No merchant draft, publish or business record is changed.
begin;
create table if not exists public.website_templates (
  id uuid primary key,
  revision uuid not null,
  name text not null check (length(name) between 1 and 100),
  category text not null check (category in ('餐饮','娱乐','零售','服务','组织','其他')),
  status text not null default 'draft' check (status in ('draft','published')),
  sort_order integer not null default 0,
  design jsonb not null check (jsonb_typeof(design) = 'object'),
  cover_image_url text not null default '',
  desktop_page_count integer not null,
  mobile_page_count integer not null,
  source_site_id text not null,
  source_plan_id text not null check (source_plan_id in ('plan-1','plan-2','plan-3')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.website_templates enable row level security;
revoke all on public.website_templates from public, anon, authenticated;
grant select, insert, update, delete on public.website_templates to service_role;
create index if not exists website_templates_catalog_idx on public.website_templates(status, sort_order, updated_at desc);
comment on table public.website_templates is 'Admin-managed immutable-by-copy website designs; merchant API is read-only. No live relationship to merchant drafts.';
insert into public.faolla_schema_migrations(version,name) values (202611100214,'website_template_library');
notify pgrst, 'reload schema';
commit;
