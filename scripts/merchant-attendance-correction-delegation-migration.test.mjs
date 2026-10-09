//238 static only; importing/running this file never starts a database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const dir=new URL('./supabase-migrations/',import.meta.url);
const read=n=>readFileSync(new URL(n,dir),'utf8').replaceAll('\r\n','\n');
const sql=read('202610080189_merchant_attendance_correction_delegation.sql');
const old=read('202610080185_merchant_attendance_period_delegations.sql');
const fn=(source,name)=>{const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+4);};
const own=name=>fn(sql,'faolla_attendance_correction_delegation_'+name+'_v1');
const owner=fn(sql,'faolla_attendance_correction_delegations_v1'),delegate=fn(sql,'faolla_attendance_delegated_corrections_v1');
const has=(body,parts)=>parts.forEach(p=>assert(body.includes(p),p));
test('189 has only three additive append-only ledgers and two public service entry points',()=>{
 assert.equal((sql.match(/create table if not exists public\./g)||[]).length,3);
 assert.equal((sql.match(/^grant execute on function /gm)||[]).length,2);
 has(sql,["set local lock_timeout='3s'","set local statement_timeout='10s'","before update or delete","before truncate","enable row level security","revoke all on %s from public,anon,authenticated,service_role","202610080185"]);
 assert(sql.trimEnd().endsWith('commit;'));
 assert.doesNotMatch(sql,/disable trigger|session_replication_role|update public\.merchant_enterprise_roles|delete from public\./i);
});
test('only account capture is forward-replaced; precisely two existence clauses preserve185',()=>{
 const addition='\n    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))';
 const after=fn(sql,'faolla_attendance_account_capture_v1');
 assert.equal(after.split(addition).length-1,2);
 assert.equal(after.replaceAll(addition,''),fn(old,'faolla_attendance_account_capture_v1'));
 has(sql,["actual is distinct from expected","item.prosecdef","item.proconfig is distinct from array['search_path=pg_catalog']","merchant_attendance_correction_capture_acl_conflict"]);
});
test('private collector uses actual actor and unchanged basis/rules/checks, never an owner wrapper',()=>{
 has(own('review'),['faolla_attendance_correction_owner_basis_v1(p_site_id,r.worker_id,r.employee_id,r.start_event_id,v_now)','faolla_attendance_correction_rules_v1','r.actor_auth_user_id=p_auth_user_id']);
 assert.doesNotMatch(own('review'),/faolla_attendance_correction_owner_review_v[12]\(/);
 assert.doesNotMatch(delegate,/faolla_attendance_correction_decide_v[12]\(|m\.user_id/);
 has(delegate,['faolla_attendance_decision_checks_v2(site,review)','decision,review,stamp','delegate_generation,employee_generation,authorized_at']);
});
test('exact command and canonical scalar hash include one scope and original inner decision',()=>{
 has(own('command'),["['grantId','expectedGrantRevision','decision']","['action','operationId','requestId','expectedRevision','expectedEvidence','reason']","'includePending','validFrom','validUntil'","9007199254740989","max_reason:=500"]);
 has(own('hash'),["'attendance-correction-delegation-v1'","(p->>'includePending')::boolean","d->>'expectedEvidence'","sha256(convert_to(a::text,'UTF8'))"]);
 assert.doesNotMatch(own('command'),/366|365/);
});
test('both epoch generations, current dual identities and no-self survive a no-worker supervisor',()=>{
 has(own('usable'),['p.delegate_generation','p.employee_generation','x.paused','de.auth_user_id=p.delegate_auth_user_id','te.auth_user_id=p.employee_auth_user_id']);
 has(owner,["'enterprise.view','attendance.correction.review'","coalesce(de_epoch.generation,0),coalesce(te_epoch.generation,0)","de.id=te.id or de.auth_user_id=te.auth_user_id"]);
 assert.doesNotMatch(owner,/attendance\.self\.view|attendance\.self\.request/);
});
test('list filters full saved location and includePending before25+1; detail also checks current source',()=>{
 const list=delegate.slice(delegate.indexOf("elsif mode_name='list' then"),delegate.indexOf("    else\n      if p_command",delegate.indexOf("elsif mode_name='list' then")));
 has(list,['x.actor_auth_user_id=g.employee_auth_user_id','g.include_pending or x.recorded_at>g.recorded_at','faolla_attendance_correction_delegation_scope_v1(x.basis,g.location_id)','order by x.recorded_at desc,x.request_id desc limit 26']);
 has(delegate,["review->'evidence'->'currentBasis',g.location_id","issue:='scope_unavailable'"]);
 has(own('original'),["if n>32 then raise exception 'attendance_correction_delegation_too_large'","if state<>'closed'"]);
});
test('minimal recovery bypasses live grants but binds original employee and Auth, without source',()=>{
 const recovery=delegate.slice(delegate.indexOf("if mode_name='recover' then"),delegate.indexOf("  else\n    if not p_allow_write",delegate.indexOf("if mode_name='recover' then")));
 has(recovery,['authority.delegate_auth_user_id<>p_auth_user_id','authority.delegate_employee_id<>de.id','faolla_attendance_correction_delegation_receipt_v1(authority)']);
 assert.doesNotMatch(recovery,/usable_v1|review_v1|basis_v1|role_id|permissions/);
 has(owner,["mode_name='recover' or m.user_id=p_auth_user_id","mode_name='catalog' or action_name='grant'"]);
});
test('decision is old real-actor business entry/effect then mandatory matching authority, sealed guards untouched',()=>{
 const decisionAt=delegate.indexOf('insert into public.merchant_attendance_correction_decisions(');
 const effectAt=delegate.indexOf('insert into public.merchant_attendance_correction_effects(');
 const proofAt=delegate.indexOf('insert into public.merchant_attendance_correction_delegation_decisions(');
 assert(decisionAt>0&&effectAt>decisionAt&&proofAt>effectAt);
 has(delegate,['faolla_attendance_correction_delegation_usable_v1(g,stamp)','attendance_correction_evidence_changed','attendance_correction_decision_blocked']);
 has(own('decision_guard'),['faolla_attendance_correction_delegation_receipt_v1(new)',"new.action='approve'","merchant_attendance_correction_effects"]);
 has(own('receipt'),["d.command is distinct from p.command->'decision'","d.actor_auth_user_id is distinct from p.delegate_auth_user_id",'p.authorized_at>=g.valid_until']);
});
test('all new helpers are private, RLS and triggers checked after install',()=>{
 const names=[...sql.matchAll(/^create or replace function public\.([a-z0-9_]+)\(/gm)].map(m=>m[1]);
 for(const name of names.filter(n=>n!=='faolla_attendance_account_capture_v1')){
  assert(sql.includes('revoke all on function public.'+name+'('),name);
 }
 has(sql,["has_function_privilege(role_name,p,'EXECUTE')","g.tgtype=27","g.tgtype=34","g.tgtype=7","proconfig=array['search_path=pg_catalog']","131072"]);
});

