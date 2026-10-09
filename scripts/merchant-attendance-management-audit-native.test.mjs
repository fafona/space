import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {attendanceNativeConnectionLifetime} from './merchant-attendance-native-connections.mjs';
import {independentPermissionAclConflictSql,independentPermissionAclMatches} from './merchant-attendance-independent-installation.mjs';
import {managementAuditNativeLimits,managementAuditNativePins,managementAuditNativePrerequisites,managementAuditNativeSources,
 managementAuditNativeDependencySql,assertManagementAuditNativeDependencies,managementAuditNativeInspectionSql,
 assertManagementAuditNativeOldState,installAndVerifyManagementAuditNative,managementAuditNativeLegacyPins,managementAuditNativeLegacySources,
 managementAuditNativeLegacyFunctionsSql,installManagementAuditNativeAuditPrerequisites} from './merchant-attendance-management-audit-native.mjs';
import {managementAuditNativeSite,managementAuditNativeIds,managementAuditNativePermissions,managementAuditNativeGroups,
 managementAuditNativeRpcExpression,managementAuditNativeFaultSql,managementAuditNativeCatalogSql} from './fixtures/attendance-management-audit-native.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),sources=managementAuditNativeSources(root);
const adapter=readFileSync(new URL('./merchant-attendance-management-audit-native.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-management-audit-native.mjs',import.meta.url),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('202→203 adapter and fixture import are inert; invalid owned context opens nothing',async()=>{
 for(const source of [adapter,fixture])assert(!/child_process|pg_ctl|createDatabase|createBrowser|new Pool|process\.env|runAdministrativeClosureNative|runPeriodDelegatedClosureNative/.test(source));
 let calls=0;await assert.rejects(()=>installAndVerifyManagementAuditNative({native:{query:()=>{calls++;}}}),/owned_context/);assert.equal(calls,0);
 assert(!adapter.includes('process.argv'));assert(!fixture.includes('process.argv'));
});

test('202203 explicit install-only options are validated before reading the owned context',async()=>{
 let reads=0;const ctx={get d(){reads++;throw new Error('synthetic_context_read');}};
 for(const options of [{businessCases:'unknown'},{businessCases:false},{unexpected:true},null,[],false,1,'skip'])
  await assert.rejects(()=>installAndVerifyManagementAuditNative(ctx,options),/management_audit_native_(?:options|business_cases)_invalid/);
 assert.equal(reads,0);
 for(const options of [{},{businessCases:'run'},{businessCases:'skip'}])
  await assert.rejects(()=>installAndVerifyManagementAuditNative(ctx,options),/synthetic_context_read/);
 await assert.rejects(()=>installAndVerifyManagementAuditNative(ctx),/synthetic_context_read/);assert.equal(reads,4);
});

test('202203 skip does not import the business fixture or claim acceptance and keeps all installation and final guards',()=>{
 const entry=adapter.slice(adapter.indexOf('export async function installAndVerifyManagementAuditNative'));
 assert.match(entry,/businessCases='run'/);assert.match(entry,/let acceptance=null/);
 assert.match(entry,/try\{if\(businessCases==='run'\)acceptance=await \(await import\('\.\/fixtures\/attendance-management-audit-native\.mjs'\)\)/);
 assert.equal((entry.match(/import\(/g)||[]).length,1);
 assert.match(entry,/if\(businessCases==='run'\)\{assert\.equal\(acceptance\.groups\.length,8\)/);
 assert.match(entry,/businessCasesExecuted:businessCases==='run'/);assert.match(entry,/rollbackRestored:businessCases==='run'\?true:null/);
 const branch=entry.indexOf("try{if(businessCases==='run')"),final=entry.slice(entry.indexOf(' finally{',branch),entry.indexOf("\n if(businessCases==='run'){",branch));
 for(const token of ['assertManagementAuditNativeDependencies','assertManagementAuditNativeOldState(old,foundation',
  'management_audit202_reentry_facts_defs_catalog','assertManagementAuditNativeOldState(foundationBaseline,audit',
  'management_audit203_reentry_facts_defs_catalog'])assert(entry.indexOf(token)<branch&&entry.indexOf(token)>=0,token);
 for(const token of ['d.fingerprint(),facts','d.definitions(),defs','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive()),old155','periodContinuationArchiveBytes(await periodArchive()),old207'])assert(final.includes(token),token);
 assert.doesNotMatch(final,/businessCases|\breturn\b/);
});

test('explicit069080 owned setup is separate from202203, frozen read-only SOURCE only, and refuses foreign context before calls',async()=>{
 const legacy=managementAuditNativeLegacySources(root);
 assert.deepEqual(legacy.files.map(f=>f.name),Object.keys(managementAuditNativeLegacyPins));
 assert.equal(legacy.functions.length,3);assert.equal(legacy.indexes.length,2);
 for(const f of legacy.files){assert.equal(createHash('sha256').update(f.text).digest('hex'),managementAuditNativeLegacyPins[f.name]);
  const body=f.text.replace(/^insert into public\.faolla_schema_migrations\(version,name\) values\(2026093000(?:69|80),'merchant_attendance_audit_(?:read|export)'\) on conflict\(version\) do nothing;$/gm,'');
  assert(!/^\s*(?:insert into|update public\.|delete from|create table|alter table)/m.test(body));}
 assert.deepEqual(legacy.functions.filter(f=>f.isRpc).map(f=>f.name).sort(),['faolla_attendance_audit_export_v1','faolla_attendance_audit_v1']);
 assert(legacy.functions.every(f=>f.defaults===0&&f.searchPath==='search_path=pg_catalog'));
 let calls=0;await assert.rejects(()=>installManagementAuditNativeAuditPrerequisites({native:{query:()=>{calls++;}}}),/owned_context/);assert.equal(calls,0);
 const entry=adapter.slice(adapter.indexOf('export async function installAndVerifyManagementAuditNative'));
 assert(!entry.includes('installManagementAuditNativeAuditPrerequisites('));
 assert(adapter.includes('management_audit_legacy_fresh_registry'));assert(adapter.includes('management_audit_legacy_function_already_exists'));
 assert(adapter.includes('management_audit_legacy_index_already_exists'));assert(adapter.includes('assertManagementAuditNativeOldState(before,after)'));
 assert(adapter.includes('management_audit_legacy_no_new_business_tables'));
});

test('explicit069080 setup checks exact installed source and every function/ACL/default metadata, not only registry names',()=>{
 const sql=managementAuditNativeLegacyFunctionsSql(managementAuditNativeLegacySources(root).functions);
 for(const field of ['prosrc','proowner','prosecdef','proconfig','provolatile','prorettype','proretset','proisstrict','proleakproof','prokind','proparallel',
  'prosupport','proallargtypes','proargmodes','proargnames','pronargs','pronargdefaults','procost','prorows','aclexplode','is_grantable'])assert(sql.includes(field),field);
 assert(!/\b(insert|update|delete|create|alter|drop)\b/i.test(sql));
 assert.throws(()=>managementAuditNativeLegacyFunctionsSql([]));
});
test('finite eight-group budgets stay inside approved90RPC140SQL120s and existing90s connection',()=>{
 assert.equal(managementAuditNativeGroups.length,8);assert.equal(managementAuditNativeGroups.reduce((n,g)=>n+g.rpcs,0),90);
 assert.equal(managementAuditNativeGroups.reduce((n,g)=>n+g.steps,0),122);
 assert.equal(managementAuditNativeLimits.rpcs,90);assert.equal(managementAuditNativeLimits.steps,140);assert.equal(managementAuditNativeLimits.installationSteps,20);
 assert.equal(managementAuditNativeLimits.transactionMs,90000);assert(managementAuditNativeLimits.transactionMs<=managementAuditNativeLimits.approvedMaximumMs);
 assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:managementAuditNativeLimits.transactionMs}),90000);
 for(const key of ['newClusters','newDatabases','microcommits','browser'])assert.equal(managementAuditNativeLimits[key],0);
 assert.equal(managementAuditNativeLimits.connections,1);assert.equal(managementAuditNativeLimits.seedRows,20);assert.equal(managementAuditNativeSite,'99990203');
 assert.equal((fixture.match(/native\.connect\(/g)||[]).length,1);assert(!/\bcommit;/.test(fixture));
});
test('both installed SOURCE bodies are explicitly frozen;202 before203 only, no200dependency',()=>{
 for(const source of [sources.foundation,sources.audit])assert.equal(createHash('sha256').update(source.text,'utf8').digest('hex'),managementAuditNativePins[source.name]);
 assert.equal(managementAuditNativePrerequisites.length,8);assert(managementAuditNativePrerequisites.some(p=>p.version===202610080196));
 assert(managementAuditNativePrerequisites.some(p=>p.version===202610080198));assert(managementAuditNativePrerequisites.some(p=>p.version===202610080199));
 assert(!managementAuditNativePrerequisites.some(p=>[202610080200,202610080201].includes(p.version)));
 assert(adapter.indexOf('install(managementDelegationMigration)')<adapter.indexOf('install(delegatedAuditMigration)'));
 assert(!adapter.slice(adapter.indexOf('install(delegatedAuditMigration)')).includes('install(managementDelegationMigration)'));
});
const validInventory=()=>({alreadyInstalled:[],registry:managementAuditNativePrerequisites.map(p=>({version:p.version,expected:p.name,actual:p.name})),
 functions:Array.from({length:5},(_,n)=>({signature:'p'+n,actualHash:'a'.repeat(64),expectedHash:'a'.repeat(64),failedFields:[]}))});
test('single read-only preflight exposes all exact prerequisite metadata failures, rejects drift and backwards installation',()=>{
 const sql=managementAuditNativeDependencySql(sources);for(const p of managementAuditNativePrerequisites)assert(sql.includes(String(p.version)));
 for(const field of ['proowner','prosecdef','proconfig','provolatile','prorettype','proretset','proisstrict','proleakproof','prokind','proparallel','prosupport','proallargtypes','proargmodes','proargnames','pronargs','pronargdefaults','procost','prorows','aclexplode','actualHash','expectedHash'])assert(sql.includes(field));
 assert(sql.includes("spec ? 'legacyHash'"));assert(!/\b(insert|update|delete|create|alter|drop)\b/i.test(sql));
 assert.deepEqual(assertManagementAuditNativeDependencies(validInventory()),validInventory());
 const missing=validInventory();missing.registry[3].actual=null;assert.throws(()=>assertManagementAuditNativeDependencies(missing),/registry/);
 const drift=validInventory();drift.functions[2].failedFields=['source_hash'];assert.throws(()=>assertManagementAuditNativeDependencies(drift),/body_metadata/);
 const backwards=validInventory();backwards.alreadyInstalled=[202610080203];assert.throws(()=>assertManagementAuditNativeDependencies(backwards),/forward_order/);
 const auditSql=managementAuditNativeDependencySql(sources,{audit:true});assert(auditSql.includes('202610080202'));assert(auditSql.includes(sources.auditRecipe.forwardRecipe.oldHash));
 assert(auditSql.includes(sources.foundationRecipe.recipe.forward.capture.newHash));assert(auditSql.includes(sources.foundationRecipe.recipe.forward.catalog185.newHash));
 const complete=validInventory();complete.functions=Array.from({length:19},(_,n)=>({...complete.functions[0],signature:'p'+n}));
 complete.registry.push({version:202610080202,expected:'merchant_attendance_management_delegations',actual:'merchant_attendance_management_delegations'});
 assertManagementAuditNativeDependencies(complete,{audit:true});assert.throws(()=>assertManagementAuditNativeDependencies(complete));
});
test('inspection and old-state comparison protect oldfacts/registry/functionOIDACLdefaults/table/indexOID, allowing only named bodies',()=>{
 const sql=managementAuditNativeInspectionSql(['merchants','faolla_schema_migrations','merchant_attendance_settings'],123);
 for(const text of ["'facts'","'registry'","'functions'","'tables'","'indexes'",'pg_get_functiondef','pg_get_constraintdef','pg_get_triggerdef','pg_get_indexdef','to_jsonb(proc)',"'defaultExpression',pg_get_expr(proc.proargdefaults,0)"])assert(sql.includes(text));
 assert.throws(()=>managementAuditNativeInspectionSql(['unsafe;drop'],123));
 const state=()=>({facts:'f',registry:[{version:1,name:'old'}],functions:[{oid:2,name:'old_fn',metadata:{proacl:['x'],pronargdefaults:1,proargdefaults:'{CONST :constvalue false :location 162}'},defaultExpression:'false',definition:'old'}],tables:[[3,'old_table']],indexes:[[4,'old_index']]});
 assertManagementAuditNativeOldState(state(),state());const body=state();body.functions[0].definition='new';
 assert.throws(()=>assertManagementAuditNativeOldState(state(),body),/unapproved/);assertManagementAuditNativeOldState(state(),body,['old_fn']);
 const position=state();position.functions[0].metadata.proargdefaults='{CONST :constvalue false :location 164}';
 assert.throws(()=>assertManagementAuditNativeOldState(state(),position),/metadata_ACL_defaults/);
 assertManagementAuditNativeOldState(state(),position,['old_fn']);
 const expression=state();expression.functions[0].defaultExpression='true';
 assert.throws(()=>assertManagementAuditNativeOldState(state(),expression,['old_fn']),/default_expression/);
 const count=state();count.functions[0].metadata.pronargdefaults=2;
 assert.throws(()=>assertManagementAuditNativeOldState(state(),count,['old_fn']),/metadata_ACL_defaults/);
 for(const field of [undefined,12,{},[]]){const malformed=state();malformed.functions[0].defaultExpression=field;
  assert.throws(()=>assertManagementAuditNativeOldState(state(),malformed,['old_fn']),/default_expression_required/);}
 const absent=state();delete absent.functions[0].defaultExpression;
 assert.throws(()=>assertManagementAuditNativeOldState(absent,absent,['old_fn']),/default_expression_required/);
 const noDefaults=state();noDefaults.functions[0].metadata.pronargdefaults=0;noDefaults.functions[0].metadata.proargdefaults=null;noDefaults.functions[0].defaultExpression=null;
 assertManagementAuditNativeOldState(noDefaults,noDefaults,['old_fn']);
 for(const key of ['tables','indexes']){const changed=state();changed[key][0][0]++;assert.throws(()=>assertManagementAuditNativeOldState(state(),changed),/OID_catalog/);}
 const acl=state();acl.functions[0].metadata.proacl=[];assert.throws(()=>assertManagementAuditNativeOldState(state(),acl,['old_fn']),/metadata_ACL/);
 const row=state();row.registry=[];assert.throws(()=>assertManagementAuditNativeOldState(state(),row),/registry_row/);
});

test('202 dependency ACL diagnostics mirror196 exact catalog-only inherited ACL, rejecting additions and grant options',()=>{
 const sql=managementAuditNativeDependencySql(sources);
 assert(sql.includes("case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then "+independentPermissionAclConflictSql('proc','owned.relowner')));
 const owner=10,row=grantee=>({grantor:owner,grantee,privilege_type:'EXECUTE',is_grantable:false});
 assert(independentPermissionAclMatches([row(owner)],owner,true));
 assert(independentPermissionAclMatches([row(0),row(owner)],owner,true));
 assert(!independentPermissionAclMatches([row(0),row(owner),row(20)],owner,true));
 assert(!independentPermissionAclMatches([{...row(0),is_grantable:true},row(owner)],owner,true));
 assert(!/\b(?:grant|revoke)\s+(?:all|execute)/i.test(sql));
});

test('complete server-side definition SHA keeps the existing2MB transport bound without truncation or losing tail changes',()=>{
 const sql=managementAuditNativeInspectionSql(['merchants','faolla_schema_migrations','merchant_attendance_settings'],123);
 assert(sql.includes("'definition',encode(sha256(convert_to(pg_get_functiondef(proc.oid),'UTF8')),'hex')"));
 assert(sql.includes("'metadata',to_jsonb(proc)-'prosrc'"));
 assert(!sql.includes("'definition',pg_get_functiondef(proc.oid)"));
 assert(!/\b(?:substring|left|right)\s*\(/i.test(sql));
 const digest=text=>createHash('sha256').update(text).digest('hex'),large='synthetic complete body '.repeat(100000);
 const state=definition=>({facts:'f',registry:[],functions:[{oid:1,name:'old',metadata:{proacl:['owner'],pronargdefaults:0,proargdefaults:null},defaultExpression:null,definition:digest(definition)}],tables:[],indexes:[]});
 const before=state(large+'a'),after=state(large+'b');
 assert.throws(()=>assertManagementAuditNativeOldState(before,after),/unapproved_old_body/);
 assertManagementAuditNativeOldState(before,state(large+'a'));
 assertManagementAuditNativeOldState(before,after,['old']);
 assert.equal(before.functions[0].definition.length,64);
});
test('actual Node coordinator bridge accepts only exact202203 RPC names, flags and synthetic namespace',()=>{
 for(const [name,flag] of [['faolla_attendance_management_delegations_v1','p_allow_grant'],['faolla_attendance_delegated_audit_v1','p_allow_access']]){
  const args={p_query:{siteId:managementAuditNativeSite,mode:'recover',operationId:uid(1)},p_auth_user_id:uid(2),p_command:null,[flag]:false};
  assert.match(managementAuditNativeRpcExpression(name,args),new RegExp('^public\\.'+name+'\\('));
  assert.throws(()=>managementAuditNativeRpcExpression(name,{...args,owner:true}));
  assert.throws(()=>managementAuditNativeRpcExpression(name,{...args,[flag]:1}));
  assert.throws(()=>managementAuditNativeRpcExpression(name,{...args,p_query:{...args.p_query,siteId:'12345678'}}));
 }
 assert.throws(()=>managementAuditNativeRpcExpression('faolla_attendance_admin_v1',{}));
});
test('new-owned-only late AFTER sidecar fault never disables or rewrites a real guard',()=>{
 const sql=managementAuditNativeFaultSql(uid(1));assert(sql.includes('create function public.synthetic203_owned_late_export_fault_v1()'));
 assert(sql.includes('after insert on public.merchant_attendance_management_delegation_operations'));
 assert(sql.includes("raise exception 'synthetic203_late_sidecar_failure'"));assert(sql.includes("new.merchant_id='99990203'"));
 assert(!/disable trigger|drop trigger|alter function|create or replace|session_replication_role/.test(sql));
 assert.throws(()=>managementAuditNativeFaultSql(uid(1),'12345678'));
 assert(fixture.includes("save('ma203_late_fault')"));assert(fixture.includes("restore('ma203_late_fault',fault)"));
 assert(fixture.includes('late_failure_zero_export_and_authority'));assert(fixture.includes('fault_catalog_exactly_restored'));
 const catalog=managementAuditNativeCatalogSql(123);for(const part of ['to_jsonb(proc)','pg_get_functiondef','pg_attribute','pg_constraint','pg_trigger','pg_index','relacl','relrowsecurity'])assert(catalog.includes(part));
 assert(fixture.includes("'ma203_fault_catalog_not_exact'"));assert.throws(()=>managementAuditNativeCatalogSql('123;drop'));
});
test('SOURCE uses real owner202grant/203Nodeprojector/CSV and old064066actual sources, not direct receipt or epoch seeds',()=>{
 for(const text of ['executeManagementDelegation','executeDelegatedAudit','buildDelegatedAuditCsv','delegatedAuditCommandFingerprint','faolla_attendance_admin_v1','faolla_attendance_scopes_v1'])assert(fixture.includes(text));
 assert.equal((fixture.match(/insert into public\./g)||[]).length,3); //merchant,roles,employees only
 assert(!/insert into public\.merchant_attendance_(?:management|account|config|scope)/.test(fixture));
 assert(!/update public\.merchant_attendance_account_epochs|set generation|fakeowner|ownerproxy/.test(fixture));
 assert.deepEqual(managementAuditNativePermissions.full,['enterprise.view','attendance.records.view','attendance.audit.view','attendance.audit.export']);
 assert(!managementAuditNativePermissions.view.includes('attendance.audit.export'));
 assert(!managementAuditNativePermissions.plain.includes('attendance.audit.view'));
 for(const permission of ['attendance.self.view','attendance.self.clock'])assert(managementAuditNativePermissions.plain.includes(permission));
 assert.equal(new Set(Object.values(managementAuditNativeIds)).size,Object.values(managementAuditNativeIds).length);
});
test('real dual generation suspension and same-identity restore keeps old grants stale; no fabricated epochs',()=>{
 for(const text of ['faolla_update_merchant_enterprise_employee_v1','attendance_suspension_enabled','offboarding_mode','actual_two_epoch_generations','e.generation===1','faolla_attendance_account_suspensions_v1','expectedGeneration:1','current.item.authorityCurrent,false','old_grant_does_not_rewrite_generations'])assert(fixture.includes(text));
 assert(fixture.includes("status(p.delegate,'disabled')"));assert(fixture.includes("status(p.employeeA,'disabled')"));
 assert(fixture.includes('expectedWorkerVersion:prepared.detail.workerVersion'));assert(fixture.includes('expectedEmployeeVersion:prepared.detail.employeeVersion'));
});
test('finite negative/current-role/whole-snapshot and originalactor receipt-only recovery are represented',()=>{
 for(const text of ['scopeMixed','scopeElsewhere','ma203_move','workerB','attendance_audit_not_found','p.authA','siteId:d.site','ma203_handover',
  'attendance_management_delegation_scope_invalid','attendance_delegated_audit_disabled','attendance_operation_conflict',"result.kind,'receipt'",'!Object.hasOwn(result,\'payload\')',
  "validFrom:profile.until","capacitySentinels:'SOURCE/pure-only; no bulk native matrix'"])assert(fixture.includes(text),text);
 assert(fixture.includes("await step('rollback','rollback;')"));assert(fixture.includes('finally{await connection.close();}'));
 assert(fixture.includes('ma203_other_scope_added'));assert(fixture.includes('ma203_old_row_changed'));
});
