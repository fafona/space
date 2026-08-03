-- Employee acknowledgement and immutable-revision workflow executions.
-- No existing role, employee, workflow, task or checklist row is backfilled.

begin;

create or replace function public.faolla_valid_merchant_workflow_evidence_v1(
  p_evidence jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
  v_size_text text;
begin
  if p_evidence is null
     or coalesce(jsonb_typeof(p_evidence), '') <> 'array'
     or jsonb_array_length(p_evidence) > 10 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_evidence) loop
    if coalesce(jsonb_typeof(v_item), '') <> 'object'
       or not public.faolla_merchant_workflow_object_has_only_keys_v1(
         v_item,
         array['kind', 'label', 'reference', 'mediaType', 'sizeBytes']::text[]
       )
       or coalesce(jsonb_typeof(v_item -> 'kind'), '') <> 'string'
       or btrim(v_item ->> 'kind') not in ('file', 'link', 'reference')
       or coalesce(jsonb_typeof(v_item -> 'label'), '') <> 'string'
       or char_length(btrim(v_item ->> 'label')) not between 1 and 160
       or coalesce(jsonb_typeof(v_item -> 'reference'), '') <> 'string'
       or char_length(btrim(v_item ->> 'reference')) not between 1 and 1000
       or (
         v_item ? 'mediaType'
         and (
           coalesce(jsonb_typeof(v_item -> 'mediaType'), '') <> 'string'
           or char_length(btrim(v_item ->> 'mediaType')) > 120
         )
       ) then
      return false;
    end if;
    if v_item ? 'sizeBytes' and v_item -> 'sizeBytes' <> 'null'::jsonb then
      v_size_text := v_item ->> 'sizeBytes';
      if coalesce(jsonb_typeof(v_item -> 'sizeBytes'), '') <> 'number'
         or v_size_text !~ '^[0-9]{1,13}$'
         or v_size_text::bigint > 1099511627776 then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;

create table if not exists public.merchant_enterprise_workflow_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  workflow_id uuid not null,
  revision_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  employee_id uuid not null,
  acknowledged_at timestamptz not null default statement_timestamp(),
  constraint merchant_enterprise_workflow_acknowledgements_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_enterprise_workflow_acknowledgements_revision_unique
    unique (merchant_id, workflow_id, revision_id, employee_id),
  constraint merchant_enterprise_workflow_acknowledgements_revision_fk
    foreign key (merchant_id, workflow_id, revision_id)
    references public.merchant_enterprise_workflow_revisions(merchant_id, workflow_id, id)
    on delete restrict,
  constraint merchant_enterprise_workflow_acknowledgements_employee_fk
    foreign key (merchant_id, employee_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete restrict
);

create table if not exists public.merchant_enterprise_workflow_executions (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  workflow_id uuid not null,
  revision_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  employee_id uuid not null,
  task_id uuid null,
  subject text not null default '' check (char_length(subject) <= 240),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),
  workflow_snapshot jsonb not null
    check (
      jsonb_typeof(workflow_snapshot) = 'object'
      and jsonb_typeof(workflow_snapshot -> 'steps') = 'array'
      and jsonb_array_length(workflow_snapshot -> 'steps') between 1 and 50
    ),
  completed_steps integer not null default 0 check (completed_steps >= 0),
  total_steps integer not null check (total_steps between 1 and 50),
  feedback_rating smallint null check (feedback_rating between 1 and 5),
  feedback_text text not null default '' check (char_length(feedback_text) <= 2000),
  feedback_status text not null default 'none'
    check (feedback_status in ('none', 'open', 'resolved')),
  feedback_submitted_at timestamptz null,
  feedback_resolution_note text not null default ''
    check (char_length(feedback_resolution_note) <= 2000),
  feedback_resolved_at timestamptz null,
  feedback_resolver_type text null
    check (feedback_resolver_type in ('owner', 'employee')),
  feedback_resolver_id uuid null,
  generated_checklist_count integer not null default 0
    check (generated_checklist_count >= 0),
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint merchant_enterprise_workflow_executions_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_enterprise_workflow_executions_source_unique
    unique (merchant_id, id, workflow_id, revision_id, revision_no, task_id),
  constraint merchant_enterprise_workflow_executions_revision_fk
    foreign key (merchant_id, workflow_id, revision_id)
    references public.merchant_enterprise_workflow_revisions(merchant_id, workflow_id, id)
    on delete restrict,
  constraint merchant_enterprise_workflow_executions_employee_fk
    foreign key (merchant_id, employee_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_workflow_executions_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_workflow_executions_progress_check
    check (
      completed_steps <= total_steps
      and generated_checklist_count <= total_steps
      and (
        (status = 'completed' and completed_steps = total_steps and completed_at is not null)
        or (status = 'in_progress' and completed_steps < total_steps and completed_at is null)
      )
    ),
  constraint merchant_enterprise_workflow_executions_feedback_check
    check (
      (
        feedback_status = 'none'
        and feedback_rating is null
        and feedback_text = ''
        and feedback_submitted_at is null
        and feedback_resolution_note = ''
        and feedback_resolved_at is null
        and feedback_resolver_type is null
        and feedback_resolver_id is null
      )
      or (
        feedback_status = 'open'
        and feedback_submitted_at is not null
        and (feedback_rating is not null or feedback_text <> '')
        and feedback_resolution_note = ''
        and feedback_resolved_at is null
        and feedback_resolver_type is null
        and feedback_resolver_id is null
      )
      or (
        feedback_status = 'resolved'
        and feedback_submitted_at is not null
        and (feedback_rating is not null or feedback_text <> '')
        and feedback_resolved_at is not null
        and feedback_resolver_type is not null
        and (
          (feedback_resolver_type = 'owner' and feedback_resolver_id is null)
          or (feedback_resolver_type = 'employee' and feedback_resolver_id is not null)
        )
      )
    )
);

create table if not exists public.merchant_enterprise_workflow_execution_steps (
  merchant_id text not null,
  execution_id uuid not null,
  step_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 4000),
  position integer not null check (position >= 0),
  completed_at timestamptz null,
  note text not null default '' check (char_length(note) <= 2000),
  evidence jsonb not null default '[]'::jsonb
    check (public.faolla_valid_merchant_workflow_evidence_v1(evidence)),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (merchant_id, execution_id, step_id),
  constraint merchant_enterprise_workflow_execution_steps_position_unique
    unique (merchant_id, execution_id, position),
  constraint merchant_enterprise_workflow_execution_steps_execution_fk
    foreign key (merchant_id, execution_id)
    references public.merchant_enterprise_workflow_executions(merchant_id, id)
    on delete restrict
);

