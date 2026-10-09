//C23 static contracts only. These do not execute SQL or claim native coverage.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
import {verifyAttendanceRetentionNative,retentionNativeTables} from './fixtures/attendance-retention-native.mjs';

const file='202610070182_merchant_attendance_retention.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return sql.slice(start,end+4);};
const has=(s,...values)=>values.forEach(value=>assert(s.includes(value),value));
const order=(s,...values)=>{let last=-1;for(const value of values){const index=s.indexOf(value,last+1);assert(index>last,value);last=index;}};
const command=fn('faolla_attendance_retention_command_v1'),hash=fn('faolla_attendance_retention_hash_v1');
const source=fn('faolla_attendance_retention_source_v1'),receipt=fn('faolla_attendance_retention_receipt_v1');
const policy=fn('faolla_attendance_retention_policy_v1'),record=fn('faolla_attendance_retention_record_v1');
const guard=fn('faolla_attendance_retention_guard_v1'),rpc=fn('faolla_attendance_retention_v1');

test('182 is additive: exactly two new ledgers and eight new private/public functions',()=>{
  assert.deepEqual(validateMigrationSource(file,sql),[]);
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map(x=>x[1]),
    ['merchant_attendance_retention_policy_operations','merchant_attendance_preservation_operations']);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(x=>x[1]),
    ['command','hash','source','receipt','policy','record','guard'].map(x=>'faolla_attendance_retention_'+x+'_v1').concat('faolla_attendance_retention_v1'));
  assert.deepEqual([...sql.matchAll(/\b(?:insert into|update|delete from)\s+public\.([a-z0-9_]+)/g)].map(x=>x[1]),
    ['merchant_attendance_retention_policy_operations','merchant_attendance_preservation_operations','faolla_schema_migrations']);
  assert.doesNotMatch(sql,/disable trigger|create policy|pg_get_functiondef|cron\.|pg_cron|delete from|drop table|alter table public\.(?!merchant_attendance_(?:retention_policy_operations|preservation_operations))/i);
  has(sql,"set local lock_timeout='3s'","(202609290061::bigint,'merchant_attendance_foundation')","(202609300072::bigint,'merchant_attendance_location_clock')",
    "(202610040135::bigint,'merchant_attendance_shift_rule_binding_reader')","(202610050149::bigint,'merchant_attendance_period_closure')",
    "if to_regprocedure(n) is null","if to_regclass('public.'||n) is null",
    "values(202610070182,'merchant_attendance_retention') on conflict(version) do nothing","notify pgrst, 'reload schema';\ncommit;");
  assert.doesNotMatch(sql,/outage_relations|202610070181/);
});

test('command variants are exact, bounded and keep null policy distinct from a day count',()=>{
  has(command,"array['siteId','action','operationId','category','expectedRevision','retentionDays','reason']",
    "array['siteId','action','operationId','category','recordId','expectedRevision','expectedSourceFingerprint','reason']",
    "p->>'category' not in('events','location_results','period_artifact')","(p->>'expectedRevision')::numeric>=9007199254740990",
    "p->>'action'='release' and (p->>'expectedRevision')::numeric=0","faolla_attendance_group_text_v1(p->>'reason',1,500)",
    "p->'retentionDays'='null'::jsonb","(p->>'retentionDays')::numeric<=36500","octet_length(convert_to(p::text,'UTF8'))>8192");
  assert.doesNotMatch(command,/3650\b|retentionDays.*default|expectedRevision.*100\b/);
});

test('operation hash has the exact ten scalar values and no JSONB whitespace dependence',()=>{
  has(hash,"jsonb_build_array('attendance-retention-command-v1',p->'siteId',p->'action',p->'category'",
    "coalesce(p->'recordId','null'::jsonb),p->'operationId',p->'expectedRevision',coalesce(p->'retentionDays','null'::jsonb)",
    "coalesce(p->'expectedSourceFingerprint','null'::jsonb),p->'reason'","string_agg(value::text,',' order by ordinal)");
  assert.doesNotMatch(hash,/clock_timestamp|actor|readAt|sourceText/);
});

