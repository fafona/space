// Static source/producer contracts only. Actual151 reproduction and152 SQL
// success, identity corruption and cap fixtures are root-owned runtime work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050152_merchant_attendance_period_missing_context.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read(filename),clean=source.replace(/--[^\n]*/g,'');
const previous=read('202610050151_merchant_attendance_period_source_ranges.sql');
const oldMissing=read('202610010103_merchant_attendance_missing_revisions.sql');
const reader=text=>{const at=text.indexOf('create or replace function public.faolla_attendance_period_source_v1(');assert(at>=0);return text.slice(at,text.indexOf('\n$$;',at)+4);};
const body=reader(source),prior=reader(previous);
const has=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const order=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const between=(text,a,b)=>{const start=text.indexOf(a),end=text.indexOf(b,start);assert(start>=0&&end>start);return text.slice(start,end);};

test('152 is one additive reader replacement with no new writes/table/index/helper or deadline change',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),['faolla_attendance_period_source_v1']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['faolla_schema_migrations']);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  assert.doesNotMatch(clean,/create\s+(?:index|table|trigger)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop\s+(?:table|function|index)|reindex/i);
  assert.doesNotMatch(clean,/statement_timeout|pg_advisory|lock\s+table|session_replication_role|disable trigger/i);
});

test('dependencies and the existing103 parent index are checked before reader cutover',()=>{
  has(clean,'202610010103::bigint','202610050148::bigint','202610050149::bigint','202610050150::bigint','202610050151::bigint',
    "version=202610050152 and name<>'merchant_attendance_period_missing_context'", "set local lock_timeout='3s'");
  order(clean,"idx:=to_regclass('public.attendance_missing_parent_idx')",'i.indisvalid and i.indisready and i.indislive',
    "pg_get_indexdef(idx,2,true)='supersedes_request_id'",'$period_missing_context_prerequisites$;',
    'create or replace function public.faolla_attendance_period_source_v1(');
  has(clean,"i.indrelid='public.merchant_attendance_missing_requests'::regclass","am.amname='btree'",'i.indexprs is null',
    'i.indnatts=2 and i.indnkeyatts=2',"='supersedes_request_idISNOTNULL'");
  has(oldMissing,'create index attendance_missing_parent_idx on public.merchant_attendance_missing_requests(merchant_id,supersedes_request_id) where supersedes_request_id is not null');
});

