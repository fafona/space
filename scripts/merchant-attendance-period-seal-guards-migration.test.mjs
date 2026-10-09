// Static contracts only. PostgreSQL execution, atomic rollback, leases and
// concurrency are separately exercised by the root-owned native acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610050150_merchant_attendance_period_seal_guards.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read(file);
const sql=source.replace(/--[^\n]*/g,'');
const targets=['correction_entries','revision_requests','correction_effects','effect_versions','missing_requests','missing_entries']
  .map(name=>'merchant_attendance_'+name);
function body(name) {
  const start=sql.indexOf('create or replace function public.'+name+'(');
  assert(start>=0,name);return sql.slice(start,sql.indexOf('$$;',start)+3);
}
const helper=body('faolla_attendance_period_assert_open_v1');
const guard=body('faolla_attendance_period_seal_insert_guard_v1');
const includes=(value,...parts)=>{for(const part of parts)assert(value.includes(part),part);};
const ordered=(value,...parts)=>{let at=-1;for(const part of parts){const next=value.indexOf(part,at+1);assert(next>at,part);at=next;}};

test('150 is additive trigger integration, replacing only its two new private functions',()=>{
  assert.deepEqual(validateMigrationSource(file,source),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),
    ['faolla_attendance_period_assert_open_v1','faolla_attendance_period_seal_insert_guard_v1']);
  assert.doesNotMatch(sql,/\b(?:create table|alter table|create index|drop|delete from|truncate|execute format|execute\s+')\b/i);
  assert.deepEqual([...sql.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(sql,/\bupdate\s+public\./i);
});

test('six canonical append points cover current and compatibility writers, never raw events',()=>{
  assert.deepEqual([...sql.matchAll(/create trigger attendance_period_seal_guard before insert on public\.(\w+)/g)].map(x=>x[1]),targets);
  assert.equal((sql.match(/for each row execute function public\.faolla_attendance_period_seal_insert_guard_v1\(\)/g)||[]).length,6);
  assert.doesNotMatch(sql,/create trigger[^;]*on public\.merchant_attendance_events\b/);
  includes(sql,"tgrelid='public.merchant_attendance_events'::regclass",'merchant_attendance_period_seal_guards_clock_postcondition_failed');
});

test('prerequisite and orphan checks fail closed before any function or trigger creation',()=>{
  includes(sql,"version=202610050149 and name='merchant_attendance_period_closure'","version=202610010103 and name='merchant_attendance_missing_revisions'",
    "to_regclass('public.merchant_attendance_period_closures')",'installed<>(to_regprocedure(p) is not null)',
    "version=202610050150 and name<>'merchant_attendance_period_seal_guards'",'merchant_attendance_period_seal_guards_installation_conflict');
  ordered(sql,'$period_seal_guard_prerequisites$;','create or replace function','$period_seal_guard_install$;','insert into public.faolla_schema_migrations');
  includes(sql,"tgfoid<>to_regprocedure('public.faolla_attendance_period_seal_insert_guard_v1()')",'tgtype<>7',"tgenabled<>'O'",'tgqual is not null');
});

test('reapply keeps trigger identities and checks all six normal BEFORE ROW INSERT attachments',()=>{
  includes(sql,"if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_correction_entries'::regclass and tgname='attendance_period_seal_guard') then",
    "tgfoid='public.faolla_attendance_period_seal_insert_guard_v1()'::regprocedure and tgtype=7",
    "tgenabled='O' and tgnargs=0 and tgqual is null)<>1");
  assert.doesNotMatch(sql,/create or replace trigger|drop trigger/i);
});

test('both helpers remain invoker-private with no role grants or public RPC',()=>{
  for(const name of ['faolla_attendance_period_assert_open_v1(text,uuid,jsonb)','faolla_attendance_period_seal_insert_guard_v1()'])
    includes(sql,'revoke all on function public.'+name+' from public,anon,authenticated,service_role;');
  includes(sql,"array['anon','authenticated','service_role']","has_function_privilege(role_name,p,'EXECUTE')",'select prosecdef from pg_proc where oid=p');
  assert.doesNotMatch(sql,/\bgrant\b|security definer/i);
});

test('assertion uses a bounded exact UTC6 array and rejects malformed/nonfinite/reversed spans',()=>{
  includes(helper,"jsonb_typeof(p_spans) is distinct from 'array'",'octet_length(p_spans::text)>1024',
    'jsonb_array_length(p_spans) not between 1 and 3',"array['startAt','endAt']",'jsonb_object_keys(span))<>2',
    'length(span->>k)<>27','is distinct from span->>k','not isfinite(a) or not isfinite(b) or b<a');
  includes(helper,"raise exception 'attendance_period_closure_invalid'","if b=a then b:=b+interval '1 microsecond';end if;");
});

test('only same merchant and worker sealed half-open overlap blocks; endpoint touching remains allowed',()=>{
  includes(helper,'c.merchant_id=p_site and c.worker_id=p_worker and c.sealed and c.start_at<b and c.end_at>a',
    "raise exception 'attendance_period_sealed'");
  assert.doesNotMatch(helper,/c\.start_at\s*<=|c\.end_at\s*>=|merchant_attendance_correction_periods/);
});

test('withdraw/reject/submission-receipt insert paths exit before seal/source reads',()=>{
  ordered(guard,"if new.action<>'submit' then return new;end if;","if new.action<>'approve' then return new;end if;",
    'site:=new.merchant_id;','if not exists(select 1 from public.merchant_attendance_period_closures');
  includes(guard,"if tg_op<>'INSERT' or tg_when<>'BEFORE' or tg_level<>'ROW'",'then return new;end if;');
  assert.doesNotMatch(guard,/clock_timestamp|p_allow_write|platform_paused|submissionWindowDays/);
});

test('unsealed worker fast path leaves all old validations intact and acquires no inverted worker/settings locks',()=>{
  ordered(guard,'worker:=new.worker_id;','where merchant_id=site and worker_id=worker and sealed) then return new;end if;',
    'proposed_start:=missing_request.start_at;','basis:=new.basis;');
  assert.doesNotMatch(guard,/\bfor (?:share|update)\b|pg_advisory|set_config/i);
  includes(source,'All existing writers and 149 seal/reopen hold settings UPDATE','no worker->settings upgrade');
});

test('correction fresh submit and first effect protect the immutable original and proposed spans',()=>{
  includes(guard,'basis:=new.basis;proposal:=new.proposal;start_id:=new.start_event_id;',
    "operation_id=new.request_id and action='submit'",'original.start_event_id is distinct from new.start_event_id',
    'basis:=original.basis;proposal:=new.proposal;start_id:=new.start_event_id;',
    "basis->'events'->0->>'id' is distinct from start_id::text",
    "original_start:=(basis->'events'->0->>'occurredAt')::timestamptz;",
    "original_end:=(basis->'events'->-1->>'occurredAt')::timestamptz;");
  includes(guard,"basis->'events'->-1->>'action'<>'clock_out'", "original_end:=original_end+interval '1 microsecond';");
});

test('revision submission and effect protect original plus latest approved plus proposed, not only root effect',()=>{
  includes(guard,"root_id:=new.base_request_id;proposal:=new.command->'proposal';",'root_id:=new.root_request_id;',
    'revision_request.base_request_id is distinct from root_id',"proposal:=revision_request.command->'proposal';",
    "operation_id=root_id and action='submit'",'original.worker_id is distinct from worker',
    'select * into current_effect from public.merchant_attendance_effect_current_v2',
    'where merchant_id=site and worker_id=worker and start_event_id=start_id;',
    'current_effect.root_request_id is distinct from root_id',
    'current_start:=current_effect.start_at;current_end:=current_effect.end_at;');
  assert.doesNotMatch(guard,/new\.start_at|new\.end_at/);
});

test('missing submission and approval protect both new declaration and superseded interval',()=>{
  includes(guard,'where merchant_id=site and request_id=new.request_id;',
    "then missing_request:=new;end if;",'proposed_start:=missing_request.start_at;proposed_end:=missing_request.end_at;',
    'if missing_request.supersedes_request_id is not null then',
    'where merchant_id=site and request_id=missing_request.supersedes_request_id;',
    'missing_parent.worker_id is distinct from worker','current_start:=missing_parent.start_at;current_end:=missing_parent.end_at;');
});

test('one bounded gate invocation sees every collected span and does not swallow sealed errors',()=>{
  assert.equal((guard.match(/perform public\.faolla_attendance_period_assert_open_v1\(/g)||[]).length,1);
  ordered(guard,"'startAt',to_char(original_start", "'startAt',to_char(current_start", "'startAt',to_char(proposed_start",
    'perform public.faolla_attendance_period_assert_open_v1(site,worker,spans);');
  for(const value of [helper,guard])assert.doesNotMatch(value,/when others|raise notice|exception when.*period_sealed/i);
});

test('existing compatibility and current submit paths append to guarded tables rather than dynamic writers',()=>{
  const first=read('202609300086_merchant_attendance_correction_decisions.sql');
  const revision=read('202610010095_merchant_attendance_revision_cycles.sql');
  includes(first,'insert into public.merchant_attendance_correction_entries(');
  assert.equal((revision.match(/insert into public\.merchant_attendance_revision_requests\(/g)||[]).length,2);
  assert.equal((revision.match(/insert into public\.merchant_attendance_effect_versions\(/g)||[]).length,2);
  for(const name of ['202610010093_merchant_attendance_versioned_reports.sql','202610010096_merchant_attendance_current_correction_decisions.sql'])
    includes(read(name),'insert into public.merchant_attendance_correction_effects(');
  includes(read('202610010103_merchant_attendance_missing_revisions.sql'),
    'insert into public.merchant_attendance_missing_requests select (target).*;',
    'insert into public.merchant_attendance_missing_entries(');
});

test('existing idempotency branches skip inserts, while approval gate exceptions roll back the same transaction',()=>{
  const current=read('202610010096_merchant_attendance_current_correction_decisions.sql');
  ordered(current,'if receipt.request_id is not null then','if receipt.command<>p_command',
    'insert into public.merchant_attendance_correction_decisions(',"if receipt.action='approve' then",'insert into public.merchant_attendance_correction_effects(');
  const revision=read('202610010095_merchant_attendance_revision_cycles.sql');
  includes(revision,'if receipt.command<>p_command then',"if receipt.action='approve' then");
  assert.doesNotMatch(guard,/\bcommit\b|\brollback\b|when others/i);
});

test('native probes are inert, ownership checked and immediately verify each failed statement before outer rollback',()=>{
  const native=readFileSync(new URL('./fixtures/attendance-period-seal-guards-native.mjs',import.meta.url),'utf8');
  includes(native,'export async function verifyPeriodSealGuardsNative({d,native,scope,h,q,pid})','assertLifecycleSandbox',
    'assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'before_hash:=${allHash}',"assert ${allHash}=before_hash,'period_gate_failure_left_partial_rows'",
    "observed('after')+'rollback;'",'d.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog');
  assert.doesNotMatch(native,/child_process|spawn\(|execFile|process\.env|process\.argv|disable trigger|session_replication_role|statement_timeout/);
  for(const name of ['correction_self_v3','correction_decide_v1','correction_decide_v2','revision_self_v1','revision_self_v2',
    'revision_decide_v2','missing_v1','period_closure_v1','self_v1'])includes(native,'faolla_attendance_'+name+'(');
  includes(native,"run('fresh_correction_submit'","run('first_approval_and_recovery'","run('revision_requests_and_effect'",
    "run('missing_and_superseded_interval'","run('reserved_reopen_capacity'",'Math.min(ceiling,99)',
    "'expectedRevision',99",'attendance_period_limit',"result->'period'->>'revision'='100'",
    "result->'period'->'sealed'='false'::jsonb",'actualNormalClockEventsWithinRollback:2',
    'this is not a legitimate seal-with-pending workflow claim');
});
