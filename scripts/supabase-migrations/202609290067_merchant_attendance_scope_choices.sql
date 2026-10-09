-- Read-only owner selectors, including inactive and already-enrolled employees.
-- No backfills, business writes, new tables or broad metadata access for managers.
begin;
set local lock_timeout = '3s';
create function public.faolla_attendance_choices_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_merchant public.merchants%rowtype;
  v_kind text; v_search text; v_cursor uuid; v_rows jsonb; v_next uuid; v_ids uuid[];
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request'; end if;
  if coalesce(p_query->>'kind','') not in ('managers','workers','locations') then raise exception 'attendance_invalid_request'; end if;
  if p_query ? 'ids' then
    if (select count(*) from jsonb_object_keys(p_query))<>2 or jsonb_typeof(p_query->'ids')<>'array'
      then raise exception 'attendance_invalid_request'; end if;
    if jsonb_array_length(p_query->'ids') not between 1 and 25
      then raise exception 'attendance_invalid_request'; end if;
    if exists(select 1 from jsonb_array_elements(p_query->'ids') x where jsonb_typeof(x)<>'string'
      or (x #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      then raise exception 'attendance_invalid_request'; end if;
    select array_agg((x #>> '{}')::uuid order by x #>> '{}') into v_ids from jsonb_array_elements(p_query->'ids') x;
    if cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x) then raise exception 'attendance_invalid_request'; end if;
    v_search:=''; v_cursor:=null;
  else
    if (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['kind','search','cursor'])
    or jsonb_typeof(p_query->'search')<>'string' or char_length(p_query->>'search')>80
    or (p_query->>'search') ~ '[[:cntrl:]]'
    or (p_query->'cursor'<>'null'::jsonb and coalesce(p_query->>'cursor','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  then raise exception 'attendance_invalid_request'; end if;
    v_search:=lower(btrim(p_query->>'search')); v_cursor:=(p_query->>'cursor')::uuid;
  end if;
  v_kind:=p_query->>'kind';
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,
    v_merchant.owner_id,v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required'; end if;
  -- Eligibility is a hint only. Scope writes lock and revalidate the target role.
  if v_kind='managers' then
    select coalesce(jsonb_agg(j order by id) filter(where n<=25),'[]'::jsonb),
      case when count(*)>25 then (array_agg(id order by id))[25] end into v_rows,v_next from (
      select e.id,row_number() over(order by e.id) n,jsonb_build_object('id',e.id,'label',e.display_name,
        'detail',e.status,'eligible',coalesce(e.status='active' and r.status='active'
          and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
          and 'attendance.records.view'=any(r.permissions),false)) j
      from public.merchant_enterprise_employees e left join public.merchant_enterprise_roles r
        on r.merchant_id=e.merchant_id and r.id=e.role_id
      where e.merchant_id=p_site_id and (v_cursor is null or e.id>v_cursor)
        and (v_ids is null or e.id=any(v_ids))
        and (v_search='' or strpos(lower(e.display_name),v_search)>0) order by e.id limit 26) page;
  elsif v_kind='workers' then
    select coalesce(jsonb_agg(j order by id) filter(where n<=25),'[]'::jsonb),
      case when count(*)>25 then (array_agg(id order by id))[25] end into v_rows,v_next from (
      select w.id,row_number() over(order by w.id) n,jsonb_build_object('id',w.id,'label',w.display_name,
        'detail',w.worker_no,'eligible',w.active) j from public.merchant_attendance_workers w
      where w.merchant_id=p_site_id and (v_cursor is null or w.id>v_cursor)
        and (v_ids is null or w.id=any(v_ids))
        and (v_search='' or strpos(lower(w.display_name||' '||w.worker_no),v_search)>0) order by w.id limit 26) page;
  else
    select coalesce(jsonb_agg(j order by id) filter(where n<=25),'[]'::jsonb),
      case when count(*)>25 then (array_agg(id order by id))[25] end into v_rows,v_next from (
      select l.id,row_number() over(order by l.id) n,jsonb_build_object('id',l.id,'label',l.name,
        'detail',l.time_zone,'eligible',l.active) j from public.merchant_attendance_locations l
      where l.merchant_id=p_site_id and (v_cursor is null or l.id>v_cursor)
        and (v_ids is null or l.id=any(v_ids))
        and (v_search='' or strpos(lower(l.name),v_search)>0) order by l.id limit 26) page;
  end if;
  -- No next cursor when exactly 25 matched. Each branch returns a bounded page.
  return jsonb_build_object('siteId',p_site_id,'kind',v_kind,'items',v_rows,'nextCursor',v_next);
end; $$;
revoke all on function public.faolla_attendance_choices_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_choices_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609290067,'merchant_attendance_scope_choices') on conflict(version) do nothing;
commit;
