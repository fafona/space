begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Never change the existing page_events data or its public legacy workflow.
-- Lock only the new analytics table while installing an atomic rollup trigger.
lock table public.account_traffic_events in share row exclusive mode;
alter table public.account_traffic_events add column if not exists medium text not null default 'unknown'
  check (medium in ('unknown','qr','share','nfc','ad'));
alter table public.account_traffic_events drop constraint if exists account_traffic_events_module_check;
alter table public.account_traffic_events add constraint account_traffic_events_module_check
  check (module in ('website','product','booking','card','coupon','poll','membership'));
alter table public.account_traffic_events drop constraint if exists account_traffic_events_action_check;
alter table public.account_traffic_events add constraint account_traffic_events_action_check
  check (action in ('view','exposure','add_to_cart','form_start','submit_attempt','website_click','contact_download_click','phone_click','email_click','whatsapp_click','claim_attempt','copy_attempt','entry_click','join_attempt'));

create table if not exists public.account_traffic_daily (
  site_id text not null,
  event_day date not null,
  module text not null,
  object_id text not null,
  action text not null,
  source text not null,
  browser text not null,
  device text not null,
  medium text not null default 'unknown' check (medium in ('unknown','qr','share','nfc','ad')),
  object_label text not null,
  event_count bigint not null check (event_count > 0),
  first_at timestamptz not null,
  last_at timestamptz not null,
  primary key(site_id,event_day,module,object_id,action,source,browser,device,medium)
);
create index if not exists account_traffic_daily_day on public.account_traffic_daily(event_day);
alter table public.account_traffic_daily enable row level security;
revoke all on public.account_traffic_daily from public,anon,authenticated;
grant select,insert,update,delete on public.account_traffic_daily to service_role;

insert into public.account_traffic_daily
  (site_id,event_day,module,object_id,action,source,browser,device,medium,object_label,event_count,first_at,last_at)
select site_id,(created_at at time zone 'Europe/Madrid')::date,module,object_id,action,source,browser,device,medium,
  (array_agg(object_label order by created_at desc,event_id desc))[1],count(*),min(created_at),max(created_at)
from public.account_traffic_events group by 1,2,3,4,5,6,7,8,9
on conflict(site_id,event_day,module,object_id,action,source,browser,device,medium) do nothing;

create or replace function public.faolla_account_traffic_rollup_insert()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  insert into public.account_traffic_daily as d
    (site_id,event_day,module,object_id,action,source,browser,device,medium,object_label,event_count,first_at,last_at)
  values(new.site_id,(new.created_at at time zone 'Europe/Madrid')::date,new.module,new.object_id,new.action,
    new.source,new.browser,new.device,new.medium,new.object_label,1,new.created_at,new.created_at)
  on conflict(site_id,event_day,module,object_id,action,source,browser,device,medium) do update set
    event_count=d.event_count+1,
    first_at=least(d.first_at,excluded.first_at),
    last_at=greatest(d.last_at,excluded.last_at),
    object_label=case when excluded.last_at>=d.last_at then excluded.object_label else d.object_label end;
  return new;
end;
$$;
revoke all on function public.faolla_account_traffic_rollup_insert() from public,anon,authenticated;
grant execute on function public.faolla_account_traffic_rollup_insert() to service_role;
create or replace trigger account_traffic_rollup_insert
  after insert on public.account_traffic_events for each row execute function public.faolla_account_traffic_rollup_insert();