test('all151 authorization/locks/raw/report/calendar logic before missing is unchanged',()=>{
  const prefix=body.slice(0,body.indexOf('  -- Relevant missing facts'))
    .replace('  missing_base_ids uuid[];missing_child_ids uuid[];missing_parent public.merchant_attendance_missing_requests%rowtype;missing_root public.merchant_attendance_missing_requests%rowtype;\n','')
    .replace('  missing_parent_approval public.merchant_attendance_missing_entries%rowtype;missing_proposal jsonb;\n','');
  assert.equal(prefix,prior.slice(0,prior.indexOf('  -- All relevant missing requests')));
  order(body,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for share',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'faolla_attendance_unified_report_v1(site,p_auth_user_id');
});

test('base intervals retain exact151 overlap; only direct pending children add membership',()=>{
  const select=between(body,'  missing_base_ids:=','  for missing_row in');
  has(select,"x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from",
    'cardinality(missing_base_ids)>100','from unnest(missing_base_ids) relevant_parent(request_id)',
    'x.merchant_id=site and x.supersedes_request_id=relevant_parent.request_id and x.supersedes_request_id is not null',
    'terminal.request_id=x.request_id and terminal.revision=2',
    'unnest(missing_base_ids||missing_child_ids)','select distinct candidate.request_id','order by candidate.request_id limit 101','cardinality(ids)>100');
  const children=between(select,'  missing_child_ids:=','  -- Do not filter');
  assert.doesNotMatch(children,/worker_id|employee_id|actor_auth_user_id|start_at|end_at|root_request_id/);
  assert.doesNotMatch(body,/with recursive/i);
});

test('outside children are not discarded after selection and worker/double identity are explicit',()=>{
  const loop=between(body,'  for missing_row in','  -- A pending head can affect');
  assert.doesNotMatch(loop,/missing_row\.end_at<=range_from|missing_row\.start_at>=range_to/);
  for(const row of ['missing_row','missing_parent','missing_root'])has(loop,
    `row(${row}.worker_id,${row}.employee_id,${row}.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id)`);
  has(loop,"raise exception 'attendance_period_source_identity_changed'");
});

test('pending revisions bind the real approved parent operation and root, not just a foreign key',()=>{
  const loop=between(body,'    if missing_row.supersedes_request_id is not null and missing_op.revision=1 then','    root_ids:=');
  has(loop,'x.request_id=missing_row.supersedes_request_id',"missing_parent_approval.action is distinct from 'approve'",
    'missing_parent_approval.operation_id is distinct from missing_row.supersedes_operation_id',
    'missing_row.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)',
    'missing_row.location_id is distinct from missing_parent.location_id','missing_row.time_zone is distinct from missing_parent.time_zone',
    'x.request_id=missing_row.root_request_id','missing_root.root_request_id is not null','missing_root.supersedes_request_id is not null');
  assert.doesNotMatch(loop,/missing_parent_approval\.actor_auth_user_id[^\n]*(?:p_auth_user_id|user_id)/);
});

test('superseded approved parent and multiple simultaneous pending siblings fail closed',()=>{
  const loop=between(body,'    if missing_row.supersedes_request_id is not null','    root_ids:=');
  has(loop,"approved.revision=2 and approved.action='approve'",'successor.supersedes_request_id=missing_parent.request_id',
    'sibling.supersedes_request_id=missing_parent.request_id and sibling.request_id<>missing_row.request_id',
    'terminal.request_id=sibling.request_id and terminal.revision=2',"raise exception 'attendance_period_source_invalid'");
  has(oldMissing,'parent.request_id is null then raise exception \'attendance_missing_revision_stale\'',
    "then raise exception 'attendance_missing_revision_pending'");
});

test('full original revise command and saved UTC proposal are validated without current tzdata',()=>{
  const loop=between(body,'    if missing_row.supersedes_request_id is not null','    root_ids:=');
  has(loop,"array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']",
    "missing_first.command->>'action' is distinct from 'revise'","missing_first.command->>'operationId' is distinct from missing_row.request_id::text",
    "missing_first.command->>'expectedWorkerId' is distinct from missing_row.worker_id::text",
    "missing_first.command->>'supersedesRequestId' is distinct from missing_row.supersedes_request_id::text",
    "missing_first.command->>'expectedApprovalOperationId' is distinct from missing_row.supersedes_operation_id::text",
    "missing_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_row.policy_revision)",
    'missing_first.recorded_at is distinct from missing_row.submitted_at',
    'faolla_attendance_correction_proposal_v1(missing_row.proposal,missing_row.submitted_at)',
    "jsonb_array_length(missing_proposal->'breaks')>8",
    "faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_row.start_at",
    "faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_row.end_at");
  assert.doesNotMatch(loop,/faolla_attendance_missing_(?:v1|review_v1)\(|day_boundary|valid_zone|at time zone/);
  has(oldMissing,"d.recorded_at<now_at",'target.submitted_at:=now_at','target.root_request_id:=coalesce(parent.root_request_id,parent.request_id)');
});

test('total100 and existingroot100 remain failclosed; context ordering and pending blocker stay stable',()=>{
  has(body,'order by x.request_id loop',"coalesce(x.root_request_id,x.request_id)=coalesce(missing_row.root_request_id,missing_row.request_id) limit 101",
    "if cardinality(root_ids)>100 then raise exception 'attendance_period_source_too_large'",
    "if status_name='submitted' then flags:=array_append(flags,'pending_missing')");
  assert.equal(body.slice(body.indexOf('    root_ids:='),body.indexOf('  -- A pending head can affect')),
    prior.slice(prior.indexOf('    root_ids:='),prior.indexOf('  -- A pending head can affect')));
});

test('correction/revision ranges,147 freshness,canonical archive protocol and byte budgets are unchanged',()=>{
  assert.equal(body.slice(body.indexOf('  -- A pending head can affect')),prior.slice(prior.indexOf('  -- A pending head can affect')));
  has(body,"'sourceVersion','attendance-period-source-v1'",'faolla_attendance_period_canonical_v1(result)',
    "octet_length(convert_to(source_text,'UTF8'))>1048576","octet_length(convert_to(result::text,'UTF8'))>4194304");
});

test('only the existing service source RPC is granted and anonymous/PUBLIC execution is denied',()=>{
  has(clean,'revoke all on function public.faolla_attendance_period_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;',
    'grant execute on function public.faolla_attendance_period_source_v1(jsonb,uuid) to service_role;',
    "array['anon','authenticated']","p.prosecdef and p.proconfig @> array['search_path=pg_catalog']",
    "a.grantee=0 and a.privilege_type='EXECUTE'");
  assert.equal((clean.match(/grant execute on function/g)||[]).length,1);
});
