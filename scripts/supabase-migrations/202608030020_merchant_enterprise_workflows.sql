-- Merchant-scoped workflow/SOP drafts and immutable published revisions.
-- Draft writes, publication, visibility projection, audit and notifications
-- are kept inside the same database authorization and transaction boundary.

begin;

-- Extend the role catalog without changing any existing role rows. Publication
-- deliberately does not depend on management so author and reviewer duties can
-- be separated.
alter table public.merchant_enterprise_roles
  drop constraint if exists merchant_enterprise_roles_permissions_check;
alter table public.merchant_enterprise_roles
  add constraint merchant_enterprise_roles_permissions_check
  check (
    permissions <@ array[
      'enterprise.view',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.archive',
      'orders.linked.view',
      'boards.manage',
      'employees.view',
      'employees.manage',
      'roles.view',
      'roles.manage',
      'audit.view',
      'workflows.view',
      'workflows.manage',
      'workflows.publish'
    ]::text[]
  );

create or replace function public.faolla_valid_merchant_enterprise_permissions_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    p_permissions is not null
    and p_permissions <@ array[
      'enterprise.view',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.archive',
      'orders.linked.view',
      'boards.manage',
      'employees.view',
      'employees.manage',
      'roles.view',
      'roles.manage',
      'audit.view',
      'workflows.view',
      'workflows.manage',
      'workflows.publish'
    ]::text[]
    and (not ('tasks.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('tasks.create' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('tasks.update' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('tasks.assign' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('tasks.archive' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('orders.linked.view' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('boards.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('roles.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('employees.view' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'roles.view' = any(p_permissions)
    ))
    and (not ('employees.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions)
      and 'employees.view' = any(p_permissions)
      and 'roles.view' = any(p_permissions)
    ))
    and (not ('roles.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'roles.view' = any(p_permissions)
    ))
    and (not ('audit.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('workflows.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('workflows.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions)
      and 'workflows.view' = any(p_permissions)
    ))
    and (not ('workflows.publish' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions)
      and 'workflows.view' = any(p_permissions)
    ));
$$;

create or replace function public.faolla_valid_merchant_workflow_tags_v1(
  p_tags jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
  v_value text;
  v_seen text[] := '{}'::text[];
begin
  if p_tags is null
     or coalesce(jsonb_typeof(p_tags), '') <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_tags) > 10 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_tags) loop
    if coalesce(jsonb_typeof(v_item), '') <> 'string' then
      return false;
    end if;
    v_value := btrim(v_item #>> '{}');
    if char_length(v_value) not between 1 and 40
       or v_value = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_value);
  end loop;
  return true;
end;
$$;

create or replace function public.faolla_valid_merchant_workflow_steps_v1(
  p_steps jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_step jsonb;
  v_key text;
  v_id text;
  v_position integer := 0;
  v_seen_ids text[] := '{}'::text[];
begin
  if p_steps is null
     or coalesce(jsonb_typeof(p_steps), '') <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_steps) > 50 then
    return false;
  end if;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    if coalesce(jsonb_typeof(v_step), '') <> 'object' then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_step) loop
      if v_key not in ('id', 'title', 'instruction', 'position') then
        return false;
      end if;
    end loop;
    if coalesce(jsonb_typeof(v_step -> 'title'), '') <> 'string'
       or char_length(btrim(v_step ->> 'title')) not between 1 and 160
       or not (v_step ? 'instruction')
       or coalesce(jsonb_typeof(v_step -> 'instruction'), '') <> 'string'
       or char_length(btrim(v_step ->> 'instruction')) not between 1 and 4000
       or coalesce(jsonb_typeof(v_step -> 'position'), '') <> 'number'
       or (v_step ->> 'position') !~ '^[0-9]+$'
       or (v_step ->> 'position') <> v_position::text then
      return false;
    end if;
    if v_step ? 'id' and coalesce(jsonb_typeof(v_step -> 'id'), '') <> 'null' then
      if coalesce(jsonb_typeof(v_step -> 'id'), '') <> 'string' then
        return false;
      end if;
      v_id := nullif(btrim(v_step ->> 'id'), '');
      if v_id is null
         or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or v_id = any(v_seen_ids) then
        return false;
      end if;
      v_seen_ids := array_append(v_seen_ids, v_id);
    end if;
    v_position := v_position + 1;
  end loop;
  return true;
end;
$$;

create or replace function public.faolla_merchant_workflow_object_has_only_keys_v1(
  p_value jsonb,
  p_allowed text[]
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value is null
     or coalesce(jsonb_typeof(p_value), '') <> 'object'
     or p_allowed is null then
    return false;
  end if;
  return not exists (
    select 1
    from jsonb_object_keys(p_value) as candidate(key)
    where not (candidate.key = any(p_allowed))
  );
end;
$$;

create table if not exists public.merchant_enterprise_workflows (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  scenario text not null check (char_length(btrim(scenario)) between 1 and 500),
  description text not null default '' check (char_length(description) <= 5000),
  category text not null default '' check (char_length(category) <= 80),
  tags text[] not null default '{}'::text[] check (
    cardinality(tags) <= 10 and array_position(tags, null::text) is null
  ),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  position integer not null default 0 check (position >= 0),
  current_revision_id uuid null,
  published_version integer not null default 0 check (published_version >= 0),
  has_unpublished_changes boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_enterprise_workflows_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_enterprise_workflows_publication_state_check
    check (
      (
        current_revision_id is null
        and published_version = 0
        and not has_unpublished_changes
        and status <> 'published'
      )
      or (
        current_revision_id is not null
        and published_version > 0
      )
    )
);

create table if not exists public.merchant_enterprise_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  workflow_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 4000),
  position integer not null check (position >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_enterprise_workflow_steps_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_enterprise_workflow_steps_workflow_fk
    foreign key (merchant_id, workflow_id)
    references public.merchant_enterprise_workflows(merchant_id, id)
    on delete restrict
);

create unique index if not exists merchant_enterprise_workflow_steps_active_position_idx
  on public.merchant_enterprise_workflow_steps(merchant_id, workflow_id, position)
  where status = 'active';
create index if not exists merchant_enterprise_workflow_steps_workflow_idx
  on public.merchant_enterprise_workflow_steps(merchant_id, workflow_id, status, position);

create table if not exists public.merchant_enterprise_workflow_revisions (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  workflow_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  published_at timestamptz not null default statement_timestamp(),
  constraint merchant_enterprise_workflow_revisions_merchant_workflow_id_unique
    unique (merchant_id, workflow_id, id),
  constraint merchant_enterprise_workflow_revisions_number_unique
    unique (merchant_id, workflow_id, revision_no),
  constraint merchant_enterprise_workflow_revisions_workflow_fk
    foreign key (merchant_id, workflow_id)
    references public.merchant_enterprise_workflows(merchant_id, id)
    on delete restrict
);

