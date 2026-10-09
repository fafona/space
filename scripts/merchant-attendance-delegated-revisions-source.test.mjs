//SOURCE evidence, not PostgreSQL/Auth/browser acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {delegatedRevisionsMigration,delegatedRevisionsActions,delegatedRevisionsForwardRecipes,delegatedRevisionsInstallRecipe,delegatedRevisionsFreezeSql} from './merchant-attendance-delegated-revisions-source.mjs';
const dir=new URL('./supabase-migrations/',import.meta.url),sql=readFileSync(new URL(delegatedRevisionsMigration,dir),'utf8').replaceAll('\r\n','\n');
const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedRevisionsMigration).sort().map(name=>({name,text:readFileSync(new URL(name,dir),'utf8')}));
const r=delegatedRevisionsInstallRecipe(sql,migrations),functions=dayReviewSqlFunctions(sql),body=name=>{const f=functions.find(f=>f.name===name);assert(f,name);return f.body;};
const own=name=>body('faolla_attendance_delegated_revisions_'+name+'_v1');

test('208 generated candidate is byte-exact13 private/RPC functions,89 plus selectedcatalog dependencies,3 forwards,0 new permanent tables',()=>{
 assert.equal(delegatedRevisionsFreezeSql(sql,migrations),sql);assert.equal(r.own.length,13);assert.equal(r.dependencies.length,89);
 assert.equal(r.own.filter(f=>f.isRpc).length,1);assert.equal(r.own.filter(f=>f.definer).length,1);
 assert.equal(r.forward.cores.length,2);assert.match(sql,/revisions208_forward_metadata\)<>3/);
 assert.doesNotMatch(sql,/^create table (?:if not exists )?public\./m);
 assert.equal((sql.match(/^grant execute on function/gm)||[]).length,1);
 for(const f of r.own)assert(sql.includes('revoke all on function '+f.signature+' from public,anon,authenticated,service_role;'));
 assert.doesNotMatch(readFileSync(new URL('./merchant-attendance-delegated-revisions-source.mjs',import.meta.url),'utf8'),/child_process|pg_ctl|createdb|initdb|listen\(/);
});
test('208 two NULL-context cores restore the exact successful095 owner bodies and original nested Auth/locks/CAS/results',()=>{
 assert.deepEqual(r.forward.cores.map(f=>f.oldHash),['13c636b9a8a240dd72be9c62f3971d00ef2fa2706a9d7de531ed336873509387','de1d32befdc98d2a6c622a0cb9e4f7f93a1d5d00b1d56996a4e5d50720634283']);
 for(const f of r.forward.cores){assert.equal(body(f.coreName),f.core);let restored=f.core.replace(f.boundary,f.anchor);if(f.nestedBoundary)restored=restored.replace(f.nestedBoundary,f.nestedOriginal);
  assert.equal(restored,f.oldBody);assert.match(f.newBody,/null\);/);assert.equal(f.definer,true);assert.equal(f.searchPath,'search_path=pg_catalog');assert.equal(f.result,'jsonb');
  assert.doesNotMatch(f.core,/p_auth_user_id\s*:=|p_auth_user_id=>g\.actor_auth_user_id/);
 }
 const decision=r.forward.cores[1];assert.equal(decision.defaults,3);assert.equal(decision.defaultExpression,'NULL::jsonb, NULL::uuid, false');
 assert.match(decision.core,/if p_grant_id is null then\n  r:=public\.faolla_attendance_revision_owner_review_v3/);
 assert.match(decision.core,/else\n  r:=public\.faolla_attendance_delegated_revisions_review_core_v1\(p_site_id,p_auth_user_id,p_request_id,p_grant_id\)/);
});
test('208 strict old7key command and full actualactor/grant SHA tuple do not introduce annul or caller authority',()=>{
 assert.deepEqual(delegatedRevisionsActions,['revision_approve','revision_reject']);const c=own('command'),h=own('hash');
 assert.match(c,/array\['action','operationId','requestId','expectedRevision','expectedEvidence','expectedBaseOperationId','reason'\]/);
 assert.match(c,/>4096/);assert.match(c,/not in\('approve','reject'\)/);assert.match(c,/>9007199254740989/);
 assert.match(h,/'attendance-delegated-revisions-v1-command',site,actor,id,[\s\S]*jsonb_build_array\(c->'action',c->'operationId',c->'requestId',c->'expectedRevision',c->'expectedEvidence',c->'expectedBaseOperationId',c->'reason'\)/);
 assert.doesNotMatch(c+h,/'annul'|actorId|ownerId|p_allow_write|p_material/);
 const rpc=functions.find(f=>f.name==='faolla_attendance_delegated_revisions_v1');assert.deepEqual(rpc.args,['p_query','p_auth_user_id','p_command','p_allow_write']);assert.equal(rpc.defaults,2);assert.equal(rpc.defaultExpression,'NULL::jsonb, false');
});
test('208 grant/current self-boundary, complete request identity and explicit includePending anchor are all server-authoritative',()=>{
 const a=own('authorize'),q=own('request');
 for(const check of ['g.delegate_auth_user_id is distinct from actor',"g.scope->>'kind' is distinct from 'revision'",'g.employee_id=g.delegate_employee_id','g.employee_auth_user_id=actor',"g.capability is distinct from 'attendance.correction.revision.review'",'management_current_v1(g,clock_timestamp())'])assert(a.includes(check),check);
 assert(a.indexOf('actual.id=site for share')<a.indexOf('from public.merchant_attendance_settings'));assert(a.indexOf('from public.merchant_attendance_settings')<a.indexOf('from public.merchant_attendance_management_delegations'));
 assert.match(q,/row\(first_row.worker_id,first_row.employee_id,first_row.actor_auth_user_id\) is distinct from row\(g.worker_id,g.employee_id,g.employee_auth_user_id\)/);
 assert.match(q,/not\(g.scope->>'includePending'\)::boolean and first_row.recorded_at<g.recorded_at/);
 assert.match(q,/if require_pending is distinct from false then[\s\S]*head.operation_id is distinct from id[\s\S]*merchant_attendance_revision_decisions/);
 assert.match(q,/actual\.id=\(item->>'id'\)::uuid[\s\S]*actual\.actor_employee_id=g.employee_id[\s\S]*g.scope->'locationIds' @> jsonb_build_array\(actual.location_id::text\)/);
});
test('208 complete context includes only pending scoped oldreview and masks one grant action without modifying old can* derivation',()=>{
 const b=body('faolla_attendance_delegated_revisions_v1'),s=own('review_scope');
 assert.match(b,/array\['siteId','grantId','mode','requestId'\]/);assert.doesNotMatch(b,/mode_name='list'|mode','members|p_auth_user_id=>g.actor_auth_user_id/);
 assert.match(b,/p_allow_write is distinct from true then raise exception 'attendance_delegated_revisions_disabled'/);
 assert.match(b,/decide_core_v1\(site,p_auth_user_id,request_id,null,null,true,id\)/);
 assert.match(b,/'context',jsonb_build_object\('review',r,'canApprove',g.delegated_action='revision_approve' and \(r->>'canApprove'\)::boolean,'canReject',g.delegated_action='revision_reject' and \(r->>'canReject'\)::boolean\)/);
 assert.match(b,/r->'review'->>'requestState' is distinct from 'submitted'/);assert.match(b,/r->'decision' is distinct from 'null'::jsonb/);
 for(const path of ["application'->'basis'->'events'","evidence'->'currentBasis'->'events'","evidence'->'previous'","evidence'->'next'"])assert(s.includes(path));
 assert.match(s,/n>406/);assert.match(s,/actual.worker_id=g.worker_id and actual.actor_employee_id=g.employee_id/);assert.match(s,/locationIds' @> jsonb_build_array\(actual.location_id::text\)/);
 assert.doesNotMatch(b+s,/set_config|current_setting|owner_auth|\buser_id\s*:=/);
});
test('208 exact original POST and minimal GET recover precede current qualifications, flags and source and recheck after real settings wait',()=>{
 const b=body('faolla_attendance_delegated_revisions_v1'),recover=own('receipt'),proof=own('operation');
 assert(b.indexOf("if mode_name='recover' then")<b.indexOf('for pass in 1..2 loop'));
 assert(b.indexOf('b->\'decision\'->\'command\' is distinct from p_command')<b.indexOf('actual.id=site for share'));
 assert.match(b,/for pass in 1\.\.2 loop/);assert.match(b,/row\(p.actor_auth_user_id,p.grant_id,p.command_fingerprint\) is distinct from row\(p_auth_user_id,id,fp\)/);
 assert.match(recover,/p.actor_auth_user_id is distinct from actor/);assert.match(recover,/operation_v1\(p,false\)/);
 assert.doesNotMatch(recover,/authorize_v1|management_current|clock_timestamp|p_allow_write/);
 assert.match(proof,/request_v1\(g,\(c->>'requestId'\)::uuid,false\)/);assert.match(proof,/if require_current then perform[\s\S]*authorize_v1/);
});
test('208 immutable business proof binds true olddecision/effect, three identities, exact command and saved timestamp without adopting legacy facts',()=>{
 const b=own('business'),p=own('operation'),rpc=body('faolla_attendance_delegated_revisions_v1');
 assert.match(b,/\(d.action='approve'\) is distinct from \(e.operation_id is not null\)/);
 assert.match(b,/e.actor_auth_user_id,e.request_revision,e.evidence_token,e.reason,e.recorded_at/);
 assert.match(b,/actual.revision>q.revision and actual.recorded_at<=d.recorded_at/);
 assert.equal((b.match(/at time zone 'UTC'/g)||[]).length,6);
 assert.match(p,/p.business_reference_id,p.business_revision,p.recorded_at/);assert.match(p,/\(c->>'requestId'\)::uuid,\(c->>'expectedRevision'\)::bigint/);
 assert.match(p,/p.recorded_at<g.valid_from or p.recorded_at>=g.valid_until/);
 assert.match(p,/p.business_fingerprint is distinct from[\s\S]*'attendance-delegated-revisions-business-v1',b/);
 assert.match(rpc,/A legacy decision with this number is not adopted/);assert.match(rpc,/actual.operation_id=op\)[\s\S]*then raise exception 'attendance_operation_conflict'/);
 assert.match(rpc,/stamp<started_at/);assert.match(rpc,/values\(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action/);
 assert.doesNotMatch(b,/effect_current|management_current|for update|insert into/);
});
test('208 minimal receipt exposes exact8 fields and real9field business reference; effectrevision is not guessed from request revision',()=>{
 const b=own('receipt');
 for(const field of ['operationId','actorId','grantId','action','reference','commandFingerprint','businessFingerprint','recordedAt'])assert(b.includes("'"+field+"'"));
 assert.match(b,/'reference',jsonb_build_object\('kind','revision','requestId',p.business_reference_id,'rootRequestId',b->'decision'->'base_request_id'/);
 for(const field of ['workerId','employeeId','employeeAuthUserId','requestRevision','baseOperationId','effectRevision'])assert(b.includes("'"+field+"'"));
 assert.match(b,/'effectRevision',b->'effect'->'revision'/);assert.doesNotMatch(b,/expectedRevision'\)::bigint\+1|proposal|reason|basis|command',/);
});
test('208 sole sharedinsert delta adds precisely two authority branches, all oldexecutor bodies and fallback remain identical',()=>{
 const f=r.forward.guard,delta="\n  if new.delegated_action in('revision_approve','revision_reject') then perform public.faolla_attendance_delegated_revisions_authority_v1(new);return new;end if;";
 assert.equal(f.oldHash,'c46a7ada6f8cbe703bd11496d71d4b97ac2ab7e7bb19152b48c3aa0835c3cc57');assert.equal(f.newBody.replace(delta,''),f.oldBody);
 assert.equal(f.newBody.split(delta).length-1,1);for(const old of ['audit_export','group_cancel','worker_save','location_save','operational_rule_withdraw','pin_revoke','attendance_management_executor_unavailable'])assert(f.newBody.includes(old));
 assert.match(own('authority'),/operation_v1\(p,true\)/);
});
test('208 install/reentry guards full metadata/default/OID/ACL, actual oldschemas and unchanged098/103/150 guard manifests',()=>{
 assert.equal(r.templates.tables.length,18);assert.equal(r.triggerManifest.length,37);assert.doesNotMatch(r.templates.sql,/references public\./);
 assert.match(r.templates.sql,/references pg_temp.merchant_attendance_revision_decisions[\s\S]*deferrable initially deferred/);
 for(const field of ['pg_get_expr(meta.proargdefaults,0)','aclexplode','meta.proargnames','meta.proconfig','meta.proowner',
  "to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression",
  "to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata",
  'pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression',"meta.pronargdefaults<>(spec->>'defaults')::integer"])assert(sql.includes(field),field);
 for(const field of ['connoinherit','convalidated','confkey','indnkeyatts','indnullsnotdistinct','indisvalid','pg_attrdef','attacl','tginitdeferred','tgfoid','pg_get_viewdef'])assert(r.tableChecks.includes(field),field);
 assert.match(r.tableChecks,/\(trigger_spec->>'name'\)::name/);
 assert(r.dependencies.find(f=>f.name==='faolla_attendance_revision_decision_link_v1').definer);
 assert.equal(r.dependencies.find(f=>f.name==='faolla_attendance_revision_review_checks_v2').hash,'69b677d7f3755550eb9cc10119aab52c32d03c7c0452afca9d8043dea163676f');
 assert.equal(r.dependencies.find(f=>f.name==='faolla_attendance_correction_owner_basis_v1').hash,'2523fe8ecf015e11b1b334bd1d9938b1b956bdeb47557c42e5b299c7eb1dae6e');
 for(const name of ['faolla_attendance_effect_version_guard_v1','faolla_attendance_missing_effect_guard_v1','faolla_attendance_period_seal_insert_guard_v1'])assert(r.dependencies.some(f=>f.name===name));
 assert.doesNotMatch(r.preflight,/disable trigger|session_replication_role|oldHash'\)\s*(?:or|in)/);
});
test('208 inherited templates retain exactly both203 ledger read indexes and full index rejection guards',()=>{
 const indexes=[['management_audit_grant_time_idx','merchant_attendance_management_delegations','grant_id'],['management_audit_revoke_time_idx','merchant_attendance_management_delegation_revocations','operation_id']];
 for(const [name,table,id] of indexes){
  const expected='create index '+name+' on pg_temp.'+table+'(merchant_id,recorded_at desc,'+id+' desc);';
  assert.equal(r.templates.sql.split(expected).length-1,1);
 }
 assert.doesNotMatch(r.templates.sql,/management_audit_exports_actor_idx|management_audit_export_time_idx|on public\./);
 for(const field of ['(select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table)','index_conflict','index_spec','indnkeyatts','indnullsnotdistinct','indisvalid','pg_get_expr(actual_index.indpred,actual_table)','pg_get_expr(actual_index.indexprs,actual_table)'])assert(r.tableChecks.includes(field),field);
});
test('208 revision templates include four exact097/116/151 indexes and reject missing or duplicate definitions',()=>{
 const indexes=[
  ['202610010097_merchant_attendance_revision_history.sql','create index attendance_revision_owner_history_idx on public.merchant_attendance_revision_requests(merchant_id,recorded_at desc,request_id desc) where action=\'submit\';'],
  ['202610010097_merchant_attendance_revision_history.sql','create index attendance_revision_root_history_idx on public.merchant_attendance_revision_requests(merchant_id,base_request_id,recorded_at desc,request_id desc) where action=\'submit\';'],
  ['202610030116_merchant_attendance_self_revision_history.sql',"create index if not exists attendance_revision_self_identity_history_idx\n  on public.merchant_attendance_revision_requests\n  (merchant_id,worker_id,employee_id,actor_auth_user_id,recorded_at desc,request_id desc)\n  where action='submit';"],
  ['202610050151_merchant_attendance_period_source_ranges.sql',"create index concurrently if not exists attendance_revision_proposal_period_idx\n  on public.merchant_attendance_revision_requests(merchant_id,worker_id,\n    (public.faolla_attendance_instant_v1(command->'proposal'->>'startAt')),\n    (public.faolla_attendance_instant_v1(command->'proposal'->>'endAt')),request_id)\n  where action='submit';"],
 ];
 for(const [file,statement] of indexes){
  assert.equal(r.templates.sql.split(statement.replace(/^create index (?:concurrently )?(?:if not exists )?/,'create index ').replace('on public.','on pg_temp.')).length-1,1);
  for(const replacement of ['',statement+'\n'+statement]){
   const changed=migrations.map(m=>m.name===file?{...m,text:m.text.replace(statement,replacement)}:m);
   assert.throws(()=>delegatedRevisionsInstallRecipe(sql,changed),/exact208_later_revision_index/);
  }
 }
 assert.equal((r.templates.sql.match(/^create (?:unique )?index [^;]+on pg_temp\.merchant_attendance_(?:revision_requests|effect_versions|revision_decisions)\s*\(/gm)||[]).length,8);
 for(const field of ['(select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table)',
  'indnkeyatts','indnullsnotdistinct','indisvalid','pg_get_expr(actual_index.indpred,actual_table)','pg_get_expr(actual_index.indexprs,actual_table)'])assert(r.tableChecks.includes(field),field);
});
test('208 exact198 routing capture is pinned with its recursive dependencies, not accepted as an unknown trigger',()=>{
 assert.deepEqual(r.triggerManifest.filter(t=>t.table==='merchant_attendance_revision_requests'&&t.name==='review_routing_capture'),[
  {table:'merchant_attendance_revision_requests',name:'review_routing_capture',type:5,fn:'faolla_attendance_review_routing_capture_v1',deferred:false},
 ]);
 const capture=r.dependencies.find(f=>f.name==='faolla_attendance_review_routing_capture_v1');assert(capture);
 assert.equal(capture.hash,'58342d0420d4a28f4756b3876ba0ac67be750ec379c5a4429615fa967fc63dc3');
 assert.equal(capture.definer,true);assert.equal(capture.volatility,'v');assert.equal(capture.searchPath,'search_path=pg_catalog');assert.equal(capture.isRpc,false);
 for(const [table,count] of [['revision_requests',4],['effect_versions',6],['revision_decisions',3]])assert.equal(r.triggerManifest.filter(t=>t.table==='merchant_attendance_'+table).length,count);
 for(const field of ['(select count(*) from pg_trigger actual','actual.tgfoid=to_regprocedure','actual.tgtype=(trigger_spec','actual.tginitdeferred=','actual.tgenabled=\'O\''])assert(r.tableChecks.includes(field),field);
});
test('208 recursively called owned/legacyhelpers are pinned once, unknown oldbody drift refuses SOURCE rather than wildcarding',()=>{
 const pinned=new Set([...r.own,...r.dependencies,...r.forward.cores,r.forward.guard].map(f=>f.name));pinned.add('faolla_valid_merchant_enterprise_permissions_v1');
 for(const f of functions)for(const [,name]of f.body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))assert(pinned.has(name),f.name+':'+name);
 assert(!r.dependencies.some(f=>'body' in f||'oldBody' in f||'newBody' in f));assert.equal(new Set(r.dependencies.map(f=>f.name)).size,r.dependencies.length);
 const changed=migrations.map(m=>m.name==='202610010095_merchant_attendance_revision_cycles.sql'?{...m,text:m.text.replace("r:=public.faolla_attendance_revision_owner_review_v3(p_site_id,p_auth_user_id,p_request_id);","r:=null;")}:m);
 assert.throws(()=>delegatedRevisionsForwardRecipes(changed));
});
