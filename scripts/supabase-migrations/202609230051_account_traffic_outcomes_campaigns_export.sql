begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.account_traffic_events in share row exclusive mode;
alter table public.account_traffic_events add column if not exists campaign_id text not null default '' check(length(campaign_id)<=36);
alter table public.account_traffic_events add column if not exists campaign_label text not null default '' check(length(campaign_label)<=80);
alter table public.account_traffic_daily add column if not exists campaign_id text not null default '' check(length(campaign_id)<=36);
alter table public.account_traffic_daily add column if not exists campaign_label text not null default '' check(length(campaign_label)<=80);
alter table public.account_traffic_daily drop constraint account_traffic_daily_pkey;
alter table public.account_traffic_daily add primary key(site_id,event_day,module,object_id,action,source,browser,device,medium,campaign_id);
alter table public.account_traffic_events drop constraint account_traffic_events_module_check;
alter table public.account_traffic_events add constraint account_traffic_events_module_check check(module in ('website','product','booking','card','coupon','poll','membership','order'));
alter table public.account_traffic_events drop constraint account_traffic_events_action_check;
alter table public.account_traffic_events add constraint account_traffic_events_action_check check(action in ('view','exposure','add_to_cart','form_start','submit_attempt','website_click','contact_download_click','phone_click','email_click','whatsapp_click','claim_attempt','copy_attempt','entry_click','join_attempt','booking_created','order_created','membership_joined','poll_submitted'));
create or replace function public.faolla_account_traffic_rollup_insert()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  insert into public.account_traffic_daily as d
    (site_id,event_day,module,object_id,action,source,browser,device,medium,campaign_id,campaign_label,object_label,event_count,first_at,last_at)
  values(new.site_id,(new.created_at at time zone 'Europe/Madrid')::date,new.module,new.object_id,new.action,
    new.source,new.browser,new.device,new.medium,new.campaign_id,new.campaign_label,new.object_label,1,new.created_at,new.created_at)
  on conflict(site_id,event_day,module,object_id,action,source,browser,device,medium,campaign_id) do update set
    event_count=d.event_count+1,
    campaign_label=excluded.campaign_label,
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