alter table public.merchant_enterprise_workflows
  add constraint merchant_enterprise_workflows_current_revision_fk
  foreign key (merchant_id, id, current_revision_id)
  references public.merchant_enterprise_workflow_revisions(merchant_id, workflow_id, id)
  on delete restrict;

create index if not exists merchant_enterprise_workflows_merchant_status_position_idx
  on public.merchant_enterprise_workflows(merchant_id, status, position, created_at, id);
create index if not exists merchant_enterprise_workflow_revisions_workflow_idx
  on public.merchant_enterprise_workflow_revisions(
    merchant_id, workflow_id, revision_no desc
  );

drop trigger if exists merchant_enterprise_workflows_touch
  on public.merchant_enterprise_workflows;
create trigger merchant_enterprise_workflows_touch
before update on public.merchant_enterprise_workflows
for each row execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_enterprise_workflow_steps_touch
  on public.merchant_enterprise_workflow_steps;
create trigger merchant_enterprise_workflow_steps_touch
before update on public.merchant_enterprise_workflow_steps
for each row execute function public.faolla_touch_versioned_row();

create or replace function public.faolla_reject_merchant_workflow_revision_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'workflow_revisions_append_only';
end;
$$;

drop trigger if exists merchant_enterprise_workflow_revisions_append_only
  on public.merchant_enterprise_workflow_revisions;
create trigger merchant_enterprise_workflow_revisions_append_only
before update or delete on public.merchant_enterprise_workflow_revisions
for each row execute function public.faolla_reject_merchant_workflow_revision_mutation_v1();

alter table public.merchant_enterprise_workflows enable row level security;
alter table public.merchant_enterprise_workflow_steps enable row level security;
alter table public.merchant_enterprise_workflow_revisions enable row level security;
revoke all on public.merchant_enterprise_workflows
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_workflow_steps
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_workflow_revisions
  from public, anon, authenticated, service_role;

