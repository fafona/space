-- Harden the existing task source fields for immutable, one-to-one order links.
-- This migration never repairs or removes existing task data. It fails before
-- applying schema changes when current rows cannot satisfy the new contract.

begin;

-- Optimistic read-only preflight. The transaction is still unchanged if any
-- legacy row needs an explicit operator decision.
do $preflight$
declare
  v_invalid_pair_count bigint;
  v_invalid_length_count bigint;
  v_duplicate_order_count bigint;
begin
  select count(*)
    into v_invalid_pair_count
    from public.merchant_tasks
   where source_type is null
      or source_id is null
      or (source_type = '' and source_id <> '')
      or (source_type <> '' and source_id = '');

  if v_invalid_pair_count > 0 then
    raise exception 'merchant_task_source_pair_invalid'
      using errcode = 'P0001',
            detail = format(
              '%s existing merchant_tasks row(s) have only one source field populated',
              v_invalid_pair_count
            );
  end if;

  select count(*)
    into v_invalid_length_count
    from public.merchant_tasks
   where char_length(source_type) > 80
      or char_length(source_id) > 200;

  if v_invalid_length_count > 0 then
    raise exception 'merchant_task_source_length_invalid'
      using errcode = 'P0001',
            detail = format(
              '%s existing merchant_tasks row(s) exceed the source length limits',
              v_invalid_length_count
            );
  end if;

  select count(*)
    into v_duplicate_order_count
    from (
      select merchant_id, source_id
        from public.merchant_tasks
       where source_type = 'order'
       group by merchant_id, source_id
      having count(*) > 1
    ) as duplicate_order_source;

  if v_duplicate_order_count > 0 then
    raise exception 'merchant_order_task_source_duplicate'
      using errcode = 'P0001',
            detail = format(
              '%s merchant/order source pair(s) already link to multiple tasks',
              v_duplicate_order_count
            );
  end if;
end;
$preflight$;

-- Stop source-changing writes for the rest of the transaction, then repeat the
-- read-only checks under the lock so a concurrent writer cannot race the DDL.
lock table public.merchant_tasks in share row exclusive mode;

do $locked_preflight$
declare
  v_invalid_pair_count bigint;
  v_invalid_length_count bigint;
  v_duplicate_order_count bigint;
begin
  select count(*)
    into v_invalid_pair_count
    from public.merchant_tasks
   where source_type is null
      or source_id is null
      or (source_type = '' and source_id <> '')
      or (source_type <> '' and source_id = '');

  if v_invalid_pair_count > 0 then
    raise exception 'merchant_task_source_pair_invalid'
      using errcode = 'P0001',
            detail = format(
              '%s existing merchant_tasks row(s) have only one source field populated',
              v_invalid_pair_count
            );
  end if;

  select count(*)
    into v_invalid_length_count
    from public.merchant_tasks
   where char_length(source_type) > 80
      or char_length(source_id) > 200;

  if v_invalid_length_count > 0 then
    raise exception 'merchant_task_source_length_invalid'
      using errcode = 'P0001',
            detail = format(
              '%s existing merchant_tasks row(s) exceed the source length limits',
              v_invalid_length_count
            );
  end if;

  select count(*)
    into v_duplicate_order_count
    from (
      select merchant_id, source_id
        from public.merchant_tasks
       where source_type = 'order'
       group by merchant_id, source_id
      having count(*) > 1
    ) as duplicate_order_source;

  if v_duplicate_order_count > 0 then
    raise exception 'merchant_order_task_source_duplicate'
      using errcode = 'P0001',
            detail = format(
              '%s merchant/order source pair(s) already link to multiple tasks',
              v_duplicate_order_count
            );
  end if;
end;
$locked_preflight$;

alter table public.merchant_tasks
  add constraint merchant_tasks_source_pair_check
  check (
    (source_type = '' and source_id = '')
    or (source_type <> '' and source_id <> '')
  );

alter table public.merchant_tasks
  add constraint merchant_tasks_source_length_check
  check (
    char_length(source_type) <= 80
    and char_length(source_id) <= 200
  );

-- Deliberately includes archived tasks: archiving a task must not make the same
-- order available for a second task link.
create unique index merchant_tasks_order_source_unique_idx
  on public.merchant_tasks(merchant_id, source_id)
  where source_type = 'order';

create or replace function public.faolla_guard_merchant_task_source_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_task_id uuid;
begin
  if tg_op = 'UPDATE' then
    v_current_task_id := old.id;

    if new.source_type is distinct from old.source_type
       or new.source_id is distinct from old.source_id then
      raise exception 'merchant_task_source_immutable'
        using errcode = 'P0001';
    end if;
  end if;

  if new.source_type = 'order' then
    -- The lock converts concurrent creates for one merchant/order pair into a
    -- deterministic existence check. The unique index remains the final guard.
    perform pg_advisory_xact_lock(
      hashtextextended(
        jsonb_build_array(new.merchant_id, new.source_id)::text,
        0
      )
    );

    if exists (
      select 1
        from public.merchant_tasks as existing_task
       where existing_task.merchant_id = new.merchant_id
         and existing_task.source_type = 'order'
         and existing_task.source_id = new.source_id
         and (
           v_current_task_id is null
           or existing_task.id <> v_current_task_id
         )
    ) then
      raise exception 'merchant_order_task_exists'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.merchant_tasks'::regclass
       and tgname = 'merchant_tasks_source_guard'
       and not tgisinternal
  ) then
    create trigger merchant_tasks_source_guard
    before insert or update on public.merchant_tasks
    for each row
    execute function public.faolla_guard_merchant_task_source_v1();
  end if;
end;
$$;

revoke all on function public.faolla_guard_merchant_task_source_v1()
  from public, anon, authenticated, service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310012, 'merchant_order_task_link')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
