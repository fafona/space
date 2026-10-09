//Static SQL contracts only. This file starts no database, browser or service.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const directory=new URL('./supabase-migrations/',import.meta.url);
const read=name=>readFileSync(new URL(name,directory),'utf8').replaceAll('\r\n','\n');
const sql=read('202610080187_merchant_attendance_period_delegated_closure.sql');
const original=read('202610080183_merchant_attendance_period_continuation.sql');
const body=(source,name)=>{const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+4);};
const main=body(sql,'faolla_attendance_period_delegated_closure_v1');
const hash=body(sql,'faolla_attendance_period_delegated_hash_v1');
const old=body(original,'faolla_attendance_period_closure_v2');
const has=(source,parts)=>parts.forEach(part=>assert(source.includes(part),part));
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert(a>=0&&b>a,start);return text.slice(a,b);};

test('187 adds only its two new functions, no old writer replacement or quota/data migration',()=>{
  assert.deepEqual([...sql.matchAll(/^create or replace function public\.([a-z0-9_]+)\(/gm)].map(x=>x[1]),
    ['faolla_attendance_period_delegated_hash_v1','faolla_attendance_period_delegated_closure_v1']);
  assert.doesNotMatch(sql,/create table|alter table|update public\.merchant_attendance_period_storage|delete from|truncate |execute replace\(|pg_get_functiondef/i);
  has(sql,["set local lock_timeout='3s'",'202610080183','202610080184','202610080185','202610080186',
    "<>(case when installed then 1 else 0 end)","function_row.proconfig is distinct from array['search_path=pg_catalog']",'merchant_attendance_period_delegated_closure_installation_conflict']);
  assert(sql.endsWith("notify pgrst, 'reload schema';\ncommit;\n"));
});

test('exact query restricts delegate access, six read modes and four writes, with31 civil days and explicit NULL checks',()=>{
  has(main,["p_auth_user_id is null or p_allow_write is null", "array['siteId','access','grantId','workerId','fromDate','throughDate','mode','periodId','operationId','version','cursor']",
    "access_name is distinct from 'delegate'", "mode_name not in('list','preview','detail','recover','history','versions')",
    'last_day-first_day not between 0 and 30',"to_char((p_query->>k)::date,'YYYY-MM-DD') is distinct from p_query->>k",
    "public.faolla_attendance_period_closure_command_v2(p_command) is distinct from true or mode_name<>'detail' or requested_version is not null",
    "action_name not in('send','respond','seal','reopen')", "p_artifact is not null and action_name is distinct from 'send'"]);
  assert.doesNotMatch(main,/'owner'|'self'|'export'|action_name='confirm'|action_name='dispute'/);
});

test('fingerprint is the frozen19-scalar JSONB tuple and binds the complete canonical write scope',()=>{
  has(hash,["p_query->'operationId' is distinct from 'null'::jsonb", "p_query->'version' is distinct from 'null'::jsonb", "p_query->'cursor' is distinct from 'null'::jsonb",
    "jsonb_build_array('attendance-period-delegated-closure-v1',p_query->>'siteId',p_query->>'access',p_query->>'grantId',p_query->>'workerId',",
    "p_query->>'fromDate',p_query->>'throughDate',p_query->>'mode',p_query->>'periodId',p_query->'operationId',p_query->'version',p_query->'cursor',",
    "p_command->>'action',p_command->>'operationId',p_command->>'periodId',(p_command->>'expectedRevision')::integer,(p_command->>'expectedVersion')::integer,",
    "p_command->'expectedFingerprint',p_command->>'reason'", "encode(sha256(convert_to(tuple_value::text,'UTF8')),'hex')"]);
  assert.doesNotMatch(hash,/jsonb_build_object|replace\(|p_artifact/);
});

test('feature-off permits only explicit recover; original POST never bypasses the disabled gate',()=>{
  has(main,["p_allow_write is distinct from true and mode_name<>'recover' then raise exception 'attendance_period_delegation_disabled'"]);
  assert(main.indexOf('attendance_period_delegation_disabled')<main.indexOf('select * into delegated'));
  assert(main.indexOf('from public.merchants x where x.id=site for share')<main.indexOf('from public.merchant_attendance_settings x where x.merchant_id=site for update'));
});

test('minimal recovery precedes current source/authority and requires exact present member/Auth plus immutable query/command proof',()=>{
  const recovery=between(main,'  --Only exact original actor/member receipts','  --185 owns the common');
  has(recovery,['x.auth_user_id=p_auth_user_id for share','delegated.actor_employee_id<>actor_employee or delegated.actor_auth_user_id<>p_auth_user_id',
    'delegated.grant_id<>gid or delegated.worker_id<>wid or delegated.period_id<>pid',"array['siteId','access','grantId','workerId','fromDate','throughDate','periodId']",
    'delegated.query->k is distinct from p_query->k','delegated.query is distinct from p_query or delegated.command is distinct from p_command',
    'public.faolla_attendance_period_delegated_hash_v1(delegated.query,delegated.command)',
    'public.faolla_attendance_period_delegation_proof_v1(delegated)',"'usableActions','[]'::jsonb,'kind','receipt','receipt',receipt_value"]);
  assert.doesNotMatch(recovery,/delegated_source_v1|artifact_checked|grant_authority:=|\.status|\.permissions|\.enabled|attendance_operation_not_found/);
});

test('global operation collisions cover all three authority ledgers and the real period entry ledger',()=>{
  const collision=between(main,'  --Only exact original actor/member receipts','  --185 owns the common');
  has(collision,['merchant_attendance_period_delegation_operations','merchant_attendance_period_entries x where x.merchant_id=site and x.operation_id=op',
    'merchant_attendance_period_delegations x where x.merchant_id=site and x.grant_id=op',
    'merchant_attendance_period_delegation_revocations x where x.merchant_id=site and x.operation_id=op',"raise exception 'attendance_operation_conflict'"]);
});

test('all fresh reads/actions including reopen use185 guard before worker data or184 real-actor source',()=>{
  const gate="grant_authority:=public.faolla_attendance_period_delegation_guard_v1(site,gid,p_auth_user_id,coalesce(action_name,'view'),wid,first_day,last_day,pid,p_allow_write)";
  has(main,[gate,"actor_employee:=(grant_authority->>'actorEmployeeId')::uuid"]);
  assert(main.indexOf(gate)<main.indexOf('select * into w from public.merchant_attendance_workers'));
  const source='public.faolla_attendance_period_delegated_source_v1(site,wid,e.id,e.auth_user_id,p_auth_user_id,first_day,last_day,pid)';
  assert.equal(main.split(source).length-1,4);
  assert.doesNotMatch(main,/faolla_attendance_period_closure_source_v1|\buser_id=p_auth_user_id|source_query|action_name<>'reopen'.*s\.enabled/);
});

test('list cursor includesgrant, enforces complete grant containment and opened-at opt-in at both cursor anchors and rows',()=>{
  const list=between(main,"  if mode_name='list' then\n    if cursor_value", "  if mode_name in('history','versions') then");
  assert.equal(list.split('x.from_date>=grant_row.from_date and x.through_date<=grant_row.through_date').length-1,3);
  assert.equal(list.split('(grant_row.include_existing or x.opened_at>=grant_row.recorded_at)').length-1,3);
  has(main,["array['kind','siteId','access','grantId','workerId','fromDate','throughDate','periodId','atOpenedAt','atPeriodId','beforeOpenedAt','beforePeriodId']",
    "'kind',mode_name,'siteId',site,'access',access_name,'grantId',gid",'order by x.opened_at desc,x.period_id desc limit 26']);
  has(list,['jsonb_array_length(items)=25','listed.employee_id<>e.id or listed.employee_auth_user_id<>e.auth_user_id']);
});

test('history50 and versions20 preserve183 seek, contiguity, point checks and exact terminal-page proof verbatim',()=>{
  const start="  if mode_name in('history','versions') then",end="  if mode_name='preview' then";
  assert.equal(between(main,start,end),between(old,start,end));
  has(main,['order by x.revision desc limit 51','order by x.version desc limit 21','least(50,page_top)','least(20,page_top)']);
});

test('eight-field draft cannot supply authority; SQL injects locked send proof and validates prospective bytes before reuse',()=>{
  const send=between(main,"    if action_name='send' then",'      if is_new then\n        --All stored periods');
  has(send,["array['protocol','sourceFingerprint','source','worker','period','report','dayBoundaries','calculationVersion']",
    "p_artifact->>'protocol' is distinct from 'attendance-period-artifact-v2'", "p_artifact->'report'->>'access' is distinct from 'delegate'",
    "prospective:=p_artifact||jsonb_build_object('authority',grant_authority)", 'artifact_text:=prospective::text','artifact_size>2097152',
    'a.artifact_bytes:=artifact_size;a.recorded_at:=now_at','perform public.faolla_attendance_period_artifact_shape_v2(a)']);
  assert(send.indexOf('a.recorded_at:=now_at')<send.indexOf('artifact_shape_v2(a)'));
  assert.doesNotMatch(send,/artifact_checked_v1\(a\)/);
});

test('send keeps realsource expectedFingerprint/canonical/dayboundaries and independent pending-outage gates',()=>{
  has(main,["source_result->'blockers' ? 'period_in_progress' or source_result->'blockers' ? 'unresolved_outage'",
    "source_result->>'sourceFingerprint' is distinct from p_command->>'expectedFingerprint'",
    "p_artifact->'source' is distinct from source_result->'sourceCanonical'", "p_artifact->'dayBoundaries' is distinct from source_result->'dayBoundaries'",
    "new_version:=c.state='open' or a.source_fingerprint<>source_result->>'sourceFingerprint'",
    "artifact_json->'source' is distinct from source_result->'sourceCanonical'",'insert into public.merchant_attendance_period_artifacts select (a).*']);
  assert.doesNotMatch(main,/update public\.merchant_attendance_period_artifacts|update public\.merchant_attendance_period_versions|used_bytes|67108864/);
});

test('new-period nonoverlap and integer rollover reserve exactly match183 semantics',()=>{
  const a='        --All stored periods were proven non-overlapping',b='        insert into public.merchant_attendance_period_closures';
  assert.equal(between(main,a,b),between(old,a,b));
  has(main,["coalesce(c.revision,0)>=2147483647 or coalesce(c.revision,0)>=2147483646 and action_name<>'reopen'",
    '(p_command->>\'expectedRevision\')::integer<>coalesce(c.revision,0)',"if new_version and c.current_version>=2147483647"]);
});

test('seal requires same saved/current source, no blockers and actual same-version employee confirmation',()=>{
  const seal=between(main,"      if action_name='seal' then","      elsif action_name='reopen' then");
  has(seal,["if c.sealed then raise exception 'attendance_period_sealed'", "if c.state='open' then raise exception 'attendance_period_not_confirmed'",
    "p_command->>'expectedFingerprint' is distinct from a.source_fingerprint", "source_result->'sourceCanonical' is distinct from artifact_json->'source'",
    "source_result->>'validation' is distinct from 'delegate_checked' or source_result->'blockers' is distinct from '[]'::jsonb",
    'c.confirmed_version is distinct from c.current_version or c.unresolved_dispute',"c.sealed:=true;c.state:='sealed'"]);
  assert.doesNotMatch(main,/c\.confirmed_version:=c\.current_version|c\.unresolved_dispute:=false|c\.state:='confirmed'/);
  has(main,["if not c.sealed then raise exception 'attendance_period_not_sealed'", "c.sealed:=false;c.state:='open';c.confirmed_version:=null"]);
});

test('same-transaction entry/head/authority then full artifact proof precede a receipt-only return',()=>{
  const write=between(main,'    c.revision:=(p_command', "  if c.period_id is null then raise exception 'attendance_period_not_found';end if;\n  if requested_version");
  const order=['insert into public.merchant_attendance_period_entries','update public.merchant_attendance_period_closures',
    'insert into public.merchant_attendance_period_delegation_operations','perform public.faolla_attendance_period_artifact_checked_v1(a)',
    'receipt_value:=public.faolla_attendance_period_delegation_receipt_v1','return jsonb_build_object'];
  let prior=-1;for(const text of order){const index=write.indexOf(text);assert(index>prior,text);prior=index;}
  has(write,['p_auth_user_id,actor_employee,wid,e.id,e.auth_user_id,action_name,p_query,p_command',
    "grant_authority,(grant_authority->>'authorizedAt')::timestamptz,now_at", "'usableActions','[]'::jsonb,'kind','receipt','receipt',receipt_value"]);
  assert.doesNotMatch(write,/exception when|return common/);
});

test('fixed detail preserves saved bytes; only current detail reads live source and no export branch exists',()=>{
  const detail=main.slice(main.indexOf("  if requested_version is null then requested_version:=c.current_version"));
  has(detail,['artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a)',"p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb",
    "'artifactText',a.artifact_text", "'artifactSha256',a.artifact_sha256,'artifactBytes',a.artifact_bytes"]);
  assert.doesNotMatch(detail,/artifact_text:=|source_query|mode_name='export'/);
});

test('only new RPC is service-executable, hash helper stays private, old function grants are untouched',()=>{
  assert.deepEqual([...sql.matchAll(/grant execute on function ([^;]+);/g)].map(x=>x[1]),
    ['public.faolla_attendance_period_delegated_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) to service_role']);
  has(sql,['revoke all on function public.faolla_attendance_period_delegated_hash_v1(jsonb,jsonb) from public,anon,authenticated,service_role',
    'merchant_attendance_period_delegated_closure_acl_failed']);
  assert.doesNotMatch(sql,/grant execute on function public\.faolla_attendance_period_delegated_source|grant execute on function public\.faolla_attendance_period_delegation_guard/);
});
