begin;

-- Archived workflows are deliberately outside the bounded active-workflow list.
-- This partial index supports stable newest-first keyset pagination per merchant.
create index if not exists merchant_enterprise_workflows_archived_updated_idx
  on public.merchant_enterprise_workflows(merchant_id, updated_at desc, id desc)
  where status = 'archived';
create index if not exists merchant_enterprise_workflows_archived_scenario_idx
  on public.merchant_enterprise_workflows(
    merchant_id, scenario, updated_at desc, id desc
  )
  where status = 'archived';
create index if not exists merchant_enterprise_workflows_archived_tags_idx
  on public.merchant_enterprise_workflows using gin(tags)
  where status = 'archived';

-- Keep the preflight and trigger installation in one write-free window. This
-- prevents a legacy restore from crossing the limit between the check and the
-- moment the new guard becomes active.
lock table public.merchant_enterprise_workflows in share row exclusive mode;

-- The active-workflow ceiling was introduced with workflow creation. Refuse to
-- install the restore guard over pre-existing invalid data: silently preserving
-- an over-limit merchant would make the invariant impossible to reason about.
do $$
begin
  if exists (
    select 1
    from public.merchant_enterprise_workflows as workflow
    where workflow.status <> 'archived'
    group by workflow.merchant_id
    having count(*) > 200
  ) then
    raise exception 'workflow_active_limit_existing_violation';
  end if;
end;
$$;

-- Restores and creates use the same transaction-scoped merchant lock. The
-- function is VOLATILE so a restore that waited for another transaction sees
-- that transaction's newly committed workflow before it counts.
create or replace function public.faolla_enforce_merchant_workflow_active_limit_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_active_count integer;
begin
  if old.status = 'archived' and new.status <> 'archived' then
    perform pg_advisory_xact_lock(
      hashtextextended('faolla-enterprise-workflows:' || new.merchant_id, 0)
    );
    select count(*)::integer into v_active_count
    from public.merchant_enterprise_workflows as workflow
    where workflow.merchant_id = new.merchant_id
      and workflow.status <> 'archived';
    if v_active_count >= 200 then
      raise exception 'workflow_limit_reached';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_enterprise_workflows_active_limit
  on public.merchant_enterprise_workflows;
create trigger merchant_enterprise_workflows_active_limit
before update of status on public.merchant_enterprise_workflows
for each row
execute function public.faolla_enforce_merchant_workflow_active_limit_v1();

-- Row triggers do not run for TRUNCATE. A statement trigger closes that gap in
-- the append-only revision history and is enabled in replica mode as well.
drop trigger if exists merchant_enterprise_workflow_revisions_reject_truncate
  on public.merchant_enterprise_workflow_revisions;
create trigger merchant_enterprise_workflow_revisions_reject_truncate
before truncate on public.merchant_enterprise_workflow_revisions
for each statement
execute function public.faolla_reject_merchant_workflow_revision_mutation_v1();
alter table public.merchant_enterprise_workflow_revisions
  enable always trigger merchant_enterprise_workflow_revisions_reject_truncate;

