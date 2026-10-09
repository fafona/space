//206 INERT owned-context extension. Import opens no process, socket or DB.
//The parent owns its existing synthetic namespace and complete cleanup.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {managementAuditNativeInspectionSql,assertManagementAuditNativeOldState} from './merchant-attendance-management-audit-native.mjs';
import {delegatedRulesMigration,delegatedRulesInstallRecipe} from './merchant-attendance-delegated-rules-source.mjs';

export const delegatedRulesNativeLimits=Object.freeze({groups:8,rpcs:90,steps:140,installationSteps:12,transactionMs:90000,
 statementMs:10000,lockMs:3000,connections:1,newSites:1,newClusters:0,newDatabases:0,microcommits:0,browser:0,realAuth:0,kdf:0,production:0});
export const delegatedRulesNativeSqlSha='61de1213dddb2d72d3524c831ccf4775bd7dfe890f7f2ea142134adcb08fa8aa';
const sha=s=>createHash('sha256').update(s.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function delegatedRulesNativeSources(root){
 assert(path.isAbsolute(root));const directory=path.join(root,'scripts/supabase-migrations');
 const previous=readdirSync(directory).filter(name=>/^\d+_.+\.sql$/.test(name)&&name<delegatedRulesMigration).sort()
  .map(name=>({name,text:readFileSync(path.join(directory,name),'utf8')}));
 const sql=readFileSync(path.join(directory,delegatedRulesMigration),'utf8');assert.equal(sha(sql),delegatedRulesNativeSqlSha,'delegated_rules_frozen_SQL');
 const recipe=delegatedRulesInstallRecipe(sql,previous),forwards=[...recipe.forward.cores,recipe.forward.guard];
 assert.equal(forwards.length,4);assert.equal(new Set(forwards.map(f=>f.signature)).size,4);
 assert.equal(recipe.own.length,19);assert.equal(recipe.dependencies.length,44);
 return Object.freeze({sql,recipe,forwards:Object.freeze(forwards)});
}
export function delegatedRulesNativeOptions(options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'delegated_rules_native_options');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'delegated_rules_native_business_cases');return Object.freeze({businessCases});
}
export async function installAndVerifyDelegatedRulesNative(ctx,options={}){
 const {businessCases}=delegatedRulesNativeOptions(options),{d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'delegated_rules_owned_context_required');
 assert.equal(scope?.schema,d.owned.schema);assert.equal(typeof archive,'function');assert.equal(typeof periodArchive,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const sources=delegatedRulesNativeSources(native.root);let installationSteps=0;
 const read=sql=>{assert(++installationSteps<=12,'delegated_rules_install12steps');return d.exec(periodContinuationSerialization+sql);};
 assert.equal(read("select name from public.faolla_schema_migrations where version=202610080205;"),'merchant_attendance_delegated_configuration');
 const names=d.inventory(),inspect=()=>JSON.parse(read(managementAuditNativeInspectionSql(names,d.owned.oid))),before=inspect();
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const install=()=>{assert(++installationSteps<=12,'delegated_rules_install12steps');d.exec(boundClockMigrationBody(native.root,delegatedRulesMigration));};
 //The complete frozen preflight runs inside the migration's own transaction:
 //44 dependencies, catalog/capture pins, four bodies and seven old rule tables.
 install();const installed=inspect();
 assertManagementAuditNativeOldState(before,installed,sources.forwards.map(f=>f.name));
 assert.deepEqual(d.inventory(),names,'delegated_rules_no_new_relations');assert.deepEqual(installed.tables,before.tables);assert.deepEqual(installed.indexes,before.indexes);
 assert.deepEqual(installed.registry.filter(row=>!before.registry.some(old=>old.version===row.version)).map(row=>[row.version,row.name]),[[202610080206,'merchant_attendance_delegated_rules']]);
 assert.deepEqual(installed.functions.filter(f=>!before.functions.some(old=>old.oid===f.oid)).map(f=>f.name).sort(),sources.recipe.own.map(f=>f.name).sort());
 install();assert.deepEqual(inspect(),installed,'delegated_rules_reentry_exact_all_objects');
 assert.equal(read("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p');"),'0');
 native.pass('206 install/reentry:4 exact body forwards/19 private or service functions/0 business tables; old facts/OID/ACL/defaults/indexes unchanged');
 const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();let acceptance=null;
 try{if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-delegated-rules-native.mjs')).verifyDelegatedRulesNative(ctx);}
 finally{
  assert.equal(d.fingerprint(),facts,'delegated_rules_fixture_full_rollback');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.rpcs<=90&&acceptance.steps<=140);assert.equal(acceptance.rollbackRestored,true);}
 return{phase:206,businessCasesExecuted:businessCases==='run',installAndReentry:true,installationSteps,newTables:0,newFunctions:19,pinnedForwardBodies:4,acceptance,
  oldFactsUnchanged:true,oldOidAclDefaultsUnchanged:true,oldArchivesUnchanged:true,rollbackRestored:businessCases==='run'?true:null,
  cleanupOwnedByParent:true,newCluster:false,newDatabase:false,realAuth:false,browser:false,kdf:false,production:false,deployed:false};
}
