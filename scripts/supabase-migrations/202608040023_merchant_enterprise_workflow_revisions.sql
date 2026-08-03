begin;

-- Published workflow revisions are immutable. These RPCs expose that history
-- without granting table access, and restore by copying a snapshot into the
-- mutable draft tables. A restore never updates an existing revision row.

create or replace function public.faolla_list_merchant_enterprise_workflow_revisions_v1(
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
  v_limit integer := 50;
  v_before_revision integer;
  v_auth jsonb;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revisions jsonb;
  v_next_before_revision integer;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'workflow_id',
      'limit', 'before_revision'
    ]::text[]
  ) then
    raise exception 'invalid_workflow_revision_query';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id_text := nullif(btrim(p_input ->> 'workflow_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
     or v_workflow_id_text is null
     or v_workflow_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid_workflow_revision_query';
  end if;
  v_workflow_id := v_workflow_id_text::uuid;

  if p_input ? 'limit' then
    if coalesce(jsonb_typeof(p_input -> 'limit'), '') <> 'number'
       or (p_input ->> 'limit') !~ '^[1-9][0-9]*$' then
      raise exception 'invalid_workflow_revision_query';
    end if;
    begin
      v_limit := (p_input ->> 'limit')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_workflow_revision_query';
    end;
    if v_limit not between 1 and 100 then
      raise exception 'invalid_workflow_revision_query';
    end if;
  end if;

  if p_input ? 'before_revision' then
    if coalesce(jsonb_typeof(p_input -> 'before_revision'), '') <> 'number'
       or (p_input ->> 'before_revision') !~ '^[1-9][0-9]*$' then
      raise exception 'invalid_workflow_revision_query';
    end if;
    begin
      v_before_revision := (p_input ->> 'before_revision')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_workflow_revision_query';
    end;
  end if;

  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view']::text[]
  );
  if v_auth ->> 'actor_type' <> 'owner'
     and not coalesce((v_auth ->> 'can_manage')::boolean, false)
     and not coalesce((v_auth ->> 'can_publish')::boolean, false) then
    raise exception 'permission_denied';
  end if;

  select * into v_workflow
    from public.merchant_enterprise_workflows as workflow
   where workflow.merchant_id = v_site_id
     and workflow.id = v_workflow_id
   for share;
  if not found then
    raise exception 'workflow_not_found';
  end if;

  with page as materialized (
    select revision.id, revision.revision_no, revision.snapshot, revision.published_at
      from public.merchant_enterprise_workflow_revisions as revision
     where revision.merchant_id = v_site_id
       and revision.workflow_id = v_workflow_id
       and (
         v_before_revision is null
         or revision.revision_no < v_before_revision
       )
     order by revision.revision_no desc
     limit (v_limit + 1)
  ), returned as materialized (
    select *
      from page
     order by revision_no desc
     limit v_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', returned.id,
        'revision_no', returned.revision_no,
        'published_at', returned.published_at,
        'title', returned.snapshot ->> 'title',
        'scenario', returned.snapshot ->> 'scenario',
        'category', returned.snapshot ->> 'category',
        'tags', coalesce(returned.snapshot -> 'tags', '[]'::jsonb),
        'step_count', coalesce(jsonb_array_length(returned.snapshot -> 'steps'), 0),
        'is_current', returned.id = v_workflow.current_revision_id
      ) order by returned.revision_no desc
    ),
    '[]'::jsonb
  ) into v_revisions
  from returned;

  with page as materialized (
    select revision.revision_no
      from public.merchant_enterprise_workflow_revisions as revision
     where revision.merchant_id = v_site_id
       and revision.workflow_id = v_workflow_id
       and (
         v_before_revision is null
         or revision.revision_no < v_before_revision
       )
     order by revision.revision_no desc
     limit (v_limit + 1)
  )
  select case
    when count(*) > v_limit then min(revision_no) filter (
      where revision_no in (
        select selected.revision_no
          from page as selected
         order by selected.revision_no desc
         limit v_limit
      )
    )
    else null
  end into v_next_before_revision
  from page;

  return jsonb_build_object(
    'merchantId', v_site_id,
    'workflow', jsonb_build_object(
      'id', v_workflow.id,
      'title', v_workflow.title,
      'status', v_workflow.status,
      'version', v_workflow.version,
      'published_version', v_workflow.published_version,
      'has_unpublished_changes', v_workflow.has_unpublished_changes
    ),
    'revisions', v_revisions,
    'next_before_revision', v_next_before_revision
  );