create or replace function public.faolla_list_merchant_enterprise_archived_workflows_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_auth jsonb;
  v_limit integer := 50;
  v_cursor_updated_at timestamptz := null;
  v_cursor_id uuid := null;
  v_cursor_id_text text;
  v_query text := null;
  v_scenario text := null;
  v_tag text := null;
  v_workflows jsonb;
  v_next_cursor jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'limit', 'cursor',
      'query', 'scenario', 'tag'
    ]::text[]
  ) then
    raise exception 'invalid_workflow_query';
  end if;

  if p_input ? 'limit' then
    if coalesce(jsonb_typeof(p_input -> 'limit'), '') <> 'number'
       or (p_input ->> 'limit') !~ '^[1-9][0-9]*$' then
      raise exception 'invalid_workflow_query';
    end if;
    begin
      v_limit := (p_input ->> 'limit')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_workflow_query';
    end;
    if v_limit not between 1 and 100 then
      raise exception 'invalid_workflow_query';
    end if;
  end if;

  if p_input ? 'query' then
    if coalesce(jsonb_typeof(p_input -> 'query'), '') <> 'string' then
      raise exception 'invalid_workflow_query';
    end if;
    v_query := btrim(p_input ->> 'query');
    if char_length(v_query) not between 1 and 160 then
      raise exception 'invalid_workflow_query';
    end if;
  end if;
  if p_input ? 'scenario' then
    if coalesce(jsonb_typeof(p_input -> 'scenario'), '') <> 'string' then
      raise exception 'invalid_workflow_query';
    end if;
    v_scenario := btrim(p_input ->> 'scenario');
    if char_length(v_scenario) not between 1 and 500 then
      raise exception 'invalid_workflow_query';
    end if;
  end if;
  if p_input ? 'tag' then
    if coalesce(jsonb_typeof(p_input -> 'tag'), '') <> 'string' then
      raise exception 'invalid_workflow_query';
    end if;
    v_tag := btrim(p_input ->> 'tag');
    if char_length(v_tag) not between 1 and 40 then
      raise exception 'invalid_workflow_query';
    end if;
  end if;

  if p_input ? 'cursor'
     and coalesce(jsonb_typeof(p_input -> 'cursor'), '') <> 'null' then
    if not public.faolla_merchant_workflow_object_has_only_keys_v1(
      p_input -> 'cursor',
      array['updated_at', 'id']::text[]
    )
    or not ((p_input -> 'cursor') ? 'updated_at')
    or not ((p_input -> 'cursor') ? 'id')
    or coalesce(jsonb_typeof(p_input -> 'cursor' -> 'updated_at'), '') <> 'string'
    or coalesce(jsonb_typeof(p_input -> 'cursor' -> 'id'), '') <> 'string' then
      raise exception 'invalid_workflow_cursor';
    end if;
    begin
      v_cursor_updated_at := nullif(
        btrim(p_input -> 'cursor' ->> 'updated_at'), ''
      )::timestamptz;
    exception
      when invalid_text_representation
        or invalid_datetime_format
        or datetime_field_overflow then
      raise exception 'invalid_workflow_cursor';
    end;
    v_cursor_id_text := nullif(btrim(p_input -> 'cursor' ->> 'id'), '');
    if v_cursor_updated_at is null
       or v_cursor_id_text is null
       or v_cursor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_workflow_cursor';
    end if;
    v_cursor_id := v_cursor_id_text::uuid;
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view']::text[]
  );
  if (v_auth ->> 'actor_type') <> 'owner'
     and not coalesce((v_auth ->> 'can_manage')::boolean, false)
     and not coalesce((v_auth ->> 'can_publish')::boolean, false) then
    raise exception 'permission_denied';
  end if;

  with candidates as materialized (
    select
      workflow.merchant_id,
      workflow.id,
      workflow.updated_at
    from public.merchant_enterprise_workflows as workflow
    where workflow.merchant_id = v_site_id
      and workflow.status = 'archived'
      and (
        v_cursor_updated_at is null
        or (workflow.updated_at, workflow.id)
          < (v_cursor_updated_at, v_cursor_id)
      )
      and (v_scenario is null or workflow.scenario = v_scenario)
      and (v_tag is null or workflow.tags @> array[v_tag]::text[])
      and (
        v_query is null
        or strpos(lower(workflow.title), lower(v_query)) > 0
        or strpos(lower(workflow.scenario), lower(v_query)) > 0
        or strpos(lower(workflow.description), lower(v_query)) > 0
        or strpos(lower(workflow.category), lower(v_query)) > 0
        or exists (
          select 1
          from unnest(workflow.tags) as workflow_tag(value)
          where strpos(lower(workflow_tag.value), lower(v_query)) > 0
        )
        or exists (
          select 1
          from public.merchant_enterprise_workflow_steps as workflow_step
          where workflow_step.merchant_id = workflow.merchant_id
            and workflow_step.workflow_id = workflow.id
            and workflow_step.status = 'active'
            and (
              strpos(lower(workflow_step.title), lower(v_query)) > 0
              or strpos(lower(workflow_step.instruction), lower(v_query)) > 0
            )
        )
      )
    order by workflow.updated_at desc, workflow.id desc
    limit (v_limit + 1)
  ),
  returned as materialized (
    select page.merchant_id, page.id, page.updated_at
    from candidates as page
    order by page.updated_at desc, page.id desc
    limit v_limit
  )
  select
    (
      select coalesce(
        jsonb_agg(
          public.faolla_build_merchant_enterprise_workflow_v1(
            page.merchant_id, page.id, false
          ) order by page.updated_at desc, page.id desc
        ),
        '[]'::jsonb
      )
      from returned as page
    ),
    case when (select count(*) from candidates) > v_limit then
      (
        select jsonb_build_object(
          'updated_at', boundary.updated_at,
          'id', boundary.id
        )
        from returned as boundary
        order by boundary.updated_at, boundary.id
        limit 1
      )
    else null end
  into v_workflows, v_next_cursor;

  return jsonb_build_object(
    'workflows', v_workflows,
    'next_cursor', v_next_cursor
  );