create or replace function public.faolla_account_traffic_report_snapshot(p_site_id text, p_days integer, p_offset integer, p_module text, p_object_id text, p_all boolean)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare result jsonb; start_at timestamptz; end_at timestamptz := now();
begin
  if p_site_id !~ '^[0-9]{8}$' or p_days not between 1 and 730 or p_offset not between 0 and 100000 then
    raise exception 'invalid_traffic_report_scope';
  end if;
  if (p_module is not null and p_module not in ('website','product','booking','card','coupon','poll','membership','order'))
    or (p_object_id is not null and (p_module is null or length(p_object_id) not between 1 and 240)) then
    raise exception 'invalid_traffic_object_scope';
  end if;
  start_at := ((end_at at time zone 'Europe/Madrid')::date - (p_days - 1))::timestamp at time zone 'Europe/Madrid';
  with events as materialized (
    select * from public.account_traffic_daily where site_id = p_site_id and event_day >= (start_at at time zone 'Europe/Madrid')::date and event_day <= (end_at at time zone 'Europe/Madrid')::date
      and (p_module is null or module = p_module) and (p_object_id is null or object_id = p_object_id)
  ), objects as (
    select module, object_id, (array_agg(object_label order by case when action in ('booking_created','order_created','membership_joined','poll_submitted') then 1 else 0 end,last_at desc, object_label desc))[1] as label,
      sum(event_count) as count, coalesce(sum(event_count) filter (where action = 'view'),0) as views,
      coalesce(sum(event_count) filter (where action = 'exposure'),0) as exposures,
      coalesce(sum(event_count) filter (where action not in ('view','exposure','booking_created','order_created','membership_joined','poll_submitted')),0) as actions,
      coalesce(sum(event_count) filter (where action in ('booking_created','order_created','membership_joined','poll_submitted')),0) as successes
    from events group by module, object_id
  ) select jsonb_build_object(
    'exportScope',case when p_all then 'all' else 'page' end,
    'timezone','Europe/Madrid', 'from',start_at, 'to',end_at,
    'firstCollectedAt',(select min(first_at) from public.account_traffic_daily where site_id = p_site_id),
    'totalEvents',(select coalesce(sum(event_count),0) from events),
    'views',(select coalesce(sum(event_count),0) from events where action = 'view'),
    'exposures',(select coalesce(sum(event_count),0) from events where action = 'exposure'),
    'actions',(select coalesce(sum(event_count),0) from events where action not in ('view','exposure','booking_created','order_created','membership_joined','poll_submitted')),
    'daily',coalesce((select jsonb_agg(x order by key) from (
      select to_char(event_day,'YYYY-MM-DD') as key, sum(event_count) as count,
        coalesce(sum(event_count) filter (where action = 'view'),0) as views, coalesce(sum(event_count) filter (where action = 'exposure'),0) as exposures,
        coalesce(sum(event_count) filter (where action not in ('view','exposure','booking_created','order_created','membership_joined','poll_submitted')),0) as actions,
      coalesce(sum(event_count) filter (where action in ('booking_created','order_created','membership_joined','poll_submitted')),0) as successes from events group by 1) x),'[]'::jsonb),
    'modules',coalesce((select jsonb_agg(x order by key) from (
      select module as key, sum(event_count) as count, coalesce(sum(event_count) filter (where action = 'view'),0) as views,
        coalesce(sum(event_count) filter (where action = 'exposure'),0) as exposures, coalesce(sum(event_count) filter (where action not in ('view','exposure','booking_created','order_created','membership_joined','poll_submitted')),0) as actions,
      coalesce(sum(event_count) filter (where action in ('booking_created','order_created','membership_joined','poll_submitted')),0) as successes
      from events group by module) x),'[]'::jsonb),
    'objectCount',(select count(*) from objects),
    'objects',coalesce((select jsonb_agg(x) from (select object_id as key,module,label,count,views,exposures,actions,successes
      from objects order by count desc,module,object_id limit case when p_all then null else 50 end offset case when p_all then 0 else p_offset end) x),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(x order by count desc,key) from (select source as key,sum(event_count) as count from events where action in ('view','exposure') group by source) x),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(x order by count desc,key) from (select medium as key,sum(event_count) as count from events where action in ('view','exposure') group by medium) x),'[]'::jsonb),
    'browsers',coalesce((select jsonb_agg(x order by count desc,key) from (select browser as key,sum(event_count) as count from events where action in ('view','exposure') group by browser) x),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(x order by count desc,key) from (select device as key,sum(event_count) as count from events where action in ('view','exposure') group by device) x),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(x order by count desc,key) from (select campaign_id as key,max(campaign_label) as label,sum(event_count) as count,coalesce(sum(event_count) filter(where action='view'),0) as views,coalesce(sum(event_count) filter(where action='exposure'),0) as exposures,coalesce(sum(event_count) filter(where action not in ('view','exposure','booking_created','order_created','membership_joined','poll_submitted')),0) as actions,coalesce(sum(event_count) filter(where action in ('booking_created','order_created','membership_joined','poll_submitted')),0) as successes from events where campaign_id<>'' group by campaign_id) x),'[]'::jsonb),
    'outcomes',coalesce((select jsonb_agg(x order by key) from (select action as key,sum(event_count) as count from events where action in ('booking_created','order_created','membership_joined','poll_submitted') group by action) x),'[]'::jsonb),
    'actionTypes',coalesce((select jsonb_agg(x order by count desc,key) from (select action as key,sum(event_count) as count from events group by action) x),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;


revoke all on function public.faolla_account_traffic_report_snapshot(text,integer,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.faolla_account_traffic_report_snapshot(text,integer,integer,text,text,boolean) to service_role;
create or replace function public.faolla_account_traffic_report(p_site_id text,p_days integer default 30,p_offset integer default 0,p_module text default null,p_object_id text default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
select public.faolla_account_traffic_report_snapshot(p_site_id,p_days,p_offset,p_module,p_object_id,false);
$$;
create or replace function public.faolla_account_traffic_report_full(p_site_id text,p_days integer default 30,p_module text default null,p_object_id text default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
select public.faolla_account_traffic_report_snapshot(p_site_id,p_days,0,p_module,p_object_id,true);
$$;
revoke all on function public.faolla_account_traffic_report(text,integer,integer,text,text) from public,anon,authenticated;
revoke all on function public.faolla_account_traffic_report_full(text,integer,text,text) from public,anon,authenticated;
grant execute on function public.faolla_account_traffic_report(text,integer,integer,text,text) to service_role;
grant execute on function public.faolla_account_traffic_report_full(text,integer,text,text) to service_role;

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
      select site_id,(created_at at time zone 'Europe/Madrid')::date as event_day,module,object_id,action,source,browser,device,medium,campaign_id,
        count(*) as amount from candidates group by 1,2,3,4,5,6,7,8,9,10
    ), unbacked as (
      select 1 from grouped g left join public.account_traffic_daily d
        using(site_id,event_day,module,object_id,action,source,browser,device,medium,campaign_id)
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


insert into public.faolla_schema_migrations(version,name) values(202609230051,'account_traffic_outcomes_campaigns_export') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