end;
$$;

create or replace function public.faolla_get_merchant_enterprise_workflow_revision_v1(
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
  v_revision_no integer;
  v_auth jsonb;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_previous public.merchant_enterprise_workflow_revisions%rowtype;
  v_current jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'actor_type', 'actor_id', 'workflow_id', 'revision_no']::text[]
  ) then
    raise exception 'invalid_workflow_revision_query';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id_text := nullif(btrim(p_input ->> 'workflow_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
     or v_workflow_id_text is null
     or v_workflow_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'revision_no'), '') <> 'number'
     or (p_input ->> 'revision_no') !~ '^[1-9][0-9]*$' then
    raise exception 'invalid_workflow_revision_query';
  end if;
  v_workflow_id := v_workflow_id_text::uuid;
  begin
    v_revision_no := (p_input ->> 'revision_no')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_workflow_revision_query';
  end;

  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view']::text[]
  );
  if v_auth ->> 'actor_type' <> 'owner'
     and not coalesce((v_auth ->> 'can_manage')::boolean, false)
     and not coalesce((v_auth ->> 'can_publish')::boolean, false) then
    raise exception 'permission_denied';
  end if;

  select * into v_workflow
    from public.merchant_enterprise_workflows as workflow
   where workflow.merchant_id = v_site_id
     and workflow.id = v_workflow_id
   for share;
  if not found then
    raise exception 'workflow_not_found';
  end if;

  select * into v_revision
    from public.merchant_enterprise_workflow_revisions as revision
   where revision.merchant_id = v_site_id
     and revision.workflow_id = v_workflow_id
     and revision.revision_no = v_revision_no;
  if not found then
    raise exception 'workflow_revision_not_found';
  end if;

  select * into v_previous
    from public.merchant_enterprise_workflow_revisions as revision
   where revision.merchant_id = v_site_id
     and revision.workflow_id = v_workflow_id
     and revision.revision_no < v_revision_no
   order by revision.revision_no desc
   limit 1;

  v_current := public.faolla_build_merchant_enterprise_workflow_v1(
    v_site_id, v_workflow_id, false
  );

  return jsonb_build_object(
    'merchantId', v_site_id,
    'workflow', jsonb_build_object(
      'id', v_workflow.id,
      'title', v_workflow.title,
      'status', v_workflow.status,
      'version', v_workflow.version,
      'published_version', v_workflow.published_version,
      'has_unpublished_changes', v_workflow.has_unpublished_changes,
      'can_restore', v_workflow.status <> 'archived'
        and (
          v_auth ->> 'actor_type' = 'owner'
          or coalesce((v_auth ->> 'can_manage')::boolean, false)
        )
    ),
    'revision', jsonb_build_object(
      'id', v_revision.id,
      'revision_no', v_revision.revision_no,
      'published_at', v_revision.published_at,
      'snapshot', v_revision.snapshot
    ),
    'previous_revision', case when v_previous.id is null then null else
      jsonb_build_object(
        'id', v_previous.id,
        'revision_no', v_previous.revision_no,
        'published_at', v_previous.published_at,
        'snapshot', v_previous.snapshot
      )
    end,
    'working_draft', jsonb_build_object(
      'title', v_current ->> 'title',
      'scenario', v_current ->> 'scenario',
      'description', v_current ->> 'description',
      'category', v_current ->> 'category',
      'tags', v_current -> 'tags',
      'steps', v_current -> 'steps'
    )
  );
