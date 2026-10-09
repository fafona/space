//196 source-contract checks only. The root agent owns all PostgreSQL runtime.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const filename='202610060166_merchant_attendance_employment_lifecycle.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read(filename),clean=sql.replace(/--[^\n]*/g,'');
const fn=name=>{const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('$$;',start);assert(start>=0&&end>start,name);return sql.slice(start,end+3);};
const has=(source,...needles)=>{for(const needle of needles)assert(source.includes(needle),needle);};
const order=(source,...needles)=>{let p=-1;for(const needle of needles){const n=source.indexOf(needle,p+1);assert(n>p,needle);p=n;}};
const api=fn('faolla_attendance_employment_lifecycle_v1'),detail=fn('faolla_attendance_employment_detail_v1');
const chain=fn('faolla_attendance_employment_chain_v1'),config=fn('faolla_attendance_employment_config_v1');
const receipt=fn('faolla_attendance_employment_receipt_v1'),restore=fn('faolla_attendance_account_detail_v1');

test('166 is one additive short transaction with one private ledger and no backfill',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  assert.equal((clean.match(/create table if not exists public\./g)||[]).length,1);
  assert.doesNotMatch(clean,/\b(?:delete from|truncate table|drop (?:table|index|function)|disable trigger|session_replication_role|set_config|pg_advisory|statement_timeout|create index)\b/i);
  for(const m of clean.matchAll(/\b(?:insert into|update) public\.(\w+)/g))assert.match(m[1],/^(?:merchant_attendance_(?:employment_periods|employment_operations|workers|settings)|faolla_schema_migrations)$/);
  has(sql,"set local lock_timeout='3s'","(202610060164::bigint,'merchant_attendance_account_suspensions')",'installed<>(to_regclass','installed<>exists');
  order(sql,'$employment_postconditions$;',"values(202610060166,'merchant_attendance_employment_lifecycle')",'commit;');
});
test('legacy copies retain original OIDs and the064 patch changes exactly its history predicate',()=>{
  const old=read('202609290064_merchant_attendance_owner_configuration.sql');
  const needle=sql.match(/needle:=\$old\$([\s\S]*?)\$old\$/)?.[1];assert(needle);
  assert.equal(old.split(needle).length,2);
  const replacement=sql.match(/replacement:=\$new\$([\s\S]*?)\$new\$/)?.[1];assert(replacement);
  const patched=old.replace(needle,replacement);
  assert.equal(patched.replace(replacement,needle),old);
  has(sql,"definition:=pg_get_functiondef",'execute replace(definition,needle,replacement)',"to_regprocedure('public.'||spec.copy",'length(replace(definition,needle');
  assert.doesNotMatch(clean,/alter function|rename to/);
  assert.doesNotMatch(replacement,/actor|auth|version|operation/);
  assert.equal((sql.match(/create or replace function public\.faolla_attendance_account_detail_v1\(/g)||[]).length,1);
});
test('strict six-key query and fourteen-key command fail closed, with bounded reason and body',()=>{
  has(api,"array['siteId','mode','workerId','afterId','afterRevision','operationId']","mode_name in('detail','history')","mode_name='recover'","mode_name<>'list' and after_id","mode_name<>'history' and after_revision");
  const command=fn('faolla_attendance_employment_command_v1');
  has(command,"'expectedWorkerVersion'","'expectedEmployeeVersion'","'expectedSettingsVersion'","'expectedRevision'","'expectedPeriodId'","'suspensionId'","'expectedGeneration'","'expectedDate'",'octet_length(p::text)>8192',"p->>'action' is null",'return false;',"p->>'reason',1,500");
  assert.doesNotMatch(command,/when others/);
});
test('fingerprint tuple exactly matches browser command protocol and receipts omit reason',()=>{
  const hash=fn('faolla_attendance_employment_hash_v1');
  order(hash,"'attendance-employment-lifecycle-v1'","p_site","p->>'action'","p->>'operationId'","p->>'workerId'","p->>'employeeId'","p->>'employeeAuthUserId'",
    "p->>'expectedWorkerVersion'","p->>'expectedEmployeeVersion'","p->>'expectedSettingsVersion'","p->>'expectedRevision'","p->>'expectedPeriodId'","p->>'suspensionId'","p->>'expectedGeneration'","p->>'expectedDate'","p->>'reason'");
  has(hash,'public.faolla_attendance_account_hash_v1');
  has(receipt,'p.command_fingerprint is distinct from public.faolla_attendance_employment_hash_v1','p.command->\'expectedRevision\' is distinct from to_jsonb(p.revision-1)');
  const projection=receipt.slice(receipt.indexOf('return jsonb_build_object'));
  assert.doesNotMatch(projection,/'reason'|'command'|'timeZone'/);
});
test('current owner authentication and settings lock precede replay and mutations',()=>{
  order(api,'from public.merchants x where x.id=site for share',"if mode_name='recover'",'m.user_id,m.auth_user_id,m.owner_user_id','where x.merchant_id=site for update','if prior.operation_id is not null then\n        if prior.actor_auth_user_id',"if not p_allow_write",'detail:=public.faolla_attendance_employment_detail_v1');
  has(api,"prior.command is distinct from p_command","attendance_operation_conflict","attendance_employment_lifecycle_disabled");
  const recover=api.slice(api.indexOf("if mode_name='recover'"),api.indexOf('if not coalesce(p_auth_user_id'));
  assert.doesNotMatch(recover,/p_allow_write|current_date|paused|m\.user_id/);
  has(recover,'prior.actor_auth_user_id<>p_auth_user_id');
});
test('detail locks worker then employee and preserves exact original suspension tail',()=>{
  order(detail,'where x.merchant_id=p_site and x.id=p_worker for update','where x.merchant_id=p_site and x.id=w.employee_id for share','now_at:=clock_timestamp()');
  has(detail,'pause.worker_id is distinct from w.id','pause.employee_auth_user_id is distinct from e.auth_user_id','epoch.paused is distinct from true','pause.generation is distinct from epoch.generation',
    '(ev.id,ev.sequence,ev.action,ev.actor_employee_id) is distinct from (pause.original_event_id,pause.original_sequence,pause.original_action,pause.original_actor_employee_id)',"ev.action<>'clock_out'",'ev.actor_employee_id is distinct from e.id');
  assert.doesNotMatch(detail,/set active|insert into|update public\./);
});
test('full controlled chain uses exact identities, period membership and bounded199 proof',()=>{
  has(chain,'limit 101','limit 201','if n>199','entry.revision<>n','entry.employee_id is distinct from p_employee','entry.employee_auth_user_id is distinct from p_auth',
    'pause.worker_id is distinct from p_worker','pause.generation is distinct from entry.generation','ids is distinct from seen','entry.period_id=any(seen)',"prior.action is distinct from 'close'",'entry.starts_on<=prior.ends_on',"prior.action<>'rejoin'",'row_p.starts_on<=last_end');
  assert.doesNotMatch(chain,/actor_auth_user_id\s*(?:=|<>).*p_auth|at time zone|update public/);
  has(chain,"if limited then periods:='[]';end if;");
});
test('pending selection includes ongoing and future items before combined100 sentinel',()=>{
  assert.equal((detail.match(/x\.end_at>now_at/g)||[]).length,3);
  has(detail,"z.action in('withdraw','reject','cancel')",'merchant_attendance_schedule_cancellations',') z order by z.start_at,z.kind,z.id limit 101',
    "if count_items>100 then limited:=true;pending:='[]';exit;",'public.faolla_attendance_self_schedule_slot_v1(schedule)','public.faolla_attendance_leave_summary_v1(leave_row)','public.faolla_attendance_work_arrangement_summary_v1(work_row)',"'historicalPending','not_checked'");
  const candidates=detail.slice(detail.indexOf('for candidate in'),detail.indexOf('count_items:=count_items+1'));
  assert.doesNotMatch(candidates,/employee_id|actor_auth_user_id|auth_user_id|start_at>now_at/);
  has(detail,"base:=base||'\"pending_limit\"'::jsonb","base:=base||'\"pending_items\"'::jsonb");
});
test('close/rejoin recheck all CAS values and server civil date while preserving inactive state',()=>{
  for(const key of ['expectedWorkerVersion','expectedEmployeeVersion','expectedSettingsVersion','expectedRevision','expectedGeneration'])has(api,"p_command->'"+key+"'");
  for(const key of ['expectedDate','expectedPeriodId'])has(api,"p_command->>'"+key+"'");
  has(api,"stamp:=clock_timestamp();today:=(stamp at time zone s.time_zone)::date",'set ends_on=today',"and ends_on is null returning * into row_p",'values(site,wid,today,stamp)',
    'update public.merchant_attendance_workers set version=version+1','update public.merchant_attendance_settings set version=version+1','chain->\'valid\' is distinct from \'true\'::jsonb');
  assert.doesNotMatch(api,/set active|set paused|pin_credentials|delegation|clock_out.*insert/);
  has(detail,"last_period->>'endsOn')::date>=today","\"date_not_after_end\"","jsonb_array_length(chain->'periods')>=100");
});
test('164 closed gate is outside was_active and leaves old snapshot/recovery implementation intact',()=>{
  order(restore,'result_json:=public.faolla_attendance_account_detail_pre166(p)','public.faolla_attendance_employment_chain_v1',"chain->>'state'='closed'", "'{canRestore}','false'::jsonb");
  has(restore,'"employment_closed"');
  has(restore,"today:=(clock_timestamp() at time zone zone_name)::date","last_period->'endsOn' is distinct from 'null'::jsonb","(last_period->>'startsOn')::date>today or today is null");
  assert.doesNotMatch(restore,/if p\.was_active|update public|suspensions_v1|original_event_id\s*:=/);
  assert.doesNotMatch(sql,/create or replace function public\.faolla_attendance_account_suspensions_v1\(/);
});
test('064 uncontrolled workers retain exact old single-open requirement; controlled closed only inactive',()=>{
  has(config,'if not exists(select 1 from public.merchant_attendance_employment_operations',"count(*)=1",'x.starts_on=p_start and x.ends_on is null',
    "chain->'valid' is distinct from 'true'::jsonb","if chain->>'state'='closed' then return not p_active;end if;",'not p_active or p_start<=today');
  assert.doesNotMatch(config,/update public|insert into|paused=false|grant execute/);
});
test('pagination and caps are complete rather than silently truncated',()=>{
  has(api,'order by x.revision limit 26','order by x.id limit 26 for share','jsonb_array_length(items)=25','jsonb_array_length(history)=25','octet_length(result_json::text)>131072');
  has(sql,'revision between 1 and 199','unique(merchant_id,worker_id,revision)');
});
test('private storage, both append guards and exact schema/functions are rechecked',()=>{
  has(sql,'enable row level security','revoke all on table public.merchant_attendance_employment_operations from public,anon,authenticated,service_role',
    'tgenabled=\'O\' and tgtype=27','tgenabled=\'O\' and tgtype=34','columns is distinct from array',"contype='f')<>5","contype='c')<>8",'i.indisvalid and i.indisready',"proconfig=array['search_path=pg_catalog']");
  const grants=[...clean.matchAll(/grant execute on function ([^;]+);/g)].map(m=>m[1]);
  assert.deepEqual(grants,['public.faolla_attendance_employment_lifecycle_v1(jsonb,uuid,jsonb,boolean) to service_role']);
  for(const m of clean.matchAll(/create or replace function public\.(\w+)/g))assert(m[1].length<=63,m[1]);
  assert.doesNotMatch(sql,/'public'::regnamespace/);
});
