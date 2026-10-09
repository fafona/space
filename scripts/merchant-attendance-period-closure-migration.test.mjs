// Static contracts, not a PostgreSQL/concurrency or end-user-path proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050149_merchant_attendance_period_closure.sql';
const source=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=source.replace(/--[^\n]*/g,'');
function body(name){const start=sql.indexOf('create or replace function public.'+name+'(');assert(start>=0,name);return sql.slice(start,sql.indexOf('$$;',start)+3);}
const rpc=body('faolla_attendance_period_closure_v1');
const checked=body('faolla_attendance_period_artifact_checked_v1');
const command=body('faolla_attendance_period_closure_command_v1');
const includes=(s,...parts)=>{for(const part of parts)assert(s.includes(part),part);};
const ordered=(s,...parts)=>{let at=-1;for(const part of parts){const next=s.indexOf(part,at+1);assert(next>at,part);at=next;}};
const tables=['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries'];

test('149 adds four isolated tables and five functions, with no old fact or writer edits',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.(\w+)/g)].map(x=>x[1]),tables);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[
    'faolla_attendance_period_closure_command_v1','faolla_attendance_period_artifact_checked_v1','faolla_attendance_period_entry_v1',
    'faolla_attendance_period_summary_v1','faolla_attendance_period_closure_v1']);
  for(const match of sql.matchAll(/\b(?:insert into|update|alter table) public\.(\w+)/g))
    assert(match[1]==='faolla_schema_migrations'||tables.includes(match[1]),match[1]);
  assert.doesNotMatch(sql,/\b(?:delete from|drop table|drop function|truncate table)\b/i);
});

test('prerequisites and partial installation checks precede new storage and are namespace independent',()=>{
  includes(sql,"version=202610050148 and name='merchant_attendance_period_source'",'installed<>(to_regclass(\'public.\'||t) is not null)',
    'installed<>(to_regprocedure(p) is not null)',"version=202610050149 and name<>'merchant_attendance_period_closure'",
    "where oid=to_regprocedure('public.faolla_attendance_period_source_v1(jsonb,uuid)')");
  ordered(sql,'$period_closure_prerequisites$;','create or replace function','create table if not exists');
  assert.doesNotMatch(sql,/nspname\s*=\s*'public'/);
});

