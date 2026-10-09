//211 static contract only: no PostgreSQL, environment, migration execution or data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610070176_merchant_attendance_outage_foundation.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{
  const a=sql.indexOf(`create or replace function public.faolla_attendance_outage${name?'_'+name:''}_v1(`),b=sql.indexOf('\n$$;',a);
  assert(a>=0&&b>a,name);return sql.slice(a,b+4);
};
const has=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const order=(s,...parts)=>{let last=-1;for(const p of parts){const next=s.indexOf(p,last+1);assert(next>last,p);last=next;}};
const interval=fn('interval'),command=fn('command'),fingerprint=fn('hash'),pairing=fn('ledger_guard'),rpc=fn('');

test('176 is one additive transaction, eight new functions and three new tables only',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(m=>m[1]),
    ['interval','command','hash','ledger_guard','incident','declaration','receipt',''].map(n=>`faolla_attendance_outage${n?'_'+n:''}_v1`));
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map(m=>m[1]),
    ['operations','incidents','declarations'].map(n=>'merchant_attendance_outage_'+n));
  has(sql,"set local lock_timeout='3s'","(202610060164::bigint,'merchant_attendance_account_suspensions')",
    "(202610060175::bigint,'merchant_attendance_plan_posthoc_periods')","values(202610070176,'merchant_attendance_outage_foundation') on conflict(version) do nothing",
    "notify pgrst, 'reload schema';\ncommit;");
  assert.doesNotMatch(sql,/disable trigger|pg_get_functiondef|set_config\(|current_setting\(|create policy|alter role|grant .* on public\.merchant_attendance_/i);
});

