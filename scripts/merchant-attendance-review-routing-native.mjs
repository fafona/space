//198 INERT. Receives the caller's already-owned native context; no cluster,
//schema, browser, old acceptance matrix or production connection is started.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';

export const reviewRoutingNativeMigration='202610080198_merchant_attendance_review_routing.sql';
export const reviewRoutingNativeTables=Object.freeze([
 'merchant_attendance_review_responsibility_entries','merchant_attendance_review_responsibility_heads',
]);
export const reviewRoutingNativeLimits=Object.freeze({groups:8,steps:150,transactionMs:90000,newClusters:0,browser:0});
export const reviewRoutingNativePrerequisite='202610080189_merchant_attendance_correction_delegation.sql';
export const reviewRoutingNativeKioskPrerequisite='202610010105_merchant_attendance_kiosk_correction_basis.sql';
export const reviewRoutingNativePermissionPrerequisite='202610080190_merchant_attendance_correction_delegation_permission.sql';
export function reviewRoutingNativePermissionSources(root){
 const source=file=>{const sql=readFileSync(path.join(root,'scripts/supabase-migrations',file),'utf8').replaceAll('\r\n','\n');
  const body=sql.match(/create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;/i)?.[1];assert(body,'review_routing190_source_required');
  return createHash('sha256').update(body).digest('hex');};
 return {oldHash:source('202610080185_merchant_attendance_period_delegations.sql'),newHash:source(reviewRoutingNativePermissionPrerequisite)};
}
//The195 parent has185, not190. Its correction-review capability is therefore
//not yet in the catalog. Install the actual approved190 prerequisite; never
//weaken the role CHECK or substitute a role that bypasses the review gate.
export function installReviewRoutingNativePermissionPrerequisite({d,native,scope}){
 const registered=d.exec("select coalesce((select name from public.faolla_schema_migrations where version=202610080190),'');");
 assert(['','merchant_attendance_correction_delegation_permission'].includes(registered),'review_routing190_registry_conflict');
 if(registered)return false;
 const pins=reviewRoutingNativePermissionSources(native.root),signature="'public.faolla_valid_merchant_enterprise_permissions_v1(text[])'::regprocedure";
 const sourceHash=()=>d.exec(`select encode(sha256(convert_to(replace(replace(prosrc,E'\\r\\n',E'\\n'),${quote(scope.schema+'.')},'pub'||'lic.'),'UTF8')),'hex') from pg_proc where oid=${signature};`);
 assert.equal(sourceHash(),pins.oldHash,'review_routing190_exact185_source_pin');
 const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(oldTables);
 const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const unaffected=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
  from pg_proc where oid=any(${quote(oldOids)}::oid[]) and oid<>${signature} and prokind='f';`);
 const metadata=()=>d.exec(`select jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0))::text from pg_proc p where oid=${signature};`);
 const definitions=unaffected(),before=metadata();assert(before);
 d.exec(boundClockMigrationBody(native.root,reviewRoutingNativePermissionPrerequisite));
 assert.equal(d.fingerprint(oldTables),facts,'review_routing190_changed_old_facts');assert.equal(unaffected(),definitions,'review_routing190_changed_unapproved_function');
 assert.equal(metadata(),before,'review_routing190_changed_OID_metadata_ACL');assert.equal(sourceHash(),pins.newHash,'review_routing190_final_source_pin');
 assert.equal(d.exec("select name from public.faolla_schema_migrations where version=202610080190;"),'merchant_attendance_correction_delegation_permission');
 native.pass('198 prerequisite190 installed only: exact185 catalog pin, approved capability helper, old facts/OID/ACL preserved; no repeated190 matrix');return true;
}
export function reviewRoutingNativeKioskPrerequisiteSources(root){
 const definitions=[['faolla_attendance_correction_basis_v1','text,uuid,uuid,uuid,uuid','202609300082_merchant_attendance_correction_requests.sql'],
  ['faolla_attendance_correction_owner_basis_v1','text,uuid,uuid,uuid,timestamptz','202609300083_merchant_attendance_correction_owner_review.sql']];
 const source=(file,name)=>{const sql=readFileSync(path.join(root,'scripts/supabase-migrations',file),'utf8').replaceAll('\r\n','\n');
  const body=sql.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,'i'))?.[1];assert(body,'review_routing105_source_required:'+name);return body;};
 return definitions.map(([name,types,file])=>({signature:`public.${name}(${types})`,oldHash:createHash('sha256').update(source(file,name)).digest('hex'),
  newHash:createHash('sha256').update(source(reviewRoutingNativeKioskPrerequisite,name)).digest('hex')}));
}
//The shared owned fixture intentionally installs104→106, omitting105. Its two
//private validators must be at the formal kiosk-capable source before198.
export function installReviewRoutingNativeKioskPrerequisite({d,native,scope}){
 const registered=d.exec("select coalesce((select name from public.faolla_schema_migrations where version=202610010105),'');");
 assert(['','merchant_attendance_kiosk_correction_basis'].includes(registered),'review_routing105_registry_conflict');if(registered)return false;
 const pins=reviewRoutingNativeKioskPrerequisiteSources(native.root),signatures=pins.map(p=>quote(p.signature)+'::regprocedure::oid').join(',');
 const sourcePins=()=>JSON.parse(d.exec(`select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'hash',encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),${quote(scope.schema+'.')},'pub'||'lic.'),'UTF8')),'hex')) order by p.proname)::text from pg_proc p where p.oid=any(array[${signatures}]);`));
 const actual=sourcePins();assert.deepEqual(actual.map(p=>p.hash),pins.map(p=>p.oldHash),'review_routing105_exact082_083_source_pins');
 const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(oldTables);
 const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const unaffected=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
  from pg_proc where oid=any(${quote(oldOids)}::oid[]) and oid<>all(array[${signatures}]) and prokind='f';`);
 const metadata=()=>d.exec(`select jsonb_agg(jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0)) order by oid)::text from pg_proc p where oid=any(array[${signatures}]);`);
 const definitions=unaffected(),before=metadata();assert(before);d.exec(boundClockMigrationBody(native.root,reviewRoutingNativeKioskPrerequisite));
 assert.equal(d.fingerprint(oldTables),facts,'review_routing105_changed_old_facts');assert.equal(unaffected(),definitions,'review_routing105_changed_unapproved_function');
 assert.equal(metadata(),before,'review_routing105_changed_OID_metadata_ACL');assert.deepEqual(sourcePins().map(p=>p.hash),pins.map(p=>p.newHash),'review_routing105_final_source_pins');
 assert.equal(d.exec("select name from public.faolla_schema_migrations where version=202610010105;"),'merchant_attendance_kiosk_correction_basis');
 native.pass('198 prerequisite105 installed only: exact082/083 pins, two private validators, old facts/OID/ACL preserved; no repeated105 matrix');return true;
}
//Read-only diagnostics use the product's exact finite manifest. They disclose
//only a function signature and failed field names, never body/source or data.
export function reviewRoutingNativeDependencyDiagnosticSql(body,{installed=false}={}){
 assert.equal(typeof installed,'boolean');
 const preflight=body.match(/do \$routing_preflight\$([\s\S]*?)\$routing_preflight\$;/)?.[1];assert(preflight,'review_routing_preflight_required');
 const manifest=preflight.match(/for expected in select \* from \(values\s*\n\s*\('public\.faolla_attendance_operational_rule_object_v1[\s\S]*?\) dependency\(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames\) loop/)?.[0];
 assert(manifest,'review_routing_dependency_manifest_required');
 const values=manifest.slice('for expected in select * from (values'.length,manifest.indexOf(') dependency(')).replaceAll('when installed then',`when ${installed} then`);
 return `with dependency(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) as (values ${values}),
 owned as(select n.nspname,c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass),
 checked as(select e.signature,array_remove(array[
 case when p.oid is null then 'missing' end,
 case when p.proowner is distinct from o.relowner then 'owner' end,
 case when p.prosecdef is distinct from e.is_definer then 'security_definer' end,
 case when p.proconfig is distinct from array['search_path=pg_catalog'] then 'config' end,
 case when p.provolatile::text is distinct from e.volatility then 'volatility' end,
 case when l.lanname is distinct from e.language_name then 'language' end,
 case when p.prorettype is distinct from to_regtype(e.result_type) then 'return_type' end,
 case when coalesce(p.proretset,true) then 'returns_set' end,
 case when coalesce(p.proisstrict,true) then 'strict' end,
 case when coalesce(p.proleakproof,true) then 'leakproof' end,
 case when p.pronargdefaults is distinct from e.defaults then 'defaults' end,
 case when coalesce(p.proargnames,array[]::text[]) is distinct from e.argnames then 'argnames' end,
 case when encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),o.nspname||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from e.source_hash then 'source_hash' end,
 case when exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantor<>o.relowner or a.grantee<>o.relowner and (not e.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable)) then 'acl' end,
 case when has_function_privilege('anon',p.oid,'EXECUTE') then 'anon_execute' end,
 case when has_function_privilege('authenticated',p.oid,'EXECUTE') then 'authenticated_execute' end,
 case when has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from e.is_rpc then 'service_execute' end
 ]::text[],null) failed_fields from dependency e cross join owned o left join pg_proc p on p.oid=to_regprocedure(e.signature) left join pg_language l on l.oid=p.prolang)
 select coalesce(jsonb_agg(jsonb_build_object('signature',signature,'failedFields',failed_fields) order by signature) filter(where cardinality(failed_fields)>0),'[]')::text from checked;`;
}
export function assertReviewRoutingNativeDependencies({d,body}){
 const installed=d.exec("select exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing');");
 assert(['t','f'].includes(installed),'review_routing_registry_boolean_required');
 const failures=JSON.parse(d.exec(reviewRoutingNativeDependencyDiagnosticSql(body,{installed:installed==='t'})));
 assert(Array.isArray(failures)&&failures.length<=30,'review_routing_dependency_diagnostic_invalid');
 assert.deepEqual(failures,[],`review_routing_dependency_metadata_mismatch:${JSON.stringify(failures)}`);
}
//The195 parent installs191-194, but does not depend on189. Install this one
//explicit prerequisite BEFORE the198 baseline; do not repeat its acceptance.
export function installReviewRoutingNativePrerequisite({d,native,scope}){
 const registered=d.exec("select coalesce((select name from public.faolla_schema_migrations where version=202610080189),'');");
 assert(['','merchant_attendance_correction_delegation'].includes(registered),'review_routing189_registry_conflict');
 if(registered)return false;
 const sql=boundClockMigrationBody(native.root,reviewRoutingNativePrerequisite);
 const expected=sql.match(/declare expected text:=\$capture185\$([\s\S]*?)\$capture185\$;/)?.[1];assert(expected,'review_routing189_expected_source_required');
 const signature="'public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure";
 const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(oldTables);
 const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const unaffected=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
  from pg_proc where oid=any(${quote(oldOids)}::oid[]) and oid<>${signature} and prokind='f';`);
 const metadata=()=>d.exec(`select jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0))::text from pg_proc p where oid=${signature};`);
 const source=d.exec(`select encode(sha256(convert_to(replace(replace(prosrc,E'\\r\\n',E'\\n'),${quote(scope.schema+'.')},'pub'||'lic.'),'UTF8')),'hex') from pg_proc where oid=${signature};`);
 assert.equal(source,createHash('sha256').update(expected.replaceAll('\r\n','\n')).digest('hex'),'review_routing189_original_capture_pin');
 const functions=unaffected(),before=metadata();assert(before);d.exec(sql);
 assert.equal(d.fingerprint(oldTables),facts,'review_routing189_changed_old_facts');assert.equal(unaffected(),functions,'review_routing189_changed_unapproved_function');
 assert.equal(metadata(),before,'review_routing189_changed_capture_OID_metadata');
 assert.equal(d.exec("select name from public.faolla_schema_migrations where version=202610080189;"),'merchant_attendance_correction_delegation');
 native.pass('198 prerequisite189 installed only: exact old capture pin, single approved body, old facts/OID/metadata preserved; no repeated189 matrix');return true;
}
export async function installAndVerifyReviewRoutingNative(ctx,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'review_routing_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'review_routing_native_business_cases_invalid');
 const {d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'review_routing_owned_context_required');
 assert.equal(typeof native?.query,'function');assert.equal(typeof native?.connect,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(d.owned.schema,scope.schema);
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const kioskPrerequisiteInstalled=installReviewRoutingNativeKioskPrerequisite(ctx);
 const prerequisiteInstalled=installReviewRoutingNativePrerequisite(ctx);
 const permissionPrerequisiteInstalled=installReviewRoutingNativePermissionPrerequisite(ctx);
 assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=d.fingerprint(oldTables);
 const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const activation="'public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)'::regprocedure";
 const unaffected=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
  from pg_proc where oid=any(${quote(oldOids)}::oid[]) and oid<>${activation} and prokind='f';`);
 const metadata=()=>d.exec(`select jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0))::text
  from pg_proc p where oid=${activation};`);
 const oldFunctions=unaffected(),oldMetadata=metadata();assert(oldMetadata);
 const body=readFileSync(path.join(native.root,'scripts/supabase-migrations',reviewRoutingNativeMigration),'utf8');
 //The three old-grant indexes are CONCURRENTLY: never d.exec/outer BEGIN.
 const install=()=>{assertReviewRoutingNativeDependencies({d,body});return native.query(scope.sql(body));};install();
 assert.equal(d.fingerprint(oldTables),oldFacts,'review_routing_install_changed_old_facts');
 assert.equal(unaffected(),oldFunctions,'review_routing_changed_old_writer_or_helper');
 assert.equal(metadata(),oldMetadata,'review_routing_activation_changed_OID_or_metadata');
 assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),reviewRoutingNativeTables);
 const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();install();
 assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
 assert.equal(unaffected(),oldFunctions);assert.equal(metadata(),oldMetadata);
 native.pass('198 installation/reentry: two private sidecars, one exact activation body, old writers/OID/ACL/facts preserved');
 let acceptance=null;
 try{if(businessCases==='run')acceptance=await (await import('./fixtures/attendance-review-routing-native.mjs')).verifyReviewRoutingNative(ctx);}
 finally{
  assert.equal(d.fingerprint(),installed,'review_routing_fixture_not_rolled_back');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.equal(unaffected(),oldFunctions);assert.equal(metadata(),oldMetadata);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
 if(businessCases==='run'){assert.equal(acceptance.groups.length,reviewRoutingNativeLimits.groups);assert(acceptance.steps<=reviewRoutingNativeLimits.steps);}
 return {phase:198,acceptance,businessCasesExecuted:businessCases==='run',installAndReentry:true,prerequisite105Installed:kioskPrerequisiteInstalled,prerequisite189Installed:prerequisiteInstalled,prerequisite190Installed:permissionPrerequisiteInstalled,newTables:2,approvedOldBodies:1,oldWritersUnchanged:true,oldFactsUnchanged:true,
  oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
}
