//207 INERT owned-context extension. The existing parent owns its synthetic
//namespace and cleanup. Import starts no process, cluster, KDF or browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {managementAuditNativeInspectionSql,assertManagementAuditNativeOldState} from './merchant-attendance-management-audit-native.mjs';
import {delegatedCredentialsMigration,delegatedCredentialsInstallRecipe} from './merchant-attendance-delegated-credentials-source.mjs';

export const delegatedCredentialsNativeLimits=Object.freeze({groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:120000,
 statementMs:10000,lockMs:3000,connections:1,newSites:1,newClusters:0,newDatabases:0,microcommits:0,browser:0,realAuth:0,kdf:0,production:0});
export const delegatedCredentialsNativeSqlSha='2c4d31cc5b3567d50782630c5834376669972708077fa914d06ff9ad76cbd1af';
export const delegatedCredentialsNativeNewTables=Object.freeze(['merchant_attendance_delegated_credential_proofs']);
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function delegatedCredentialsNativeSources(root){
 assert(path.isAbsolute(root));const directory=path.join(root,'scripts/supabase-migrations');
 const previous=readdirSync(directory).filter(name=>/^\d+_.+\.sql$/.test(name)&&name<delegatedCredentialsMigration).sort()
  .map(name=>({name,text:readFileSync(path.join(directory,name),'utf8')}));
 const sql=readFileSync(path.join(directory,delegatedCredentialsMigration),'utf8');assert.equal(sha(sql),delegatedCredentialsNativeSqlSha,'delegated_credentials_frozen_SQL');
 const recipe=delegatedCredentialsInstallRecipe(sql,previous),forwards=[...recipe.forward.cores,recipe.forward.snapshot,recipe.forward.guard];
 assert.equal(forwards.length,5);assert.equal(new Set(forwards.map(f=>f.signature)).size,5);
 assert.equal(recipe.own.length,19);assert.equal(recipe.dependencies.length,36);assert.equal(recipe.templates.tables.length,15);assert.equal(recipe.triggerManifest.length,24);
 return Object.freeze({sql,recipe,forwards:Object.freeze(forwards)});
}
export function delegatedCredentialsNativeOptions(options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'delegated_credentials_native_options');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'delegated_credentials_native_business_cases');return Object.freeze({businessCases});
}
export async function installAndVerifyDelegatedCredentialsNative(ctx,options={}){
 const {businessCases}=delegatedCredentialsNativeOptions(options),{d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'delegated_credentials_owned_context_required');
 assert.equal(scope?.schema,d.owned.schema);assert.equal(typeof archive,'function');assert.equal(typeof periodArchive,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const sources=delegatedCredentialsNativeSources(native.root);let installationSteps=0;
 const read=sql=>{assert(++installationSteps<=12,'delegated_credentials_install12steps');return d.exec(periodContinuationSerialization+sql);};
 assert.equal(read("select name from public.faolla_schema_migrations where version=202610080206;"),'merchant_attendance_delegated_rules');
 const names=d.inventory();for(const table of delegatedCredentialsNativeNewTables)assert(!names.includes(table),'delegated_credentials_new_relation_exists');
 const inspect=tableNames=>JSON.parse(read(managementAuditNativeInspectionSql(tableNames,d.owned.oid))),before=inspect(names);
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const install=()=>{assert(++installationSteps<=12,'delegated_credentials_install12steps');d.exec(boundClockMigrationBody(native.root,delegatedCredentialsMigration));};
 //The migration owns the complete exact preflight:36 dependencies, selected
 //catalog, five forward bodies and all15 tables/24 protected triggers.
 install();const installed=inspect(names);
 assertManagementAuditNativeOldState(before,installed,sources.forwards.map(f=>f.name));
 assert.deepEqual(d.inventory().filter(name=>!names.includes(name)),delegatedCredentialsNativeNewTables);
 assert.deepEqual(installed.registry.filter(row=>!before.registry.some(old=>old.version===row.version)).map(row=>[row.version,row.name]),[[202610080207,'merchant_attendance_delegated_credentials']]);
 assert.deepEqual(installed.functions.filter(f=>!before.functions.some(old=>old.oid===f.oid)).map(f=>f.name).sort(),sources.recipe.own.map(f=>f.name).sort());
 const allNames=[...names,...delegatedCredentialsNativeNewTables],baseline=inspect(allNames);
 install();assert.deepEqual(inspect(allNames),baseline,'delegated_credentials_reentry_exact_all_objects');
 assert.equal(read("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p');"),'0');
 native.pass('207 install/reentry:5 exact body forwards/19 own functions/one7-column private proof; old facts/OID/ACL/defaults/indexes unchanged');
 const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();let acceptance=null;
 try{if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-delegated-credentials-native.mjs')).verifyDelegatedCredentialsNative(ctx);}
 finally{
  assert.equal(d.fingerprint(),facts,'delegated_credentials_fixture_full_rollback');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.rpcs<=90&&acceptance.steps<=140);assert.equal(acceptance.rollbackRestored,true);}
 return{phase:207,businessCasesExecuted:businessCases==='run',installAndReentry:true,installationSteps,newTables:1,newFunctions:19,pinnedForwardBodies:5,acceptance,
  oldFactsUnchanged:true,oldOidAclDefaultsUnchanged:true,oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,
  cleanupOwnedByParent:true,newCluster:false,newDatabase:false,realAuth:false,browser:false,kdf:false,production:false,deployed:false};
}