-- Reuse the notification inbox while making its target polymorphism explicit.
-- Workflow payloads contain only the published title and revision number.
create or replace function public.faolla_valid_merchant_workflow_notification_payload_v1(
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_payload is null
     or coalesce(jsonb_typeof(p_payload), '') <> 'object' then
    return false;
  end if;
  return coalesce(
    (select count(*) from jsonb_object_keys(p_payload)) = 2
    and p_payload ? 'workflowTitle'
    and coalesce(jsonb_typeof(p_payload -> 'workflowTitle'), '') = 'string'
    and char_length(btrim(p_payload ->> 'workflowTitle')) between 1 and 160
    and p_payload ? 'publishedVersion'
    and coalesce(jsonb_typeof(p_payload -> 'publishedVersion'), '') = 'number'
    and (p_payload ->> 'publishedVersion') ~ '^[1-9][0-9]*$',
    false
  );
end;
$$;

alter table public.merchant_enterprise_notifications
  alter column task_id drop not null,
  add column if not exists workflow_id uuid null;

alter table public.merchant_enterprise_notifications
  drop constraint if exists merchant_enterprise_notifications_notification_type_check;
alter table public.merchant_enterprise_notifications
  add constraint merchant_enterprise_notifications_notification_type_check
  check (notification_type in (
    'task_assigned',
    'task_unassigned',
    'task_commented',
    'task_due_changed',
    'workflow_published'
  ));

alter table public.merchant_enterprise_notifications
  add constraint merchant_enterprise_notifications_workflow_fk
  foreign key (merchant_id, workflow_id)
  references public.merchant_enterprise_workflows(merchant_id, id)
  on delete restrict;
alter table public.merchant_enterprise_notifications
  add constraint merchant_enterprise_notifications_exactly_one_target_check
  check (
    (
      notification_type = 'workflow_published'
      and task_id is null
      and workflow_id is not null
    )
    or (
      notification_type <> 'workflow_published'
      and task_id is not null
      and workflow_id is null
    )
  );
alter table public.merchant_enterprise_notifications
  add constraint merchant_enterprise_notifications_workflow_payload_check
  check (
    notification_type <> 'workflow_published'
    or public.faolla_valid_merchant_workflow_notification_payload_v1(payload)
  );

create index if not exists merchant_enterprise_notifications_workflow_idx
  on public.merchant_enterprise_notifications(
    merchant_id, workflow_id, created_at desc, id desc
  )
  where workflow_id is not null;

-- Audit records store only a non-sensitive workflow summary. Step text,
-- scenario and description remain outside the immutable audit stream.
alter table public.merchant_enterprise_audit_events
  drop constraint if exists merchant_enterprise_audit_events_event_type_check;
alter table public.merchant_enterprise_audit_events
  add constraint merchant_enterprise_audit_events_event_type_check
  check (event_type in (
    'workspace.bootstrapped',
    'role.created',
    'role.updated',
    'role.board_scope_changed',
    'board.created',
    'board.updated',
    'column.created',
    'column.updated',
    'employee.created',
    'employee.updated',
    'employee.renamed',
    'employee.role_changed',
    'employee.disabled',
    'employee.restored',
    'employee.removed',
    'invitation.reserved',
    'invitation.revoked',
    'invitation.removed',
    'invitation.accepted',
    'invitation.delivery_finalized',
    'invitation.auth_bound',
    'workflow.created',
    'workflow.updated',
    'workflow.published',
    'workflow.archived',
    'workflow.restored'
  ));
alter table public.merchant_enterprise_audit_events
  drop constraint if exists merchant_enterprise_audit_events_entity_type_check;
alter table public.merchant_enterprise_audit_events
  add constraint merchant_enterprise_audit_events_entity_type_check
  check (entity_type in (
    'workspace', 'role', 'board', 'column', 'employee', 'invitation', 'workflow'
  ));

create or replace function public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
  p_input jsonb,
  p_required_permissions text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_merchant public.merchants%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null
     or coalesce(jsonb_typeof(p_input), '') <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'merchant_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_type'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_id'), '') <> 'string'
     or p_required_permissions is null
     or not (p_required_permissions <@ array[
       'enterprise.view', 'workflows.view', 'workflows.manage', 'workflows.publish'
     ]::text[]) then
    raise exception 'permission_denied';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_actor_type is null
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id_text is null
     or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'permission_denied';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  select * into v_merchant
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'permission_denied';
  end if;

  if v_actor_type = 'owner' then
    if not coalesce(
      v_actor_id = any(array_remove(array[
        v_merchant.user_id,
        v_merchant.auth_user_id,
        v_merchant.owner_user_id,
        v_merchant.owner_id,
        v_merchant.auth_id,
        v_merchant.created_by,
        v_merchant.created_by_user_id
      ]::uuid[], null::uuid)),
      false
    ) then
      raise exception 'permission_denied';
    end if;
    return jsonb_build_object(
      'actor_type', 'owner',
      'actor_id', null,
      'can_manage', true,
      'can_publish', true
    );
  end if;

  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_actor_id
   for share;
  if not found or v_employee.status <> 'active' then
    raise exception 'permission_denied';
  end if;

  select * into v_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_employee.role_id
   for share;
  if not found
     or v_role.status <> 'active'
     or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
     or not (v_role.permissions @> p_required_permissions) then
    raise exception 'permission_denied';
  end if;

  return jsonb_build_object(
    'actor_type', 'employee',
    'actor_id', v_actor_id,
    'can_manage', 'workflows.manage' = any(v_role.permissions),
    'can_publish', 'workflows.publish' = any(v_role.permissions)
  );
end;
$$;

create or replace function public.faolla_replace_merchant_workflow_steps_v1(
  p_merchant_id text,
  p_workflow_id uuid,
  p_steps jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step jsonb;
  v_step_id uuid;
  v_seen_ids uuid[] := '{}'::uuid[];
  v_position integer;
  v_changed integer;
begin
  if not public.faolla_valid_merchant_workflow_steps_v1(p_steps) then
    raise exception 'invalid_workflow_steps';
  end if;

  perform 1
    from public.merchant_enterprise_workflow_steps as workflow_step
   where workflow_step.merchant_id = p_merchant_id
     and workflow_step.workflow_id = p_workflow_id
   order by workflow_step.id
   for update of workflow_step;

  update public.merchant_enterprise_workflow_steps
     set position = position + 1000
   where merchant_id = p_merchant_id
     and workflow_id = p_workflow_id
     and status = 'active';

  v_position := 0;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_step_id := null;
    if v_step ? 'id'
       and coalesce(jsonb_typeof(v_step -> 'id'), '') <> 'null' then
      v_step_id := (v_step ->> 'id')::uuid;
    end if;

    if v_step_id is null then
      insert into public.merchant_enterprise_workflow_steps (
        merchant_id, workflow_id, title, instruction, position, status
      ) values (
        p_merchant_id,
        p_workflow_id,
        btrim(v_step ->> 'title'),
        btrim(v_step ->> 'instruction'),
        v_position,
        'active'
      ) returning id into v_step_id;
    else
      update public.merchant_enterprise_workflow_steps
         set title = btrim(v_step ->> 'title'),
             instruction = btrim(v_step ->> 'instruction'),
             position = v_position,
             status = 'active'
       where merchant_id = p_merchant_id
         and workflow_id = p_workflow_id
         and id = v_step_id;
      get diagnostics v_changed = row_count;
      if v_changed <> 1 then
        if exists (
          select 1
          from public.merchant_enterprise_workflow_steps
          where id = v_step_id
        ) then
          raise exception 'invalid_workflow_step';
        end if;
        insert into public.merchant_enterprise_workflow_steps (
          id, merchant_id, workflow_id, title, instruction, position, status
        ) values (
          v_step_id,
          p_merchant_id,
          p_workflow_id,
          btrim(v_step ->> 'title'),
          btrim(v_step ->> 'instruction'),
          v_position,
          'active'
        );
      end if;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_step_id);
    v_position := v_position + 1;
  end loop;

  update public.merchant_enterprise_workflow_steps
     set status = 'archived'
   where merchant_id = p_merchant_id
     and workflow_id = p_workflow_id
     and status = 'active'
     and (
       cardinality(v_seen_ids) = 0
       or not (id = any(v_seen_ids))
     );
  return v_position;
end;
$$;

create or replace function public.faolla_build_merchant_enterprise_workflow_v1(
  p_merchant_id text,
  p_workflow_id uuid,
  p_use_published_revision boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_steps jsonb;
begin
  select * into v_workflow
    from public.merchant_enterprise_workflows
   where merchant_id = p_merchant_id
     and id = p_workflow_id;
  if not found then
    raise exception 'workflow_not_found';
  end if;

  if p_use_published_revision then
    if v_workflow.current_revision_id is null then
      raise exception 'workflow_not_published';
    end if;
    select * into v_revision
      from public.merchant_enterprise_workflow_revisions
     where merchant_id = p_merchant_id
       and workflow_id = p_workflow_id
       and id = v_workflow.current_revision_id;
    if not found then
      raise exception 'workflow_revision_not_found';
    end if;
    return jsonb_build_object(
      'id', v_workflow.id,
      'merchant_id', v_workflow.merchant_id,
      'title', v_revision.snapshot ->> 'title',
      'scenario', v_revision.snapshot ->> 'scenario',
      'description', v_revision.snapshot ->> 'description',
      'category', v_revision.snapshot ->> 'category',
      'tags', v_revision.snapshot -> 'tags',
      'status', 'published',
      'steps', v_revision.snapshot -> 'steps',
      'position', (v_revision.snapshot ->> 'position')::integer,
      'published_version', v_revision.revision_no,
      'published_at', v_revision.published_at,
      'has_unpublished_changes', false,
      'version', v_revision.revision_no,
      'created_at', v_revision.published_at,
      'updated_at', v_revision.published_at
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', workflow_step.id,
        'title', workflow_step.title,
        'instruction', workflow_step.instruction,
        'position', workflow_step.position,
        'version', workflow_step.version,
        'created_at', workflow_step.created_at,
        'updated_at', workflow_step.updated_at
      ) order by workflow_step.position, workflow_step.id
    ),
    '[]'::jsonb
  ) into v_steps
  from public.merchant_enterprise_workflow_steps as workflow_step
  where workflow_step.merchant_id = p_merchant_id
    and workflow_step.workflow_id = p_workflow_id
    and workflow_step.status = 'active';

  if v_workflow.current_revision_id is not null then
    select * into v_revision
      from public.merchant_enterprise_workflow_revisions
     where merchant_id = p_merchant_id
       and workflow_id = p_workflow_id
       and id = v_workflow.current_revision_id;
  end if;

  return jsonb_build_object(
    'id', v_workflow.id,
    'merchant_id', v_workflow.merchant_id,
    'title', v_workflow.title,
    'scenario', v_workflow.scenario,
    'description', v_workflow.description,
    'category', v_workflow.category,
    'tags', to_jsonb(v_workflow.tags),
    'status', v_workflow.status,
    'steps', v_steps,
    'position', v_workflow.position,
    'published_version', v_workflow.published_version,
    'published_at', v_revision.published_at,
    'has_unpublished_changes', v_workflow.has_unpublished_changes,
    'version', v_workflow.version,
    'created_at', v_workflow.created_at,
    'updated_at', v_workflow.updated_at
  );