end;
$$;

create or replace function public.faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1(
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
  v_revision_no integer;
  v_expected_version bigint;
  v_operation_id text;
  v_idempotency_key text;
  v_claim jsonb;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_snapshot jsonb;
  v_tag_array text[];
  v_before jsonb;
  v_after jsonb;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'workflow_id',
      'revision_no', 'expected_version', 'operation_id'
    ]::text[]
  ) then
    raise exception 'invalid_workflow_revision_restore';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id_text := nullif(btrim(p_input ->> 'workflow_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
     or v_workflow_id_text is null
     or v_workflow_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'revision_no'), '') <> 'number'
     or (p_input ->> 'revision_no') !~ '^[1-9][0-9]*$'
     or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_workflow_revision_restore';
  end if;
  v_workflow_id := v_workflow_id_text::uuid;
  begin
    v_revision_no := (p_input ->> 'revision_no')::integer;
    v_expected_version := (p_input ->> 'expected_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_workflow_revision_restore';
  end;

  perform public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view', 'workflows.manage']::text[]
  );
  v_idempotency_key := 'enterprise-workflow-revision-restore-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_workflow_revision_restore_v1',
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_workflow
    from public.merchant_enterprise_workflows as workflow
   where workflow.merchant_id = v_site_id
     and workflow.id = v_workflow_id
   for update;
  if not found then
    raise exception 'workflow_not_found';
  end if;
  if v_workflow.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if v_workflow.status = 'archived' then
    raise exception 'workflow_archived';
  end if;

  select * into v_revision
    from public.merchant_enterprise_workflow_revisions as revision
   where revision.merchant_id = v_site_id
     and revision.workflow_id = v_workflow_id
     and revision.revision_no = v_revision_no;
  if not found then
    raise exception 'workflow_revision_not_found';
  end if;
  v_snapshot := v_revision.snapshot;
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
       v_snapshot,
       array['title', 'scenario', 'description', 'category', 'tags', 'position', 'steps']::text[]
     )
     or not (v_snapshot ?& array['title', 'scenario', 'description', 'category', 'tags', 'steps'])
     or coalesce(jsonb_typeof(v_snapshot -> 'title'), '') <> 'string'
     or char_length(btrim(v_snapshot ->> 'title')) not between 1 and 160
     or coalesce(jsonb_typeof(v_snapshot -> 'scenario'), '') <> 'string'
     or char_length(btrim(v_snapshot ->> 'scenario')) not between 1 and 500
     or coalesce(jsonb_typeof(v_snapshot -> 'description'), '') <> 'string'
     or char_length(v_snapshot ->> 'description') > 5000
     or coalesce(jsonb_typeof(v_snapshot -> 'category'), '') <> 'string'
     or char_length(v_snapshot ->> 'category') > 80
     or not public.faolla_valid_merchant_workflow_tags_v1(v_snapshot -> 'tags')
     or not public.faolla_valid_merchant_workflow_steps_v1(v_snapshot -> 'steps') then
    raise exception 'workflow_revision_invalid';
  end if;

  select coalesce(
    array_agg(btrim(tag.value #>> '{}') order by tag.ordinality),
    '{}'::text[]
  ) into v_tag_array
  from jsonb_array_elements(v_snapshot -> 'tags')
    with ordinality as tag(value, ordinality);

  v_before := public.faolla_merchant_workflow_audit_summary_v1(
    v_site_id, v_workflow_id
  );
  perform public.faolla_replace_merchant_workflow_steps_v1(
    v_site_id, v_workflow_id, v_snapshot -> 'steps'
  );
  update public.merchant_enterprise_workflows
     set title = btrim(v_snapshot ->> 'title'),
         scenario = btrim(v_snapshot ->> 'scenario'),
         description = v_snapshot ->> 'description',
         category = btrim(v_snapshot ->> 'category'),
         tags = v_tag_array,
         has_unpublished_changes = true
   where merchant_id = v_site_id
     and id = v_workflow_id
     and version = v_expected_version
  returning * into v_workflow;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  v_after := public.faolla_merchant_workflow_audit_summary_v1(
    v_site_id, v_workflow_id
  ) || jsonb_build_object('restored_from_revision', v_revision_no);
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'workflow.restore_revision', 'input'
  );
  perform public.faolla_append_merchant_enterprise_audit_event_v1(
    v_site_id,
    'workflow.updated',
    'workflow',
    v_workflow_id,
    v_workflow.title,
    v_before,
    v_after,
    'workflow.restore_revision:' || v_operation_id,
    null,
    null,
    null
  );

  v_response := jsonb_build_object(
    'workflow', public.faolla_build_merchant_enterprise_workflow_v1(
      v_site_id, v_workflow_id, false
    ),
    'restored_from_revision', v_revision_no
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_idempotency_key, v_response
  );
end;
$$;

-- This is intentionally read-only. It reports roles whose workflow access was
-- never decided after the workflow feature shipped; it never backfills them.
create or replace function public.faolla_list_merchant_enterprise_workflow_permission_gaps_v1(
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
  v_gaps jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'actor_type', 'actor_id']::text[]
  ) then
    raise exception 'invalid_workflow_permission_gap_query';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_workflow_permission_gap_query';
  end if;
  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view']::text[]
  );
  if v_auth ->> 'actor_type' <> 'owner' then
    raise exception 'permission_denied';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role_id', candidate.id,
        'name', candidate.name,
        'system_key', candidate.system_key,
        'is_system', candidate.is_system,
        'version', candidate.version,
        'permissions', to_jsonb(candidate.permissions),
        'recommended_workflow_permissions', to_jsonb(candidate.recommended),
        'missing_workflow_permissions', to_jsonb(candidate.missing),
        'classification', candidate.classification,
        'employee_count', candidate.employee_count
      ) order by candidate.is_system desc, candidate.name, candidate.id
    ),
    '[]'::jsonb
  ) into v_gaps
  from (
    select
      role_row.*,
      recommendation.permissions as recommended,
      array(
        select permission
          from unnest(recommendation.permissions) as permission
         where not (permission = any(role_row.permissions))
         order by permission
      )::text[] as missing,
      case when role_row.system_key in ('administrator', 'supervisor', 'employee')
        then 'system_default_gap'
        else 'custom_role_review'
      end as classification,
      (
        select count(*)::integer
          from public.merchant_enterprise_employees as employee
         where employee.merchant_id = role_row.merchant_id
           and employee.role_id = role_row.id
           and employee.status in ('invited', 'active')
      ) as employee_count
    from public.merchant_enterprise_roles as role_row
    cross join lateral (
      select case
        when role_row.system_key = 'administrator' then
          array['workflows.view', 'workflows.manage', 'workflows.publish']::text[]
        when role_row.system_key = 'supervisor' then
          array['workflows.view', 'workflows.manage']::text[]
        when role_row.system_key = 'employee' then
          array['workflows.view']::text[]
        when 'enterprise.view' = any(role_row.permissions)
             and not ('workflows.view' = any(role_row.permissions)) then
          array['workflows.view']::text[]
        else '{}'::text[]
      end as permissions
    ) as recommendation
    where role_row.merchant_id = v_site_id
      and role_row.status = 'active'
  ) as candidate
  where cardinality(candidate.missing) > 0;

  return jsonb_build_object('merchantId', v_site_id, 'gaps', v_gaps);
