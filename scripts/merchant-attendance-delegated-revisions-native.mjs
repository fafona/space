//208 INERT owned-context extension. Only the existing parent owns the local
//synthetic database and cleanup. Import starts no process, Auth, KDF or browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {managementAuditNativeInspectionSql,assertManagementAuditNativeOldState} from './merchant-attendance-management-audit-native.mjs';
import {delegatedRevisionsMigration,delegatedRevisionsInstallRecipe} from './merchant-attendance-delegated-revisions-source.mjs';

export const delegatedRevisionsNativeLimits=Object.freeze({groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:120000,
 statementMs:10000,lockMs:3000,connections:3,races:1,polls:16,newSites:1,newTables:0,newClusters:0,newDatabases:0,microcommits:0,
 browser:0,realAuth:0,kdf:0,production:0});
export const delegatedRevisionsNativeSqlSha='e1a3b19b14bf3f5a67f1c744db215797d18fd9b8961165fef16149097f954f42';
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function delegatedRevisionsNativeSources(root){
 assert(path.isAbsolute(root));const directory=path.join(root,'scripts/supabase-migrations');
 const previous=readdirSync(directory).filter(name=>/^\d+_.+\.sql$/.test(name)&&name<delegatedRevisionsMigration).sort()
  .map(name=>({name,text:readFileSync(path.join(directory,name),'utf8')}));
 const sql=readFileSync(path.join(directory,delegatedRevisionsMigration),'utf8');assert.equal(sha(sql),delegatedRevisionsNativeSqlSha,'delegated_revisions_frozen_SQL');
 const recipe=delegatedRevisionsInstallRecipe(sql,previous),forwards=[...recipe.forward.cores,recipe.forward.guard];
 assert.equal(forwards.length,3);assert.equal(new Set(forwards.map(f=>f.signature)).size,3);
 assert.equal(recipe.own.length,13);assert.equal(recipe.own.filter(f=>f.isRpc).length,1);assert.equal(recipe.dependencies.length,89);
 assert.equal(recipe.templates.tables.length,18);assert.equal(recipe.templates.extraTables.length,3);assert.equal(recipe.triggerManifest.length,37);
 return Object.freeze({sql,recipe,forwards:Object.freeze(forwards)});
}
export function delegatedRevisionsNativeOptions(options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'delegated_revisions_native_options');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'delegated_revisions_native_business_cases');return Object.freeze({businessCases});
}
export async function installAndVerifyDelegatedRevisionsNative(ctx,options={}){
 const {businessCases}=delegatedRevisionsNativeOptions(options),{d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'delegated_revisions_owned_context_required');
 assert.equal(scope?.schema,d.owned.schema);assert.equal(typeof archive,'function');assert.equal(typeof periodArchive,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const sources=delegatedRevisionsNativeSources(native.root);let installationSteps=0;
 const read=sql=>{assert(++installationSteps<=12,'delegated_revisions_install12steps');return d.exec(periodContinuationSerialization+sql);};
 assert.equal(read("select name from public.faolla_schema_migrations where version=202610080207;"),'merchant_attendance_delegated_credentials');
 const names=d.inventory(),inspect=()=>JSON.parse(read(managementAuditNativeInspectionSql(names,d.owned.oid))),before=inspect();
 const old155=periodContinuationArchiveBytes(await archive()),oldPeriod=periodContinuationArchiveBytes(await periodArchive());
 const install=()=>{assert(++installationSteps<=12,'delegated_revisions_install12steps');d.exec(boundClockMigrationBody(native.root,delegatedRevisionsMigration));};
 //The migration pins all89 recursive dependencies, the selected catalog,
 //three exact forwards,18 old tables,37 triggers and the current-effect view.
 install();const installed=inspect();
 assertManagementAuditNativeOldState(before,installed,sources.forwards.map(f=>f.name));
 assert.deepEqual(d.inventory(),names,'delegated_revisions_no_new_business_relations');
 assert.deepEqual(installed.registry.filter(row=>!before.registry.some(old=>old.version===row.version)).map(row=>[row.version,row.name]),[[202610080208,'merchant_attendance_delegated_revisions']]);
 assert.deepEqual(installed.functions.filter(f=>!before.functions.some(old=>old.oid===f.oid)).map(f=>f.name).sort(),sources.recipe.own.map(f=>f.name).sort());
 const baseline=inspect();install();assert.deepEqual(inspect(),baseline,'delegated_revisions_reentry_exact_all_objects');
 assert.equal(read("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p','v');"),'0');
 native.pass('208 install/reentry:3 exact body forwards/13 own functions/no new permanent tables; full old facts/OID/ACL/catalog preserved');
 const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();let acceptance=null;
 try{if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-delegated-revisions-native.mjs')).verifyDelegatedRevisionsNative(ctx);}
 finally{
  assert.equal(d.fingerprint(),facts,'delegated_revisions_fixture_full_rollback');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),oldPeriod);
 }
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.rpcs<=90&&acceptance.steps<=140);assert.equal(acceptance.rollbackRestored,true);}
 return{phase:208,businessCasesExecuted:businessCases==='run',installAndReentry:true,installationSteps,newTables:0,newFunctions:13,pinnedForwardBodies:3,acceptance,
  oldFactsUnchanged:true,oldOidAclDefaultsUnchanged:true,oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,
  cleanupOwnedByParent:true,newCluster:false,newDatabase:false,realAuth:false,browser:false,kdf:false,production:false,deployed:false};
}
