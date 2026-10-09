//202 SOURCE-only checks. No SQL parser/PG, configured Auth, KDF or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {independentPermissionAclConflictSql} from './merchant-attendance-independent-installation.mjs';
import {managementDelegationMigration,managementDelegationTables,managementDelegationCapabilities,
 managementDelegationForwardRecipes,managementDelegationApplyForward,managementDelegationInstallRecipe,
 managementDelegationFreezeSql,managementDelegationOwnManifest} from './merchant-attendance-management-delegation-source.mjs';
const directory=new URL('./supabase-migrations/',import.meta.url),sql=readFileSync(new URL(managementDelegationMigration,directory),'utf8');
const migrations=readdirSync(directory).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<managementDelegationMigration).sort().map(name=>({name,text:readFileSync(new URL(name,directory),'utf8')}));
const byPrefix=n=>migrations.find(m=>m.name.startsWith(n)).text;
const forward=managementDelegationForwardRecipes({legacyCatalog:byPrefix('202610080185_'),currentCatalog:byPrefix('202610080190_'),capture:byPrefix('202610080189_')});
const recipe=managementDelegationInstallRecipe(sql,migrations),own=managementDelegationOwnManifest(sql),body=n=>dayReviewSqlFunctions(sql).find(f=>f.name===n).body;
test('202 SOURCE generator is deterministic/idempotent and owns13 functions,3 private tables,4 indexes only',()=>{
 assert.equal(managementDelegationFreezeSql(sql,migrations),sql);assert.equal(recipe.ownCount,13);assert.equal(own.length,13);
 assert.deepEqual(managementDelegationTables,['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations']);
 assert.equal((sql.match(/^create table if not exists public\./gm)||[]).length,3);assert.equal((sql.match(/^create index if not exists /gm)||[]).length,4);
 assert(!sql.includes('source_not_frozen'));assert.equal(own.filter(f=>f.isRpc).length,1);assert.equal(own.filter(f=>f.isRpc)[0].name,'faolla_attendance_management_delegations_v1');
 assert.equal(own.find(f=>f.isRpc).defaultExpression,'NULL::jsonb, false');
});
test('202 exactly14 finite new catalog literals retain every185|190 predecessor body byte outside one known insertion',()=>{
 assert.equal(managementDelegationCapabilities.length,14);assert.equal(new Set(managementDelegationCapabilities).size,14);
 for(const predecessor of[forward.catalog185,forward.catalog190]){
  assert.equal(predecessor.changes.length,1);assert.equal(predecessor.changes[0].count,1);
  assert.equal(managementDelegationApplyForward(predecessor.oldBody,predecessor),predecessor.newBody);
  for(const c of managementDelegationCapabilities)assert.equal(predecessor.newBody.split("('"+c+"', array['enterprise.view']::text[]),").length-1,1);
  assert.equal(predecessor.newBody.replace(predecessor.changes[0].to,predecessor.changes[0].from),predecessor.oldBody);
 }
 assert.throws(()=>managementDelegationApplyForward(forward.catalog190.oldBody+' ',forward.catalog190));
 assert(!/update public\.merchant_enterprise_roles|insert into public\.merchant_enterprise_roles|add_default/i.test(sql));
});
test('202 sole other shared forward changes exactly the two189 workerless pause early-return checks, preserving real generations/FKs',()=>{
 const f=forward.capture;assert.equal(f.changes.length,1);assert.equal(f.changes[0].count,2);
 assert.equal(managementDelegationApplyForward(f.oldBody,f),f.newBody);
 assert.equal(f.newBody.split('from public.merchant_attendance_management_delegations x').length-1,2);
 assert.equal(f.newBody.split(f.changes[0].to).join(f.changes[0].from),f.oldBody);
 for(const m of['gen:=coalesce(ep.generation,0)+1','merchant_attendance_account_suspensions','merchant_attendance_account_epochs','if ep.paused then return ep.suspension_id'])assert(f.newBody.includes(m),m);
 assert(!/create (?:or replace )?function public\.(?!faolla_attendance_management_)/.test(sql));
 assert(!/update public\.merchant_attendance_(?:events|account_epochs)|session_replication_role|disable trigger/.test(sql));
});
test('202 installation exact dependencies + shared OID/ACL/owner/default/metadata pin precede DDL, reentry never silently repairs',()=>{
 assert.equal(recipe.dependencies.length,3);
 for(const n of['202610080196','202610080198','202610080199','202610080189'])assert(recipe.preflight.includes(n));
 for(const m of['management_dependencies','management_own_manifest','management_forward_manifest','meta.proargmodes','meta.prosupport','meta.proparallel',
  'meta.procost','meta.pronargdefaults','pg_get_expr(meta.proargdefaults,0)','has_function_privilege','aclexplode','meta.prosrc','constraint_spec.convalidated',
  'actual_index.indisvalid','actual_index.indisready','actual_index.indislive','management_insert_guard','original.metadata'])assert((recipe.preflight+recipe.final).includes(m),m);
 assert(sql.indexOf('do $management_preflight$')<sql.indexOf('create or replace function public.faolla_attendance_management_scalar_v1'));
 assert(sql.indexOf('do $management_two_forwards$')<sql.indexOf('do $management_postconditions$'));
 assert(recipe.forward.includes('if installed then return;end if;'));assert(recipe.final.includes("to_jsonb(proc)-'prosrc'"));
 assert(recipe.final.includes('drop table pg_temp.management_shared_metadata'));
});
test('202 TEMP parser templates reference TEMP parents only and private tables have exact column/constraint/index/trigger/RLS protection',()=>{
 const temp=recipe.preflight.slice(recipe.preflight.indexOf('create temp table management_expected_settings'),recipe.preflight.indexOf('do $management_preflight$'));
 assert(!/references public\./.test(temp));assert(temp.includes('references pg_temp.management_expected_employees'));
 assert(temp.includes('references pg_temp.merchant_attendance_management_delegations'));assert(temp.includes('id uuid,merchant_id text'));
 for(const m of['actual.attcollation','actual.attidentity','actual.attgenerated','actual.attisdropped','actual_constraint.confkey','actual_constraint.confrelid',
  'actual_constraint.confdeltype','pg_get_expr(actual_constraint.conbin','actual_index.indclass','actual_index.indoption','actual.tgnargs','actual.tgqual',
  'actual.tgdeferrable','actual.tginitdeferred','::name','relrowsecurity','pg_policy','attribute.attacl'])assert(recipe.preflight.includes(m),m);
 assert(!/foreign key.*references public\./.test(temp));
});

