// Static contracts only. Import/test performs no database, service or browser work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const directory=new URL('./supabase-migrations/',import.meta.url),file='202610080188_merchant_attendance_owner_notifications.sql';
const read=name=>readFileSync(new URL(name,directory),'utf8').replaceAll('\r\n','\n'),sql=read(file);
const body=(name,source=sql)=>{const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+4);};
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return text.slice(a,b);};
const has=(text,...pieces)=>pieces.forEach(piece=>assert(text.includes(piece),piece));
const order=(text,...pieces)=>{let at=-1;for(const piece of pieces){at=text.indexOf(piece,at+1);assert(at>=0,piece);}};
const helpers=['source','verify','receipt','guard','capture','item'].map(name=>'faolla_attendance_owner_notification_'+name+'_v1');
const wrappers=['faolla_attendance_plan_exception_owner_event_v1','faolla_attendance_period_closure_owner_event_v1','faolla_attendance_period_closure_owner_event_v2'];
const main=body('faolla_attendance_owner_notifications_v1'),source=body(helpers[0]),receipt=body(helpers[2]);
const tables=['merchant_attendance_owner_notifications','merchant_attendance_owner_notification_reads','merchant_attendance_owner_notification_operations'];

test('188 is additive, transactional, guarded for first install/re-entry and leaves old writer definitions untouched',()=>{
 assert.deepEqual(validateMigrationSource(file,sql),[]);
 assert.deepEqual([...sql.matchAll(/^create or replace function public\.([a-z0-9_]+)\(/gm)].map(m=>m[1]),[...helpers,...wrappers,'faolla_attendance_owner_notifications_v1']);
 assert.deepEqual([...sql.matchAll(/^create table if not exists public\.([a-z0-9_]+)\(/gm)].map(m=>m[1]),tables);
 has(sql,"set local lock_timeout='3s'",'202610060169','202610060174','202610080183',"<>(case when installed then 1 else 0 end)",
  'merchant_attendance_owner_notifications_installation_conflict',"values(202610080188,'merchant_attendance_owner_notifications') on conflict(version) do nothing");
 assert(sql.endsWith("notify pgrst, 'reload schema';\ncommit;\n"));
 assert.doesNotMatch(sql,/execute replace\(|pg_get_functiondef|rename to|update public\.|delete from|insert into public\.merchant_attendance_(?:period_entries|plan_exception_entries|event_notifications|period_artifacts)/i);
});
test('three exact wrapper signatures add only default-off owner capture and pass old arguments/results through unchanged',()=>{
 const specs=[['faolla_attendance_plan_exception_owner_event_v1','faolla_attendance_plan_exception_posthoc_review_v1','p_query,p_auth_user_id,p_command,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications'],
  ...[1,2].map(v=>['faolla_attendance_period_closure_owner_event_v'+v,'faolla_attendance_period_closure_v'+v,'p_query,p_auth_user_id,p_command,p_artifact,p_allow_write'])];
 for(const [name,old,args]of specs){const fn=body(name),call=`public.${old}(${args})`;
  has(fn,'p_capture_owner_notifications boolean default false',"if p_capture_owner_notifications is null then raise exception 'attendance_invalid_request'",'return '+call+';', 'result:='+call+';','return result;');
  assert.equal(fn.split(call).length-1,2);order(fn,'if not p_capture_owner_notifications','return '+call,'select m.user_id into recipient','result:='+call,'notification_capture_v1','return result;');
  assert.doesNotMatch(fn,/jsonb_build_object|result\s*:=\s*result|exception when|on conflict|\.active|\.status|recipient\s*(?:<>|!=)\s*p_auth_user_id/i);
 }
});
test('old174 self-note short circuit and both183 self-dispute writers remain reachable and are wrapped completely',()=>{
 const old174=read('202610060174_merchant_attendance_plan_posthoc_reviews.sql'),old183=read('202610080183_merchant_attendance_period_continuation.sql');
 has(old174,"if access_name<>'owner' or mode_name not in('detail','decide')",'return public.faolla_attendance_plan_exception_clearance_execute_v1');
 has(body(wrappers[0]),"p_query->>'access' is distinct from 'self'", "p_query->>'mode' is distinct from 'note'");
 for(const v of [1,2]){
  has(body('faolla_attendance_period_closure_v'+v,old183),"(access_name='self')<>(action_name in('confirm','dispute'))", "elsif action_name='dispute' then");
  has(body('faolla_attendance_period_closure_owner_event_v'+v),"p_query->>'access' is distinct from 'self'", "p_command->>'action' is distinct from 'dispute'");
 }
});
test('capture lock order pins then-owner before settings serialization, and fresh detection precedes real writer',()=>{
 for(const name of wrappers){const fn=body(name);
  order(fn,'select m.user_id into recipient from public.merchants m where m.id=site for share',
   'perform 1 from public.merchant_attendance_settings s where s.merchant_id=site for update','select exists(', 'into existed','result:=public.',
   'if op is not null and not existed then perform public.faolla_attendance_owner_notification_capture_v1');
  assert.doesNotMatch(fn,/for update[\s\S]*from public\.merchants|pg_advisory|for share[\s\S]*for share/);
 }
 has(body(wrappers[0]),'merchant_attendance_plan_exception_entries','merchant_attendance_plan_exception_reads');
 for(const name of wrappers.slice(1))has(body(name),'merchant_attendance_period_entries');
});
test('notification schema stores only fixed identity/navigation, never source note/reason/evidence/command bodies',()=>{
 const schema=between(sql,'create table if not exists public.merchant_attendance_owner_notifications(', 'create index if not exists');
 has(schema,'source_revision bigint not null','employee_auth_user_id uuid not null','recipient_auth_user_id uuid not null','occurred_at timestamptz not null','target jsonb not null',
  'unique(merchant_id,source_category,operation_id)','unique(merchant_id,notification_id,recipient_auth_user_id)');
 assert.doesNotMatch(schema,/\b(?:command|summary|reason|note|evidence|location|artifact_text)\s+(?:text|jsonb)/);
 const capture=body(helpers[4]);has(capture,'saved_actor is distinct from p_actor','saved_command is distinct from p_command',"source_value->>'employeeAuthUserId' is distinct from p_actor::text");
 assert.doesNotMatch(capture,/on conflict|p_actor\s*(?:<>|!=)\s*p_recipient|insert into[\s\S]*\bcommand\s*[,)]/i);
});
test('source proofs use exact immutable entries and fixed frames, not current employee status, current owner or recalculation',()=>{
 has(source,"note_entry.kind is distinct from 'note'",'note_entry.actor_auth_user_id is distinct from note_entry.employee_auth_user_id',
  'faolla_attendance_plan_exception_review_entry_v1(note_entry)',"period_entry.action is distinct from 'dispute'",'faolla_attendance_period_entry_v2(period_entry)',
  'period_entry.actor_auth_user_id is distinct from period_row.employee_auth_user_id','v.version=period_entry.version',
  "'target',jsonb_build_object('slotId',case_row.slot_id)","'target',jsonb_build_object('periodId',period_entry.period_id,'fromDate'",'9007199254740990');
 assert.doesNotMatch(source,/\.active|\.status|\.permissions|from public\.merchants|artifact_checked|source_canonical|source_fingerprint|->.?\s*'(?:note|reason|evidence)'/);
 const verify=body(helpers[1]);assert.doesNotMatch(verify,/from public\.merchants|user_id=/);
 const guard=body(helpers[3]);has(guard,'select m.user_id into owner_at_insert','new.recipient_auth_user_id is distinct from owner_at_insert');
});
test('exact notification query and mark command reject missing/null discriminants, mixed modes and partial cursors',()=>{
 has(main,"array['siteId','mode','notificationId','operationId','beforeAt','beforeId']","p_auth_user_id is null or p_allow_write is null",
  "jsonb_typeof(p_query->'mode') is distinct from 'string'","p_query->>'mode' not in('list','detail','recover')",'>4096',
  '(cursor_id is null)<>(cursor_at is null)',"mode_name='list' and (nid is not null or op is not null)",
  "mode_name='detail' and (nid is null or op is not null or cursor_id is not null)","mode_name='recover' and (nid is null or op is null or cursor_id is not null)",
  "array['action','operationId','notificationId']","p_command->>'action' is distinct from 'mark_read'","p_command->'notificationId' is distinct from p_query->'notificationId'");
});
test('GET recover returns only exact original actor receipt before any ownership/settings/source dependency',()=>{
 const recovery=between(main,"  if mode_name='recover' then",'  select m.user_id into current_owner');
 has(recovery,'saved.actor_auth_user_id is distinct from p_auth_user_id or saved.notification_id is distinct from nid',
  "saved.operation_id is null then return common||jsonb_build_object('kind','receipt','receipt',null)",'faolla_attendance_owner_notification_receipt_v1(saved)');
 assert.doesNotMatch(recovery,/merchant_attendance_settings|merchant_enterprise|merchant_attendance_owner_notifications\s|source_v1|item_v1|p_allow_write|insert into|for update/);
 has(receipt,"jsonb_build_object('operationId',p.operation_id,'notificationId',p.notification_id,'actorId',p.actor_auth_user_id,", "'readAt',to_char");
 assert.doesNotMatch(receipt,/sourceCategory|sourceId|workerId|employeeId|target|from public\.merchants|owner_notification_(?:source|verify|item)_v1/);
});
test('all POSTs, including exact replay, require current owner plus fixed recipient and enabled mark permission',()=>{
 order(main,'current_owner is distinct from p_auth_user_id','n.recipient_auth_user_id=p_auth_user_id',
  "if not p_allow_write or not settings_row.enabled then raise exception 'attendance_platform_paused'",'saved.command is distinct from p_command',
  "return common||jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_owner_notification_receipt_v1(saved))");
 has(main,"raise exception 'attendance_operation_conflict'",'saved.actor_auth_user_id is distinct from p_auth_user_id or saved.notification_id is distinct from nid');
});
test('mark idempotency is its own immutable operation ledger and never acknowledges/confirms the original source',()=>{
 has(sql,'primary key(merchant_id,operation_id)','foreign key(merchant_id,notification_id,actor_auth_user_id,read_at)',
  'references public.merchant_attendance_owner_notification_reads(merchant_id,notification_id,recipient_auth_user_id,read_at)');
 has(main,'if seen.notification_id is null then','greatest(clock_timestamp(),notice.occurred_at)',
  'values(site,op,nid,p_auth_user_id,p_command,seen.read_at,greatest(clock_timestamp(),seen.read_at))');
 assert.doesNotMatch(main,/on conflict|update public\.|plan_exception_reads\(|period_entries\(|(?:action|mode_name)\s*:?=\s*'(?:ack|confirm|respond)'/i);
 assert.equal([...main.matchAll(/insert into public\./g)].length,2);
});
test('owner pagination is25+1 bounded with exact recipient cursor anchor and last emitted cursor',()=>{
 has(main,'n.notification_id=cursor_id and n.recipient_auth_user_id=p_auth_user_id and n.occurred_at=cursor_at',
  'order by n.occurred_at desc,n.notification_id desc limit 26','count_seen:=count_seen+1;exit when count_seen=26',
  "next_cursor:=jsonb_build_object('at',to_char(candidate.occurred_at at time zone 'UTC',fmt),'id',candidate.notification_id)",
  "'nextCursor',case when count_seen=26 then next_cursor else null end",'>131072');
 order(main,'exit when count_seen=26','items:=items||jsonb_build_array(item)','next_cursor:=jsonb_build_object');
 has(sql,'(merchant_id,recipient_auth_user_id,occurred_at desc,notification_id desc)',"i.indkey::text='1 10 11 2'", "i.indoption::text='0 0 3 3'");
});
test('item DTO has exactly the contract metadata keys and no authority/write implications',()=>{
 const fn=body(helpers[5]),returned=fn.slice(fn.indexOf('return jsonb_build_object'));
 const keys=[...returned.matchAll(/(?:\(|,)\s*'([A-Za-z][A-Za-z0-9]*)'\s*,/g)].map(m=>m[1]);
 assert.deepEqual(keys,['notificationId','sourceCategory','sourceOperationId','sourceId','sourceRevision','workerId','employeeId','employeeAuthUserId','occurredAt','readAt','target']);
 assert.doesNotMatch(returned,/command|reason|evidence|note|canWrite|canDecide|canConfirm/);
});
test('three ledgers enforce RLS, append-only/no-truncate and actual-source insert guards with no direct service grants',()=>{
 has(sql,'alter table %s enable row level security','revoke all on %s from public,anon,authenticated,service_role',
  'attendance_owner_notification_immutable before update or delete','attendance_owner_notification_no_truncate before truncate',
  'attendance_owner_notification_insert_guard before insert',"g.tgtype=27","g.tgtype=34","g.tgtype=7",'g.tgqual is null and g.tgnargs=0',
  'not c.relrowsecurity or c.relforcerowsecurity','exists(select 1 from pg_policy',"a.grantee<>c.relowner");
 assert.doesNotMatch(sql,/grant (?:select|insert|update|delete|all) on (?:table )?public\.merchant_attendance_owner/i);
});
test('only four publicRPCs are definer/service callable; six helpers remain private on first install and replay',()=>{
 for(const name of helpers){assert(!body(name).includes('security definer'));has(sql,`'public.${name}(`);}
 for(const name of [...wrappers,'faolla_attendance_owner_notifications_v1'])assert(body(name).includes('security definer set search_path=pg_catalog'));
 has(sql,"revoke all on function %s from public,anon,authenticated,service_role",'if is_public then',"grant execute on function %s to service_role",'function_row.prosecdef<>is_public',
  "function_row.proconfig is distinct from array['search_path=pg_catalog']","has_function_privilege('service_role',f,'EXECUTE')<>is_public",'p.proname=function_name)<>1');
});
test('table/index/trigger/key metadata are checked, including exact mark-to-read actor and timestamp foreign key',()=>{
 has(sql,'actual_columns is distinct from item.columns_expected','constraint_shape is distinct from item.expected',
  'not c.convalidated or c.condeferrable or c.condeferred',"c.confupdtype<>'a' or c.confdeltype<>'a' or c.confmatchtype<>'s'",
  "a.amname='btree' and i.indisvalid and i.indisready",'i.indpred is null and i.indexprs is null');
 const shapes=[...sql.matchAll(/\('merchant_attendance_owner_[^']+','(\[\{[^']+\])'::jsonb\)/g)].map(m=>JSON.parse(m[1]));
 assert.equal(shapes.length,3);assert.deepEqual(shapes[2][0],{type:'f',keys:['merchant_id','notification_id','actor_auth_user_id','read_at'],
  ref:'merchant_attendance_owner_notification_reads',refkeys:['merchant_id','notification_id','recipient_auth_user_id','read_at']});
 assert(shapes[0].some(x=>x.type==='u'&&JSON.stringify(x.keys)==='["merchant_id","source_category","operation_id"]'));
});
