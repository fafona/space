//196 INERT adapter. The approved parent supplies its existing owned195 context.
//No CLI, process, database, cluster, browser, Auth or KDF starts on import.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {independentInstallationManifest,independentPermissionHelperName,independentPermissionAclConflictSql} from './merchant-attendance-independent-installation.mjs';
import {createIndependentNativeProtection} from './fixtures/attendance-independent-native-protection.mjs';

export const independentNativeMigration='202610080196_merchant_attendance_independent_workers.sql';
export const independentNativeSha='6D75D0E376F55AD6796C55B16BA5B4FF00718FD149574998895C3C6AAB00A476';
export const independentNativeBudget=Object.freeze({groups:8,logicalSteps:180,milliseconds:120000,maxConnections:3,exactPidRaces:2,
 newClusters:0,newDatabases:0,browser:0,realAuth:0,kdf:0,production:0});
export function independentNativeManifest(root,body){
 assert.equal(typeof body,'string');const m=independentInstallationManifest(root,body);
 assert.equal(m.tables.length,6);assert.equal(m.functions.length,20);assert.equal(m.forward.length,7);
 return m;
}

//Read-only failure diagnostics mirror the frozen product preflight. They name
//only signatures/failed metadata fields; never credential materials or facts.
export function independentNativeDependencyDiagnostics(manifest,schema){
 assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);
 const specs=[...manifest.dependencies,...manifest.forward.map(f=>({...f,hash:f.oldHash}))];
 return `with specs as(select v,format('%I.%I(%s)',${quote(schema)},v->>'name',replace(v->>'types','public.',${quote(schema+'.')})) signature,
 case when v->>'name'='faolla_valid_merchant_enterprise_permissions_v1'
 and not exists(select 1 from public.faolla_schema_migrations where version=202610080190)
 and exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations') then v->>'legacyHash' else v->>'hash' end expected_hash
 from jsonb_array_elements(${json(specs)}) v), failures as(select signature,array_remove(array[
 case when p.oid is null then 'missing' end,
 case when p.proowner is distinct from (select nspowner from pg_namespace where nspname=${quote(schema)}) then 'owner' end,
 case when p.prokind is distinct from 'f' or p.proretset or p.proisstrict or p.proleakproof or p.proargmodes is not null or p.proparallel is distinct from 'u' then 'flags' end,
 case when p.prolang is distinct from (select oid from pg_language where lanname=v->>'language') then 'language' end,
 case when p.prorettype is distinct from to_regtype(replace(v->>'resultType','public.',${quote(schema+'.')})) then 'return_type' end,
 case when p.provolatile::text is distinct from v->>'volatility' or p.prosecdef is distinct from (v->>'securityDefiner')::boolean then 'volatility_security' end,
 case when p.proconfig is distinct from array(select replace(x,'public',${quote(schema)}) from jsonb_array_elements_text(v->'config') x) then 'config' end,
 case when coalesce(p.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(v->'argumentNames')) or p.pronargdefaults is distinct from (v->>'defaults')::integer then 'arguments_defaults' end,
 case when encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),${quote(schema+'.')},'pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash then 'source_hash' end,
 case when case when v->>'name'='${independentPermissionHelperName}' then ${independentPermissionAclConflictSql('p','p.proowner')}
 else has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
 or has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from (v->>'serviceExecute')::boolean
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantor<>p.proowner or a.grantee<>p.proowner
 and not((v->>'serviceExecute')::boolean and a.grantee=(select oid from pg_roles where rolname='service_role') and a.privilege_type='EXECUTE' and not a.is_grantable)) end then 'acl' end
 ],null) failed,case when v->>'name'='${independentPermissionHelperName}' then jsonb_build_object('signature',signature,'owner',p.proowner::regrole::text,
 'effectiveOwnerExecute',has_function_privilege(p.proowner,p.oid,'EXECUTE'),'entries',(select jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,
 'grantee',case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end,'privilege',a.privilege_type,'grantOption',a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable)
 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) end helper_acl from specs left join pg_proc p on p.oid=to_regprocedure(signature))
 select jsonb_build_object('failures',coalesce(jsonb_agg(jsonb_build_object('signature',signature,'failedFields',failed) order by signature) filter(where cardinality(failed)>0),'[]'),
 'permissionHelperAcl',coalesce(jsonb_agg(helper_acl) filter(where helper_acl is not null),'[]')) from failures;`;
}

