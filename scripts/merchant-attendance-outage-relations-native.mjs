//222 additive relationship ledger acceptance. Reuse the fully checked217
//owned schema; original clock/source/review/period semantics are not replaced.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageSubjectNative} from './merchant-attendance-outage-subject-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyAttendanceOutageRelationsNative} from './fixtures/attendance-outage-relations-native.mjs';
export const outageRelationsNativeMigration='202610070181_merchant_attendance_outage_relations.sql';

export async function runAttendanceOutageRelationsNative(args,after=null){
 assert(after===null||typeof after==='function','outage_relations_extension_invalid');
 return runAttendanceOutageSubjectNative(args,async ctx=>{
  const {d,native,scope,archive,oldArchive,periodArchive,period,pq,periodId,outageSubjectFoundation}=ctx;
  assert.equal(outageSubjectFoundation.phase,217);assert.equal(outageSubjectFoundation.rollbackRestored,true);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
  assert((await period(pq('detail','owner',periodId))).period.sealed);
  const oldNames=d.inventory().filter(n=>n!=='faolla_schema_migrations'),facts=d.fingerprint(oldNames),saved=periodArchive();
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${owned.oid} and prokind='f';`);
  const oldFunctions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
   from pg_proc p where p.pronamespace=${owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`);
  const oldHash=oldFunctions(),install=()=>d.exec(boundClockMigrationBody(native.root,outageRelationsNativeMigration).replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
  install();assert.equal(d.fingerprint(oldNames),facts);assert.equal(oldFunctions(),oldHash);
  const installed=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();install();
  assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);assert.equal(oldFunctions(),oldHash);
  const relations=await verifyAttendanceOutageRelationsNative(ctx);
  assert.equal(d.fingerprint(),installed);assert.equal(d.fingerprint(oldNames),facts);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);assert.equal(oldFunctions(),oldHash);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,saved.artifactText);assert.equal(periodArchive().artifactSha256,saved.artifactSha256);
  const unchanged=await period(pq('detail','owner',periodId));assert(unchanged.period.sealed);assert.equal(unchanged.sourceChanged,false);
  native.pass('222181 additive installation/reentry and relationship operations preserve all original functions, facts, source status and both sealed archives');
  const result={phase:222,prerequisites:217,relations,oldFunctionsUnchanged:true,oldFactsUnchanged:true,
   old155ArchiveBytes:oldArchive.artifactBytes,old155ArchivePreserved:true,actualSealedArchivePreserved:true,rollbackRestored:true,
   browser:false,productionAccess:false,newCluster:false,deployed:false};
  if(after!==null)return {...result,extension:await after({...ctx,outageRelationsFoundation:result})};
  return result;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageRelationsNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'outage_relations_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