test('202 retains the two exact196 inherited catalog ACL shapes without granting or skipping other function ACLs',()=>{
 const exact=independentPermissionAclConflictSql('meta','expected_owner');
 for(const block of [recipe.preflight,recipe.final]){
  assert(block.includes("or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then "+exact));
  assert(block.includes("acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)\n   then raise"));
  assert(block.includes("else has_function_privilege('anon',f,'EXECUTE')"));
  assert(!/\b(?:grant|revoke)\s+(?:all|execute)/i.test(block));
 }
 assert(recipe.final.includes("(to_jsonb(proc)-'prosrc') is distinct from original.metadata"));
});
test('202 scopes preserve exact23 action/key families, explicit reviewRouting, double identity and real independent subject generation',()=>{
 const scope=body('faolla_attendance_management_scope_v1'),cap=body('faolla_attendance_management_capability_v1');
 assert.equal((cap.match(/when '[a-z_]+' then 'attendance\./g)||[]).length,23);
 for(const m of['allowedRuleKeys','correctionWindow','reviewRouting','timesheetCycle','reminders','lateGraceMinutes','completedBreakMinimumMinutes',
  'independent_pin','subjectId','generation','group_worker','assignmentId','audit_company','management_binding_v1'])assert(scope.includes(m),m);
 assert(!scope.includes('devicePolicy'));assert(!scope.includes('exceptionPolicy'));
 assert(scope.includes('null,1,25'));assert(scope.includes('null,0,25'));assert(scope.includes("array['config','management']"));
 assert(body('faolla_attendance_management_command_v1').includes("not in('audit_view','audit_export')"));
});
test('202 grants are explicit action/resource only; normal current view never substitutes future family actual eligibility',()=>{
 const context=body('faolla_attendance_management_scope_context_v1'),current=body('faolla_attendance_management_current_v1');
 for(const m of['employee.auth_user_id=g.delegate_auth_user_id',"employee.status='active'",'g.delegate_generation<>coalesce','epoch.paused',
  'actual.user_id=g.actor_auth_user_id','g.employee_auth_user_id,g.employee_generation','at_time>=g.valid_until'])assert(current.includes(m),m);
 assert(context.includes("sub.state<>'independent'"));assert(context.includes('sub.generation<>'));assert(context.includes('w.employee_id is distinct from e.id'));
 assert(!context.includes('not w.active'));assert(!context.includes("e.status<>'active'"));assert(!context.includes('employee_version'));
 assert(sql.includes('attendance_management_executor_unavailable'));assert(!/faolla_attendance_(?:revision_decide|plan_exception_posthoc_review|terminal_device|pin_clock)_/.test(sql));
});
test('202 original actor GET and exact SHA/body POST receipts precede all current authority/rollout checks and recheck after settings wait',()=>{
 const rpc=body('faolla_attendance_management_delegations_v1');
 const recover=rpc.indexOf("if mode='recover' then\n  receipt:="),owner=rpc.indexOf('perform 1 from public.merchants actual'),replay=rpc.indexOf('select actor_auth_user_id,command into stored_actor,stored');
 assert(recover>0&&recover<owner);assert(replay>recover&&replay<owner);
 assert.equal((rpc.match(/stored_actor is distinct from p_auth_user_id or stored is distinct from p_command/g)||[]).length,2);
 assert.equal((rpc.match(/receipt->>'commandFingerprint' is distinct from fingerprint/g)||[]).length,2);
 assert.equal((rpc.match(/select actor_auth_user_id,command into stored_actor,stored/g)||[]).length,2);
 assert(rpc.indexOf('p_allow_grant is distinct from true')>rpc.lastIndexOf('select actor_auth_user_id,command into stored_actor,stored'));
 assert(rpc.includes('p_allow_grant and settings_enabled'));assert(rpc.includes('limit 26'));
 const receipt=body('faolla_attendance_management_receipt_v1');assert(receipt.includes('actual.actor_auth_user_id=actor'));assert(!receipt.includes("'scope'"));assert(!receipt.includes("'command'"));
});
test('202 pending/public command SHA and output contain no PIN, material, pairing secret or arbitrary executor payload',()=>{
 const command=body('faolla_attendance_management_command_v1'),hash=body('faolla_attendance_management_hash_v1'),rpc=body('faolla_attendance_management_delegations_v1');
 assert(hash.includes("'attendance-management-delegation-command-v1',site,actor"));
 for(const text of[command,hash,rpc])assert(!/salt|verifier|pairSecret|deviceSecret|p_material|\bpin\s*[:=]/.test(text));
 assert(sql.includes('grant execute on function public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean) to service_role'));
 assert(!/grant (?:select|insert|update|delete|all) on public\.merchant_attendance_management/.test(sql));
});
test('202 source recipe freezes all13 own body hashes without claiming PostgreSQL installation or family completion',()=>{
 for(const f of own)assert.equal(f.hash,createHash('sha256').update(dayReviewSqlFunctions(sql).find(s=>s.signature===f.signature).body,'utf8').digest('hex'));
 assert.equal(own.filter(f=>f.definer).length,2);assert.equal(own.filter(f=>f.isRpc).length,1);
 assert(sql.includes('NO seven-family executor'));assert(sql.includes('No blanket target-active guard'));
 assert(!/execSync|spawn|connect\(|query\(/.test(readFileSync(new URL('./merchant-attendance-management-delegation-source.mjs',import.meta.url),'utf8')));
});
