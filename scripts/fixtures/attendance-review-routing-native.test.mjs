import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installAndVerifyReviewRoutingNative,reviewRoutingNativeLimits,reviewRoutingNativeTables,reviewRoutingNativeMigration,installReviewRoutingNativePrerequisite,reviewRoutingNativePrerequisite,reviewRoutingNativeDependencyDiagnosticSql,assertReviewRoutingNativeDependencies,installReviewRoutingNativeKioskPrerequisite,reviewRoutingNativeKioskPrerequisiteSources,reviewRoutingNativeKioskPrerequisite} from '../merchant-attendance-review-routing-native.mjs';
import {boundClockFixtureMigrations} from './attendance-bound-clocks-native.mjs';
import {fileURLToPath} from 'node:url';
import {reviewRoutingNativeRpcExpression,reviewRoutingNativeIds,reviewRoutingNativePermissions,reviewRoutingNativeApplicationCommand,reviewRoutingNativeSourceRoleProjection} from './attendance-review-routing-native.mjs';
import {reviewRoutingNativePermissionPrerequisite,reviewRoutingNativePermissionSources,installReviewRoutingNativePermissionPrerequisite} from '../merchant-attendance-review-routing-native.mjs';

test('198 native adapter requires the existing caller-owned context and imports without creating resources',async()=>{
 await assert.rejects(installAndVerifyReviewRoutingNative(),/review_routing_owned_context_required/);
 await assert.rejects(installAndVerifyReviewRoutingNative({d:{syntheticOnly:false},h:{syntheticOnly:true}}),/review_routing_owned_context_required/);
 assert.deepEqual(reviewRoutingNativeLimits,{groups:8,steps:150,transactionMs:90000,newClusters:0,browser:0});
 assert.deepEqual(reviewRoutingNativeTables,['merchant_attendance_review_responsibility_entries','merchant_attendance_review_responsibility_heads']);
 assert.equal(new Set(Object.values(reviewRoutingNativeIds)).size,6);
 assert(reviewRoutingNativePermissions.full.includes('attendance.self.view'));
 assert.deepEqual(reviewRoutingNativePermissions.correctionOnly,['enterprise.view','attendance.correction.review']);
});
test('198 native original application commands use production parsers and millisecond intervals',()=>{
 const input={operationId:reviewRoutingNativeIds.role,workerId:reviewRoutingNativeIds.delegate,settingsVersion:1,policyRevision:0,timeZone:'UTC',date:'2026-10-12',reason:'Synthetic198 test'};
 for(const family of ['leave','work_arrangement']){const c=reviewRoutingNativeApplicationCommand(family,input);assert.equal(c.startAt,'2026-10-12T05:00:00.000Z');assert.equal(c.endAt,'2026-10-12T06:00:00.000Z');
  assert.equal(c.expectedWorkerId,input.workerId);assert.equal(c.action,'submit');assert.equal(Object.hasOwn(c,'kind'),family==='work_arrangement');}
 assert.throws(()=>reviewRoutingNativeApplicationCommand('unknown',input));assert.throws(()=>reviewRoutingNativeApplicationCommand('leave',{...input,date:'2026-02-30'}));
});