end;
$$;

create or replace function public.faolla_merchant_workflow_audit_summary_v1(
  p_merchant_id text,
  p_workflow_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', workflow.title,
    'category', workflow.category,
    'status', workflow.status,
    'published_version', workflow.published_version,
    'step_count', (
      select count(*)
      from public.merchant_enterprise_workflow_steps as workflow_step
      where workflow_step.merchant_id = workflow.merchant_id
        and workflow_step.workflow_id = workflow.id
        and workflow_step.status = 'active'
    )
  )
  from public.merchant_enterprise_workflows as workflow
  where workflow.merchant_id = p_merchant_id
    and workflow.id = p_workflow_id;
$$;

create or replace function public.faolla_create_merchant_enterprise_workflow_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_operation_id text;
  v_idempotency_key text;
  v_claim jsonb;
  v_tags jsonb;
  v_steps jsonb;
  v_position integer := 0;
  v_active_count integer;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'operation_id',
      'title', 'scenario', 'description', 'category', 'tags', 'steps', 'position'
    ]::text[]
  ) then
    raise exception 'invalid_workflow_payload';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_tags := coalesce(p_input -> 'tags', '[]'::jsonb);
  v_steps := coalesce(p_input -> 'steps', '[]'::jsonb);
  if coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or coalesce(jsonb_typeof(p_input -> 'title'), '') <> 'string'
     or char_length(btrim(p_input ->> 'title')) not between 1 and 160
     or coalesce(jsonb_typeof(p_input -> 'scenario'), '') <> 'string'
     or char_length(btrim(p_input ->> 'scenario')) not between 1 and 500
     or (p_input ? 'description' and coalesce(jsonb_typeof(p_input -> 'description'), '') <> 'string')
     or char_length(coalesce(p_input ->> 'description', '')) > 5000
     or (p_input ? 'category' and coalesce(jsonb_typeof(p_input -> 'category'), '') <> 'string')
     or char_length(coalesce(p_input ->> 'category', '')) > 80
     or not public.faolla_valid_merchant_workflow_tags_v1(v_tags)
     or not public.faolla_valid_merchant_workflow_steps_v1(v_steps)
     or (
       p_input ? 'position'
       and (
         coalesce(jsonb_typeof(p_input -> 'position'), '') <> 'number'
         or (p_input ->> 'position') !~ '^[0-9]+$'
       )
     ) then
    raise exception 'invalid_workflow_payload';
  end if;
  if p_input ? 'position' then
    begin
      v_position := (p_input ->> 'position')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_workflow_payload';
    end;
  end if;

  perform public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view', 'workflows.manage']::text[]
  );
  perform pg_advisory_xact_lock(
    hashtextextended('faolla-enterprise-workflows:' || v_site_id, 0)
  );
  v_idempotency_key := 'enterprise-workflow-create-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_workflow_create_v1',
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select count(*)::integer into v_active_count
    from public.merchant_enterprise_workflows
   where merchant_id = v_site_id
     and status <> 'archived';
  if v_active_count >= 200 then
    raise exception 'workflow_limit_reached';
  end if;

  select coalesce(array_agg(btrim(tag.value #>> '{}') order by tag.ordinality), '{}'::text[])
    into v_workflow.tags
    from jsonb_array_elements(v_tags) with ordinality as tag(value, ordinality);
  insert into public.merchant_enterprise_workflows (
    merchant_id, title, scenario, description, category, tags, position
  ) values (
    v_site_id,
    btrim(p_input ->> 'title'),
    btrim(p_input ->> 'scenario'),
    coalesce(p_input ->> 'description', ''),
    coalesce(p_input ->> 'category', ''),
    v_workflow.tags,
    v_position
  ) returning * into v_workflow;

  perform public.faolla_replace_merchant_workflow_steps_v1(
    v_site_id, v_workflow.id, v_steps
  );
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'workflow.create', 'input'
  );
  perform public.faolla_append_merchant_enterprise_audit_event_v1(
    v_site_id,
    'workflow.created',
    'workflow',
    v_workflow.id,
    v_workflow.title,
    '{}'::jsonb,
    public.faolla_merchant_workflow_audit_summary_v1(v_site_id, v_workflow.id),
    'workflow.create:' || v_operation_id,
    null,
    null,
    null
  );
  v_response := jsonb_build_object(
    'workflow', public.faolla_build_merchant_enterprise_workflow_v1(
      v_site_id, v_workflow.id, false
    )
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_idempotency_key, v_response
  );
end;
$$;

create or replace function public.faolla_update_merchant_enterprise_workflow_v1(
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
  v_operation_id text;
  v_action text;
  v_expected_version bigint;
  v_idempotency_key text;
  v_claim jsonb;
  v_auth jsonb;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_tags jsonb;
  v_tag_array text[];
  v_steps jsonb;
  v_snapshot_steps jsonb;
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
  v_event_type text;
  v_changed integer;
  v_step_count integer;
  v_response jsonb;
begin
  if p_input is null or coalesce(jsonb_typeof(p_input), '') <> 'object' then
    raise exception 'invalid_workflow_payload';
  end if;
  if coalesce(jsonb_typeof(p_input -> 'action'), '') <> 'string' then
    raise exception 'invalid_workflow_action';
  end if;
  v_action := nullif(btrim(p_input ->> 'action'), '');
  if v_action is null
     or v_action not in ('save', 'publish', 'archive', 'restore') then
    raise exception 'invalid_workflow_action';
  end if;
  if v_action = 'save' then
    if not public.faolla_merchant_workflow_object_has_only_keys_v1(
      p_input,
      array[
        'merchant_id', 'actor_type', 'actor_id', 'operation_id',
        'workflow_id', 'expected_version', 'action', 'title', 'scenario',
        'description', 'category', 'tags', 'steps', 'position'
      ]::text[]
    )
    or not (
      p_input ? 'title' or p_input ? 'scenario' or p_input ? 'description'
      or p_input ? 'category' or p_input ? 'tags' or p_input ? 'steps'
      or p_input ? 'position'
    ) then
      raise exception 'invalid_workflow_payload';
    end if;
  elsif not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'operation_id',
      'workflow_id', 'expected_version', 'action'
    ]::text[]
  ) then
    raise exception 'invalid_workflow_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id_text := nullif(btrim(p_input ->> 'workflow_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
     or v_workflow_id_text is null
     or v_workflow_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$' then
    raise exception 'invalid_workflow_payload';
  end if;
  v_workflow_id := v_workflow_id_text::uuid;
  begin
    v_expected_version := (p_input ->> 'expected_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_workflow_payload';
  end;

  if v_action = 'save' then
    if (p_input ? 'title' and (
         coalesce(jsonb_typeof(p_input -> 'title'), '') <> 'string'
         or char_length(btrim(p_input ->> 'title')) not between 1 and 160
       ))
       or (p_input ? 'scenario' and (
         coalesce(jsonb_typeof(p_input -> 'scenario'), '') <> 'string'
         or char_length(btrim(p_input ->> 'scenario')) not between 1 and 500
       ))
       or (p_input ? 'description' and (
         coalesce(jsonb_typeof(p_input -> 'description'), '') <> 'string'
         or char_length(p_input ->> 'description') > 5000
       ))
       or (p_input ? 'category' and (
         coalesce(jsonb_typeof(p_input -> 'category'), '') <> 'string'
         or char_length(p_input ->> 'category') > 80
       ))
       or (p_input ? 'position' and (
         coalesce(jsonb_typeof(p_input -> 'position'), '') <> 'number'
         or (p_input ->> 'position') !~ '^[0-9]+$'
       )) then
      raise exception 'invalid_workflow_payload';
    end if;
    if p_input ? 'tags'
       and not public.faolla_valid_merchant_workflow_tags_v1(p_input -> 'tags') then
      raise exception 'invalid_workflow_tags';
    end if;
    if p_input ? 'steps'
       and not public.faolla_valid_merchant_workflow_steps_v1(p_input -> 'steps') then
      raise exception 'invalid_workflow_steps';
    end if;
  end if;

  if v_action = 'save' then
    v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
      p_input,
      array['enterprise.view', 'workflows.view', 'workflows.manage']::text[]
    );
  else
    v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
      p_input,
      array['enterprise.view', 'workflows.view', 'workflows.publish']::text[]
    );
  end if;

  v_idempotency_key := 'enterprise-workflow-update-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_workflow_update_v1',
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_workflow
    from public.merchant_enterprise_workflows
   where merchant_id = v_site_id
     and id = v_workflow_id
   for update;
  if not found then
    raise exception 'workflow_not_found';
  end if;
  if v_workflow.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if v_action in ('save', 'publish') and v_workflow.status = 'archived' then
    raise exception 'workflow_archived';
  elsif v_action = 'archive' and v_workflow.status = 'archived' then
    raise exception 'workflow_already_archived';
  elsif v_action = 'restore' and v_workflow.status <> 'archived' then
    raise exception 'workflow_not_archived';
  end if;

  v_before := public.faolla_merchant_workflow_audit_summary_v1(
    v_site_id, v_workflow_id
  );
  if v_action = 'save' then
    if p_input ? 'tags' then
      v_tags := p_input -> 'tags';
      select coalesce(
        array_agg(btrim(tag.value #>> '{}') order by tag.ordinality),
        '{}'::text[]
      ) into v_tag_array
      from jsonb_array_elements(v_tags) with ordinality as tag(value, ordinality);
    else
      v_tag_array := v_workflow.tags;
    end if;
    if p_input ? 'steps' then
      v_steps := p_input -> 'steps';
      perform public.faolla_replace_merchant_workflow_steps_v1(
        v_site_id, v_workflow_id, v_steps
      );
    end if;
    begin
      update public.merchant_enterprise_workflows
         set title = case when p_input ? 'title'
               then btrim(p_input ->> 'title') else title end,
             scenario = case when p_input ? 'scenario'
               then btrim(p_input ->> 'scenario') else scenario end,
             description = case when p_input ? 'description'
               then p_input ->> 'description' else description end,
             category = case when p_input ? 'category'
               then btrim(p_input ->> 'category') else category end,
             tags = v_tag_array,
             position = case when p_input ? 'position'
               then (p_input ->> 'position')::integer else position end,
             has_unpublished_changes = case
               when published_version > 0 then true else false end
       where merchant_id = v_site_id
         and id = v_workflow_id
         and version = v_expected_version
       returning * into v_workflow;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_workflow_payload';
    end;
    if not found then
      raise exception 'enterprise_version_conflict';
    end if;
    v_event_type := 'workflow.updated';

  elsif v_action = 'publish' then
    select count(*)::integer into v_step_count
      from public.merchant_enterprise_workflow_steps
     where merchant_id = v_site_id
       and workflow_id = v_workflow_id
       and status = 'active';
    if char_length(btrim(v_workflow.title)) < 1
       or char_length(btrim(v_workflow.scenario)) < 1
       or v_step_count < 1 then
      raise exception 'workflow_publish_incomplete';
    end if;
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', workflow_step.id,
          'title', workflow_step.title,
          'instruction', workflow_step.instruction,
          'position', workflow_step.position
        ) order by workflow_step.position, workflow_step.id
      ),
      '[]'::jsonb
    ) into v_snapshot_steps
    from public.merchant_enterprise_workflow_steps as workflow_step
    where workflow_step.merchant_id = v_site_id
      and workflow_step.workflow_id = v_workflow_id
      and workflow_step.status = 'active';
    v_snapshot := jsonb_build_object(
      'title', v_workflow.title,
      'scenario', v_workflow.scenario,
      'description', v_workflow.description,
      'category', v_workflow.category,
      'tags', to_jsonb(v_workflow.tags),
      'position', v_workflow.position,
      'steps', v_snapshot_steps
    );
    insert into public.merchant_enterprise_workflow_revisions (
      merchant_id, workflow_id, revision_no, snapshot
    ) values (
      v_site_id, v_workflow_id, v_workflow.published_version + 1, v_snapshot
    ) returning * into v_revision;
    update public.merchant_enterprise_workflows
       set current_revision_id = v_revision.id,
           published_version = v_revision.revision_no,
           status = 'published',
           has_unpublished_changes = false
     where merchant_id = v_site_id
       and id = v_workflow_id
       and version = v_expected_version
     returning * into v_workflow;
    if not found then
      raise exception 'enterprise_version_conflict';
    end if;

    insert into public.merchant_enterprise_notifications (
      merchant_id,
      recipient_employee_id,
      task_id,
      workflow_id,
      notification_type,
      event_key,
      actor_type,
      actor_id,
      payload
    )
    select
      v_site_id,
      employee.id,
      null,
      v_workflow_id,
      'workflow_published',
      'workflow:' || v_workflow_id::text || ':published:' || v_revision.revision_no::text,
      v_auth ->> 'actor_type',
      case when v_auth ->> 'actor_type' = 'employee'
        then v_auth ->> 'actor_id' else '' end,
      jsonb_build_object(
        'workflowTitle', v_workflow.title,
        'publishedVersion', v_revision.revision_no
      )
    from public.merchant_enterprise_employees as employee
    join public.merchant_enterprise_roles as role_row
      on role_row.merchant_id = employee.merchant_id
     and role_row.id = employee.role_id
    where employee.merchant_id = v_site_id
      and employee.status = 'active'
      and role_row.status = 'active'
      and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
      and 'enterprise.view' = any(role_row.permissions)
      and 'workflows.view' = any(role_row.permissions)
      and not (
        v_auth ->> 'actor_type' = 'employee'
        and employee.id::text = v_auth ->> 'actor_id'
      )
    on conflict (merchant_id, recipient_employee_id, event_key) do nothing;
    v_event_type := 'workflow.published';

  elsif v_action = 'archive' then
    update public.merchant_enterprise_workflows
       set status = 'archived'
     where merchant_id = v_site_id
       and id = v_workflow_id
       and version = v_expected_version
     returning * into v_workflow;
    if not found then
      raise exception 'enterprise_version_conflict';
    end if;
    v_event_type := 'workflow.archived';

  else
    update public.merchant_enterprise_workflows
       set status = case when current_revision_id is null then 'draft' else 'published' end
     where merchant_id = v_site_id
       and id = v_workflow_id
       and version = v_expected_version
     returning * into v_workflow;
    if not found then
      raise exception 'enterprise_version_conflict';
    end if;
    v_event_type := 'workflow.restored';
  end if;

  v_after := public.faolla_merchant_workflow_audit_summary_v1(
    v_site_id, v_workflow_id
  );
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'workflow.' || v_action, 'input'
  );
  perform public.faolla_append_merchant_enterprise_audit_event_v1(
    v_site_id,
    v_event_type,
    'workflow',
    v_workflow_id,
    v_workflow.title,
    v_before,
    v_after,
    'workflow.' || v_action || ':' || v_operation_id,
    null,
    null,
    null
  );
  v_response := jsonb_build_object(
    'workflow', public.faolla_build_merchant_enterprise_workflow_v1(
      v_site_id, v_workflow_id, false
    )
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_idempotency_key, v_response
  );