test('all writes are to the new ledger; no clock, correction, missing, epoch or period mutation',()=>{
  const targets=[...sql.matchAll(/\b(?:insert into|delete from|update)\s+public\.([a-z0-9_]+)/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(targets)].sort(),['faolla_schema_migrations','merchant_attendance_outage_declarations','merchant_attendance_outage_incidents','merchant_attendance_outage_operations']);
  assert.doesNotMatch(rpc,/period_assert_open|account_capture|missing_v1\(|correction|period_closure|clock_v/);
  has(sql,'A declaration is neither a clock event nor a resolved claim','No old function, source, period, application, permission or setting is changed');
});

test('strict bounded commands and discriminated queries do not accept null enums or extra authority',()=>{
  has(command,">8192","jsonb_typeof(p->'action') is distinct from 'string'","p->>'action' not in('create_incident','declare')",
    "array['action','operationId','incidentId','type','channel','locationId','interval','reason']",
    "array['action','operationId','declarationId','incidentId','workerId','employeeId','employeeAuthUserId','expectedWorkerVersion','expectedEmployeeVersion','expectedGeneration','interval','statement','originalOperationId','originalChannel','paperReference']",
    "p->'originalOperationId'='null'::jsonb and p->'originalChannel'='null'::jsonb");
  has(rpc,">4096","p_allow_write is null","array['siteId','access','mode','afterId']","array['siteId','access','mode','incidentId','afterId']",
    "array['siteId','access','mode','incidentId']","array['siteId','access','mode','declarationId']","array['siteId','access','mode','operationId']",
    "mode_name='incident' and access_name='owner'","p_command->>'declarationId'=record_id::text");
});

test('historical span validation is exact microseconds and never replays timezone rules',()=>{
  has(interval,"'startAt','endAt','timeZone','startOffsetMinutes','endOffsetMinutes'",'at time zone \'UTC\'',"b-a>interval '744 hours'",
    "b>='2101-01-01T00:00:00Z'::timestamptz","not between -840 and 840",'to_char((p->>k)::timestamptz');
  assert.doesNotMatch(interval,/pg_timezone_names|valid_zone_v1|clock_timestamp|at time zone zone_name/);
  order(rpc,'select * into saved from public.merchant_attendance_outage_operations','receipt:=public.faolla_attendance_outage_receipt_v1(saved)',
    'if receipt is null and p_command is not null then',"if not p_allow_write then raise exception 'attendance_outage_disabled'",
    'public.faolla_attendance_valid_zone_v1(zone_name)','(a at time zone zone_name)','(b at time zone zone_name)');
  has(rpc,'or b>stamp',"a<(i.declared_interval->>'endAt')::timestamptz and (i.declared_interval->>'startAt')::timestamptz<b");
});

test('scalar fingerprint tuple preserves exact command and excludes JSON object key ordering',()=>{
  has(fingerprint,"jsonb_build_array(p_site,p_access,p->'action',p->'operationId',p->'incidentId',p->'type',p->'channel',p->'locationId'",
    "jsonb_build_array(p_site,p_access,p->'action',p->'operationId',p->'declarationId',p->'incidentId',p->'workerId',p->'employeeId',p->'employeeAuthUserId'",
    "p->'expectedWorkerVersion',p->'expectedEmployeeVersion',p->'expectedGeneration'",
    "string_agg(value::text,',' order by ordinal)","encode(sha256(convert_to(body,'UTF8')),'hex')");
  assert.doesNotMatch(fingerprint,/p::text|command::text/);
  has(rpc,'saved.command is distinct from p_command','saved.record_id is distinct from coalesce(record_id,target_incident)');
});

test('settings-first locks serialize replay and writes; membership and role are rechecked under locks',()=>{
  order(rpc,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for update',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share',
    'select * into saved from public.merchant_attendance_outage_operations');
  has(rpc,"e.auth_user_id is distinct from p_auth_user_id or e.status<>'active'",
    "array['enterprise.view','attendance.self.view','attendance.self.request']::text[]",
    'saved.actor_auth_user_id<>p_auth_user_id','row(saved.worker_id,saved.employee_id,saved.employee_auth_user_id,saved.actor_employee_id)');
  assert.doesNotMatch(rpc,/x\.incident_id=incident_id\b|declare[^;]*\bincident_id uuid/);
});

test('fresh self requires current unpaused worker; owner transcription is not self impersonation or approval',()=>{
  const branch=rpc.slice(rpc.indexOf("if access_name='owner' then",rpc.indexOf('if receipt is null and p_command is not null then')),rpc.indexOf('insert into public.merchant_attendance_outage_operations'));
  order(branch,"if access_name='owner' then",'where merchant_id=site and id=(p_command->>\'workerId\')::uuid for update','else',
    "then raise exception 'attendance_access_denied'","if not w.active then raise exception 'attendance_account_suspended'",
    "if coalesce(epoch.paused,false) then raise exception 'attendance_account_suspended'");
  assert.doesNotMatch(branch.slice(0,branch.indexOf('else')),/not w\.active|e\.status|epoch\.paused/);
  has(branch,"w.version<>(p_command->>'expectedWorkerVersion')::bigint","e.version<>(p_command->>'expectedEmployeeVersion')::bigint",
    "generation_no<>(p_command->>'expectedGeneration')::bigint");
  has(rpc,'actor_employee:=e.id','p_auth_user_id,actor_employee','access_name,p_auth_user_id,actor_employee,stamp');
  assert.doesNotMatch(rpc,/p_auth_user_id\s*=\s*e\.auth_user_id/);
});

test('self header and list never expose another employee count or incident body by guessed ID',()=>{
  has(rpc,"if mode_name='incidents' then raise exception 'attendance_access_denied'",
    "access_name='self' and not exists(select 1 from public.merchant_attendance_outage_declarations x",
    'x.worker_id=w.id and x.employee_id=e.id and x.employee_auth_user_id=e.auth_user_id',
    'row(d.worker_id,d.employee_id,d.employee_auth_user_id) is distinct from row(w.id,e.id,e.auth_user_id)');
  assert.doesNotMatch(rpc,/count\(\*\)|totalCount|otherCount/);
  const selfProbe=rpc.slice(rpc.indexOf("where access_name='self' and x.merchant_id=site"));
  order(selfProbe,'x.worker_id=w.id and x.employee_id=e.id and x.employee_auth_user_id=e.auth_user_id','order by x.declaration_id limit 26');
});

test('pages and body are bounded, cursor uses the last returned item and recovery bypasses pages',()=>{
  has(rpc,'order by x.incident_id limit 26','order by bounded.declaration_id limit 26',"n=26 then next_id:=(items->24->>'id')::uuid;exit",
    ">262144 then raise exception 'attendance_outage_too_large'","elsif mode_name='recover' then raise exception 'attendance_outage_not_found'",
    "elsif receipt is null then",'can_write boolean:=false');
  order(rpc,'select * into saved from public.merchant_attendance_outage_operations','elsif receipt is null then','for i in select');
  const receipt=fn('receipt');
  assert.deepEqual([...receipt.matchAll(/'([A-Za-z]+)',p\./g)].map(x=>x[1]),['operationId','action','recordId','incidentId','actorId','commandFingerprint']);
  assert.doesNotMatch(receipt,/'command'|'statement'|'reason'|'employeeAuthUserId'|'interval'/);
});

test('all three tables are immutable and deferred mandatory pairing runs privately as definer',()=>{
  has(sql,'before update or delete on %s','before truncate on %s','after insert on %s deferrable initially deferred',
    "tg_table_name='merchant_attendance_outage_incidents' and entry_row.action<>'create_incident'",
    "tg_table_name='merchant_attendance_outage_declarations' and entry_row.action<>'declare'",
    'foreign key(merchant_id,operation_id,incident_id,actor_auth_user_id)','foreign key(merchant_id,operation_id,declaration_id,actor_auth_user_id)');
  has(pairing,'returns trigger language plpgsql security definer set search_path=pg_catalog',
    'entry_row.operation_id is null','i.declared_interval is distinct from c->\'interval\'',
    'd.generation is distinct from (c->>\'expectedGeneration\')::bigint','d.recorded_by,d.recorded_at');
  assert.doesNotMatch(rpc,/set constraints|disable trigger/i);
  has(sql,"actor_auth_user_id=employee_auth_user_id)) is true)","original_channel in('web','location','onsite','pin','other'))) is true)");
});

test('service-only RPC, private helpers and table RLS remain checked after reapply',()=>{
  has(sql,'p_allow_write boolean default false','revoke all on function public.faolla_attendance_outage_ledger_guard_v1() from public,anon,authenticated,service_role',
    'grant execute on function public.faolla_attendance_outage_v1(jsonb,uuid,jsonb,boolean) to service_role',
    "p.proname in('faolla_attendance_outage_v1','faolla_attendance_outage_ledger_guard_v1')",
    "p.proconfig is distinct from array['search_path=pg_catalog']::text[]",'a.grantee=0','relrowsecurity','select 1 from pg_policy where polrelid=t',
    "tgtype=5 and tgenabled='O' and tgdeferrable and tginitdeferred",'and tgtype=27','and tgtype=34');
  assert.equal([...sql.matchAll(/grant execute on function/g)].length,1);
  has(sql,"am.amname='btree' and x.indisvalid and x.indisready",'x.indnkeyatts=cardinality(idx.columns)','pg_get_indexdef(x.indexrelid,k,true)',
    "installed<>(to_regclass('public.'||n) is not null)",'merchant_attendance_outage_foundation_installation_conflict');
});
