//214 inert migration contract tests. They never execute SQL or start a server.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610070178_merchant_attendance_outage_reviews.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return sql.slice(start,end+4);};
const has=(s,...needles)=>needles.forEach(x=>assert(s.includes(x),x));
const order=(s,...needles)=>{let last=-1;for(const x of needles){const next=s.indexOf(x,last+1);assert(next>last,x);last=next;}};
const command=fn('faolla_attendance_outage_review_command_v1'),hash=fn('faolla_attendance_outage_review_hash_v1');
const entry=fn('faolla_attendance_outage_review_entry_v1'),proposal=fn('faolla_attendance_outage_review_proposal_v1');
const original=fn('faolla_attendance_outage_review_original_v1'),basis=fn('faolla_attendance_outage_review_basis_v1'),rpc=fn('faolla_attendance_outage_review_v1');

test('178 adds one immutable review ledger and eight new functions; no old writer, period or activation changes',()=>{
  assert.deepEqual(validateMigrationSource(file,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(x=>x[1]),
    ['command','hash','entry','proposal','guard','original','basis'].map(n=>'faolla_attendance_outage_review_'+n+'_v1').concat('faolla_attendance_outage_review_v1'));
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map(x=>x[1]),['merchant_attendance_outage_review_operations']);
  assert.deepEqual([...sql.matchAll(/\b(?:insert into|update|delete from)\s+public\.([a-z0-9_]+)/g)].map(x=>x[1]),['merchant_attendance_outage_review_operations','faolla_schema_migrations']);
  assert.doesNotMatch(sql,/disable trigger|pg_get_functiondef|set_config\(|current_setting\(|create policy|create index|period_assert_open|account_capture/i);
  has(sql,"version=202610070177 and name='merchant_attendance_outage_links'","values(202610070178,'merchant_attendance_outage_reviews') on conflict(version) do nothing","notify pgrst, 'reload schema';\ncommit;");
});

test('exact six-key commands pair zero revisions, bind result version, and reserve the safety tail',()=>{
  has(command,"array['action','operationId','expectedRevision','expectedResultVersion','expectedFingerprint','reason']",
    "p->>'action' not in('propose','confirm','dispute','resolve','reopen')",
    "numeric>(case when p->>'action' in('dispute','reopen') then 999 else 997 end)",
    "(p->>'expectedResultVersion')::numeric>998","(p->>'expectedResultVersion')::numeric>(p->>'expectedRevision')::numeric",
    "((p->>'expectedRevision')::numeric=0) is distinct from ((p->>'expectedResultVersion')::numeric=0)",
    "p->>'action'<>'propose' and (p->>'expectedResultVersion')::numeric=0","p->>'reason',1,1000");
  has(rpc,"revision_no>=1000 or (action_name not in('dispute','reopen') and revision_no>=998)");
});

test('fingerprints are the fixed nine scalar tuple, not whitespace-sensitive JSONB array formatting',()=>{
  has(hash,"jsonb_build_array(p_site,p_access,p_declaration,p->'action',p->'operationId',p->'expectedRevision',p->'expectedResultVersion',p->'expectedFingerprint',p->'reason')",
    "string_agg(value::text,',' order by ordinal)","convert_to('[","'UTF8'","sha256");
});

test('storage keeps subject identities separate from real actor and rejects SQL NULL check holes',()=>{
  has(sql,'unique(merchant_id,declaration_id,revision)',"result_version between 1 and 998",
    "access='owner' and action in('propose','resolve','reopen') and actor_employee_id is null",
    "access='self' and action in('confirm','dispute') and actor_employee_id is not null and actor_employee_id=employee_id and actor_auth_user_id=employee_auth_user_id)) is true)",
    "command->>'expectedFingerprint'=result_fingerprint",'public.faolla_attendance_outage_review_hash_v1(merchant_id,access,declaration_id,command)) is true)');
});

test('settings and saved-worker locks precede employee authorization and current role checks',()=>{
  order(rpc,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for update',
    'from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=did',
    'from public.merchant_attendance_workers where merchant_id=site and id=d.worker_id for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share','if op is not null then');
  has(rpc,"e.auth_user_id is distinct from p_auth_user_id or e.status<>'active'",
    "array['enterprise.view','attendance.self.view','attendance.self.request']::text[]",
    "(access_name='self') is distinct from (p_command->>'action' in('confirm','dispute'))");
});

test('original actor/access/scope recovery precedes flags, caps and current sources',()=>{
  order(rpc,'select * into saved from public.merchant_attendance_outage_review_operations',
    'saved.declaration_id<>did or saved.access<>access_name or saved.actor_auth_user_id<>p_auth_user_id',
    'saved.command is distinct from p_command','if saved.operation_id is null then','select * into head',
    "if not p_allow_write then raise exception 'attendance_outage_review_disabled'",'faolla_attendance_outage_review_basis_v1');
  has(rpc,'row(saved.worker_id,saved.employee_id,saved.employee_auth_user_id,saved.actor_employee_id)',
    "elsif mode_name='recover' then raise exception 'attendance_outage_review_not_found'",
    "result_version=saved.result_version and action='propose'",'revision_no:=saved.revision;version_no:=saved.result_version');
});

test('safety actions do not recollect sources or require settings enabled, but still require explicit write flag',()=>{
  has(rpc,"if action_name not in('dispute','reopen') and not s.enabled then raise exception 'attendance_platform_paused'",
    "if mode_name='detail' and (p_command is null or action_name in('propose','confirm','resolve')) then",
    "can_write:=p_allow_write and revision_no<1000");
  const commands=rpc.slice(rpc.indexOf("if action_name='propose' then"),rpc.indexOf('stamp:=clock_timestamp();'));
  assert.doesNotMatch(commands,/outage_review_basis|outage_link_preview|epoch|w\.active|e\.status/);
  has(commands,"action_name='reopen' and head.action is distinct from 'resolve'");
});

test('current source reuses177 exact saved link evidence and cannot turn open/pending eligibility into readiness',()=>{
  has(basis,"order by revision desc limit 1","if link.operation_id is null then blockers:='[\"link_missing\"]'",
    "if link.action='revoke' then blockers:='[\"link_revoked\"]'",
    'faolla_attendance_outage_link_preview_v1(d,link.sources,p_worker_version,p_employee_version,p_generation,p_identity,link.evidence)',
    "'linkOperationId',link.operation_id,'linkRevision',link.revision,'linkFingerprint',link.source_fingerprint,'linkEvidence',preview->'evidence','original',original",
    "original->>'status'='unresolved'","'\"original_unknown\"'::jsonb");
  has(rpc,"source_ready:=proposal_row.operation_id is not null and blocks='[]'::jsonb",
    "member_ready:=identity_ok and coalesce(w.active,false) and coalesce(e.status='active',false)",
    'coalesce(epoch.paused,false)',"basis->>'fingerprint' is distinct from proposal_row.result_fingerprint",
    "row(basis->>'linkOperationId',basis->>'linkRevision',basis->>'linkFingerprint')");
});

test('raw original proof requires the exact operation inside a historical dual-identity verified selected session',()=>{
  has(original,'if d.original_operation_id is null then',"'status','not_required'","d.original_channel not in('web','location','onsite','pin')",
    'merchant_id=d.merchant_id and worker_id=d.worker_id and operation_id=d.original_operation_id',
    'ev.actor_employee_id is distinct from d.employee_id',
    'faolla_attendance_period_session_v1(d.merchant_id,d.worker_id', 'd.employee_id,d.employee_auth_user_id,clock_timestamp())',
    "if actual_ref=item->'reference' and exists", "original_event.value->>'id'=ev.id::text",'if not known then return unresolved');
  assert.doesNotMatch(original,/original.*failed|status','failed|_clock_v[123]\(|pin_authenticate|onsite_self_v[123]\(|owner_id/);
});

test('channel sidecars are looked up without scope filtering and unknown/contradictory channels cannot become web',()=>{
  for(const table of ['pin_clock_receipts','onsite_receipts','location_clock_notices','location_results'])
    has(original,'from public.merchant_attendance_'+table+' where event_id=ev.id');
  has(original,"ev.source='web' and pr.event_id is null and qr.event_id is null and lr.event_id is null and gr.event_id is null",
    'row(pr.merchant_id,pr.worker_id,pr.employee_id,pr.operation_id)',
    'row(qr.merchant_id,qr.worker_id,qr.employee_id,qr.operation_id)',
    'if ok is distinct from true then return unresolved');
  assert.doesNotMatch(original,/from public\.merchant_attendance_(?:pin_clock_receipts|onsite_receipts|location_clock_notices|location_results) where merchant_id/);
});

test('PIN/QR proof validates exact old command; QR expiry is compared to saved event, never current credentials',()=>{
  has(original,"array['operationId','locationId','action','expectedSequence','expectedWorkerId','expectedEmployeeId']",
    "c->>'action'=ev.action","c->'expectedSequence'=to_jsonb(ev.sequence-1)",
    "array['v','purpose','siteId','terminalId','locationId','pairedAtMs','issuedAtMs','expiresAtMs','nonce']",
    "qr.claims->>'purpose' is distinct from 'faolla.attendance.onsite'","qr.claims->>'nonce' is distinct from qr.nonce::text",
    "event_ms:=floor(extract(epoch from ev.occurred_at)*1000)", 'issued<paired or expires-issued<>45000 or event_ms<issued or event_ms>=expires');
  assert.doesNotMatch(original,/from public\..*(?:credentials|terminals|leases)|expires.*(?:now\(|clock_timestamp)|pin_hash|current_credential/);
});

test('location safe finish keeps its true historic success semantics without a fabricated version CAS',()=>{
  has(original,"array['operationId','locationId','action','expectedSequence','settingsVersion','workerVersion','locationVersion','noticeRevision','safeFinish']",
    "c->'safeFinish'=to_jsonb(lr.safe_finish)","c->'noticeRevision'=coalesce(to_jsonb(lr.notice_revision),'null'::jsonb)");
  const safe=original.slice(original.indexOf('if lr.safe_finish then'),original.indexOf("if ok is distinct from true"));
  order(safe,"lr.notice_revision is null and ev.action in('break_end','clock_out')",'else',"c->'settingsVersion'=to_jsonb(gr.settings_version)");
  assert.doesNotMatch(safe.slice(0,safe.indexOf('else')),/gr\.(?:worker|settings|location)_version/);
});

test('new results reset response relevance, confirmation can supersede dispute, and reopening cannot directly re-resolve',()=>{
  has(rpc,"result_version=version_no and action='propose'", "result_version=version_no and action in('confirm','dispute')",
    "head.action is distinct from 'resolve'", "source_ready and head.action in('propose','dispute','reopen')",
    "source_ready and head.action='confirm' and response_row.action='confirm'",'version_no:=version_no+1');
  has(entry,"previous.action='resolve' or p.result_version<>coalesce(previous.result_version,0)+1",
    "p.action='confirm' and previous.action not in('propose','dispute','reopen')",
    "p.action='resolve' and previous.action<>'confirm'","p.action='reopen' and previous.action<>'resolve'",
    "p.action in('confirm','resolve') and (proposal.evidence->'original'->>'status'='unresolved'");
});

test('saved evidence binds immutable link/declaration and never reinterprets current status, sources or timezone',()=>{
  has(entry,'p.recorded_at<d.recorded_at','previous.recorded_at>p.recorded_at',
    "link.declaration_id<>p.declaration_id or link.action<>'apply' or link.recorded_at>p.recorded_at",
    "p.evidence->'linkEvidence' is distinct from link.evidence",'p.result_fingerprint is distinct from encode(sha256',
    "original->'operationId' is distinct from coalesce(to_jsonb(d.original_operation_id),'null'::jsonb)",
    "original->'channel' is distinct from coalesce(to_jsonb(d.original_channel),'null'::jsonb)");
  assert.doesNotMatch(entry,/outage_review_basis|outage_review_original|outage_link_preview|period_session|current_v[12]|account_epochs|valid_zone|clock_timestamp/);
  has(proposal,"if p.action<>'propose'", "'evidence',p.evidence,'sourceText',p.evidence::text");
});

test('history is bounded descending summaries and successful writes/recovery contain only their exact old receipt',()=>{
  has(rpc,'order by x.revision desc limit 26','if n>25 then truncated:=true;exit',
    'history:=history||jsonb_build_array(public.faolla_attendance_outage_review_entry_v1(history_row))',
    "'operationId',saved.operation_id,'commandFingerprint',saved.command_fingerprint,'entry',entry",
    "current_item:=null;proposal_item:=null;response_item:=null;status_item:=null;history:='[]';truncated:=false;can_write:=false");
  has(sql,">131072 then raise exception 'attendance_outage_review_too_large'",">1048576 then raise exception 'attendance_outage_review_too_large'");
});

test('all private functions and table privileges remain closed; only new RPC is service-executable',()=>{
  has(sql,'revoke all on public.merchant_attendance_outage_review_operations from public,anon,authenticated,service_role',
    'returns trigger language plpgsql security definer set search_path=pg_catalog','perform public.faolla_attendance_outage_review_entry_v1(new)',
    'before update or delete on public.merchant_attendance_outage_review_operations','before truncate on public.merchant_attendance_outage_review_operations',
    "p.proconfig is distinct from array['search_path=pg_catalog']::text[]",'if n<>8','a.grantee=0','tgtype=27','tgtype=34','tgtype=5');
  assert.deepEqual([...sql.matchAll(/grant execute on function ([^\n]+)/g)].map(x=>x[1]),['public.faolla_attendance_outage_review_v1(jsonb,uuid,jsonb,boolean) to service_role;']);
});