end;
$$;

create or replace function public.faolla_list_merchant_enterprise_workflows_v1(
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
  v_include_archived boolean := false;
  v_can_read_draft boolean;
  v_workflows jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'actor_type', 'actor_id', 'include_archived']::text[]
  ) then
    raise exception 'invalid_workflow_query';
  end if;
  if p_input ? 'include_archived' then
    if coalesce(jsonb_typeof(p_input -> 'include_archived'), '') <> 'boolean' then
      raise exception 'invalid_workflow_query';
    end if;
    v_include_archived := (p_input ->> 'include_archived')::boolean;
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_auth := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view']::text[]
  );
  v_can_read_draft := (v_auth ->> 'actor_type') = 'owner'
    or coalesce((v_auth ->> 'can_manage')::boolean, false)
    or coalesce((v_auth ->> 'can_publish')::boolean, false);

  if v_can_read_draft then
    select coalesce(
      jsonb_agg(
        public.faolla_build_merchant_enterprise_workflow_v1(
          page.merchant_id, page.id, false
        ) order by
          page.archived_sort,
          page.active_position,
          page.archived_updated_at desc,
          page.created_at,
          page.id
      ),
      '[]'::jsonb
    ) into v_workflows
    from (
      select
        workflow.merchant_id,
        workflow.id,
        workflow.created_at,
        case when workflow.status = 'archived' then 1 else 0 end
          as archived_sort,
        case when workflow.status <> 'archived' then workflow.position end
          as active_position,
        case when workflow.status = 'archived' then workflow.updated_at end
          as archived_updated_at
      from public.merchant_enterprise_workflows as workflow
      where workflow.merchant_id = v_site_id
        and (v_include_archived or workflow.status <> 'archived')
      order by
        archived_sort,
        active_position,
        archived_updated_at desc,
        workflow.created_at,
        workflow.id
      limit case when v_include_archived then 400 else 200 end
    ) as page;
  else
    select coalesce(
      jsonb_agg(
        public.faolla_build_merchant_enterprise_workflow_v1(
          page.merchant_id, page.id, true
        ) order by page.published_position, page.published_at, page.id
      ),
      '[]'::jsonb
    ) into v_workflows
    from (
      select
        workflow.merchant_id,
        workflow.id,
        revision.published_at,
        (revision.snapshot ->> 'position')::integer as published_position
      from public.merchant_enterprise_workflows as workflow
      join public.merchant_enterprise_workflow_revisions as revision
        on revision.merchant_id = workflow.merchant_id
       and revision.workflow_id = workflow.id
       and revision.id = workflow.current_revision_id
      where workflow.merchant_id = v_site_id
        and workflow.status = 'published'
      order by published_position, revision.published_at, workflow.id
      limit 200
    ) as page;
  end if;
  return jsonb_build_object('workflows', v_workflows);