test('ledger constraints bind full intent and source bytes with explicit true to close NULL bypasses',()=>{
  has(sql,'revision bigint not null check(revision between 1 and 9007199254740990)',
    'unique(merchant_id,category,revision)','unique(merchant_id,category,record_id,revision)',
    "command->>'siteId'=merchant_id","command->>'recordId'=record_id::text","command->>'operationId'=operation_id::text",
    'command_fingerprint=public.faolla_attendance_retention_hash_v1(command)) is true',
    "source_fingerprint=encode(sha256(convert_to(source_snapshot::text,'UTF8')),'hex')) is true",
    'octet_length(convert_to(source_snapshot::text,\'UTF8\'))<=8192');
});

test('record sources disclose immutable historical identity, never current employee/Auth mapping',()=>{
  has(source,'where merchant_id=p_site and id=p_record',"'actorEmployeeId',ev.actor_employee_id","'rawSource',ev.source",
    'from public.merchant_attendance_location_results where event_id=ev.id',"'event',event_item",
    "'recordedAt',to_char(ar.recorded_at at time zone 'UTC',fmt)");
  assert.doesNotMatch(source,/merchant_attendance_workers|merchant_enterprise_employees|account_epochs|active|employee_auth_user_id.*p_auth|faolla_attendance_period_(?:source|closure_source)_v1\(/);
  assert.doesNotMatch(source,/latitude|longitude|pin_hash|credential_hash|artifact_text',|employeeAuthUserId',/);
});

test('UTC6 and floating location JSON canonicalization are deterministic with narrowly checked configuration',()=>{
  has(source,'set search_path=pg_catalog set extra_float_digits=3',"YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"","'accuracyMeters',loc.accuracy_meters");
  assert.doesNotMatch(source,/to_jsonb\((?:ev|loc|ar)\)|clock_timestamp|current_timestamp|pg_timezone_names/);
  assert.equal((sql.match(/then array\['search_path=pg_catalog','extra_float_digits=3'\] else array\['search_path=pg_catalog'\]/g)||[]).length,2);
});

test('artifact adapter checks stored bytes, canonical SHA, saved dual identity and immutable references only',()=>{
  has(source,'faolla_attendance_period_artifact_checked_v1(ar)',"sqlerrm='attendance_period_closure_invalid'",
    "body->'worker'->>'employeeAuthUserId' is distinct from cl.employee_auth_user_id::text",
    "src->>'employeeAuthUserId' is distinct from cl.employee_auth_user_id::text","src->>'siteId' is distinct from p_site",
    "ar.source_fingerprint is distinct from encode(sha256(convert_to(src::text,'UTF8')),'hex')",
    "'attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3','attendance-period-source-v4'",
    "body->'dayBoundaries' is distinct from src->'dayBoundaries'",'version_row.entry_version is distinct from version_row.version',
    "version_row.action is distinct from 'send'",'version_row.entry_recorded_at is distinct from version_row.recorded_at',
    "version_row.command->>'expectedFingerprint' is distinct from ar.source_fingerprint",'if n=0 or not exists',
    "e.operation_id=ar.artifact_id and e.action='send' and e.recorded_at=ar.recorded_at");
  assert.doesNotMatch(source,/cl\.current_version|cl\.sealed|current_setting|p_allow_write|p_auth_user_id/);
});

test('default policies are null revision0 and due arithmetic is elapsed seconds, separate from hold',()=>{
  has(policy,"'revision',coalesce(p.revision,0),'retentionDays',p.retention_days,'operationId',p.operation_id");
  has(record,"when 'events' then src->>'receivedAt' when 'location_results' then src->'event'->>'receivedAt' else src->>'recordedAt'",
    "anchor+(policy->>'retentionDays')::integer*interval '86400 seconds'",'when due_at<=p_as_of then',
    "when due_at is null then 'unconfigured'","'held',coalesce(pres.action='hold',false)",
    "canonical:=jsonb_build_object('siteId',p_site,'category',p_category,'recordId',p_record,'source',src)");
  assert.doesNotMatch(record,/interval '1 day'|interval '24 hours'|current_date|delete|due_at.*pres\.action|settings\.enabled/);
});

test('receipt projector verifies original intent without recollecting current source or current owner',()=>{
  has(receipt,'p_revision<>(p_command->>\'expectedRevision\')::bigint+1',
    'p_fingerprint is distinct from public.faolla_attendance_retention_hash_v1(p_command)',
    "'operationId',p_command->'operationId','actorId',p_actor,'revision',p_revision,'command',p_command",
    "'commandFingerprint',p_fingerprint,'recordedAt'");
  assert.doesNotMatch(receipt,/\bselect\b|source_v1|policy_v1|clock_timestamp|p_auth/);
});

test('SQL enforces purpose-specific query keys and derived POST scope, no recover POST',()=>{
  has(rpc,"when 'history' then array['category','recordId','beforeRevision']","when 'recover' then array['operationId']",
    "then array['category','workerId','periodId'] else array['category','workerId','fromAt','toAt']",
    "p_command->>'action'='set_policy' and v_mode<>'policies'",
    "v_mode<>'record' or p_command->>'category' is distinct from v_category or p_command->>'recordId' is distinct from v_record::text",
    "p_command->>'siteId'<>v_site",'to_at<=from_at or to_at-from_at>interval \'744 hours\'');
});

test('current canonical owner and settings lock precede actor-bound exact replay, then fresh gate/CAS/source',()=>{
  order(rpc,'from public.merchants where id=v_site and user_id=p_auth_user_id for share',
    'from public.merchant_attendance_settings where merchant_id=v_site for update',
    'where merchant_id=v_site and operation_id=v_operation','policy_row.actor_auth_user_id<>p_auth_user_id',
    'policy_row.command is distinct from p_command',"if receipt is not null or v_mode='recover' then",
    "if not p_allow_write then raise exception 'attendance_retention_disabled'","head_rev<>(p_command->>'expectedRevision')::bigint",
    'public.faolla_attendance_retention_source_v1(v_site,v_category,v_record)');
  has(rpc,'pres_row.actor_auth_user_id<>p_auth_user_id','pres_row.command is distinct from p_command');
  assert.doesNotMatch(rpc,/s\.enabled|worker\.active|employee\.status|account_epochs|role_row|auth_user_id=.*employee/);
});

test('new metadata does not propagate; same-state actions reject and both ledgers share the operation namespace',()=>{
  has(rpc,"head_days is not distinct from (p_command->>'retentionDays')::integer", "coalesce(head_action,'release')=p_command->>'action'",
    "raise exception 'attendance_retention_unchanged'",'policy_row.operation_id is not null and pres_row.operation_id is not null');
  has(guard,'merchant_attendance_preservation_operations where merchant_id=new.merchant_id and operation_id=new.operation_id',
    'merchant_attendance_retention_policy_operations where merchant_id=new.merchant_id and operation_id=new.operation_id',
    'previous_policy.operation_id is null','previous_pres.operation_id is null',"new.revision=1 and new.action<>'hold'",'previous_pres.action=new.action');
  assert.doesNotMatch(guard,/insert into|update public|delete from|faolla_attendance_retention_v1\(/);
});

test('exclusive revision history is indexed and probes26, with no permanent business history cap',()=>{
  assert.equal((rpc.match(/and \(before_rev is null or revision<before_rev\) order by revision desc limit 26/g)||[]).length,2);
  has(rpc,"if n>25 then next_rev:=(items->-1->>'revision')::bigint;exit;end if", "'nextBeforeRevision',next_rev");
  assert.doesNotMatch(sql,/revision between 1 and (?:100|1000)\b|revision>=100\b|beforeAt|offset [0-9]/);
});

test('preview uses saved worker keys, half-open occurred interval and 101 reject before materialization',()=>{
  has(rpc,'e.occurred_at>=from_at and e.occurred_at<to_at',
    'order by e.occurred_at desc,e.id desc limit 101','order by a.recorded_at desc,a.artifact_id desc limit 101',
    "if n>100 then raise exception 'attendance_retention_too_large'",'c.worker_id=v_worker');
  order(rpc,'order by a.recorded_at desc,a.artifact_id desc limit 101',"if n>100 then raise exception 'attendance_retention_too_large'",
    "data:='[]';for row_item",'public.faolla_attendance_retention_record_v1(v_site,v_category,row_item.id::uuid,read_at)');
  assert.doesNotMatch(rpc.replace(/--[^\n]*/g,''),/current_date|now\(\)\s*-|worker.*active|employee_id=.*v_worker/);
});

test('result never implies deletion and all read/response arrays have explicit byte/row bounds',()=>{
  has(rpc,"'disposition','preview_only'","'kind','receipt'","'kind','preview','asOf',to_char(read_at at time zone 'UTC',fmt)",
    'read_at:=coalesce(read_at,clock_timestamp())',"octet_length(convert_to(result::text,'UTF8'))>131072");
  assert.equal((rpc.match(/can_write:=p_allow_write/g)||[]).length,2);
  assert.doesNotMatch(rpc,/can_write:=true|eligible_for_deletion|deleted|deleteAt|execute format/i);
});

test('ACLs, owners, configurations and exactly three immutable/validator triggers fail closed',()=>{
  assert.equal((sql.match(/grant execute on function/g)||[]).length,1);
  assert.equal((sql.match(/revoke all on function/g)||[]).length,8);
  has(sql,'grant execute on function public.faolla_attendance_retention_v1(jsonb,uuid,jsonb,boolean) to service_role',
    'c.relkind<>\'r\' or not c.relrowsecurity','a.grantee<>c.relowner','p.proargnames is distinct from f.names',
    'p.pronargdefaults<>f.defaults','p.prorettype<>f.return_type::regtype',"p.proparallel<>'u'",'pg_policy where polrelid=t',
    "tgenabled='O'",'tgtype=27','tgtype=34','tgtype=5',"r='service_role' and f.name='faolla_attendance_retention_v1'");
  has(guard,'returns trigger language plpgsql security definer set search_path=pg_catalog');
  assert.doesNotMatch(sql,/<>\s*case\b|>\s*case\b|a\(name,args,returns,/i);
});

test('native planner uses real strict commands, one rollback transaction and only a disclosed denied sidecar prerequisite',async()=>{
  const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const owned={schema:'attendance_race_'+'1'.repeat(32),oid:101,tableOid:102,owner:'postgres',marker:'faolla-synthetic-concurrency:'+id(1)};
  const archive={artifactText:'fixed bytes',artifactSha256:'a'.repeat(64)},periodId=id(3);let plan;
  const d={syntheticOnly:true,owned,site:'99990001',owner:id(4),guard:'',inventory:()=>['merchants','merchant_attendance_events','merchant_attendance_location_results',...retentionNativeTables],
   fingerprint:()=> 'baseline',definitions:()=> 'definitions',tableCatalog:()=> 'catalog',exec:query=>{
    if(query.startsWith('reset role;'))return JSON.stringify(owned);
    if(query.startsWith("select jsonb_build_object('eventId'"))return JSON.stringify({eventId:id(5),workerId:id(6),occurredAt:'2026-10-05T10:00:00.123456Z',locationExists:false,artifactId:id(7)});
    throw Error('unexpected setup query');
   }};
  const ctx={d,h:{syntheticOnly:true,workerId:id(6),employeeId:id(8),employeeAuthUserId:id(9)},scope:{schema:owned.schema,sql:s=>s},
   native:{querySteps:async steps=>{plan=steps;throw Error('capture_only_no_database');}},periodId,
   periodArchive:()=>({...archive,period:{periodId,sealed:true}}),archive:()=>archive,oldArchive:archive};
  await assert.rejects(()=>verifyAttendanceRetentionNative(ctx),/capture_only_no_database/);
  assert(plan&&plan.length<=100);assert(plan[0].startsWith('begin;'));assert(plan.at(-1).endsWith('rollback;'));
  const combined=plan.join('\n');
  has(combined,"'denied',true,null,null,null","'policy_history_27'","'history_first25'","'history_last2'",
   "'new_owner_release_while_paused'","'new_owner_cannot_claim_old_receipt'","'old_owner_no_longer_authorized'",
   "'location_serialization_zero'","'location_serialization_three'","'retention_service_role_required'",
   'rollback to savepoint retention_identity;release savepoint retention_identity;',"'retention_probe_mismatch:% expected:% actual:%'");
  assert.doesNotMatch(combined,/disable trigger|initdb|pg_ctl|commit;|insert into public\.merchant_attendance_events/);
  assert.equal((combined.match(/insert into public\.merchant_attendance_location_results/g)||[]).length,1);
  const writes=[...combined.matchAll(/insert into public\.([a-z_]+)/g)].map(x=>x[1]);assert.deepEqual(writes,['merchant_attendance_location_results']);
});