create table if not exists public.merchant_enterprise_workflow_execution_checklist_items (
  merchant_id text not null,
  execution_id uuid not null,
  workflow_id uuid not null,
  revision_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  step_id uuid not null,
  task_id uuid not null,
  checklist_item_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (merchant_id, execution_id, step_id),
  constraint merchant_enterprise_workflow_execution_checklist_item_unique
    unique (merchant_id, checklist_item_id),
  constraint merchant_enterprise_workflow_execution_checklist_step_fk
    foreign key (merchant_id, execution_id, step_id)
    references public.merchant_enterprise_workflow_execution_steps(
      merchant_id, execution_id, step_id
    )
    on delete restrict,
  constraint merchant_enterprise_workflow_execution_checklist_source_fk
    foreign key (
      merchant_id, execution_id, workflow_id, revision_id, revision_no, task_id
    )
    references public.merchant_enterprise_workflow_executions(
      merchant_id, id, workflow_id, revision_id, revision_no, task_id
    )
    on delete restrict,
  constraint merchant_enterprise_workflow_execution_checklist_revision_fk
    foreign key (merchant_id, workflow_id, revision_id)
    references public.merchant_enterprise_workflow_revisions(merchant_id, workflow_id, id)
    on delete restrict,
  constraint merchant_enterprise_workflow_execution_checklist_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_workflow_execution_checklist_item_fk
    foreign key (merchant_id, checklist_item_id)
    references public.merchant_task_checklist_items(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_enterprise_workflow_ack_employee_idx
  on public.merchant_enterprise_workflow_acknowledgements(
    merchant_id, employee_id, workflow_id, revision_no desc
  );
create index if not exists merchant_enterprise_workflow_execution_employee_idx
  on public.merchant_enterprise_workflow_executions(
    merchant_id, employee_id, workflow_id, started_at desc, id desc
  );
create index if not exists merchant_enterprise_workflow_execution_stats_idx
  on public.merchant_enterprise_workflow_executions(
    merchant_id, workflow_id, revision_no, status, started_at desc
  );
create index if not exists merchant_enterprise_workflow_execution_feedback_idx
  on public.merchant_enterprise_workflow_executions(
    merchant_id, workflow_id, feedback_status, feedback_submitted_at desc
  ) where feedback_status <> 'none';
create unique index if not exists merchant_enterprise_workflow_task_checklist_generation_unique
  on public.merchant_enterprise_workflow_executions(merchant_id, task_id)
  where task_id is not null and generated_checklist_count > 0;

drop trigger if exists merchant_enterprise_workflow_executions_touch
  on public.merchant_enterprise_workflow_executions;
create trigger merchant_enterprise_workflow_executions_touch
before update on public.merchant_enterprise_workflow_executions
for each row execute function public.faolla_touch_versioned_row();

create or replace function public.faolla_protect_merchant_workflow_execution_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.merchant_id is distinct from old.merchant_id
     or new.id is distinct from old.id
     or new.workflow_id is distinct from old.workflow_id
     or new.revision_id is distinct from old.revision_id
     or new.revision_no is distinct from old.revision_no
     or new.employee_id is distinct from old.employee_id
     or new.task_id is distinct from old.task_id
     or new.subject is distinct from old.subject
     or new.workflow_snapshot is distinct from old.workflow_snapshot
     or new.total_steps is distinct from old.total_steps
     or new.generated_checklist_count is distinct from old.generated_checklist_count
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'workflow_execution_snapshot_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_enterprise_workflow_execution_snapshot_immutable
  on public.merchant_enterprise_workflow_executions;
create trigger merchant_enterprise_workflow_execution_snapshot_immutable
before update on public.merchant_enterprise_workflow_executions
for each row execute function public.faolla_protect_merchant_workflow_execution_snapshot_v1();

create or replace function public.faolla_protect_merchant_workflow_execution_step_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.merchant_id is distinct from old.merchant_id
     or new.execution_id is distinct from old.execution_id
     or new.step_id is distinct from old.step_id
     or new.title is distinct from old.title
     or new.instruction is distinct from old.instruction
     or new.position is distinct from old.position then
    raise exception 'workflow_execution_snapshot_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_enterprise_workflow_execution_step_snapshot_immutable
  on public.merchant_enterprise_workflow_execution_steps;
create trigger merchant_enterprise_workflow_execution_step_snapshot_immutable
before update on public.merchant_enterprise_workflow_execution_steps
for each row execute function public.faolla_protect_merchant_workflow_execution_step_snapshot_v1();

create or replace function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'workflow_execution_history_append_only';
end;
$$;

drop trigger if exists merchant_enterprise_workflow_acknowledgements_append_only
  on public.merchant_enterprise_workflow_acknowledgements;
create trigger merchant_enterprise_workflow_acknowledgements_append_only
before update or delete on public.merchant_enterprise_workflow_acknowledgements
for each row execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
drop trigger if exists merchant_enterprise_workflow_acknowledgements_reject_truncate
  on public.merchant_enterprise_workflow_acknowledgements;
create trigger merchant_enterprise_workflow_acknowledgements_reject_truncate
before truncate on public.merchant_enterprise_workflow_acknowledgements
for each statement execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
alter table public.merchant_enterprise_workflow_acknowledgements
  enable always trigger merchant_enterprise_workflow_acknowledgements_reject_truncate;

drop trigger if exists merchant_enterprise_workflow_executions_reject_delete
  on public.merchant_enterprise_workflow_executions;
create trigger merchant_enterprise_workflow_executions_reject_delete
before delete on public.merchant_enterprise_workflow_executions
for each row execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
drop trigger if exists merchant_enterprise_workflow_executions_reject_truncate
  on public.merchant_enterprise_workflow_executions;
create trigger merchant_enterprise_workflow_executions_reject_truncate
before truncate on public.merchant_enterprise_workflow_executions
for each statement execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
alter table public.merchant_enterprise_workflow_executions
  enable always trigger merchant_enterprise_workflow_executions_reject_truncate;

drop trigger if exists merchant_enterprise_workflow_execution_steps_reject_delete
  on public.merchant_enterprise_workflow_execution_steps;
create trigger merchant_enterprise_workflow_execution_steps_reject_delete
before delete on public.merchant_enterprise_workflow_execution_steps
for each row execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
drop trigger if exists merchant_enterprise_workflow_execution_steps_reject_truncate
  on public.merchant_enterprise_workflow_execution_steps;
create trigger merchant_enterprise_workflow_execution_steps_reject_truncate
before truncate on public.merchant_enterprise_workflow_execution_steps
for each statement execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
alter table public.merchant_enterprise_workflow_execution_steps
  enable always trigger merchant_enterprise_workflow_execution_steps_reject_truncate;

drop trigger if exists merchant_enterprise_workflow_execution_checklist_append_only
  on public.merchant_enterprise_workflow_execution_checklist_items;
create trigger merchant_enterprise_workflow_execution_checklist_append_only
before update or delete on public.merchant_enterprise_workflow_execution_checklist_items
for each row execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
drop trigger if exists merchant_enterprise_workflow_execution_checklist_reject_truncate
  on public.merchant_enterprise_workflow_execution_checklist_items;
create trigger merchant_enterprise_workflow_execution_checklist_reject_truncate
before truncate on public.merchant_enterprise_workflow_execution_checklist_items
for each statement execute function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1();
alter table public.merchant_enterprise_workflow_execution_checklist_items
  enable always trigger merchant_enterprise_workflow_execution_checklist_reject_truncate;

create or replace function public.faolla_build_merchant_workflow_acknowledgement_v1(
  p_merchant_id text,
  p_acknowledgement_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', acknowledgement.id,
    'siteId', acknowledgement.merchant_id,
    'workflowId', acknowledgement.workflow_id,
    'revisionId', acknowledgement.revision_id,
    'revisionNo', acknowledgement.revision_no,
    'employeeId', acknowledgement.employee_id,
    'acknowledgedAt', acknowledgement.acknowledged_at
  )
  from public.merchant_enterprise_workflow_acknowledgements as acknowledgement
  where acknowledgement.merchant_id = p_merchant_id
    and acknowledgement.id = p_acknowledgement_id;
$$;

create or replace function public.faolla_build_merchant_workflow_execution_v1(
  p_merchant_id text,
  p_execution_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', execution.id,
    'siteId', execution.merchant_id,
    'workflowId', execution.workflow_id,
    'revisionId', execution.revision_id,
    'revisionNo', execution.revision_no,
    'employeeId', execution.employee_id,
    'taskId', execution.task_id,
    'subject', execution.subject,
    'status', execution.status,
    'workflowSnapshot', execution.workflow_snapshot,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stepId', step.step_id,
        'title', step.title,
        'instruction', step.instruction,
        'position', step.position,
        'completedAt', step.completed_at,
        'note', step.note,
        'evidence', step.evidence
      ) order by step.position, step.step_id)
      from public.merchant_enterprise_workflow_execution_steps as step
      where step.merchant_id = execution.merchant_id
        and step.execution_id = execution.id
    ), '[]'::jsonb),
    'completedSteps', execution.completed_steps,
    'totalSteps', execution.total_steps,
    'feedbackRating', execution.feedback_rating,
    'feedbackText', execution.feedback_text,
    'feedbackStatus', execution.feedback_status,
    'feedbackSubmittedAt', execution.feedback_submitted_at,
    'feedbackResolutionNote', execution.feedback_resolution_note,
    'feedbackResolvedAt', execution.feedback_resolved_at,
    'feedbackResolverType', execution.feedback_resolver_type,
    'feedbackResolverId', execution.feedback_resolver_id,
    'generatedChecklistCount', execution.generated_checklist_count,
    'startedAt', execution.started_at,
    'completedAt', execution.completed_at,
    'version', execution.version,
    'createdAt', execution.created_at,
    'updatedAt', execution.updated_at
  )
  from public.merchant_enterprise_workflow_executions as execution
  where execution.merchant_id = p_merchant_id
    and execution.id = p_execution_id;
