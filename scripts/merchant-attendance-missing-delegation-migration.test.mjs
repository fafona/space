//189 static scope/contract proofs. PostgreSQL/browser execution belongs to root.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const filename='202610060160_merchant_attendance_missing_delegation.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const has=(source,...parts)=>{for(const part of parts)assert(source.includes(part),part);};
const order=(source,...parts)=>{let at=-1;for(const part of parts){const next=source.indexOf(part,at+1);assert(next>at,part);at=next;}};
const fn=name=>{const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('$$;',start);assert(start>=0&&end>start,name);return sql.slice(start,end+3);};
const command=fn('faolla_attendance_missing_delegation_command_v1');
const hash=fn('faolla_attendance_missing_delegation_hash_v1');
const guard=fn('faolla_attendance_missing_delegation_guard_v1');
const owner=fn('faolla_attendance_missing_delegations_v1');
const delegate=fn('faolla_attendance_delegated_missing_v1');
const receipt=fn('faolla_attendance_missing_delegation_receipt_v1');
const usable=fn('faolla_attendance_missing_delegation_usable_v1');
const item=fn('faolla_attendance_missing_delegation_item_v1');

test('160 is additive: exactly three new tables and nine new functions, no old function or writer replacement',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[
    'faolla_attendance_missing_delegation_command_v1','faolla_attendance_missing_delegation_hash_v1','faolla_attendance_missing_delegation_guard_v1',
    'faolla_attendance_missing_delegation_usable_v1','faolla_attendance_missing_delegation_grant_v1','faolla_attendance_missing_delegation_receipt_v1',
    'faolla_attendance_missing_delegation_item_v1','faolla_attendance_missing_delegations_v1','faolla_attendance_delegated_missing_v1']);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(x=>x[1]),[
    'merchant_attendance_missing_delegations','merchant_attendance_missing_delegation_revocations','merchant_attendance_missing_delegation_decisions']);
  assert.doesNotMatch(clean,/\b(?:update public\.|delete from|truncate public\.|drop (?:table|function|index)|disable trigger|session_replication_role|set_config|statement_timeout|pg_advisory)/i);
  for(const m of clean.matchAll(/insert into public\.(\w+)/g))assert.match(m[1],/^(?:merchant_attendance_missing_(?:delegations|delegation_revocations|delegation_decisions|entries)|faolla_schema_migrations)$/);
  assert.doesNotMatch(clean,/grant\s+(?:select|insert|update|delete)|update.*permissions|faolla_attendance_missing_v1\(/i);
});
test('CIC install is three phases with independent 3s locks and final atomic registry',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,2);assert.equal((clean.match(/^commit;/gm)||[]).length,2);
  assert.equal((clean.match(/set local lock_timeout='3s'/g)||[]).length,2);
  order(clean,'$missing_delegation_prerequisites$;','commit;','create index concurrently if not exists attendance_missing_delegation_list_idx','begin;','$missing_delegation_index_ready$;','create table if not exists','$missing_delegation_postconditions$;',"values(202610060160,'merchant_attendance_missing_delegation')",'commit;');
  const pre=sql.slice(0,sql.indexOf('$missing_delegation_prerequisites$;'));
  assert.doesNotMatch(pre,/create (?:table|index|function)|alter table|insert into/i);
  has(pre,"(202610010103::bigint,'merchant_attendance_missing_revisions')","(202610040135::bigint,'merchant_attendance_shift_rule_binding_reader')","(202610050150::bigint,'merchant_attendance_period_seal_guards')",
    'installed<>(to_regclass','installed<>exists',"where oid='public.faolla_schema_migrations'::regclass");
  assert.doesNotMatch(pre,/'public'::regnamespace/);
});
test('both old-table index guards reject wrong/invalid/partial/opclass/collation/options objects, never repair',()=>{
  const prefix=sql.slice(0,sql.indexOf('create or replace function'));
  for(const label of ['prerequisites','index_ready']){
    const a=prefix.indexOf('do $missing_delegation_'+label+'$'),b=prefix.indexOf('$missing_delegation_'+label+'$;',a);const piece=prefix.slice(a,b);
    has(piece,"am.amname='btree'","i.indrelid='public.merchant_attendance_missing_requests'::regclass",'i.indisvalid and i.indisready and i.indislive',
      'not i.indisunique and not i.indisexclusion','i.indpred is null and i.indexprs is null','i.indnatts=7 and i.indnkeyatts=7',
      'i.indoption[z-1]<>opts[z]','i.indcollation[z-1]','o.opcdefault','o.opcintype=a.atttypid');
  }
  has(prefix,'(merchant_id,worker_id,employee_id,actor_auth_user_id,location_id,submitted_at desc,request_id desc)');
  assert.doesNotMatch(prefix,/drop index|reindex/i);
});
test('exact command shapes keep real old six-key decisions, bounded reason and UTC6 expiry',()=>{
  has(command,"array['grantId','expectedGrantRevision','decision']","array['action','operationId','requestId','expectedRevision','evidenceToken','reason']",
    "array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','locationId','validFrom','validUntil','reason']",
    "array['action','operationId','grantId','expectedRevision','reason']","p->'expectedGrantRevision' is distinct from '1'::jsonb",
    "d->'expectedRevision' is distinct from '1'::jsonb","d->'validFrom','stamp6'","d->'validUntil','stamp6'","d->'reason','reason'",'8192');
  has(command,"coalesce(d->>'action','') not in('approve','reject')");
  assert.doesNotMatch(command,/interval '(?:30|31|365) days'/);
});
test('fixed scalar fingerprint has exactly the frozen owner and delegate tuples with numeric revisions',()=>{
  has(hash,"jsonb_build_array('attendance-missing-delegation-v1',p_site,p_access)",
    "jsonb_build_array(d->>'action',d->>'operationId',p->>'grantId',(p->>'expectedGrantRevision')::integer,d->>'requestId',(d->>'expectedRevision')::integer,d->>'evidenceToken',d->>'reason')",
    "jsonb_build_array(p->>'action',p->>'operationId',p->>'delegateEmployeeId',p->>'delegateAuthUserId',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId',p->>'locationId',p->>'validFrom',p->>'validUntil',p->>'reason')",
    "jsonb_build_array(p->>'action',p->>'operationId',p->>'grantId',(p->>'expectedRevision')::integer,p->>'reason')",
    "encode(sha256(convert_to(values_json::text,'UTF8')),'hex')");
});
test('storage links every delegated decision to exact old terminal and saved authorization, atomically',()=>{
  has(clean,'unique(merchant_id,request_id)','references public.merchant_attendance_missing_entries(merchant_id,operation_id)',
    'references public.merchant_attendance_missing_delegations(merchant_id,grant_id)','delegate_auth_user_id<>employee_auth_user_id');
  has(guard,'g.grant_id is null or r.request_id is null or e.operation_id is null',
    '(g.delegate_employee_id,g.delegate_auth_user_id,g.worker_id,g.employee_id,g.employee_auth_user_id,g.location_id)',
    '(r.worker_id,r.employee_id,r.actor_auth_user_id,r.location_id)','e.revision<>2','e.actor_auth_user_id<>new.delegate_auth_user_id',
    "e.command is distinct from new.command->'decision'",'e.recorded_at is distinct from new.recorded_at','new.recorded_at<g.valid_from or new.recorded_at>=g.valid_until');
  order(delegate,'insert into public.merchant_attendance_missing_entries(',"values(site,op,req.request_id,2,decision->>'action',p_auth_user_id,decision,stamp)",
    'insert into public.merchant_attendance_missing_delegation_decisions(','public.faolla_attendance_missing_delegation_receipt_v1(authority);');
  assert.doesNotMatch(delegate,/when others|exception.*unique_violation|perform.*missing_v1\(/i);
});
test('all new storage append-only, RLS, no policies/API DML, exact enabled trigger checks',()=>{
  has(clean,'enable row level security','before update or delete','before truncate','revoke all on %s from public,anon,authenticated,service_role',
    "tgname='missing_delegation_immutable'","tgname='missing_delegation_no_truncate'","tgname='missing_delegation_decision_guard'",
    "g.tgtype=27 and g.tgenabled='O'","g.tgtype=34 and g.tgenabled='O'","g.tgtype=7 and g.tgenabled='O'",'exists(select 1 from pg_policy','aclexplode');
  assert.equal((clean.match(/grant execute on function/g)||[]).length,2);
  has(clean,'grant execute on function public.faolla_attendance_missing_delegations_v1(jsonb,uuid,jsonb,boolean) to service_role;',
    'grant execute on function public.faolla_attendance_delegated_missing_v1(jsonb,uuid,jsonb,boolean) to service_role;',
    "not prosecdef and proconfig=array['search_path=pg_catalog']","prosecdef and proconfig=array['search_path=pg_catalog']");
});
test('owner authorization and lock order precede fresh identity capture; no self grants',()=>{
  order(owner,'m.user_id=p_auth_user_id for share','merchant_attendance_settings x where x.merchant_id=site for update',
    "x.id=(p_command->>'workerId')::uuid for update",'order by x.id for share','select * into dr','select * into loc','stamp:=clock_timestamp();','insert into public.merchant_attendance_missing_delegations');
  has(owner,"array['enterprise.view','attendance.self.view','attendance.missing.review']::text[]",'w.employee_id is distinct from te.id',"te.auth_user_id is distinct from (p_command->>'employeeAuthUserId')::uuid",
    "de.auth_user_id is distinct from (p_command->>'delegateAuthUserId')::uuid",'de.id=te.id or de.auth_user_id=te.auth_user_id');
});
test('owner revoke is safe with flag off, recovery remains current-owner original-actor minimal',()=>{
  has(owner,"not p_allow_write and mode_name<>'recover' and action_name is distinct from 'revoke'",'g.actor_auth_user_id<>p_auth_user_id','rv.actor_auth_user_id<>p_auth_user_id',
    'g.command is distinct from p_command','rv.command is distinct from p_command','if p_command is not null and receipt is null then');
  const revoke=owner.slice(owner.indexOf('select * into g from public.merchant_attendance_missing_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;',owner.indexOf('insert into public.merchant_attendance_missing_delegations')),
    owner.indexOf("elsif p_command is null and mode_name='detail'"));
  assert.doesNotMatch(revoke,/p_allow_write|can_write|permissions|employee_id.*distinct/i);
});
test('delegate recover is original same employee/Auth only without role, activity, grant, feature or body',()=>{
  const a=delegate.indexOf("if mode_name='recover' then"),b=delegate.indexOf('else\n    if not p_allow_write',a);assert(b>a);const recover=delegate.slice(a,b);
  has(recover,'authority.delegate_auth_user_id<>p_auth_user_id or authority.delegate_employee_id<>de.id','x.auth_user_id=p_auth_user_id for share','faolla_attendance_missing_delegation_receipt_v1(authority)');
  assert.doesNotMatch(recover,/permissions|status<>|usable_v1|p_allow_write|missing_requests|missing_review_v1|jsonb_build_object/);
  has(receipt,'e.request_id<>p.request_id','e.actor_auth_user_id<>p.delegate_auth_user_id',"e.command is distinct from p.command->'decision'",'p.command_fingerprint is distinct from');
  const projection=receipt.slice(receipt.indexOf('return jsonb_build_object'));
  for(const key of ['operationId','requestId','grantId','action','status','actorId','recordedAt','commandFingerprint'])has(projection,"'"+key+"'");
  assert.doesNotMatch(projection,/'(?:command|reason|proposal|workerName|delegateName|locationName|employeeId|startAt|endAt)'/);
});
test('ordinary delegate reads and writes check all live identities, role and fixed saved location under correct locks',()=>{
  order(delegate,'merchant_attendance_settings x where x.merchant_id=site for update','x.id=g.worker_id for update','order by x.id for share','select * into dr','stamp:=clock_timestamp();can_write');
  has(delegate,'g.delegate_employee_id<>de.id or g.delegate_auth_user_id<>p_auth_user_id','w.employee_id is distinct from g.employee_id','te.auth_user_id is distinct from g.employee_auth_user_id','de.auth_user_id is distinct from g.delegate_auth_user_id',
    "array['enterprise.view','attendance.self.view','attendance.missing.review']::text[]",'req.actor_auth_user_id=p_auth_user_id','public.faolla_attendance_missing_delegation_usable_v1(g,stamp) is distinct from true');
  has(usable,'p_at>=p.valid_from and p_at<p.valid_until','merchant_attendance_missing_delegation_revocations','de.id=p.delegate_employee_id','te.auth_user_id=p.employee_auth_user_id','de.auth_user_id<>te.auth_user_id');
});
test('25+1 paging filters scope and pending status before limits, catalog is actual three-way typed SQL',()=>{
  has(delegate,'x.worker_id=g.worker_id','x.employee_id=g.employee_id and x.actor_auth_user_id=g.employee_auth_user_id and x.location_id=g.location_id',
    't.request_id=x.request_id and t.revision=2','order by x.submitted_at desc,x.request_id desc limit 26','seen:=seen+1;exit when seen=26;',
    'x.delegate_employee_id=de.id and x.delegate_auth_user_id=p_auth_user_id','order by x.grant_id limit 26');
  has(delegate,'where can_write and x.merchant_id=site and x.delegate_employee_id=de.id');
  order(delegate,'--Filter the exact saved identity','x.worker_id=g.worker_id','not exists(select 1 from public.merchant_attendance_missing_entries','limit 26','faolla_attendance_missing_delegation_item_v1(req)');
  has(owner,"kind='delegates'","kind='workers'","kind='locations'",'order by c.id limit 26','x.grant_id>after_id','order by x.grant_id limit 26');
});
test('review uses real delegate without public-owner impersonation and only generic privacy-safe projection',()=>{
  has(delegate,'review:=public.faolla_attendance_missing_review_v1(req,p_auth_user_id,true);',"review->>'status' is distinct from 'submitted'",'stamp<req.submitted_at',
    "decision->>'evidenceToken' is distinct from review->>'evidenceToken'","review->'canApprove' is distinct from 'true'::jsonb","review->'canReject' is distinct from 'true'::jsonb",
    'p.request_id=req.supersedes_request_id','c.start_at<p.end_at and c.end_at>p.start_at');
  assert.doesNotMatch(item,/'(?:lineage|issues|currentRequestId|currentApprovalOperationId|raw_overlap|effective_overlap)'\s*,/);
  has(item,"'blocked',p_review->'issues'<>'[]'::jsonb","'canApprove',p_review->'canApprove'","'canReject',p_review->'canReject'");
  assert.doesNotMatch(delegate,/faolla_attendance_missing_v1\(|user_id\s+into|owner_auth/i);
});
test('new protocol never backfills old receipts; flags, strict GET/POST modes and 128KiB caps are explicit',()=>{
  has(delegate,"(mode_name='decide')<>(p_command is not null)",'authority.command is distinct from p_command',
    'elsif exists(select 1 from public.merchant_attendance_missing_entries',"raise exception 'attendance_operation_conflict'",'octet_length(convert_to(result::text,\'UTF8\'))>131072');
  has(owner,"array['siteId','access','mode','catalog','afterId','grantId','operationId']",'octet_length(convert_to(result::text,\'UTF8\'))>131072');
  has(delegate,"array['siteId','access','mode','grantId','requestId','operationId','beforeAt','beforeId','afterId']");
  assert.doesNotMatch(clean,/sourceText|correction_effects.*insert|insert into public\.merchant_attendance_events|update.*period_closures/i);
});
