//218 real two-connection ordering, committed only inside the caller-owned
//synthetic schema. Existing archives/rows remain unchanged; outer cleanup owns
//removal of this temporary namespace. No guessed sealed rows or disabled guards.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeTables,outageNativeExpression} from './attendance-outage-native.mjs';
import {outagePeriodWriteTables} from './attendance-outage-periods-native.mjs';
const require=createRequire(import.meta.url);
const dayBefore=(day,count)=>new Date(Date.parse(day+'T00:00:00Z')-count*86400000).toISOString().slice(0,10);
export function createOutageSealRacePlan(input,order){
 assert(['declaration_first','seal_first'].includes(order));assert(/^\d{4}-\d{2}-\d{2}$/.test(input.sealedDay));
 const offset=order==='declaration_first'?0:100,fresh=n=>id(218200000+offset+n),day=dayBefore(input.sealedDay,order==='declaration_first'?2:3);
 const interval={startAt:day+'T08:00:00.000000Z',endAt:day+'T09:00:00.000000Z',timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 const periodId=fresh(1),query={siteId:input.site,access:'owner',workerId:input.worker,fromDate:day,throughDate:day,mode:'detail',periodId,operationId:null,version:null};
 const incident={action:'create_incident',operationId:fresh(2),incidentId:fresh(3),type:'network',channel:'web',locationId:input.location,interval,
  reason:'Synthetic218 explicit outage after an independently sent period'};
 const declaration={action:'declare',operationId:fresh(4),declarationId:fresh(5),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic218 original declaration; no clock event or archive rewrite',originalOperationId:null,originalChannel:null,paperReference:null};
 return {fresh,query,periodId,incident,declaration};
}
export async function verifyAttendanceOutageSealRacesNative(ctx){
 const {d,h,native,scope,period,periodArchive,archive,oldArchive}=ctx;
 assert(d?.syntheticOnly&&h?.syntheticOnly);assert.equal(typeof native.connect,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const names=d.inventory(),allowed=[...outageNativeTables,...outagePeriodWriteTables];
 const protectedNames=names.filter(n=>!allowed.includes(n)),protectedBefore=d.fingerprint(protectedNames),defs=d.definitions(),catalog=d.tableCatalog();
 const originals=Object.fromEntries(allowed.map(table=>[table,JSON.parse(d.exec(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${table} t;`))]));
 const initialArchive=periodArchive();
 const check=()=>{
  assert.equal(d.fingerprint(protectedNames),protectedBefore);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  for(const table of allowed)assert.equal(d.exec(`select ${json(originals[table])} <@ coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${table} t;`),'t','outage_seal_old_row_changed:'+table);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,initialArchive.artifactText);assert.equal(periodArchive().artifactSha256,initialArchive.artifactSha256);
 };
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)};`));
 assert(profile);const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const groups=[];let reads=0,writes=0,rejections=0;
 const readPeriod=async q=>{const before=d.fingerprint(),r=await period(q);assert.equal(d.fingerprint(),before);reads++;return r;};
 const callPeriod=async(q,c)=>{const r=await period(q,c);writes++;return r;};
 const readOutage=(q,c=null)=>{const before=d.fingerprint(),raw=JSON.parse(d.exec('set local role service_role;select '+outageNativeExpression(q,d.owner,c,!!c)+';'));
  const r=projectOutageResult(raw,q,d.owner,c);if(c)writes++;else {reads++;assert.equal(d.fingerprint(),before);}return r;};
 const periodExpression=(q,c=null,allow=false)=>`public.faolla_attendance_period_closure_v1(${json(q)},${quote(d.owner)},${json(c)},null,${allow})`;
 const storedArchive=q=>{const before=d.fingerprint(),r=JSON.parse(d.exec('set local role service_role;select '+periodExpression({...q,mode:'export',version:1})+';'));
  assert.equal(d.fingerprint(),before);reads++;return r;};
 const statement=expression=>d.guard+`set local time zone 'UTC';set local role service_role;select ${expression};set constraints all immediate;reset role;`;
 for(const order of ['declaration_first','seal_first']){
  const p=createOutageSealRacePlan({site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,sealedDay:h.slot.workDate,...profile},order),q=p.query;
  assert(Date.parse(p.declaration.interval.endAt)<=Date.parse(initialArchive.artifact.period.startAt),'outage_seal_fixture_overlaps_old_period');
  const initial=await readPeriod({...q,mode:'preview',periodId:null});assert.deepEqual(initial.preview.blockers,[]);
  assert.equal(initial.preview.artifact.report.base.rows.length,0,'outage_seal_requires_empty_separate_period');
  const send={action:'send',operationId:p.fresh(10),periodId:p.periodId,expectedRevision:0,expectedVersion:0,
   expectedFingerprint:initial.preview.artifact.sourceFingerprint,reason:'Synthetic218 explicitly send isolated period'};
  let current=await callPeriod(q,send);
  const confirm={action:'confirm',operationId:p.fresh(11),periodId:p.periodId,expectedRevision:current.period.revision,expectedVersion:current.period.currentVersion,
   expectedFingerprint:current.artifact.sourceFingerprint,reason:'Synthetic218 actual employee confirmation before concurrent seal'};
  current=await callPeriod({...q,access:'self'},confirm);assert.equal(current.period.sealed,false);
  const seal={action:'seal',operationId:p.fresh(12),periodId:p.periodId,expectedRevision:current.period.revision,expectedVersion:current.period.currentVersion,
   expectedFingerprint:current.artifact.sourceFingerprint,reason:'Synthetic218 explicit seal contending with new declaration'};
  const iq={siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId};readOutage(iq,p.incident);
  const dq={siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId},beforeArchive=storedArchive(q);
  const beforePeriod=current.period,sealSql=statement(periodExpression(q,seal,true)),declareSql=statement(outageNativeExpression(dq,d.owner,p.declaration,true));
  const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},order==='declaration_first'?declareSql:sealSql,order==='declaration_first'?sealSql:declareSql);
  assert.equal(race.witnessed,true);writes++;
  if(order==='declaration_first'){
   assert(race.right.error);assert.match(String(race.right.error),/ERROR:\s+attendance_period_source_changed(?:\s|$)/);assert.equal(race.right.output,null);rejections++;
   assert.equal(d.exec(`select count(*) from public.merchant_attendance_period_entries where merchant_id=${quote(d.site)} and operation_id=${quote(seal.operationId)};`),'0');
  }else {assert.equal(race.right.error,null);assert(race.right.output);writes++;}
  const recoveredDeclaration=readOutage({siteId:d.site,access:'owner',mode:'recover',operationId:p.declaration.operationId});
  assert.equal(recoveredDeclaration.receipt.recordId,p.declaration.declarationId);
  const now=await readPeriod(q);assert.equal(now.sourceChanged,true);assert.equal(now.period.sealed,order==='seal_first');
  assert.equal(now.period.revision,beforePeriod.revision+(order==='seal_first'?1:0));
  const preview=await readPeriod({...q,mode:'preview'});assert(preview.preview.blockers.includes('unresolved_outage'));
  const afterArchive=storedArchive(q);assert.equal(afterArchive.artifactText,beforeArchive.artifactText);assert.equal(afterArchive.artifactSha256,beforeArchive.artifactSha256);
  const originalSend=await readPeriod({...q,mode:'recover',operationId:send.operationId});assert.deepEqual(originalSend.operation.command,send);
  if(order==='seal_first'){
   const originalSeal=await readPeriod({...q,mode:'recover',operationId:seal.operationId});assert.deepEqual(originalSeal.operation.command,seal);
   const frozen=d.fingerprint(),replay=await period(q,seal);assert(replay.replayed);assert.deepEqual(replay.operation,originalSeal.operation);assert.equal(d.fingerprint(),frozen);reads++;
  }else {
   const frozen=d.fingerprint();await assert.rejects(()=>period({...q,mode:'recover',operationId:seal.operationId}),/attendance_operation_not_found/);
   assert.equal(d.fingerprint(),frozen);rejections++;
  }
  check();groups.push({order,witnessed:true,waiterRejected:order==='declaration_first',archivePreserved:true,currentSourceChanged:true});
  native.pass('218179/176 exact PID '+order+' keeps prior archive; '+(order==='declaration_first'?'stale seal rejected without receipt':'both commit but current sealed source changes'));
 }
 check();return {groups,reads,writes,rejections,witnessedRaces:2,committedOnlyInOwnedSchema:true,oldRowsPreserved:true,oldArchivesPreserved:true};
}
