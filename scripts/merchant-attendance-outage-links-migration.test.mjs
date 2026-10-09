//212 static migration contract; no SQL execution, DB startup or environment use.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610070177_merchant_attendance_outage_links.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return sql.slice(start,end+4);};
const has=(s,...needles)=>needles.forEach(x=>assert(s.includes(x),x));
const order=(s,...needles)=>{let last=-1;for(const x of needles){const next=s.indexOf(x,last+1);assert(next>last,x);last=next;}};
const refs=fn('faolla_attendance_outage_link_refs_v1'),command=fn('faolla_attendance_outage_link_command_v1');
const hash=fn('faolla_attendance_outage_link_hash_v1'),source=fn('faolla_attendance_outage_link_source_v1');
const preview=fn('faolla_attendance_outage_link_preview_v1'),entry=fn('faolla_attendance_outage_link_entry_v1');
const rpc=fn('faolla_attendance_outage_links_v1');

test('177 is additive, registers one transaction and replaces no old function or writer',()=>{
  assert.deepEqual(validateMigrationSource(file,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(x=>x[1]),
    ['refs','command','hash','source','preview','entry','guard'].map(n=>'faolla_attendance_outage_link_'+n+'_v1').concat('faolla_attendance_outage_links_v1'));
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map(x=>x[1]),['merchant_attendance_outage_link_operations']);
  const writes=[...sql.matchAll(/\b(?:insert into|update|delete from)\s+public\.([a-z0-9_]+)/g)].map(x=>x[1]);
  assert.deepEqual(writes,['merchant_attendance_outage_link_operations','faolla_schema_migrations']);
  assert.doesNotMatch(sql,/disable trigger|pg_get_functiondef|set_config\(|current_setting\(|create policy|create index|period_assert_open|account_capture/i);
  has(sql,"version=202610070176 and name='merchant_attendance_outage_foundation'","values(202610070177,'merchant_attendance_outage_links') on conflict(version) do nothing",
    "notify pgrst, 'reload schema';\ncommit;");
});

test('one to ten unique references preserve selected order; final revision is reserved for explicit revoke',()=>{
  has(refs,"jsonb_array_length(p) not between 1 and 10",'faolla_attendance_plan_posthoc_reference_v1(x)',"coalesce(x->>'startEventId',x->>'rootRequestId')",'if k=any(seen) then return false');
  assert.doesNotMatch(refs,/order by|sort/);
  has(command,">16384","jsonb_typeof(p->'action') is distinct from 'string'",
    "array['action','operationId','expectedRevision','expectedFingerprint','sources','reason']",
    "array['action','operationId','expectedRevision','expectedFingerprint','reason']",
    "when p->>'action'='revoke' then 1 else 0 end","when p->>'action'='apply' then 98 else 99 end");
  has(rpc,"revision_no>=100 or p_command->>'action'='apply' and revision_no>=99");
});

test('nested scalar fingerprint tuple matches the fixed nine-element ABI without JSONB array spaces',()=>{
  has(hash,"jsonb_build_array(p_site,'owner',p_declaration,p->'action',p->'operationId',p->'expectedRevision',p->'expectedFingerprint',null,p->'reason')",
    "jsonb_build_array(x->'kind',x->'startEventId',x->'lastEventId',x->'lastSequence',x->'effectOperationId',x->'effectRevision')",
    "jsonb_build_array(x->'kind',x->'requestId',x->'rootRequestId',x->'approvalOperationId')",
    "string_agg(value::text,',' order by ordinal)","case when ordinal=8 then refs else value::text end",
    "encode(sha256(convert_to(body,'UTF8')),'hex')");
});

test('session source validates actual historical identity and keeps all original/effect/break facts in the hash',()=>{
  has(source,"set search_path=pg_catalog set timezone='UTC'",'faolla_attendance_period_session_v1(p.merchant_id,p.worker_id',
    "p.employee_id,p.employee_auth_user_id,p_at)","events:=proof->'item'->'events'","open_source:=last_event->>'action'<>'clock_out'",
    "'lastEventId',last_event->'id','lastSequence',last_event->'sequence'","'effectOperationId',effect->'operationId','effectRevision',effect->'revision'",
    "basis:=jsonb_build_object('item',proof->'item','pending',pending_items)","'evidenceFingerprint',encode(sha256(convert_to(basis::text,'UTF8')),'hex')");
  assert.doesNotMatch(source,/plan_posthoc_preview|posthoc_claim|plan_rule_v1|slot_id|asOf|readAt/);
  const beforeBasis=source.slice(source.indexOf("if p_ref->>'kind'='session' then"),source.indexOf("basis:=jsonb_build_object('item'"));
  assert.doesNotMatch(beforeBasis,/proof->'relation'|proof->'adoption'|currentCancelled/);
});

test('only whole-row source serialization gets fixed UTC config; other private and public configurations remain exact',()=>{
  assert.equal([...sql.matchAll(/set timezone='UTC'/g)].length,1);
  has(sql,"case when p.proname='faolla_attendance_outage_link_source_v1' then",'cardinality(p.proconfig) is distinct from 2',
    "p.proconfig[1] is distinct from 'search_path=pg_catalog'","lower(p.proconfig[2]) is distinct from 'timezone=utc'",
    "else p.proconfig is distinct from array['search_path=pg_catalog']::text[] end");
});

test('pending corrections are root-point checked independent of date and hash exact identity-bound immutable facts',()=>{
  const pending=source.slice(source.indexOf('for pending_row in select x.*'),source.indexOf("basis:=jsonb_build_object('item'"));
  has(pending,"ce.action='submit'",'tail.revision>ce.revision','public.merchant_attendance_correction_decisions decision',
    'base.request_id=rr.base_request_id',"rr.action='submit'",'tail.revision>rr.revision','public.merchant_attendance_revision_decisions decision',
    'order by x.kind,x.request_id,x.operation_id limit 101','if n>100',
    'row(pending_row.employee_id,pending_row.actor_auth_user_id) is distinct from row(p.employee_id,p.employee_auth_user_id)',
    "'operationId',pending_row.operation_id,'revision',pending_row.revision,'facts',pending_row.facts");
  assert.doesNotMatch(pending,/start_at|end_at|occurred_at|declared_interval/);
});

test('missing root selection cannot filter out moved or wrong-identity current successors',()=>{
  has(source,'coalesce(requested.root_request_id,requested.request_id) is distinct from',
    'faolla_attendance_plan_posthoc_missing_v1(p.merchant_id,p.worker_id,p.employee_id,p.employee_auth_user_id,requested.request_id)',
    'current_ids:=array(select r.request_id from public.merchant_attendance_missing_current_v1',
    "coalesce(r.root_request_id,r.request_id)=(p_ref->>'rootRequestId')::uuid limit 2",'if cardinality(current_ids)<>1',
    'faolla_attendance_plan_posthoc_missing_v1(p.merchant_id,p.worker_id,p.employee_id,p.employee_auth_user_id,missing_row.request_id)',
    'c.supersedes_request_id=missing_row.request_id','jsonb_array_length(pending_items)>1',
    "'request',to_jsonb(missing_row),'approval',to_jsonb(terminal),'pending',pending_items");
  const point=source.slice(source.indexOf('current_ids:=array('),source.indexOf('if cardinality(current_ids)'));
  assert.doesNotMatch(point,/worker_id|employee_id|start_at|end_at/);
});

test('open and pending are visible preparation warnings; unavailable is not falsely asserted changed',()=>{
  has(preview,'item:=null;changed:=false;available:=false',"blocks:=array_append(blocks,'source_open')", "blocks:=array_append(blocks,'pending_source')",
    "available:=true",'all_available:=all_available and available and not changed',
    'tail_at>a and a<to_at and tail_at>from_at','tail_at=a and a>=from_at and a<to_at',
    "elsif not (a<b and a<to_at and b>from_at)","'open',coalesce((item->>'open')::boolean,false)");
  assert.doesNotMatch(preview,/now\(\)|tail_at:=clock_timestamp|b:=clock_timestamp/);
  has(preview,"'attendance_period_source_identity_changed'","'attendance_report_invalid_data'",'else raise;end if');
});

test('source fingerprint excludes read time/head revision and compares saved full facts only in detail',()=>{
  has(preview,"'protocol','outage-link-evidence-v1'","'generation',p_generation,'declaredInterval',p.declared_interval,'items',items",
    'source_text:=evidence::text','if p_saved is not null and evidence is distinct from p_saved',
    "item is distinct from p_saved->'items'->at_index");
  const evidence=preview.slice(preview.indexOf('evidence:=jsonb_build_object'),preview.indexOf('source_text:=evidence::text'));
  assert.doesNotMatch(evidence,/revision_no|recordedAt|clock_timestamp|readAt|observedAt/);
  has(rpc,'(d,refs,w.version,e.version,generation_no,true)',
    '(d,refs,w.version,e.version,generation_no,identity_ok)',
    '(d,head.sources,w.version,e.version,generation_no,identity_ok,head.evidence)');
});

test('settings before saved-worker locks and current self role/auth checks precede all evidence reads',()=>{
  order(rpc,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for update',
    'from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=did',
    'from public.merchant_attendance_workers where merchant_id=site and id=d.worker_id for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share','if op is not null then');
  has(rpc,'row(d.worker_id,d.employee_id,d.employee_id,d.employee_auth_user_id)',
    "e.auth_user_id is distinct from p_auth_user_id or e.status<>'active'",
    "array['enterprise.view','attendance.self.view','attendance.self.request']::text[]");
  assert.doesNotMatch(rpc,/not w\.active|epoch\.paused|p_auth_user_id=e\.auth_user_id/);
});

test('point replay and recovery precede head/source/gate; only current owner and original actor may recover',()=>{
  order(rpc,'select * into saved from public.merchant_attendance_outage_link_operations',
    'saved.declaration_id<>did or saved.actor_auth_user_id<>p_auth_user_id',
    'saved.command is distinct from p_command',"receipt:=jsonb_build_object('operationId',saved.operation_id",'if receipt is null then',
    'select * into head',"if not p_allow_write then raise exception 'attendance_outage_links_disabled'",'faolla_attendance_outage_link_preview_v1');
  has(rpc,"access_name<>'owner'","elsif mode_name='recover' then raise exception 'attendance_outage_links_not_found'");
  const revoke=rpc.slice(rpc.indexOf("if p_command->>'action'='revoke' then"),rpc.indexOf('stamp:=clock_timestamp();'));
  order(revoke,"head.action is distinct from 'apply'","refs:='[]';evidence:=null;fp:=head.source_fingerprint",'else','if not identity_ok');
});

test('immutable saved validation never recollects current sources, and summaries avoid full snapshot histories',()=>{
  assert.doesNotMatch(entry,/outage_link_source|outage_link_preview|period_session|missing_current|clock_timestamp|valid_zone|account_epochs/);
  has(entry,'previous.operation_id is null or previous.recorded_at>p.recorded_at',"previous.action is distinct from 'apply'",
    "p.evidence->'declaredInterval' is distinct from d.declared_interval", "x->'reference' is distinct from p.sources->n",
    "(span->>'startAt')::timestamptz>p.recorded_at",'p.source_fingerprint<>encode(sha256');
  const history=rpc.slice(rpc.indexOf("elsif mode_name='history' then",rpc.indexOf('if receipt is null then')),rpc.indexOf("can_write:=access_name='owner'"));
  has(history,'current_item:=null','order by x.revision desc limit 26','if n>25 then truncated:=true;exit',"'sourceCount',jsonb_array_length(row_item.sources)");
  assert.doesNotMatch(history,/'evidence'|'sourceText'|'sources',/);
  has(sql,">131072 then raise exception 'attendance_outage_links_too_large'",">1048576 then raise exception 'attendance_outage_links_too_large'");
});

test('RLS and all private helpers remain inaccessible; append-only validator and service-only RPC are checked',()=>{
  has(sql,'unique(merchant_id,declaration_id,revision)','before update or delete on public.merchant_attendance_outage_link_operations',
    'before truncate on public.merchant_attendance_outage_link_operations','after insert on public.merchant_attendance_outage_link_operations',
    'returns trigger language plpgsql security definer set search_path=pg_catalog','perform public.faolla_attendance_outage_link_entry_v1(new)',
    'revoke all on public.merchant_attendance_outage_link_operations from public,anon,authenticated,service_role',
    'grant execute on function public.faolla_attendance_outage_links_v1(jsonb,uuid,jsonb,boolean) to service_role',
    "p.proconfig is distinct from array['search_path=pg_catalog']::text[]",'a.grantee=0','if n<>8','tgtype=27','tgtype=34','tgtype=5');
  assert.equal([...sql.matchAll(/grant execute on function/g)].length,1);
});
