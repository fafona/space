//227 isolated metadata-only acceptance. Reuses the existing stopped owned
//cluster and211 sealed context; no production, new cluster, dump or UI.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceOutageNative} from './merchant-attendance-outage-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyAttendanceRetentionNative,retentionNativeExpression} from './fixtures/attendance-retention-native.mjs';
const require=createRequire(import.meta.url),migration='202610070182_merchant_attendance_retention.sql';
export async function runAttendanceRetentionNative(args){
 return runAttendanceOutageNative(args,async ctx=>{
  const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
  assert(d.syntheticOnly===true&&h.syntheticOnly===true);assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);
  const oldNames=d.inventory().filter(n=>n!=='faolla_schema_migrations'),before=d.fingerprint(oldNames),saved=periodArchive();
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const oldFunctions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
   from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`),definitionsBefore=oldFunctions();
  const install=()=>d.exec(boundClockMigrationBody(native.root,migration));
  install();assert.equal(d.fingerprint(oldNames),before);assert.equal(oldFunctions(),definitionsBefore);
  const installed=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();install();
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  native.pass('227182 additive metadata installation/reentry preserves every old row and original function/ACL');
  const metadata=await verifyAttendanceRetentionNative(ctx);
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  const {projectRetentionResult}=require('../src/lib/merchantAttendanceRetention.server.ts');
  const {retentionWriteQuery}=require('../src/lib/merchantAttendanceRetention.ts');
  const statement=(q,c=null,allow=true)=>`set local role service_role;select ${retentionNativeExpression(q,d.owner,c,allow)};`;
  const project=(q,c,text)=>projectRetentionResult(JSON.parse(text.trim()),q,d.owner,c);
  const read=q=>project(q,null,d.exec(statement(q,null,false)));
  const races=[];let operation=227900000;
  for(const [index,kind]of ['cas','same_operation','operation_conflict','holder_rollback','cross_ledger_operation'].entries()){
   const category=['events','location_results','period_artifact','events','location_results'][index],q={siteId:d.site,mode:'policies'};
   const head=read(q).data.items.find(p=>p.category===category);
   const holder={siteId:d.site,action:'set_policy',operationId:id(++operation),category,expectedRevision:head.revision,retentionDays:30+index,reason:'Synthetic227 exact PID '+kind};
   let waiter={...holder,operationId:id(++operation),retentionDays:60+index},waitQuery=q;
   if(kind==='same_operation')waiter=holder;
   if(kind==='operation_conflict')waiter={...holder,reason:holder.reason+' changed'};
   if(kind==='cross_ledger_operation'){
    const event=d.exec(`select id::text from public.merchant_attendance_events where merchant_id=${quote(d.site)} order by id limit 1;`);assert(event);
    waitQuery={siteId:d.site,mode:'record',category:'events',recordId:event};const record=read(waitQuery).data.item;
    waiter={siteId:d.site,action:'hold',operationId:holder.operationId,category:'events',recordId:event,expectedRevision:record.preservation.revision,
     expectedSourceFingerprint:record.sourceFingerprint,reason:'Synthetic227 cross-ledger conflict'};
   }
   assert.deepEqual(retentionWriteQuery(holder),q);assert.deepEqual(retentionWriteQuery(waiter),waitQuery);
   const raced=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    statement(q,holder),statement(waitQuery,waiter,kind!=='same_operation'),{rollback:kind==='holder_rollback'});
   assert(raced.witnessed);const held=project(q,holder,raced.left);assert.equal(held.receipt.revision,head.revision+1);
   if(['cas','operation_conflict','cross_ledger_operation'].includes(kind)){
    assert(raced.right.error);assert.equal(raced.right.output,null);
    assert.match(String(raced.right.error),kind==='cas'?/ERROR:\s+attendance_retention_changed(?:\s|$)/:/ERROR:\s+attendance_operation_conflict(?:\s|$)/);
   }else{
    assert.equal(raced.right.error,null);const value=project(waitQuery,waiter,raced.right.output);
    if(kind==='same_operation')assert.deepEqual(value.receipt,held.receipt);else{
     assert.equal(value.receipt.revision,head.revision+1);
     assert.equal(read({siteId:d.site,mode:'recover',operationId:holder.operationId}).receipt,null);
    }
   }
   assert.equal(d.fingerprint(oldNames),before);assert.equal(oldFunctions(),definitionsBefore);
   assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(periodArchive().artifactText,saved.artifactText);
   races.push({kind,exactPidWitnessed:true,holderRolledBack:kind==='holder_rollback'});
  }
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(oldFunctions(),definitionsBefore);
  assert.equal(archive().artifactSha256,oldArchive.artifactSha256);assert.equal(periodArchive().artifactSha256,saved.artifactSha256);
  native.pass('227 five exact-PID metadata CAS/replay/cross-ledger operation races preserve old business rows and both fixed archives');
  return {phase:227,metadata,races,oldRowsUnchanged:true,oldFunctionsUnchanged:true,oldArchivesUnchanged:true,
   fixtureRolledBack:true,raceRowsOnlyInOwnedSchema:true,newCluster:false,productionAccess:false,browser:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceRetentionNative(process.argv.slice(2))
 .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