end;
$$;

-- Notification access is recalculated from the current employee and role on
-- every read. A workflow-only employee cannot read or mark historical task
-- notifications, and the inverse is also true.
create or replace function public.faolla_authorize_merchant_notification_actor_v1(
  p_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_role_id uuid;
begin
  if p_input is null
     or coalesce(jsonb_typeof(p_input), '') <> 'object'
     or coalesce(jsonb_typeof(p_input -> 'merchant_id'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_type'), '') <> 'string'
     or coalesce(jsonb_typeof(p_input -> 'actor_id'), '') <> 'string' then
    raise exception 'invalid_notification_actor';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or p_input ->> 'actor_type' <> 'employee'
     or v_actor_id_text is null
     or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_notification_actor';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  select employee.role_id into v_role_id
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and employee.id = v_actor_id
     and employee.status = 'active'
   for share of employee;
  if not found then
    raise exception 'permission_denied';
  end if;

  perform 1
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = v_role_id
     and role_row.status = 'active'
     and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
     and 'enterprise.view' = any(role_row.permissions)
     and (
       'tasks.view' = any(role_row.permissions)
       or 'workflows.view' = any(role_row.permissions)
     )
   for share of role_row;
  if not found then
    raise exception 'permission_denied';
  end if;
  return v_actor_id;
end;
$$;

create or replace function public.faolla_list_merchant_enterprise_notifications_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_id uuid;
  v_limit integer;
  v_cursor_created_at_text text;
  v_cursor_created_at timestamptz;
  v_cursor_id_text text;
  v_cursor_id uuid;
  v_can_read_tasks boolean;
  v_can_read_workflows boolean;
  v_notifications jsonb;
  v_unread_count bigint;
begin
  v_actor_id := public.faolla_authorize_merchant_notification_actor_v1(p_input);
  v_site_id := btrim(p_input ->> 'merchant_id');
  if coalesce(jsonb_typeof(p_input -> 'limit'), '') <> 'number' then
    raise exception 'invalid_notification_request';
  end if;
  begin
    v_limit := (p_input ->> 'limit')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_notification_request';
  end;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'invalid_notification_request';
  end if;

  v_cursor_created_at_text := nullif(btrim(p_input ->> 'cursor_created_at'), '');
  v_cursor_id_text := nullif(btrim(p_input ->> 'cursor_id'), '');
  if (v_cursor_created_at_text is null) <> (v_cursor_id_text is null) then
    raise exception 'invalid_notification_request';
  end if;
  if v_cursor_created_at_text is not null then
    if v_cursor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_notification_request';
    end if;
    begin
      v_cursor_created_at := v_cursor_created_at_text::timestamptz;
      v_cursor_id := v_cursor_id_text::uuid;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_notification_request';
    end;
  end if;

  select
    'tasks.view' = any(role_row.permissions),
    'workflows.view' = any(role_row.permissions)
  into v_can_read_tasks, v_can_read_workflows
  from public.merchant_enterprise_employees as employee
  join public.merchant_enterprise_roles as role_row
    on role_row.merchant_id = employee.merchant_id
   and role_row.id = employee.role_id
  where employee.merchant_id = v_site_id
    and employee.id = v_actor_id
    and employee.status = 'active'
    and role_row.status = 'active';
  if not found then
    raise exception 'permission_denied';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'merchant_id', page.merchant_id,
        'task_id', page.task_id,
        'workflow_id', page.workflow_id,
        'notification_type', page.notification_type,
        'actor_type', page.actor_type,
        'actor_id', page.actor_id,
        'payload', page.payload,
        'read_at', page.read_at,
        'created_at', page.created_at
      ) order by page.created_at desc, page.id desc
    ),
    '[]'::jsonb
  ) into v_notifications
  from (
    select notification.*
    from public.merchant_enterprise_notifications as notification
    where notification.merchant_id = v_site_id
      and notification.recipient_employee_id = v_actor_id
      and (
        (notification.task_id is not null and v_can_read_tasks)
        or (notification.workflow_id is not null and v_can_read_workflows)
      )
      and (
        v_cursor_created_at is null
        or (notification.created_at, notification.id)
          < (v_cursor_created_at, v_cursor_id)
      )
    order by notification.created_at desc, notification.id desc
    limit v_limit + 1
  ) as page;

  select count(*) into v_unread_count
  from public.merchant_enterprise_notifications as notification
  where notification.merchant_id = v_site_id
    and notification.recipient_employee_id = v_actor_id
    and notification.read_at is null
    and (
      (notification.task_id is not null and v_can_read_tasks)
      or (notification.workflow_id is not null and v_can_read_workflows)
    );
  return jsonb_build_object(
    'notifications', v_notifications,
    'unread_count', v_unread_count
  );