test('one persisted text body per fingerprint, logical versions reference it without duplicate JSON storage',()=>{
  const start=sql.indexOf('create table if not exists public.merchant_attendance_period_artifacts');
  const artifactTable=sql.slice(start,sql.indexOf('create table if not exists public.merchant_attendance_period_versions',start));
  includes(artifactTable,'artifact_text text not null','unique(merchant_id,period_id,source_fingerprint)',
    "artifact_sha256=encode(sha256(convert_to(artifact_text,'UTF8')),'hex')",'artifact_bytes between 1 and 2097152');
  assert.doesNotMatch(artifactTable,/\bartifact\s+jsonb|\bsource\s+jsonb/);
  includes(sql,'foreign key(merchant_id,period_id,artifact_id) references public.merchant_attendance_period_artifacts');
  includes(checked,'a jsonb:=p.artifact_text::jsonb',"sha256(convert_to(p.artifact_text,'UTF8'))");
  assert.doesNotMatch(checked,/time_zone\(|at time zone|attendanceDay|period_source_v1|sourceCanonical|a::text/);
});

test('three append-only journals, private RLS and deferred head references',()=>{
  assert.equal((sql.match(/before update or delete on public\.merchant_attendance_period_/g)||[]).length,3);
  assert.equal((sql.match(/before truncate on public\.merchant_attendance_period_/g)||[]).length,3);
  assert.equal((sql.match(/enable row level security/g)||[]).length,4);
  includes(sql,'attendance_period_head_entry_fk','attendance_period_current_version_fk','attendance_period_version_entry_fk','attendance_period_artifact_entry_fk');
  assert.equal((sql.match(/deferrable initially deferred/g)||[]).length,4);
  includes(sql,'pg_policy where polrelid=t','aclexplode(coalesce(cls.relacl',"array['anon','authenticated','service_role']");
});

test('only the new five-argument RPC is executable by service, no browser grants',()=>{
  assert.deepEqual([...sql.matchAll(/grant execute on function public\.([^;]+);/g)].map(x=>x[1]),
    ['faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) to service_role']);
  includes(rpc,'security definer set search_path=pg_catalog');
  includes(sql,"has_function_privilege('anon',p,'EXECUTE')","has_function_privilege('authenticated',p,'EXECUTE')");
});

test('query is exact nine fields, <=31 dates and explicit preview/recovery/export combinations',()=>{
  includes(rpc,"array['siteId','access','workerId','fromDate','throughDate','mode','periodId','operationId','version']",
    "jsonb_typeof(p_query->'siteId') is distinct from 'string'",'length(site)<>8','last_day-first_day not between 0 and 30',
    "mode_name='preview' and (op is not null or requested_version is not null)","(mode_name='recover')<>(op is not null)",
    "mode_name='export' and requested_version is null");
  includes(command,"array['action','operationId','periodId','expectedRevision','expectedVersion','expectedFingerprint','reason']",
    "action_name not in('send','confirm','dispute','respond','seal','reopen')","(p->>'expectedRevision')::integer>100", "(p->>'expectedVersion')::integer>20");
});

test('merchant/settings precede worker UPDATE and locked current employee/role reauthentication',()=>{
  ordered(rpc,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for update;',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for update;',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;',
    'from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;');
  includes(rpc,"'enterprise.view'=any(r.permissions)","'attendance.self.view'=any(r.permissions)",
    "mode_name='export' and not('attendance.self.export'=any(r.permissions))", "'attendance.self.request'=any(r.permissions)");
  assert.doesNotMatch(rpc,/requests\.create|select user_id into/);
  const sourceCalls=[...rpc.matchAll(/faolla_attendance_period_source_v1\(([^;]+)\);/g)].map(x=>x[1]);
  assert(sourceCalls.length>0);assert(sourceCalls.every(args=>args==='source_query,p_auth_user_id'));
});

test('every saved-period operation checks fixed dual identity, actor and command before fresh write gates',()=>{
  ordered(rpc,'c.employee_id<>e.id or c.employee_auth_user_id<>e.auth_user_id',
    'select * into saved from public.merchant_attendance_period_entries',
    'saved.period_id<>pid or saved.actor_auth_user_id<>p_auth_user_id','saved.command is distinct from p_command',
    'if p_command is not null and saved.operation_id is null then','not coalesce(p_allow_write,false)');
  includes(rpc,"elsif mode_name='recover' then raise exception 'attendance_operation_not_found'",'replayed:=true;');
});

test('reopen works while paused but still requires current owner, reason, sealed state and exact CAS',()=>{
  includes(rpc,"(access_name='self')<>(action_name in('confirm','dispute'))",
    "if action_name<>'reopen' and (not coalesce(p_allow_write,false) or not s.enabled)",
    "if not c.sealed then raise exception 'attendance_period_not_sealed'", "c.sealed:=false;c.state:='open';c.confirmed_version:=null;");
  includes(command,"action_name not in('send','confirm') and char_length(p->>'reason')=0");
  assert.doesNotMatch(rpc,/unlock_period|correction_periods|submissionWindowDays|correction_control/);
});

test('fresh send re-collects true-owner148 and binds source/hash/identity/range/day boundaries',()=>{
  includes(rpc,'source_result:=public.faolla_attendance_period_source_v1(source_query,p_auth_user_id);',
    "p_artifact->'source' is distinct from source_result->'sourceCanonical'",
    "p_artifact->>'sourceFingerprint' is distinct from source_result->>'sourceFingerprint'",
    "source_result->>'sourceFingerprint' is distinct from p_command->>'expectedFingerprint'",
    "p_artifact->'worker' is distinct from expected_worker", "p_artifact->'period' is distinct from expected_period",
    "p_artifact->'dayBoundaries' is distinct from source_result->'dayBoundaries'",
    "p_artifact->'report'->'base'->>'employeeId' is distinct from e.id::text");
  ordered(rpc,"if action_name='send' then",'source_result:=public.faolla_attendance_period_source_v1',
    'artifact_text:=p_artifact::text;artifact_size:=','insert into public.merchant_attendance_period_closures');
});

test('only unfinished periods block fresh send; other pending context can be reviewed and exact replay stays earlier',()=>{
  const start=rpc.indexOf("if action_name='send' then"),end=rpc.indexOf("if action_name in('confirm','seal') then",start);
  const send=rpc.slice(start,end);
  const gate="if source_result->'blockers' ? 'period_in_progress' then raise exception 'attendance_period_blocked';end if;";
  ordered(send,'source_result:=public.faolla_attendance_period_source_v1(source_query,p_auth_user_id);',gate,
    'insert into public.merchant_attendance_period_closures');
  ordered(rpc,'saved.command is distinct from p_command','if p_command is not null and saved.operation_id is null then',gate);
  assert.equal((rpc.match(/source_result->'blockers' \? 'period_in_progress'/g)||[]).length,1);
  assert.doesNotMatch(send,/source_result->'blockers' is distinct from '\[\]'|pending_correction|pending_missing|pending_leave|open_session|unresolved_review/);
  includes(rpc,"source_result->'blockers' is distinct from '[]'::jsonb");
});

test('local quotas are explicit, immutable text is charged only on a cache miss and there is no auto-delete',()=>{
  includes(rpc,'if coalesce(c.revision,0)>=100', 'where merchant_id=site limit 1000','if n>=1000',
    'where merchant_id=site and worker_id=wid limit 200','if n>=200',
    'if new_version and c.current_version>=20','if artifact_size>2097152', 'if bytes_total+artifact_size>67108864');
  ordered(rpc,'source_fingerprint=source_result->>\'sourceFingerprint\';','if a.artifact_id is null then','sum(artifact_bytes)',
    'insert into public.merchant_attendance_period_artifacts select (a).*;');
});

test('last bounded history entry is reserved for reopening, so quota cannot leave a permanent seal',()=>{
  includes(rpc,"if coalesce(c.revision,0)>=100 or coalesce(c.revision,0)>=99 and action_name<>'reopen' then raise exception 'attendance_period_limit'",
    "c.sealed:=false;c.state:='open';c.confirmed_version:=null;");
  includes(sql,'check(not sealed or revision<100)');
  ordered(rpc,'saved.command is distinct from p_command',"coalesce(c.revision,0)>=99 and action_name<>'reopen'");
});

test('same-fingerprint send keeps the version and confirmation except a reopened cycle gets a new logical version',()=>{
  includes(rpc,"new_version:=c.state='open' or a.source_fingerprint<>source_result->>'sourceFingerprint'",
    'if new_version then','if not is_new then c.current_version:=c.current_version+1;end if;',
    'values(site,pid,c.current_version,a.artifact_id,op,now_at);',
    "c.confirmed_version:=null;c.state:=case when c.unresolved_dispute then 'disputed' else 'review' end;");
  assert.equal((rpc.match(/c\.unresolved_dispute:=false/g)||[]).length,1);
});

test('self confirmation rechecks actual self source equality but does not impersonate owner validation',()=>{
  includes(rpc,"if action_name in('confirm','seal') then", "if c.state='open' then raise exception 'attendance_period_not_confirmed'",
    "source_result->'sourceCanonical' is distinct from artifact_json->'source'",
    "if action_name='confirm' then c.confirmed_version:=c.current_version;c.unresolved_dispute:=false;c.state:='confirmed';");
  ordered(rpc,"if action_name='confirm' then", "source_result->>'validation' is distinct from 'owner_checked'");
});

test('seal requires current fingerprint, clean owner blockers, current explicit confirmation and no dispute',()=>{
  includes(rpc,"p_command->>'expectedFingerprint' is distinct from a.source_fingerprint",
    "source_result->'blockers' is distinct from '[]'::jsonb", "raise exception 'attendance_period_blocked'",
    'c.confirmed_version is distinct from c.current_version or c.unresolved_dispute',"c.sealed:=true;c.state:='sealed';");
});

test('sealed self dispute appends and leaves sealed version/confirmation intact; owner response cannot resolve it',()=>{
  const from=rpc.indexOf("elsif action_name='dispute' then"),through=rpc.indexOf("elsif action_name='reopen' then",from);
  const dispute=rpc.slice(from,through);
  includes(dispute,"c.unresolved_dispute:=true;if not c.sealed then c.state:='disputed';end if;");
  assert.doesNotMatch(dispute,/confirmed_version:=|sealed:=|current_version:=/);
  assert.doesNotMatch(rpc,/action_name='respond' then.*(?:unresolved_dispute|confirmed_version):=/);
});

test('all stored history is bounded, contiguous, chronologically checked and fixed version reads never resample',()=>{
  includes(rpc,'order by revision limit 101','entry_row.revision<>jsonb_array_length(history)+1',
    'prior_at>entry_row.recorded_at','jsonb_array_length(history)<>c.revision','if n<>c.current_version',
    "if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then",
    'if replayed and requested_version<>saved.version then');
  includes(rpc,"'artifactText',a.artifact_text","'artifactSha256',a.artifact_sha256","'artifactBytes',a.artifact_bytes",
    "'sourceChanged',changed", "'operation',public.faolla_attendance_period_entry_v1(saved)");
});

test('only known current-source failures degrade to unchecked; authorization, cancellation and unknown errors propagate',()=>{
  const block=rpc.slice(rpc.indexOf("if p_command is null and mode_name='detail'"),rpc.indexOf('common:=jsonb_build_object'));
  includes(block,'exception when raise_exception then','if sqlerrm=any(array[','changed:=null;','else raise;end if;');
  assert.doesNotMatch(block,/attendance_access_denied|attendance_worker_not_found|attendance_settings_required|when others|query_canceled/);
});

test('summary displays archived identity/name/range and not mutable current profile or reinterpreted dates',()=>{
  const summary=body('faolla_attendance_period_summary_v1');
  includes(summary,"return (a->'worker')||(a->'period')",'p.employee_auth_user_id::text',"'confirmedVersion',p.confirmed_version");
  assert.doesNotMatch(summary,/merchant_enterprise_employees|merchant_attendance_workers|attendance_valid_zone|day_boundary|at time zone p\.time_zone/);
});