end;
$$;

-- Notification navigation and direct links need one exact row without walking
-- archive pages. Authorization is recalculated inside the database on every
-- call. View-only employees receive only the immutable current publication;
-- owners, managers and publishers may inspect the current draft or archive.
create or replace function public.faolla_get_merchant_enterprise_workflow_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_workflow_id_text text;
  v_workflow_id uuid;
  v_auth jsonb;
  v_status text;
  v_current_revision_id uuid;
  v_can_read_current boolean;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'actor_type', 'actor_id', 'workflow_id']::text[]
  )
  or not (p_input ? 'workflow_id')
  or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string' then
    raise exception 'invalid_workflow_query';
  end if;

  v_workflow_id_text := nullif(btrim(p_input ->> 'workflow_id'), '');
  if v_workflow_id_text is null
     or v_workflow_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid_workflow_query';
  end if;
  v_workflow_id := v_workflow_id_text::uuid;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view']::text[]
  );
  v_can_read_current := (v_auth ->> 'actor_type') = 'owner'
    or coalesce((v_auth ->> 'can_manage')::boolean, false)
    or coalesce((v_auth ->> 'can_publish')::boolean, false);

  select workflow.status, workflow.current_revision_id
    into v_status, v_current_revision_id
  from public.merchant_enterprise_workflows as workflow
  where workflow.merchant_id = v_site_id
    and workflow.id = v_workflow_id;
  if not found
     or (
       not v_can_read_current
       and (v_status <> 'published' or v_current_revision_id is null)
     ) then
    raise exception 'workflow_not_found';
  end if;

  return jsonb_build_object(
    'workflow',
    public.faolla_build_merchant_enterprise_workflow_v1(
      v_site_id,
      v_workflow_id,
      not v_can_read_current
    )
  );
end;
$$;

revoke all on function public.faolla_enforce_merchant_workflow_active_limit_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_list_merchant_enterprise_archived_workflows_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_get_merchant_enterprise_workflow_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_list_merchant_enterprise_archived_workflows_v1(jsonb)
  to service_role;
grant execute on function public.faolla_get_merchant_enterprise_workflow_v1(jsonb)
  to service_role;

-- Keep the protected workflow storage unavailable even if database defaults or
-- future role grants change outside this migration.
revoke all on public.merchant_enterprise_workflows
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_workflow_steps
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_workflow_revisions
  from public, anon, authenticated, service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608030021, 'merchant_enterprise_workflow_archive_pagination')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