test('198 six-family setup gives only the inherited synthetic source its missing self-work permission and still protects the exact role',()=>{
 const source=readFileSync(new URL('./attendance-review-routing-native.mjs',import.meta.url),'utf8');
 assert.equal(reviewRoutingNativeSourceRoleProjection('merchant_enterprise_employees'),'to_jsonb(x)');
 const projection=reviewRoutingNativeSourceRoleProjection('merchant_enterprise_roles');
 assert(projection.includes("to_jsonb(x)=current_setting('faolla.rr198_source_role')::jsonb->'after'"));
 assert(projection.includes("then current_setting('faolla.rr198_source_role')::jsonb->'before' else to_jsonb(x) end"));
 assert.throws(()=>reviewRoutingNativeSourceRoleProjection('roles;drop'));
 for(const token of ["permissions||array['attendance.self.work_arrangement']","before_role-array['permissions','updated_at','version']",'rr198_source_role_setup_changed_other_field',
  'rr198_source_role_setup_wrong_version','rr198_source_role_setup_wrong_timestamp',"then 0 else 1 end)","source_role.updated_at else now() end",
  'rr198_source_role_setup_wrong_permission',"syntheticSourceRoleSetup:{capability:'attendance.self.work_arrangement'",'exactBeforeAndAfterProtected:true,rollbackOnly:true'])assert(source.includes(token),token);
 assert(source.indexOf("perform set_config('faolla.rr198_originals'")<source.indexOf('before_role:=to_jsonb(source_role)'));
 assert(source.includes('assert.equal(d.fingerprint(),baseline)'));assert(source.includes("await step('rollback','rollback;')"));
 assert(!source.includes('disable trigger'));assert(!source.includes('attendance.self.work_arrangement\'\'=any'));
});
test('198 native adds only the missing189 prerequisite before its own baseline',()=>{
 assert.equal(reviewRoutingNativePrerequisite,'202610080189_merchant_attendance_correction_delegation.sql');
 const d={exec:()=> 'merchant_attendance_correction_delegation'};
 assert.equal(installReviewRoutingNativePrerequisite({d,native:null,scope:null}),false);
 assert.throws(()=>installReviewRoutingNativePrerequisite({d:{exec:()=> 'wrong_registry_name'},native:null,scope:null}),/review_routing189_registry_conflict/);
 const source=readFileSync(new URL('../merchant-attendance-review-routing-native.mjs',import.meta.url),'utf8');
 for(const token of ['review_routing189_original_capture_pin','review_routing189_changed_old_facts','review_routing189_changed_unapproved_function','review_routing189_changed_capture_OID_metadata'])assert(source.includes(token));
 assert(source.indexOf('const prerequisiteInstalled=installReviewRoutingNativePrerequisite(ctx)')<source.indexOf("const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts"));
});
test('198 native restores the omitted105 prerequisite with two exact old validator pins, not a weaker product pin',()=>{
 assert.equal(reviewRoutingNativeKioskPrerequisite,'202610010105_merchant_attendance_kiosk_correction_basis.sql');
 const index=boundClockFixtureMigrations.indexOf('202610010104_merchant_attendance_terminals.sql');
 assert.equal(boundClockFixtureMigrations[index+1],'202610010106_merchant_attendance_pin_credentials.sql');assert(!boundClockFixtureMigrations.includes(reviewRoutingNativeKioskPrerequisite));
 const pins=reviewRoutingNativeKioskPrerequisiteSources(fileURLToPath(new URL('../../',import.meta.url)));
 assert.equal(pins.length,2);assert(pins.every(p=>p.oldHash!==p.newHash));
 assert.equal(pins[1].newHash,'2523fe8ecf015e11b1b334bd1d9938b1b956bdeb47557c42e5b299c7eb1dae6e');
 assert.equal(installReviewRoutingNativeKioskPrerequisite({d:{exec:()=> 'merchant_attendance_kiosk_correction_basis'}}),false);
 assert.throws(()=>installReviewRoutingNativeKioskPrerequisite({d:{exec:()=> 'wrong'}}),/review_routing105_registry_conflict/);
 const source=readFileSync(new URL('../merchant-attendance-review-routing-native.mjs',import.meta.url),'utf8');
 for(const token of ['review_routing105_exact082_083_source_pins','review_routing105_changed_old_facts','review_routing105_changed_unapproved_function','review_routing105_changed_OID_metadata_ACL','review_routing105_final_source_pins'])assert(source.includes(token));
 assert(source.indexOf('const kioskPrerequisiteInstalled=installReviewRoutingNativeKioskPrerequisite(ctx)')<source.indexOf('const prerequisiteInstalled=installReviewRoutingNativePrerequisite(ctx)'));
});

