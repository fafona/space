//223 local-only extension of222. The existing runner owns startup, namespace
//cleanup and persistent-baseline verification; this file creates no cluster.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageRelationsNative} from './merchant-attendance-outage-relations-native.mjs';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyAttendanceOutageRelationsRacesNative,outageRelationRaceWriteTables} from './fixtures/attendance-outage-relations-races-native.mjs';

export async function runAttendanceOutageRelationsRacesNative(args,after=null){
 assert(after===null||typeof after==='function','outage_relation_race_extension_invalid');
 return runAttendanceOutageRelationsNative(args,async ctx=>{
  const {d,native,scope,period,pq,periodId,archive,oldArchive,periodArchive,outageRelationsFoundation}=ctx;
  assert.equal(outageRelationsFoundation.phase,222);assert.equal(outageRelationsFoundation.rollbackRestored,true);
  for(const key of ['oldFunctionsUnchanged','oldFactsUnchanged','old155ArchivePreserved','actualSealedArchivePreserved'])assert.equal(outageRelationsFoundation[key],true,key);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const allowed=[...outageRelationRaceWriteTables],protectedNames=d.inventory().filter(name=>!allowed.includes(name));
  const before=d.fingerprint(protectedNames),definitions=d.definitions(),catalog=d.tableCatalog(),saved=periodArchive();
  const oldRows=Object.fromEntries(allowed.map(name=>[name,JSON.parse(d.exec(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${name} r;`))]));
  const races=await verifyAttendanceOutageRelationsRacesNative(ctx);
  assert.equal(d.fingerprint(protectedNames),before);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  for(const name of allowed)assert.equal(d.exec(`select not exists(select 1 from jsonb_array_elements(${json(oldRows[name])}) old_row where not exists(select 1 from public.${name} r where to_jsonb(r)=old_row));`),'t','outage_relation_race_old_rows_changed:'+name);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,saved.artifactText);assert.equal(periodArchive().artifactSha256,saved.artifactSha256);
  const current=await period(pq('detail','owner',periodId));assert(current.period.sealed);assert.equal(current.sourceChanged,false);
  const result={phase:223,prerequisites:222,races,oldRowsPreserved:true,oldFunctionsPreserved:true,oldArchivesPreserved:true,
   concurrencyCommits:'caller-owned synthetic schema; outer lifecycle removes it and checks persistent baseline',
   browser:false,newCluster:false,productionAccess:false,deployed:false};
  if(after!==null)return {...result,extension:await after({...ctx,outageRelationsRacesFoundation:result})};
  return result;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageRelationsRacesNative(process.argv.slice(2))
 .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({error:'outage_relations_races_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