$$;

create or replace function public.faolla_acknowledge_merchant_enterprise_workflow_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_workflow_id uuid;
  v_expected_revision_no integer;
  v_operation_id text;
  v_actor jsonb;
  v_employee_id uuid;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_ack public.merchant_enterprise_workflow_acknowledgements%rowtype;
  v_key text;
  v_claim jsonb;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'actor_type', 'actor_id', 'workflow_id', 'expected_revision_no', 'operation_id']::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
  or (p_input ->> 'workflow_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(jsonb_typeof(p_input -> 'expected_revision_no'), '') <> 'number'
  or (p_input ->> 'expected_revision_no') !~ '^[1-9][0-9]*$'
  or char_length(p_input ->> 'expected_revision_no') > 9
  or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
  or char_length(btrim(p_input ->> 'operation_id')) not between 1 and 120 then
    raise exception 'invalid_workflow_execution_request';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id := (p_input ->> 'workflow_id')::uuid;
  v_expected_revision_no := (p_input ->> 'expected_revision_no')::integer;
  v_operation_id := btrim(p_input ->> 'operation_id');
  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'employee' then
    raise exception 'employee_actor_required';
  end if;
  v_employee_id := (v_actor ->> 'actor_id')::uuid;

  v_key := 'enterprise-workflow-ack-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id, v_key, 'enterprise_workflow_acknowledge_v1', md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_workflow
  from public.merchant_enterprise_workflows
  where merchant_id = v_site_id and id = v_workflow_id
  for share;
  if not found or v_workflow.status <> 'published' or v_workflow.current_revision_id is null then
    raise exception 'workflow_not_found';
  end if;
  select * into v_revision
  from public.merchant_enterprise_workflow_revisions
  where merchant_id = v_site_id
    and workflow_id = v_workflow_id
    and id = v_workflow.current_revision_id
  for share;
  if not found or v_revision.revision_no <> v_expected_revision_no then
    raise exception 'workflow_revision_changed';
  end if;

  insert into public.merchant_enterprise_workflow_acknowledgements (
    merchant_id, workflow_id, revision_id, revision_no, employee_id
  ) values (
    v_site_id, v_workflow_id, v_revision.id, v_revision.revision_no, v_employee_id
  )
  on conflict (merchant_id, workflow_id, revision_id, employee_id) do nothing;
  select * into v_ack
  from public.merchant_enterprise_workflow_acknowledgements
  where merchant_id = v_site_id
    and workflow_id = v_workflow_id
    and revision_id = v_revision.id
    and employee_id = v_employee_id;
  v_response := jsonb_build_object(
    'acknowledgement',
    public.faolla_build_merchant_workflow_acknowledgement_v1(v_site_id, v_ack.id)
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_key, v_response
  );
end;
$$;

create or replace function public.faolla_start_merchant_enterprise_workflow_execution_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_workflow_id uuid;
  v_expected_revision_no integer;
  v_operation_id text;
  v_subject text;
  v_task_id uuid;
  v_generate_checklist boolean := false;
  v_actor jsonb;
  v_employee_id uuid;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_execution public.merchant_enterprise_workflow_executions%rowtype;
  v_task public.merchant_tasks%rowtype;
  v_step jsonb;
  v_step_id uuid;
  v_step_position integer;
  v_step_count integer;
  v_active_execution_count integer;
  v_active_checklist_count integer;
  v_checklist_response jsonb;
  v_checklist_item_id uuid;
  v_key text;
  v_claim jsonb;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'workflow_id',
      'expected_revision_no', 'subject', 'task_id', 'generate_checklist', 'operation_id'
    ]::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
  or (p_input ->> 'workflow_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(jsonb_typeof(p_input -> 'expected_revision_no'), '') <> 'number'
  or (p_input ->> 'expected_revision_no') !~ '^[1-9][0-9]*$'
  or char_length(p_input ->> 'expected_revision_no') > 9
  or coalesce(jsonb_typeof(p_input -> 'subject'), '') <> 'string'
  or char_length(btrim(p_input ->> 'subject')) > 240
  or coalesce(jsonb_typeof(p_input -> 'generate_checklist'), '') <> 'boolean'
  or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
  or char_length(btrim(p_input ->> 'operation_id')) not between 1 and 120
  or (
    p_input ? 'task_id'
    and (
      coalesce(jsonb_typeof(p_input -> 'task_id'), '') <> 'string'
      or (p_input ->> 'task_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) then
    raise exception 'invalid_workflow_execution_request';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id := (p_input ->> 'workflow_id')::uuid;
  v_expected_revision_no := (p_input ->> 'expected_revision_no')::integer;
  v_subject := btrim(p_input ->> 'subject');
  v_generate_checklist := (p_input ->> 'generate_checklist')::boolean;
  v_operation_id := btrim(p_input ->> 'operation_id');
  if p_input ? 'task_id' then
    v_task_id := (p_input ->> 'task_id')::uuid;
  end if;
  if v_generate_checklist and v_task_id is null then
    raise exception 'invalid_workflow_execution_request';
  end if;

  -- A linked task is locked and authorized first, matching the established
  -- task-write lock order before employee/role/workflow rows are revisited.
  if v_task_id is not null then
    perform public.faolla_authorize_merchant_task_write_v1(
      p_input,
      v_task_id,
      null,
      array['tasks.update']::text[],
      '{}'::uuid[],
      'task_not_found'
    );
    select * into v_task
    from public.merchant_tasks
    where merchant_id = v_site_id and id = v_task_id
    for update;
    if not found then raise exception 'task_not_found'; end if;
    if v_task.archived_at is not null then raise exception 'invalid_task_archived'; end if;
  end if;

  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'employee' then
    raise exception 'employee_actor_required';
  end if;
  v_employee_id := (v_actor ->> 'actor_id')::uuid;
  if v_task_id is not null and not exists (
    select 1 from public.merchant_task_assignees as assignee
    where assignee.merchant_id = v_site_id
      and assignee.task_id = v_task_id
      and assignee.employee_id = v_employee_id
  ) then
    raise exception 'task_assignment_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'faolla-workflow-execution:' || v_site_id || ':' || v_employee_id::text || ':' || v_workflow_id::text,
    0
  ));
  v_key := 'enterprise-workflow-execution-start-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id, v_key, 'enterprise_workflow_execution_start_v1', md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_workflow
  from public.merchant_enterprise_workflows
  where merchant_id = v_site_id and id = v_workflow_id
  for share;
  if not found or v_workflow.status <> 'published' or v_workflow.current_revision_id is null then
    raise exception 'workflow_not_found';
  end if;
  select * into v_revision
  from public.merchant_enterprise_workflow_revisions
  where merchant_id = v_site_id
    and workflow_id = v_workflow_id
    and id = v_workflow.current_revision_id
  for share;
  if not found or v_revision.revision_no <> v_expected_revision_no then
    raise exception 'workflow_revision_changed';
  end if;
  if not exists (
    select 1 from public.merchant_enterprise_workflow_acknowledgements
    where merchant_id = v_site_id
      and workflow_id = v_workflow_id
      and revision_id = v_revision.id
      and employee_id = v_employee_id
  ) then
    raise exception 'workflow_acknowledgement_required';
  end if;
  v_step_count := jsonb_array_length(v_revision.snapshot -> 'steps');
  if v_step_count not between 1 and 50 then
    raise exception 'workflow_execution_snapshot_invalid';
  end if;

  select count(*)::integer into v_active_execution_count
  from public.merchant_enterprise_workflow_executions
  where merchant_id = v_site_id
    and employee_id = v_employee_id
    and workflow_id = v_workflow_id
    and status = 'in_progress';
  if v_active_execution_count >= 100 then
    raise exception 'workflow_execution_limit_reached';
  end if;
  if v_generate_checklist then
    if exists (
      select 1 from public.merchant_enterprise_workflow_executions
      where merchant_id = v_site_id
        and task_id = v_task_id
        and generated_checklist_count > 0
    ) then
      raise exception 'workflow_task_execution_exists';
    end if;
    select count(*)::integer into v_active_checklist_count
    from public.merchant_task_checklist_items
    where merchant_id = v_site_id
      and task_id = v_task_id
      and archived_at is null;
    if v_active_checklist_count + v_step_count > 100 then
      raise exception 'task_checklist_limit_reached';
    end if;
  end if;

  insert into public.merchant_enterprise_workflow_executions (
    merchant_id, workflow_id, revision_id, revision_no, employee_id,
    task_id, subject, workflow_snapshot, total_steps, generated_checklist_count
  ) values (
    v_site_id, v_workflow_id, v_revision.id, v_revision.revision_no, v_employee_id,
    v_task_id, v_subject, v_revision.snapshot, v_step_count,
    case when v_generate_checklist then v_step_count else 0 end
  ) returning * into v_execution;

  for v_step in
    select value from jsonb_array_elements(v_revision.snapshot -> 'steps')
  loop
    v_step_id := (v_step ->> 'id')::uuid;
    v_step_position := (v_step ->> 'position')::integer;
    insert into public.merchant_enterprise_workflow_execution_steps (
      merchant_id, execution_id, step_id, title, instruction, position
    ) values (
      v_site_id, v_execution.id, v_step_id,
      btrim(v_step ->> 'title'), btrim(v_step ->> 'instruction'), v_step_position
    );
    if v_generate_checklist then
      v_checklist_response := public.faolla_create_merchant_task_checklist_item_v1(
        jsonb_build_object(
          'merchant_id', v_site_id,
          'task_id', v_task_id,
          'text', btrim(v_step ->> 'title'),
          'operation_id', 'workflow-execution-checklist:' || v_execution.id::text || ':' || v_step_position::text,
          'actor_type', 'employee',
          'actor_id', v_employee_id::text
        )
      );
      v_checklist_item_id := (v_checklist_response -> 'item' ->> 'id')::uuid;
      insert into public.merchant_enterprise_workflow_execution_checklist_items (
        merchant_id, execution_id, workflow_id, revision_id, revision_no,
        step_id, task_id, checklist_item_id
      ) values (
        v_site_id, v_execution.id, v_workflow_id, v_revision.id, v_revision.revision_no,
        v_step_id, v_task_id, v_checklist_item_id
      );
    end if;
  end loop;

  if v_task_id is not null then
    insert into public.merchant_task_events (
      merchant_id, task_id, operation_id, event_type, actor_type, actor_id, payload
    ) values (
      v_site_id,
      v_task_id,
      'workflow-execution-started:' || v_execution.id::text,
      'workflow_execution_started',
      'employee',
      v_employee_id::text,
      jsonb_build_object(
        'executionId', v_execution.id,
        'workflowId', v_workflow_id,
        'revisionId', v_revision.id,
        'revisionNo', v_revision.revision_no,
        'generatedChecklistCount', case when v_generate_checklist then v_step_count else 0 end
      )
    );
  end if;
  v_response := jsonb_build_object(
    'execution', public.faolla_build_merchant_workflow_execution_v1(v_site_id, v_execution.id),
    'generatedChecklistCount', case when v_generate_checklist then v_step_count else 0 end
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_key, v_response
  );
end;
$$;

create or replace function public.faolla_get_merchant_enterprise_workflow_employee_state_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_workflow_id uuid;
  v_actor jsonb;
  v_employee_id uuid;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_ack_id uuid;
  v_executions jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input, array['merchant_id', 'actor_type', 'actor_id', 'workflow_id']::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
  or (p_input ->> 'workflow_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid_workflow_execution_request';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id := (p_input ->> 'workflow_id')::uuid;
  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'employee' then raise exception 'employee_actor_required'; end if;
  v_employee_id := (v_actor ->> 'actor_id')::uuid;
  select * into v_workflow
  from public.merchant_enterprise_workflows
  where merchant_id = v_site_id and id = v_workflow_id;
  if not found or v_workflow.status <> 'published' or v_workflow.current_revision_id is null then
    raise exception 'workflow_not_found';
  end if;
  select id into v_ack_id
  from public.merchant_enterprise_workflow_acknowledgements
  where merchant_id = v_site_id
    and workflow_id = v_workflow_id
    and revision_id = v_workflow.current_revision_id
    and employee_id = v_employee_id;
  select coalesce(jsonb_agg(
    public.faolla_build_merchant_workflow_execution_v1(v_site_id, page.id)
    order by page.started_at desc, page.id desc
  ), '[]'::jsonb) into v_executions
  from (
    select id, started_at
    from public.merchant_enterprise_workflow_executions
    where merchant_id = v_site_id
      and workflow_id = v_workflow_id
      and employee_id = v_employee_id
    order by started_at desc, id desc
    limit 50
  ) as page;
  return jsonb_build_object(
    'currentRevisionNo', v_workflow.published_version,
    'acknowledgement', case when v_ack_id is null then null else
      public.faolla_build_merchant_workflow_acknowledgement_v1(v_site_id, v_ack_id) end,
    'executions', v_executions
  );
end;
$$;

create or replace function public.faolla_get_merchant_enterprise_workflow_execution_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_execution_id uuid;
  v_actor jsonb;
  v_employee_id uuid;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input, array['merchant_id', 'actor_type', 'actor_id', 'execution_id']::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'execution_id'), '') <> 'string'
  or (p_input ->> 'execution_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid_workflow_execution_request';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_execution_id := (p_input ->> 'execution_id')::uuid;
  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'employee' then raise exception 'employee_actor_required'; end if;
  v_employee_id := (v_actor ->> 'actor_id')::uuid;
  perform 1 from public.merchant_enterprise_workflow_executions
  where merchant_id = v_site_id and id = v_execution_id and employee_id = v_employee_id;
  if not found then raise exception 'workflow_execution_not_found'; end if;
  return jsonb_build_object(
    'execution', public.faolla_build_merchant_workflow_execution_v1(v_site_id, v_execution_id)
  );
end;
$$;

create or replace function public.faolla_update_merchant_enterprise_workflow_execution_step_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_execution_id uuid;
  v_step_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_actor jsonb;
  v_employee_id uuid;
  v_execution public.merchant_enterprise_workflow_executions%rowtype;
  v_completed_steps integer;
  v_key text;
  v_claim jsonb;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'execution_id', 'step_id',
      'expected_version', 'completed', 'note', 'evidence', 'operation_id'
    ]::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'execution_id'), '') <> 'string'
  or (p_input ->> 'execution_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(jsonb_typeof(p_input -> 'step_id'), '') <> 'string'
  or (p_input ->> 'step_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
  or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
  or char_length(p_input ->> 'expected_version') > 18
  or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
  or char_length(btrim(p_input ->> 'operation_id')) not between 1 and 120
  or not (p_input ? 'completed' or p_input ? 'note' or p_input ? 'evidence')
  or (p_input ? 'completed' and coalesce(jsonb_typeof(p_input -> 'completed'), '') <> 'boolean')
  or (p_input ? 'note' and (
    coalesce(jsonb_typeof(p_input -> 'note'), '') <> 'string'
    or char_length(btrim(p_input ->> 'note')) > 2000
  ))
  or (p_input ? 'evidence' and not public.faolla_valid_merchant_workflow_evidence_v1(p_input -> 'evidence')) then
    raise exception 'invalid_workflow_execution_step_update';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_execution_id := (p_input ->> 'execution_id')::uuid;
  v_step_id := (p_input ->> 'step_id')::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;
  v_operation_id := btrim(p_input ->> 'operation_id');
  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'employee' then raise exception 'employee_actor_required'; end if;
  v_employee_id := (v_actor ->> 'actor_id')::uuid;
  select * into v_execution
  from public.merchant_enterprise_workflow_executions
  where merchant_id = v_site_id and id = v_execution_id and employee_id = v_employee_id
  for update;
  if not found then raise exception 'workflow_execution_not_found'; end if;

  v_key := 'enterprise-workflow-execution-step-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id, v_key, 'enterprise_workflow_execution_step_v1', md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;
  if v_execution.version <> v_expected_version then raise exception 'enterprise_version_conflict'; end if;
  update public.merchant_enterprise_workflow_execution_steps
  set completed_at = case
        when p_input ? 'completed' and (p_input ->> 'completed')::boolean
          then coalesce(completed_at, statement_timestamp())
        when p_input ? 'completed' then null
        else completed_at
      end,
      note = case when p_input ? 'note' then btrim(p_input ->> 'note') else note end,
      evidence = case when p_input ? 'evidence' then p_input -> 'evidence' else evidence end,
      updated_at = statement_timestamp()
  where merchant_id = v_site_id and execution_id = v_execution_id and step_id = v_step_id;
  if not found then raise exception 'workflow_execution_step_not_found'; end if;
  select count(*)::integer into v_completed_steps
  from public.merchant_enterprise_workflow_execution_steps
  where merchant_id = v_site_id and execution_id = v_execution_id and completed_at is not null;
  update public.merchant_enterprise_workflow_executions
  set completed_steps = v_completed_steps,
      status = case when v_completed_steps = total_steps then 'completed' else 'in_progress' end,
      completed_at = case when v_completed_steps = total_steps
        then coalesce(completed_at, statement_timestamp()) else null end,
      updated_at = updated_at
  where merchant_id = v_site_id and id = v_execution_id and version = v_expected_version
  returning * into v_execution;
  if not found then raise exception 'enterprise_version_conflict'; end if;
  v_response := jsonb_build_object(
    'execution', public.faolla_build_merchant_workflow_execution_v1(v_site_id, v_execution_id)
  );
  return public.faolla_complete_enterprise_structure_operation_v1(v_site_id, v_key, v_response);
end;
$$;

create or replace function public.faolla_submit_merchant_enterprise_workflow_feedback_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_execution_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_actor jsonb;
  v_employee_id uuid;
  v_execution public.merchant_enterprise_workflow_executions%rowtype;
  v_key text;
  v_claim jsonb;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'execution_id', 'expected_version',
      'rating', 'text', 'operation_id'
    ]::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'execution_id'), '') <> 'string'
  or (p_input ->> 'execution_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
  or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
  or char_length(p_input ->> 'expected_version') > 18
  or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
  or char_length(btrim(p_input ->> 'operation_id')) not between 1 and 120
  or not (p_input ? 'rating' or p_input ? 'text')
  or (p_input ? 'rating' and (
    coalesce(jsonb_typeof(p_input -> 'rating'), '') <> 'number'
    or (p_input ->> 'rating') !~ '^[1-5]$'
  ))
  or (p_input ? 'text' and (
    coalesce(jsonb_typeof(p_input -> 'text'), '') <> 'string'
    or char_length(btrim(p_input ->> 'text')) > 2000
  ))
  or (not (p_input ? 'rating') and btrim(coalesce(p_input ->> 'text', '')) = '') then
    raise exception 'invalid_workflow_execution_feedback';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_execution_id := (p_input ->> 'execution_id')::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;
  v_operation_id := btrim(p_input ->> 'operation_id');
  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'employee' then raise exception 'employee_actor_required'; end if;
  v_employee_id := (v_actor ->> 'actor_id')::uuid;
  select * into v_execution
  from public.merchant_enterprise_workflow_executions
  where merchant_id = v_site_id and id = v_execution_id and employee_id = v_employee_id
  for update;
  if not found then raise exception 'workflow_execution_not_found'; end if;
  v_key := 'enterprise-workflow-feedback-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id, v_key, 'enterprise_workflow_feedback_v1', md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then return v_claim -> 'response'; end if;
  if v_execution.version <> v_expected_version then raise exception 'enterprise_version_conflict'; end if;
  if v_execution.status <> 'completed' then raise exception 'workflow_execution_incomplete'; end if;
  update public.merchant_enterprise_workflow_executions
  set feedback_rating = case when p_input ? 'rating' then (p_input ->> 'rating')::smallint else feedback_rating end,
      feedback_text = case when p_input ? 'text' then btrim(p_input ->> 'text') else feedback_text end,
      feedback_status = 'open',
      feedback_submitted_at = statement_timestamp(),
      feedback_resolution_note = '',
      feedback_resolved_at = null,
      feedback_resolver_type = null,
      feedback_resolver_id = null,
      updated_at = updated_at
  where merchant_id = v_site_id and id = v_execution_id and version = v_expected_version
  returning * into v_execution;
  if not found then raise exception 'enterprise_version_conflict'; end if;
  v_response := jsonb_build_object(
    'execution', public.faolla_build_merchant_workflow_execution_v1(v_site_id, v_execution_id)
  );
  return public.faolla_complete_enterprise_structure_operation_v1(v_site_id, v_key, v_response);
end;
$$;

create or replace function public.faolla_resolve_merchant_enterprise_workflow_feedback_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_execution_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_resolution_note text;
  v_actor jsonb;
  v_execution public.merchant_enterprise_workflow_executions%rowtype;
  v_key text;
  v_claim jsonb;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'actor_type', 'actor_id', 'execution_id', 'expected_version',
      'resolution_note', 'operation_id'
    ]::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'execution_id'), '') <> 'string'
  or (p_input ->> 'execution_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
  or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
  or char_length(p_input ->> 'expected_version') > 18
  or coalesce(jsonb_typeof(p_input -> 'resolution_note'), '') <> 'string'
  or char_length(btrim(p_input ->> 'resolution_note')) > 2000
  or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
  or char_length(btrim(p_input ->> 'operation_id')) not between 1 and 120 then
    raise exception 'invalid_workflow_execution_feedback';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_execution_id := (p_input ->> 'execution_id')::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;
  v_operation_id := btrim(p_input ->> 'operation_id');
  v_resolution_note := btrim(p_input ->> 'resolution_note');
  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'owner'
     and not coalesce((v_actor ->> 'can_manage')::boolean, false)
     and not coalesce((v_actor ->> 'can_publish')::boolean, false) then
    raise exception 'permission_denied';
  end if;
  select * into v_execution
  from public.merchant_enterprise_workflow_executions
  where merchant_id = v_site_id and id = v_execution_id
  for update;
  if not found then raise exception 'workflow_execution_not_found'; end if;
  v_key := 'enterprise-workflow-feedback-resolve-v1:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id, v_key, 'enterprise_workflow_feedback_resolve_v1', md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then return v_claim -> 'response'; end if;
  if v_execution.version <> v_expected_version then raise exception 'enterprise_version_conflict'; end if;
  if v_execution.feedback_status <> 'open' then raise exception 'workflow_feedback_not_open'; end if;
  update public.merchant_enterprise_workflow_executions
  set feedback_status = 'resolved',
      feedback_resolution_note = v_resolution_note,
      feedback_resolved_at = statement_timestamp(),
      feedback_resolver_type = v_actor ->> 'actor_type',
      feedback_resolver_id = case
        when v_actor ->> 'actor_type' = 'employee' then (v_actor ->> 'actor_id')::uuid
        else null
      end,
      updated_at = updated_at
  where merchant_id = v_site_id and id = v_execution_id and version = v_expected_version
  returning * into v_execution;
  if not found then raise exception 'enterprise_version_conflict'; end if;
  v_response := jsonb_build_object(
    'resolution', jsonb_build_object(
      'executionId', v_execution.id,
      'version', v_execution.version,
      'feedbackStatus', v_execution.feedback_status,
      'resolvedAt', v_execution.feedback_resolved_at,
      'resolverType', v_execution.feedback_resolver_type
    )
  );
  return public.faolla_complete_enterprise_structure_operation_v1(v_site_id, v_key, v_response);
end;
$$;

create or replace function public.faolla_get_merchant_enterprise_workflow_execution_stats_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_workflow_id uuid;
  v_actor jsonb;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_eligible_count integer;
  v_ack_count integer;
  v_execution_count integer;
  v_in_progress_count integer;
  v_completed_count integer;
  v_task_linked_count integer;
  v_generated_count integer;
  v_feedback_count integer;
  v_open_feedback_count integer;
  v_average_rating numeric;
  v_participants jsonb;
  v_feedback jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input, array['merchant_id', 'actor_type', 'actor_id', 'workflow_id']::text[]
  )
  or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
  or (p_input ->> 'workflow_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid_workflow_execution_request';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_workflow_id := (p_input ->> 'workflow_id')::uuid;
  v_actor := public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input, array['enterprise.view', 'workflows.view']::text[]
  );
  if v_actor ->> 'actor_type' <> 'owner'
     and not coalesce((v_actor ->> 'can_manage')::boolean, false)
     and not coalesce((v_actor ->> 'can_publish')::boolean, false) then
    raise exception 'permission_denied';
  end if;
  select * into v_workflow
  from public.merchant_enterprise_workflows
  where merchant_id = v_site_id and id = v_workflow_id;
  if not found or v_workflow.current_revision_id is null then raise exception 'workflow_not_found'; end if;

  select count(*)::integer into v_eligible_count
  from public.merchant_enterprise_employees as employee
  join public.merchant_enterprise_roles as role_row
    on role_row.merchant_id = employee.merchant_id and role_row.id = employee.role_id
  where employee.merchant_id = v_site_id
    and employee.status = 'active'
    and role_row.status = 'active'
    and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
    and 'enterprise.view' = any(role_row.permissions)
    and 'workflows.view' = any(role_row.permissions);
  select count(*)::integer into v_ack_count
  from public.merchant_enterprise_workflow_acknowledgements as acknowledgement
  join public.merchant_enterprise_employees as employee
    on employee.merchant_id = acknowledgement.merchant_id
   and employee.id = acknowledgement.employee_id
  join public.merchant_enterprise_roles as role_row
    on role_row.merchant_id = employee.merchant_id
   and role_row.id = employee.role_id
  where acknowledgement.merchant_id = v_site_id
    and acknowledgement.workflow_id = v_workflow_id
    and acknowledgement.revision_id = v_workflow.current_revision_id
    and employee.status = 'active'
    and role_row.status = 'active'
    and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
    and 'enterprise.view' = any(role_row.permissions)
    and 'workflows.view' = any(role_row.permissions);
  select
    count(*)::integer,
    (count(*) filter (where status = 'in_progress'))::integer,
    (count(*) filter (where status = 'completed'))::integer,
    (count(*) filter (where task_id is not null))::integer,
    coalesce(sum(generated_checklist_count), 0)::integer,
    (count(*) filter (where feedback_status <> 'none'))::integer,
    round(avg(feedback_rating) filter (where feedback_rating is not null), 2)
  into v_execution_count, v_in_progress_count, v_completed_count,
       v_task_linked_count, v_generated_count, v_feedback_count,
       v_average_rating
  from public.merchant_enterprise_workflow_executions
  where merchant_id = v_site_id and workflow_id = v_workflow_id
    and revision_id = v_workflow.current_revision_id;

  select count(*)::integer into v_open_feedback_count
  from public.merchant_enterprise_workflow_executions
  where merchant_id = v_site_id
    and workflow_id = v_workflow_id
    and feedback_status = 'open';

  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeId', participant.employee_id,
    'employeeName', participant.display_name,
    'acknowledgedAt', participant.acknowledged_at,
    'executionCount', participant.execution_count,
    'completedCount', participant.completed_count,
    'lastActivityAt', participant.last_activity_at
  ) order by participant.display_name, participant.employee_id), '[]'::jsonb)
  into v_participants
  from (
    select employee.id as employee_id,
      employee.display_name,
      acknowledgement.acknowledged_at,
      count(execution.id)::integer as execution_count,
      (count(execution.id) filter (where execution.status = 'completed'))::integer as completed_count,
      max(execution.updated_at) as last_activity_at
    from public.merchant_enterprise_employees as employee
    join public.merchant_enterprise_roles as role_row
      on role_row.merchant_id = employee.merchant_id and role_row.id = employee.role_id
    left join public.merchant_enterprise_workflow_acknowledgements as acknowledgement
      on acknowledgement.merchant_id = employee.merchant_id
     and acknowledgement.employee_id = employee.id
     and acknowledgement.workflow_id = v_workflow_id
     and acknowledgement.revision_id = v_workflow.current_revision_id
    left join public.merchant_enterprise_workflow_executions as execution
      on execution.merchant_id = employee.merchant_id
     and execution.employee_id = employee.id
     and execution.workflow_id = v_workflow_id
     and execution.revision_id = v_workflow.current_revision_id
    where employee.merchant_id = v_site_id
      and employee.status = 'active'
      and role_row.status = 'active'
      and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
      and 'enterprise.view' = any(role_row.permissions)
      and 'workflows.view' = any(role_row.permissions)
    group by employee.id, employee.display_name, acknowledgement.acknowledged_at
    order by employee.display_name, employee.id
    limit 500
  ) as participant;

  select coalesce(jsonb_agg(jsonb_build_object(
    'executionId', feedback.id,
    'executionVersion', feedback.version,
    'employeeId', feedback.employee_id,
    'employeeName', feedback.display_name,
    'revisionNo', feedback.revision_no,
    'rating', feedback.feedback_rating,
    'text', feedback.feedback_text,
    'status', feedback.feedback_status,
    'submittedAt', feedback.feedback_submitted_at,
    'resolutionNote', feedback.feedback_resolution_note,
    'resolvedAt', feedback.feedback_resolved_at,
    'resolverType', feedback.feedback_resolver_type,
    'resolverId', feedback.feedback_resolver_id
  ) order by (feedback.feedback_status = 'open') desc,
             feedback.feedback_submitted_at desc,
             feedback.id desc), '[]'::jsonb)
  into v_feedback
  from (
    select execution.*, employee.display_name
    from public.merchant_enterprise_workflow_executions as execution
    join public.merchant_enterprise_employees as employee
      on employee.merchant_id = execution.merchant_id and employee.id = execution.employee_id
    where execution.merchant_id = v_site_id
      and execution.workflow_id = v_workflow_id
      and execution.feedback_status <> 'none'
    order by (execution.feedback_status = 'open') desc,
             execution.feedback_submitted_at desc,
             execution.id desc
    limit 50
  ) as feedback;
  return jsonb_build_object('stats', jsonb_build_object(
    'merchantId', v_site_id,
    'workflowId', v_workflow_id,
    'currentRevisionNo', v_workflow.published_version,
    'eligibleEmployeeCount', v_eligible_count,
    'acknowledgedEmployeeCount', v_ack_count,
    'executionCount', v_execution_count,
    'inProgressCount', v_in_progress_count,
    'completedCount', v_completed_count,
    'taskLinkedExecutionCount', v_task_linked_count,
    'generatedChecklistCount', v_generated_count,
    'feedbackCount', v_feedback_count,
    'openFeedbackCount', v_open_feedback_count,
    'averageRating', v_average_rating,
    'participants', v_participants,
    'recentFeedback', v_feedback
  ));