end;
$$;

create or replace function public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_role_id_text text;
  v_role_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_idempotency_key text;
  v_claim jsonb;
  v_auth jsonb;
  v_role public.merchant_enterprise_roles%rowtype;
  v_requested text[];
  v_added text[];
  v_next_permissions text[];
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'role_id',
      'expected_version', 'workflow_permissions', 'operation_id'
    ]::text[]
  ) then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_role_id_text := nullif(btrim(p_input ->> 'role_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or coalesce(jsonb_typeof(p_input -> 'role_id'), '') <> 'string'
     or v_role_id_text is null
     or v_role_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or coalesce(jsonb_typeof(p_input -> 'workflow_permissions'), '') <> 'array'
     or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  if jsonb_array_length(p_input -> 'workflow_permissions') not between 1 and 3 then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_input -> 'workflow_permissions') as requested(value)
     where jsonb_typeof(requested.value) <> 'string'
        or requested.value #>> '{}' not in (
          'workflows.view', 'workflows.manage', 'workflows.publish'
        )
  ) then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  select coalesce(array_agg(distinct permission order by permission), '{}'::text[])
    into v_requested
    from jsonb_array_elements_text(p_input -> 'workflow_permissions')
      as requested(permission);
  if cardinality(v_requested) <> jsonb_array_length(p_input -> 'workflow_permissions') then
    raise exception 'invalid_workflow_permission_grant';
  end if;
  v_role_id := v_role_id_text::uuid;
  begin
    v_expected_version := (p_input ->> 'expected_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_workflow_permission_grant';
  end;

  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view']::text[]
  );
  if v_auth ->> 'actor_type' <> 'owner' then
    raise exception 'permission_denied';
  end if;

  v_idempotency_key := 'enterprise-workflow-permission-grant-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_workflow_permission_grant_v1',
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_role
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = v_role_id
     and role_row.status = 'active'
   for update;
  if not found then
    raise exception 'role_not_found';
  end if;
  if v_role.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;

  select array_agg(distinct permission order by permission)
    into v_next_permissions
    from unnest(v_role.permissions || v_requested) as permission;
  if not public.faolla_valid_merchant_enterprise_permissions_v1(v_next_permissions) then
    raise exception 'invalid_permission_dependencies';
  end if;
  select coalesce(array_agg(permission order by permission), '{}'::text[])
    into v_added
    from unnest(v_requested) as permission
   where not (permission = any(v_role.permissions));

  if cardinality(v_added) > 0 then
    perform public.faolla_set_merchant_enterprise_audit_context_v1(
      p_input, 'role.grant_workflow_permissions', 'input'
    );
    update public.merchant_enterprise_roles
       set permissions = v_next_permissions,
           updated_at = updated_at
     where merchant_id = v_site_id
       and id = v_role_id
       and version = v_expected_version
    returning * into v_role;
    if not found then
      raise exception 'enterprise_version_conflict';
    end if;
  end if;

  v_response := jsonb_build_object(
    'merchantId', v_site_id,
    'role', jsonb_build_object(
      'id', v_role.id,
      'name', v_role.name,
      'status', v_role.status,
      'is_system', v_role.is_system,
      'version', v_role.version,
      'permissions', to_jsonb(v_role.permissions)
    ),
    'added_permissions', to_jsonb(v_added)
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_idempotency_key, v_response
  );
end;
$$;

revoke all on function public.faolla_list_merchant_enterprise_workflow_revisions_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_get_merchant_enterprise_workflow_revision_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_list_merchant_enterprise_workflow_permission_gaps_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_list_merchant_enterprise_workflow_revisions_v1(jsonb)
  to service_role;
grant execute on function public.faolla_get_merchant_enterprise_workflow_revision_v1(jsonb)
  to service_role;
grant execute on function public.faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1(jsonb)
  to service_role;
grant execute on function public.faolla_list_merchant_enterprise_workflow_permission_gaps_v1(jsonb)
  to service_role;
grant execute on function public.faolla_grant_merchant_enterprise_role_workflow_permissions_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations(version, name)
values (202608040023, 'merchant_enterprise_workflow_revisions')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