end;
$$;

create or replace function public.faolla_mark_merchant_enterprise_notifications_read_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_id uuid;
  v_mark_all boolean;
  v_notification_id_text text;
  v_notification_id uuid;
  v_can_read_tasks boolean;
  v_can_read_workflows boolean;
  v_marked_count integer := 0;
  v_unread_count bigint;
begin
  v_actor_id := public.faolla_authorize_merchant_notification_actor_v1(p_input);
  v_site_id := btrim(p_input ->> 'merchant_id');
  if coalesce(jsonb_typeof(p_input -> 'mark_all'), '') <> 'boolean' then
    raise exception 'invalid_notification_request';
  end if;
  v_mark_all := (p_input ->> 'mark_all')::boolean;
  v_notification_id_text := nullif(btrim(p_input ->> 'notification_id'), '');
  if v_mark_all = (v_notification_id_text is not null) then
    raise exception 'invalid_notification_request';
  end if;
  if v_notification_id_text is not null then
    if v_notification_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_notification_request';
    end if;
    v_notification_id := v_notification_id_text::uuid;
  end if;

  select
    'tasks.view' = any(role_row.permissions),
    'workflows.view' = any(role_row.permissions)
  into v_can_read_tasks, v_can_read_workflows
  from public.merchant_enterprise_employees as employee
  join public.merchant_enterprise_roles as role_row
    on role_row.merchant_id = employee.merchant_id
   and role_row.id = employee.role_id
  where employee.merchant_id = v_site_id
    and employee.id = v_actor_id
    and employee.status = 'active'
    and role_row.status = 'active';
  if not found then
    raise exception 'permission_denied';
  end if;

  update public.merchant_enterprise_notifications as notification
     set read_at = coalesce(notification.read_at, now())
   where notification.merchant_id = v_site_id
     and notification.recipient_employee_id = v_actor_id
     and notification.read_at is null
     and (v_mark_all or notification.id = v_notification_id)
     and (
       (notification.task_id is not null and v_can_read_tasks)
       or (notification.workflow_id is not null and v_can_read_workflows)
     );
  get diagnostics v_marked_count = row_count;

  select count(*) into v_unread_count
  from public.merchant_enterprise_notifications as notification
  where notification.merchant_id = v_site_id
    and notification.recipient_employee_id = v_actor_id
    and notification.read_at is null
    and (
      (notification.task_id is not null and v_can_read_tasks)
      or (notification.workflow_id is not null and v_can_read_workflows)
    );
  return jsonb_build_object(
    'marked_count', v_marked_count,
    'unread_count', v_unread_count
  );
end;
$$;

create or replace function public.faolla_list_merchant_enterprise_audit_events_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_limit integer := 50;
  v_before_created_at timestamptz := null;
  v_before_id uuid := null;
  v_entity_type text := null;
  v_event_type text := null;
  v_merchant public.merchants%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype;
  v_events jsonb;
  v_last_created_at timestamptz;
  v_last_id uuid;