end;
$$;

alter table public.merchant_enterprise_workflow_acknowledgements enable row level security;
alter table public.merchant_enterprise_workflow_executions enable row level security;
alter table public.merchant_enterprise_workflow_execution_steps enable row level security;
alter table public.merchant_enterprise_workflow_execution_checklist_items enable row level security;

revoke all on public.merchant_enterprise_workflow_acknowledgements
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_workflow_executions
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_workflow_execution_steps
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_workflow_execution_checklist_items
  from public, anon, authenticated, service_role;

revoke all on function public.faolla_valid_merchant_workflow_evidence_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_protect_merchant_workflow_execution_snapshot_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_protect_merchant_workflow_execution_step_snapshot_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_reject_merchant_workflow_execution_append_only_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_build_merchant_workflow_acknowledgement_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_build_merchant_workflow_execution_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_acknowledge_merchant_enterprise_workflow_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_start_merchant_enterprise_workflow_execution_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_get_merchant_enterprise_workflow_employee_state_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_get_merchant_enterprise_workflow_execution_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_workflow_execution_step_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_submit_merchant_enterprise_workflow_feedback_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_resolve_merchant_enterprise_workflow_feedback_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_get_merchant_enterprise_workflow_execution_stats_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_acknowledge_merchant_enterprise_workflow_v1(jsonb)
  to service_role;
grant execute on function public.faolla_start_merchant_enterprise_workflow_execution_v1(jsonb)
  to service_role;
grant execute on function public.faolla_get_merchant_enterprise_workflow_employee_state_v1(jsonb)
  to service_role;
grant execute on function public.faolla_get_merchant_enterprise_workflow_execution_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_workflow_execution_step_v1(jsonb)
  to service_role;
grant execute on function public.faolla_submit_merchant_enterprise_workflow_feedback_v1(jsonb)
  to service_role;
grant execute on function public.faolla_resolve_merchant_enterprise_workflow_feedback_v1(jsonb)
  to service_role;
grant execute on function public.faolla_get_merchant_enterprise_workflow_execution_stats_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608040022, 'merchant_enterprise_workflow_execution')
on conflict (version) do update set name = excluded.name;

notify pgrst, 'reload schema';

commit;