create or replace function public.faolla_account_traffic_report(p_site_id text, p_days integer default 30, p_offset integer default 0, p_module text default null, p_object_id text default null)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare result jsonb; start_at timestamptz; end_at timestamptz := now();
begin
  if p_site_id !~ '^[0-9]{8}$' or p_days not between 1 and 730 or p_offset not between 0 and 100000 then
    raise exception 'invalid_traffic_report_scope';
  end if;
  if (p_module is not null and p_module not in ('website','product','booking','card','coupon','poll','membership'))
    or (p_object_id is not null and (p_module is null or length(p_object_id) not between 1 and 240)) then
    raise exception 'invalid_traffic_object_scope';
  end if;
  start_at := ((end_at at time zone 'Europe/Madrid')::date - (p_days - 1))::timestamp at time zone 'Europe/Madrid';
  with events as materialized (
    select * from public.account_traffic_daily where site_id = p_site_id and event_day >= (start_at at time zone 'Europe/Madrid')::date and event_day <= (end_at at time zone 'Europe/Madrid')::date
      and (p_module is null or module = p_module) and (p_object_id is null or object_id = p_object_id)
  ), objects as (
    select module, object_id, (array_agg(object_label order by last_at desc, object_label desc))[1] as label,
      sum(event_count) as count, coalesce(sum(event_count) filter (where action = 'view'),0) as views,
      coalesce(sum(event_count) filter (where action = 'exposure'),0) as exposures,
      coalesce(sum(event_count) filter (where action not in ('view','exposure')),0) as actions
    from events group by module, object_id
  ) select jsonb_build_object(
    'timezone','Europe/Madrid', 'from',start_at, 'to',end_at,
    'firstCollectedAt',(select min(first_at) from public.account_traffic_daily where site_id = p_site_id),
    'totalEvents',(select coalesce(sum(event_count),0) from events),
    'views',(select coalesce(sum(event_count),0) from events where action = 'view'),
    'exposures',(select coalesce(sum(event_count),0) from events where action = 'exposure'),
    'actions',(select coalesce(sum(event_count),0) from events where action not in ('view','exposure')),
    'daily',coalesce((select jsonb_agg(x order by key) from (
      select to_char(event_day,'YYYY-MM-DD') as key, sum(event_count) as count,
        coalesce(sum(event_count) filter (where action = 'view'),0) as views, coalesce(sum(event_count) filter (where action = 'exposure'),0) as exposures,
        coalesce(sum(event_count) filter (where action not in ('view','exposure')),0) as actions from events group by 1) x),'[]'::jsonb),
    'modules',coalesce((select jsonb_agg(x order by key) from (
      select module as key, sum(event_count) as count, coalesce(sum(event_count) filter (where action = 'view'),0) as views,
        coalesce(sum(event_count) filter (where action = 'exposure'),0) as exposures, coalesce(sum(event_count) filter (where action not in ('view','exposure')),0) as actions
      from events group by module) x),'[]'::jsonb),
    'objectCount',(select count(*) from objects),
    'objects',coalesce((select jsonb_agg(x) from (select object_id as key,module,label,count,views,exposures,actions
      from objects order by count desc,module,object_id limit 50 offset p_offset) x),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(x order by count desc,key) from (select source as key,sum(event_count) as count from events where action in ('view','exposure') group by source) x),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(x order by count desc,key) from (select medium as key,sum(event_count) as count from events where action in ('view','exposure') group by medium) x),'[]'::jsonb),
    'browsers',coalesce((select jsonb_agg(x order by count desc,key) from (select browser as key,sum(event_count) as count from events where action in ('view','exposure') group by browser) x),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(x order by count desc,key) from (select device as key,sum(event_count) as count from events where action in ('view','exposure') group by device) x),'[]'::jsonb),
    'actionTypes',coalesce((select jsonb_agg(x order by count desc,key) from (select action as key,sum(event_count) as count from events group by action) x),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.faolla_account_traffic_report(text,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.faolla_account_traffic_report(text,integer,integer,text,text) to service_role;


-- Explicit opt-in only. Installing this function does NOT schedule or execute
-- deletion. Defaults to a read-only preview; limits are fixed, not caller dates.
create or replace function public.faolla_account_traffic_retention(p_apply boolean default false,p_batch_size integer default 5000)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  raw_cutoff timestamptz := (((now() at time zone 'Europe/Madrid')::date-90)::timestamp at time zone 'Europe/Madrid');
  daily_cutoff date := ((now() at time zone 'Europe/Madrid')::date-interval '25 months')::date;
  raw_count bigint; daily_count bigint; removed_raw bigint := 0; removed_daily bigint := 0; missing_rollups bigint := 0;
begin
  if p_apply is null or p_batch_size is null or p_batch_size not between 1 and 10000 then
    raise exception 'invalid_retention_options';
  end if;
  select count(*) into raw_count from public.account_traffic_events where created_at<raw_cutoff;
  select count(*) into daily_count from public.account_traffic_daily where event_day<daily_cutoff;
  if p_apply then
    if not pg_try_advisory_xact_lock(230049,230050) then
      return jsonb_build_object('busy',true,'applied',false);
    end if;
    with candidates as materialized (
      select * from public.account_traffic_events where created_at<raw_cutoff
      order by created_at,site_id,event_id limit p_batch_size for update skip locked
    ), grouped as (
      select site_id,(created_at at time zone 'Europe/Madrid')::date as event_day,module,object_id,action,source,browser,device,medium,
        count(*) as amount from candidates group by 1,2,3,4,5,6,7,8,9
    ), unbacked as (
      select 1 from grouped g left join public.account_traffic_daily d
        using(site_id,event_day,module,object_id,action,source,browser,device,medium)
      where d.event_count is null or d.event_count<g.amount
    ), removed as (
      delete from public.account_traffic_events e using candidates c
      where e.site_id=c.site_id and e.event_id=c.event_id and not exists(select 1 from unbacked)
      returning 1
    )
    select (select count(*) from removed),(select count(*) from unbacked) into removed_raw,missing_rollups;
    if missing_rollups=0 then
      with candidates as (
        select d.ctid from public.account_traffic_daily d where d.event_day<daily_cutoff
          and not exists(select 1 from public.account_traffic_events e where e.site_id=d.site_id
            and e.created_at >= (d.event_day::timestamp at time zone 'Europe/Madrid')
            and e.created_at < ((d.event_day+1)::timestamp at time zone 'Europe/Madrid'))
        order by d.event_day limit p_batch_size for update skip locked
      ), removed as (
        delete from public.account_traffic_daily d using candidates c where d.ctid=c.ctid returning 1
      ) select count(*) into removed_daily from removed;
    end if;
  end if;
  return jsonb_build_object('applied',p_apply,'rawCutoff',raw_cutoff,'dailyCutoff',daily_cutoff,
    'expiredRaw',raw_count,'expiredDaily',daily_count,'removedRaw',removed_raw,'removedDaily',removed_daily,
    'blockedMissingRollups',missing_rollups,'batchLimit',p_batch_size);
end;
$$;
revoke all on function public.faolla_account_traffic_retention(boolean,integer) from public,anon,authenticated;
grant execute on function public.faolla_account_traffic_retention(boolean,integer) to service_role;

insert into public.faolla_schema_migrations(version,name)
values(202609230050,'account_traffic_rollup_retention') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