begin
  if p_input is null or coalesce(jsonb_typeof(p_input), '') <> 'object' then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_actor_type is null
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id_text is null
     or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'permission_denied';
  end if;
  v_actor_id := v_actor_id_text::uuid;
  if p_input ? 'limit' then
    if coalesce(jsonb_typeof(p_input -> 'limit'), '') <> 'number' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    begin
      v_limit := (p_input ->> 'limit')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_enterprise_audit_query';
    end;
  end if;
  if v_limit not between 1 and 100 then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  v_entity_type := nullif(btrim(p_input ->> 'entity_type'), '');
  v_event_type := nullif(btrim(p_input ->> 'event_type'), '');
  if v_entity_type is not null
     and v_entity_type not in (
       'workspace', 'role', 'board', 'column', 'employee', 'invitation', 'workflow'
     ) then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  if v_event_type is not null
     and v_event_type not in (
       'workspace.bootstrapped',
       'role.created',
       'role.updated',
       'role.board_scope_changed',
       'board.created',
       'board.updated',
       'column.created',
       'column.updated',
       'employee.created',
       'employee.updated',
       'employee.renamed',
       'employee.role_changed',
       'employee.disabled',
       'employee.restored',
       'employee.removed',
       'invitation.reserved',
       'invitation.revoked',
       'invitation.removed',
       'invitation.accepted',
       'invitation.delivery_finalized',
       'invitation.auth_bound',
       'workflow.created',
       'workflow.updated',
       'workflow.published',
       'workflow.archived',
       'workflow.restored'
     ) then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  if (p_input ? 'before_created_at') <> (p_input ? 'before_id') then
    raise exception 'invalid_enterprise_audit_cursor';
  end if;
  if p_input ? 'before_created_at' then
    begin
      v_before_created_at := nullif(
        btrim(p_input ->> 'before_created_at'), ''
      )::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_enterprise_audit_cursor';
    end;
    v_actor_id_text := nullif(btrim(p_input ->> 'before_id'), '');
    if v_before_created_at is null
       or v_actor_id_text is null
       or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_enterprise_audit_cursor';
    end if;
    v_before_id := v_actor_id_text::uuid;
  end if;

  select * into v_merchant
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'permission_denied';
  end if;
  if v_actor_type = 'owner' then
    if not coalesce(
      v_actor_id = any(array_remove(array[
        v_merchant.user_id,
        v_merchant.auth_user_id,
        v_merchant.owner_user_id,
        v_merchant.owner_id,
        v_merchant.auth_id,
        v_merchant.created_by,
        v_merchant.created_by_user_id
      ]::uuid[], null::uuid)),
      false
    ) then
      raise exception 'permission_denied';
    end if;
  else
    select * into v_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id
     for share;
    if not found or v_employee.status <> 'active' then
      raise exception 'permission_denied';
    end if;
    select * into v_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_employee.role_id
     for share;
    if not found
       or v_role.status <> 'active'
       or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
       or not ('audit.view' = any(v_role.permissions)) then
      raise exception 'permission_denied';
    end if;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc),
    '[]'::jsonb
  ) into v_events
  from (
    select audit_event.*
    from public.merchant_enterprise_audit_events as audit_event
    where audit_event.merchant_id = v_site_id
      and (v_entity_type is null or audit_event.entity_type = v_entity_type)
      and (v_event_type is null or audit_event.event_type = v_event_type)
      and (
        v_before_created_at is null
        or (audit_event.created_at, audit_event.id)
          < (v_before_created_at, v_before_id)
      )
    order by audit_event.created_at desc, audit_event.id desc
    limit v_limit
  ) as page;

  select page.created_at, page.id into v_last_created_at, v_last_id
  from (
    select audit_event.created_at, audit_event.id
    from public.merchant_enterprise_audit_events as audit_event
    where audit_event.merchant_id = v_site_id
      and (v_entity_type is null or audit_event.entity_type = v_entity_type)
      and (v_event_type is null or audit_event.event_type = v_event_type)
      and (
        v_before_created_at is null
        or (audit_event.created_at, audit_event.id)
          < (v_before_created_at, v_before_id)
      )
    order by audit_event.created_at desc, audit_event.id desc
    offset greatest(jsonb_array_length(v_events) - 1, 0)
    limit 1
  ) as page;
  return jsonb_build_object(
    'events', v_events,
    'next_cursor', case
      when jsonb_array_length(v_events) = v_limit then jsonb_build_object(
        'before_created_at', v_last_created_at,
        'before_id', v_last_id
      )
      else null
    end
  );
end;
$$;

-- A BEFORE INSERT trigger gives workflow defaults only to future bootstrap
-- system roles. It never updates or backfills a role that already exists.
create or replace function public.faolla_add_default_workflow_permissions_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_system and new.system_key = 'administrator' then
    if not ('workflows.view' = any(new.permissions)) then
      new.permissions := array_append(new.permissions, 'workflows.view');
    end if;
    if not ('workflows.manage' = any(new.permissions)) then
      new.permissions := array_append(new.permissions, 'workflows.manage');
    end if;
    if not ('workflows.publish' = any(new.permissions)) then
      new.permissions := array_append(new.permissions, 'workflows.publish');
    end if;
  elsif new.is_system and new.system_key = 'supervisor' then
    if not ('workflows.view' = any(new.permissions)) then
      new.permissions := array_append(new.permissions, 'workflows.view');
    end if;
    if not ('workflows.manage' = any(new.permissions)) then
      new.permissions := array_append(new.permissions, 'workflows.manage');
    end if;
  elsif new.is_system and new.system_key = 'employee' then
    if not ('workflows.view' = any(new.permissions)) then
      new.permissions := array_append(new.permissions, 'workflows.view');
    end if;
  end if;
  if not public.faolla_valid_merchant_enterprise_permissions_v1(new.permissions) then
    raise exception 'invalid_enterprise_permissions';
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_enterprise_roles_default_workflow_permissions
  on public.merchant_enterprise_roles;
create trigger merchant_enterprise_roles_default_workflow_permissions
before insert on public.merchant_enterprise_roles
for each row execute function public.faolla_add_default_workflow_permissions_v1();

revoke all on function public.faolla_valid_merchant_enterprise_permissions_v1(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_valid_merchant_workflow_tags_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_valid_merchant_workflow_steps_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_merchant_workflow_object_has_only_keys_v1(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_valid_merchant_workflow_notification_payload_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_reject_merchant_workflow_revision_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_authorize_merchant_enterprise_workflow_actor_v1(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_replace_merchant_workflow_steps_v1(text, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_build_merchant_enterprise_workflow_v1(text, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_merchant_workflow_audit_summary_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_authorize_merchant_notification_actor_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_add_default_workflow_permissions_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.faolla_create_merchant_enterprise_workflow_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_workflow_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_list_merchant_enterprise_workflows_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_list_merchant_enterprise_notifications_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_mark_merchant_enterprise_notifications_read_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_create_merchant_enterprise_workflow_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_workflow_v1(jsonb)
  to service_role;
grant execute on function public.faolla_list_merchant_enterprise_workflows_v1(jsonb)
  to service_role;
grant execute on function public.faolla_list_merchant_enterprise_notifications_v1(jsonb)
  to service_role;
grant execute on function public.faolla_mark_merchant_enterprise_notifications_read_v1(jsonb)
  to service_role;
grant execute on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608030020, 'merchant_enterprise_workflows')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
