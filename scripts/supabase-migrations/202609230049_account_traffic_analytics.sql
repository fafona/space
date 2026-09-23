begin;

-- Independent of legacy page_events; no public reads or direct browser inserts.
create table if not exists public.account_traffic_events (
  site_id text not null check (site_id ~ '^[0-9]{8}$'),
  event_id uuid not null,
  module text not null check (module in ('website','product','booking','card')),
  object_id text not null check (length(object_id) between 1 and 240),
  object_label text not null check (length(object_label) <= 120),
  action text not null check (action in ('view','exposure','add_to_cart','form_start','submit_attempt','website_click','contact_download_click','phone_click','email_click','whatsapp_click')),
  source text not null check (source in ('direct_unknown','internal','google','bing','baidu','facebook','instagram','other_referral')),
  browser text not null check (browser in ('wechat','facebook_app','instagram_app','edge','chrome','firefox','safari','other')),
  device text not null check (device in ('mobile','tablet','desktop')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (site_id, event_id)
);
create index if not exists account_traffic_events_site_time on public.account_traffic_events(site_id, created_at desc);
create index if not exists account_traffic_events_time on public.account_traffic_events(created_at);
alter table public.account_traffic_events enable row level security;
revoke all on public.account_traffic_events from public, anon, authenticated;
grant select, insert, delete on public.account_traffic_events to service_role;

-- Aggregation happens in SQL BEFORE PostgREST's row limit. The object list is
-- paginated independently; totals and all other breakdowns remain complete.
create or replace function public.faolla_account_traffic_report(p_site_id text, p_days integer default 30, p_offset integer default 0, p_module text default null, p_object_id text default null)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare result jsonb; start_at timestamptz; end_at timestamptz := now();
begin
  if p_site_id !~ '^[0-9]{8}$' or p_days not between 1 and 90 or p_offset not between 0 and 100000 then
    raise exception 'invalid_traffic_report_scope';
  end if;
  if (p_module is not null and p_module not in ('website','product','booking','card'))
    or (p_object_id is not null and (p_module is null or length(p_object_id) not between 1 and 240)) then
    raise exception 'invalid_traffic_object_scope';
  end if;
  start_at := ((end_at at time zone 'Europe/Madrid')::date - (p_days - 1))::timestamp at time zone 'Europe/Madrid';
  with events as materialized (
    select * from public.account_traffic_events where site_id = p_site_id and created_at >= start_at and created_at <= end_at
      and (p_module is null or module = p_module) and (p_object_id is null or object_id = p_object_id)
  ), objects as (
    select module, object_id, (array_agg(object_label order by created_at desc, event_id))[1] as label,
      count(*) as count, count(*) filter (where action = 'view') as views,
      count(*) filter (where action = 'exposure') as exposures,
      count(*) filter (where action not in ('view','exposure')) as actions
    from events group by module, object_id
  ) select jsonb_build_object(
    'timezone','Europe/Madrid', 'from',start_at, 'to',end_at,
    'firstCollectedAt',(select min(created_at) from public.account_traffic_events where site_id = p_site_id),
    'totalEvents',(select count(*) from events),
    'views',(select count(*) from events where action = 'view'),
    'exposures',(select count(*) from events where action = 'exposure'),
    'actions',(select count(*) from events where action not in ('view','exposure')),
    'daily',coalesce((select jsonb_agg(x order by key) from (
      select to_char(created_at at time zone 'Europe/Madrid','YYYY-MM-DD') as key, count(*) as count,
        count(*) filter(where action = 'view') as views, count(*) filter(where action = 'exposure') as exposures,
        count(*) filter(where action not in ('view','exposure')) as actions from events group by 1) x),'[]'::jsonb),
    'modules',coalesce((select jsonb_agg(x order by key) from (
      select module as key, count(*) as count, count(*) filter(where action = 'view') as views,
        count(*) filter(where action = 'exposure') as exposures, count(*) filter(where action not in ('view','exposure')) as actions
      from events group by module) x),'[]'::jsonb),
    'objectCount',(select count(*) from objects),
    'objects',coalesce((select jsonb_agg(x) from (select object_id as key,module,label,count,views,exposures,actions
      from objects order by count desc,module,object_id limit 50 offset p_offset) x),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(x order by count desc,key) from (select source as key,count(*) as count from events where action='view' group by source) x),'[]'::jsonb),
    'browsers',coalesce((select jsonb_agg(x order by count desc,key) from (select browser as key,count(*) as count from events where action='view' group by browser) x),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(x order by count desc,key) from (select device as key,count(*) as count from events where action='view' group by device) x),'[]'::jsonb),
    'actionTypes',coalesce((select jsonb_agg(x order by count desc,key) from (select action as key,count(*) as count from events group by action) x),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.faolla_account_traffic_report(text,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.faolla_account_traffic_report(text,integer,integer,text,text) to service_role;

-- Preserve the legacy metric (site page views), correcting the global 1000-row
-- sampling bug and giving 'today' its Europe/Madrid calendar-day meaning.
create or replace function public.faolla_legacy_merchant_visits(p_site_ids text[])
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(row), '[]'::jsonb) from (
    select split_part(coalesce(nullif(channel,''),page_path),':',2) as site_id,
      count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid') as today,
      count(*) filter (where created_at >= now()-interval '7 days') as day7,
      count(*) filter (where created_at >= now()-interval '30 days') as day30,
      count(*) as total
    from public.page_events
    where event_type='page_view' and created_at <= now()
      and coalesce(nullif(channel,''),page_path) ~ '^site:[0-9]{8}:'
      and split_part(coalesce(nullif(channel,''),page_path),':',2) = any(p_site_ids)
    group by 1
  ) row;
$$;
revoke all on function public.faolla_legacy_merchant_visits(text[]) from public, anon, authenticated;
grant execute on function public.faolla_legacy_merchant_visits(text[]) to service_role;

insert into public.faolla_schema_migrations(version,name)
values (202609230049,'account_traffic_analytics') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