export async function installAndVerifyIndependentWorkersNative(ctx={},options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'independent_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'independent_native_business_cases_invalid');
 const {d,h,native,scope}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'independent_synthetic_context_required');
 const audit=createIndependentNativeProtection(ctx);
 assert.deepEqual(assertLifecycleSandbox(s=>audit.run('owned_schema',s)),d.owned);assert.equal(scope.schema,d.owned.schema);
 const body=boundClockMigrationBody(native.root,independentNativeMigration),manifest=independentNativeManifest(native.root,body);
 //Bound body strips only BEGIN/COMMIT. Hash the original reviewed bytes instead
 //of silently pinning a transformed migration or platform newline convention.
 const {readFileSync}=await import('node:fs');const {join}=await import('node:path');
 assert.equal(createHash('sha256').update(readFileSync(join(native.root,'scripts/supabase-migrations',independentNativeMigration))).digest('hex').toUpperCase(),independentNativeSha);
 const dependencies=JSON.parse(audit.run('dependencies',independentNativeDependencyDiagnostics(manifest,d.owned.schema)));
 native.pass('196 read-only inherited permission-helper ACL metadata: '+JSON.stringify(dependencies.permissionHelperAcl));
 assert.deepEqual(dependencies.failures,[],'independent_exact_prerequisite_metadata:'+JSON.stringify(dependencies));
 const oldTables=audit.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=audit.fingerprint(oldTables);
 const old155=await audit.archiveBytes('155'),old207=await audit.archiveBytes('207');
 const oldOids=audit.run('old_oids',`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const replaced=audit.run('forward_oids',`select array_agg(to_regprocedure('public.'||(v->>'name')||'('||(v->>'types')||')')::oid order by v->>'name')::text from jsonb_array_elements(${json(manifest.forward)}) v;`);
 const unaffected=()=>audit.functions(oldOids,replaced),metadata=()=>audit.metadata(replaced);
 const beforeFunctions=unaffected(),beforeMetadata=metadata();assert.equal(JSON.parse(beforeMetadata).length,7);
 audit.run('install',body,{write:true});
 assert.equal(audit.fingerprint(oldTables),facts,'independent_install_old_facts');assert.equal(unaffected(),beforeFunctions);assert.equal(metadata(),beforeMetadata);
 const installedTables=audit.inventory();assert.deepEqual(installedTables.filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),manifest.tables.map(t=>t.name).sort());
 const installed=audit.fingerprint(installedTables),definitions=audit.definitions(),catalog=audit.catalog();
 audit.run('reentry',body,{write:true});assert.equal(audit.fingerprint(installedTables),installed);assert.equal(audit.definitions(),definitions);assert.equal(audit.catalog(),catalog);
 assert.equal(unaffected(),beforeFunctions);assert.equal(metadata(),beforeMetadata);
 native.pass('196 install/reentry: six private tables/twenty functions/seven exact forward OID+metadata, old facts preserved');
 let acceptance=null;
 if(businessCases==='run'){
  const {verifyIndependentWorkersNative,independentNativeOutsideSql}=await import('./fixtures/attendance-independent-native.mjs');
  const outside=independentNativeOutsideSql(oldTables),oldOutside=audit.run('outside_before',`select ${outside};`);
  try{acceptance=await verifyIndependentWorkersNative({...ctx,independentAudit:audit});}
  finally{
   //The explicitly disclosed new-site race commits are not rollback-only. All
   //pre-existing rows are protected; the parent owns exact namespace cleanup.
   assert.equal(audit.run('outside_after',`select ${outside};`),oldOutside,'independent_preexisting_facts_changed');
   assert.equal(unaffected(),beforeFunctions);assert.equal(metadata(),beforeMetadata);assert.equal(audit.definitions(),definitions);assert.equal(audit.catalog(),catalog);
   assert.deepEqual(await audit.archiveBytes('155'),old155);assert.deepEqual(await audit.archiveBytes('207'),old207);
  }
  assert.equal(acceptance.coreRollbackRestored,true);assert.equal(acceptance.cleanupOwnedByParent,true);
 }else{
  //No business fixture is imported. Protect the complete installed state,
  //not the race-only outside-site projection, before returning an explicit skip.
  assert.equal(audit.fingerprint(installedTables),installed,'independent_skip_installed_facts_changed');
  assert.equal(unaffected(),beforeFunctions);assert.equal(metadata(),beforeMetadata);assert.equal(audit.definitions(),definitions);assert.equal(audit.catalog(),catalog);
  assert.deepEqual(await audit.archiveBytes('155'),old155);assert.deepEqual(await audit.archiveBytes('207'),old207);
 }
 return {phase:196,installAndReentry:true,newTables:6,newFunctions:20,approvedForwardSignatures:7,acceptance,businessCasesExecuted:businessCases==='run',protection:audit.summary(),
 oldFactsUnchanged:true,oldArchivesUnchanged:true,cleanupOwnedByParent:true,newCluster:false,newDatabase:false,browser:false,realAuth:false,hardware:false,kdf:false,production:false,deployed:false};
}
