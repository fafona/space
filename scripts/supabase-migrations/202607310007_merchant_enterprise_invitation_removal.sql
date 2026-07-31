-- Allow an explicitly requested, still-pending employee invitation to be
-- removed without cascading or rewriting any task history. Supabase Auth
-- principals are intentionally outside this database transaction and are not
-- touched by this RPC.

begin;

create or replace function public.faolla_remove_merchant_employee_invitation_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_employee_id uuid;
  v_expected_version bigint;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_removed_employee_id uuid;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_employee_invitation_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_employee_id := nullif(btrim(p_input ->> 'employee_id'), '')::uuid;
  v_expected_version := nullif(btrim(p_input ->> 'expected_version'), '')::bigint;
  if v_site_id is null
     or v_employee_id is null
     or v_expected_version is null
     or v_expected_version <= 0 then
    raise exception 'invalid_employee_invitation';
  end if;

  select *
    into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id
   for update;
  if not found then
    raise exception 'employee_not_found';
  end if;
  if v_employee.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if v_employee.status <> 'invited' or v_employee.accepted_at is not null then
    raise exception 'employee_invitation_not_pending';
  end if;

  if exists (
    select 1
      from public.merchant_tasks
     where merchant_id = v_site_id
       and created_by_employee_id = v_employee_id
  ) or exists (
    select 1
      from public.merchant_task_assignees
     where merchant_id = v_site_id
       and (
         employee_id = v_employee_id
         or assigned_by_employee_id = v_employee_id
       )
  ) then
    raise exception 'employee_invitation_in_use';
  end if;

  delete from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_employee_id
     and version = v_expected_version
     and status = 'invited'
     and accepted_at is null
  returning id into v_removed_employee_id;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  return jsonb_build_object(
    'removed',
    true,
    'employee_id',
    v_removed_employee_id::text
  );
end;
$$;

revoke all on function public.faolla_remove_merchant_employee_invitation_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_remove_merchant_employee_invitation_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310007, 'merchant_enterprise_invitation_removal')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