test('198 native installs the omitted190 catalog before synthetic correction reviewer roles without relaxing the CHECK',()=>{
 assert.equal(reviewRoutingNativePermissionPrerequisite,'202610080190_merchant_attendance_correction_delegation_permission.sql');
 const root=fileURLToPath(new URL('../../',import.meta.url)),pins=reviewRoutingNativePermissionSources(root);
 assert.notEqual(pins.oldHash,pins.newHash);
 for(const [file,hash] of [['202610080185_merchant_attendance_period_delegations.sql',pins.oldHash],[reviewRoutingNativePermissionPrerequisite,pins.newHash]]){
  const sql=readFileSync(new URL('../supabase-migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  const body=sql.match(/create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;/i)[1];
  assert.equal(createHash('sha256').update(body).digest('hex'),hash);
  assert.equal(body.includes("('attendance.correction.review', array['enterprise.view']::text[])"),file===reviewRoutingNativePermissionPrerequisite);
 }
 assert.equal(installReviewRoutingNativePermissionPrerequisite({d:{exec:()=> 'merchant_attendance_correction_delegation_permission'}}),false);
 assert.throws(()=>installReviewRoutingNativePermissionPrerequisite({d:{exec:()=> 'wrong'}}),/review_routing190_registry_conflict/);
 const source=readFileSync(new URL('../merchant-attendance-review-routing-native.mjs',import.meta.url),'utf8');
 for(const token of ['review_routing190_exact185_source_pin','review_routing190_changed_old_facts','review_routing190_changed_unapproved_function','review_routing190_changed_OID_metadata_ACL','review_routing190_final_source_pin'])assert(source.includes(token));
 assert(source.indexOf('const prerequisiteInstalled=installReviewRoutingNativePrerequisite(ctx)')<source.indexOf('const permissionPrerequisiteInstalled=installReviewRoutingNativePermissionPrerequisite(ctx)'));
 assert(source.indexOf('const permissionPrerequisiteInstalled=installReviewRoutingNativePermissionPrerequisite(ctx)')<source.indexOf("const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts"));
 assert(!source.includes('drop constraint'));assert(!source.includes('alter table public.merchant_enterprise_roles'));
});
test('198 native exact RPC expressions preserve actual actor, boolean gates and162 notification argument',()=>{
 const a={p_query:{siteId:'99990001',mode:'recover',family:'leave',operationId:reviewRoutingNativeIds.role},p_auth_user_id:reviewRoutingNativeIds.delegateAuth,p_command:null,p_allow_write:false};
 const expression=reviewRoutingNativeRpcExpression('faolla_attendance_review_routing_v1',a);assert(expression.includes("'"+a.p_auth_user_id+"'"));assert.match(expression,/,null,false\)$/);
 assert.throws(()=>reviewRoutingNativeRpcExpression('faolla_attendance_review_routing_v1',{...a,actor:'spoof'}));
 assert.throws(()=>reviewRoutingNativeRpcExpression('faolla_attendance_review_routing_v1',{...a,p_allow_write:'true'}));
 assert.throws(()=>reviewRoutingNativeRpcExpression('faolla_attendance_correction_self_v1',a));
 assert.throws(()=>reviewRoutingNativeRpcExpression('faolla_attendance_review_routing_v1',{...a,p_query:{...a.p_query,siteId:'10000001'}}));
 assert.match(reviewRoutingNativeRpcExpression('faolla_attendance_application_delegations_v1',{...a,p_capture_notifications:false}),/,false,false\)$/);
 assert.throws(()=>reviewRoutingNativeRpcExpression('faolla_attendance_application_delegations_v1',a));
 assert.match(reviewRoutingNativeRpcExpression('faolla_attendance_operational_consumer_activation_v1',{p_query:{siteId:'99990001',consumer:'review_routing',mode:'current'},p_auth_user_id:a.p_auth_user_id,p_command:null,p_allow_activate:false}),/,null,false\)$/);
});
test('198 dependency diagnostic is read-only, exact finite manifest and returns no source or facts',()=>{
 const body=readFileSync(new URL('../supabase-migrations/'+reviewRoutingNativeMigration,import.meta.url),'utf8');
 for(const installed of [false,true]){
  const query=reviewRoutingNativeDependencyDiagnosticSql(body,{installed});
  assert.equal((query.match(/\('public\.faolla_attendance_/g)||[]).length,30);
  assert(query.includes(`case when ${installed} then '3b621cc8`));
  assert(!/\b(?:insert|update|delete|alter|create|drop|grant|revoke)\b/i.test(query));
  assert(query.includes("jsonb_build_object('signature',signature,'failedFields',failed_fields)"));
  for(const field of ['owner','security_definer','config','volatility','language','return_type','returns_set','strict','leakproof','defaults','argnames','source_hash','acl','anon_execute','authenticated_execute','service_execute'])assert(query.includes(`'${field}'`));
 }
 let calls=0;assertReviewRoutingNativeDependencies({d:{exec:()=>++calls===1?'f':'[]'},body});assert.equal(calls,2);
 calls=0;assert.throws(()=>assertReviewRoutingNativeDependencies({d:{exec:()=>++calls===1?'f':'[{"signature":"synthetic","failedFields":["language"]}]'},body}),/review_routing_dependency_metadata_mismatch.*synthetic.*language/);
 assert.throws(()=>reviewRoutingNativeDependencyDiagnosticSql('wrong'),/review_routing_preflight_required/);
});
test('198 native source pins limited acceptance, old facts/archive restoration and real original writers',()=>{
 const runner=readFileSync(new URL('../merchant-attendance-review-routing-native.mjs',import.meta.url),'utf8'),fixture=readFileSync(new URL('./attendance-review-routing-native.mjs',import.meta.url),'utf8');
 for(const token of ['native.query(scope.sql(body))','assertReviewRoutingNativeDependencies({d,body})','oldFunctions','oldMetadata','install();','await connection.close()',"await step('rollback','rollback;')",'prior(value)','rr198_unrelated_table_changed',"lifetimeMs:90000",'++steps<=150',"assert.equal(groups.length,8)","actualFamilies:['correction','correction_revision','missing','missing_revision','leave','work_arrangement']",'candidateCounts:[0,2,26]',"i<24",'candidate_reads_must_not_auto_register','manual_selected_grant_not_blocked_by_sentinel','actual_owner096_approve','actual082_manual_registration',"assert.equal(lastRpc.sqlstate,'23514')",'notHistoricalRpc:true','oldNumberExact:true','rr198_service_DML_not_denied','rr198_postgres_immutable_guard_not_denied'])assert((runner+fixture).includes(token),token);
 for(const source of [runner,fixture])assert(!/initdb|create\s+database|drop\s+database|process\.env|fetch\(|disable\s+trigger|runPeriodDelegatedClosureNative|runAdministrativeClosureNative/i.test(source));
 assert(!runner.includes('process.argv'),'root must explicitly compose owned ctx; no implicit CLI');
 const migration=readFileSync(new URL('../supabase-migrations/'+reviewRoutingNativeMigration,import.meta.url));
 assert.equal(createHash('sha256').update(migration).digest('hex').toUpperCase(),'84A0FCE6130C5B35F116E29FC56950549C9DB459B3C1FE8408EC00A2F7F5E9BE');
});
