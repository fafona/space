//218 test-only. Real176/177/178 writes COMMIT inside the caller-owned synthetic
//schema so two connections can observe them. The outer runner destroys that
//schema and verifies the persistent baseline; this helper does not roll them back.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeTables,outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {outageLinksNativeTables} from './attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './attendance-outage-reviews-native.mjs';
const require=createRequire(import.meta.url),startId=id(204710),endId=id(204711);
export const outageReviewRaceGroups=Object.freeze(['confirm_first','propose_first','revoke_first','resolve_first']);
const tables=Object.freeze([...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables]);
const utc6=value=>new Date(value).toISOString().replace(/Z$/,'000Z');

export function createOutageReviewRacePlan(input,group){
 assert(outageReviewRaceGroups.includes(group));
 for(const value of [input.workerVersion,input.employeeVersion])assert(Number.isSafeInteger(value)&&value>0);
 assert(Number.isSafeInteger(input.generation)&&input.generation>=0);
 const fresh=n=>id(218100000+outageReviewRaceGroups.indexOf(group)*1000+n);
 const interval={startAt:utc6(input.startAt),endAt:utc6(input.endAt),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.startAt)<Date.parse(interval.endAt)&&Date.parse(interval.endAt)<Date.parse(input.now));
 assert(Date.parse(interval.endAt)-Date.parse(interval.startAt)<31*86400000);
 assert(!(Date.parse(interval.startAt)<Date.parse(input.sealedEnd)&&Date.parse(interval.endAt)>Date.parse(input.sealedStart)),
  'outage_review_race_declaration_must_not_overlap_existing_sealed_frame');
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic218 race incident, not a reconstructed clock'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,
  workerId:input.worker,employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,
  expectedEmployeeVersion:input.employeeVersion,expectedGeneration:input.generation,interval,
  statement:'Synthetic218 separate declaration for '+group,originalOperationId:null,originalChannel:null,paperReference:null};
 const q=(mode='detail',access='owner',operationId=null)=>({siteId:input.site,access,mode,declarationId:declaration.declarationId,
  ...(mode==='recover'?{operationId}:mode==='history'?{beforeRevision:null}:{})});
 const reference={kind:'session',startEventId:startId,lastEventId:endId,lastSequence:4,effectOperationId:null,effectRevision:null};
 return {group,fresh,incident,declaration,q,reference,operationIds:[1,3,5,10,11,12,13,14].map(fresh)};
}

//Only the exact newly authorized operation IDs in five append-only tables may
//differ. All other tables AND preexisting rows of these five tables are hashed.
export function outageReviewRaceProtectedSql(names,site,operationIds=[]){
 assert(Array.isArray(names)&&names.length&&new Set(names).size===names.length);assert(/^\d{8}$/.test(site));
 assert(new Set(operationIds).size===operationIds.length);
 for(const op of operationIds)assert(/^00000000-0000-4000-8000-00021810[0-3][0-9]{3}$/.test(op),'outage_review_race_exact_synthetic_operation');
 return '(select md5(jsonb_object_agg(race_name,race_rows order by race_name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const where=tables.includes(name)&&operationIds.length?` where not (race_row.merchant_id=${quote(site)} and race_row.operation_id=any(array[${operationIds.map(x=>quote(x)+'::uuid').join(',')}]::uuid[]))`:'';
  return `select ${quote(name)} race_name,(select coalesce(jsonb_agg(to_jsonb(race_row) order by to_jsonb(race_row)::text),'[]') from public.${name} race_row${where}) race_rows`;
 }).join(' union all ')+') outage_review_race_facts)';
}

export async function verifyAttendanceOutageReviewRacesNative(ctx){
 const {d,h,native,scope,period,pq,periodId,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.connect,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const periodBefore=await period(pq('detail','owner',periodId));assert.equal(periodBefore.period.sealed,true);
 const savedArchive=periodArchive(),names=d.inventory(),defs=d.definitions(),catalog=d.tableCatalog();
 for(const name of tables)assert(names.includes(name));
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const exec=sql=>d.exec(prefix+sql),allSql=outageNativeFingerprintSql(names),all=()=>exec('select '+allSql+';');
 const beforeProfile=all(),fmt='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
 const profile=JSON.parse(exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC',${quote(fmt)}),
  'session',public.faolla_attendance_period_session_v1(${quote(d.site)},w.id,${quote(startId)},e.id,e.auth_user_id,clock_timestamp()))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)}
   and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert.equal(all(),beforeProfile,'outage_review_race_profile_zero_writes');assert(profile?.session);
 const events=profile.session.item.events;
 assert.deepEqual(events.map(e=>[e.id,e.sequence,e.action]),[[startId,3,'clock_in'],[endId,4,'clock_out']]);
 assert.equal(profile.session.item.effect,null);assert.equal(profile.session.ruleBinding.employeeId,h.employeeId);
 assert.equal(profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);
 const input={site:d.site,employee:h.employeeId,auth:h.employeeAuthUserId,worker:h.workerId,location:h.slot.locationId,
  ...profile,startAt:events[0].occurredAt,endAt:events[1].occurredAt};
 //The saved period frame is authoritative; source204 is a different day.
 const frame=JSON.parse(savedArchive.artifactText).period;
 input.sealedStart=frame.startAt;input.sealedEnd=frame.endAt;
 assert.equal(typeof input.sealedStart,'string');assert.equal(typeof input.sealedEnd,'string');
 const plans=outageReviewRaceGroups.map(group=>createOutageReviewRacePlan(input,group)),allIds=plans.flatMap(p=>p.operationIds);
 assert.equal(new Set(allIds).size,allIds.length);
 const protectedSql=outageReviewRaceProtectedSql(names,d.site,allIds),protectedBefore=exec('select '+protectedSql+';');
 const guard=`do $outage_race_guard$ begin
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_review_race_guards_enabled';
  ${tables.map(name=>`assert exists(select 1 from pg_class c where c.oid='public.${name}'::regclass and c.relnamespace=${owned.oid} and c.relowner::regrole::text='postgres' and c.relrowsecurity),'outage_review_race_owned_table';
   assert not exists(select 1 from pg_constraint c where c.conrelid='public.${name}'::regclass and not c.convalidated),'outage_review_race_valid_constraints';
   assert not exists(select 1 from public.${name} where operation_id=any(array[${allIds.map(x=>quote(x)+'::uuid').join(',')}]::uuid[])),'outage_review_race_fresh_ids';`).join('\n')}
  end;$outage_race_guard$;`;
 exec(guard);
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const {projectOutageLinksResult}=require('../../src/lib/merchantAttendanceOutageLinks.server.ts');
 const {projectOutageReviewResult}=require('../../src/lib/merchantAttendanceOutageReview.server.ts');
 const projectors={outage:projectOutageResult,links:projectOutageLinksResult,review:projectOutageReviewResult};
 const functions={outage:'faolla_attendance_outage_v1',links:'faolla_attendance_outage_links_v1',review:'faolla_attendance_outage_review_v1'};
 const committed=new Map(),groups=[];let reads=1,submissions=0,rejections=0,replays=0;
 const spec=(kind,q,c=null,allow=true)=>({kind,q,c,allow,actor:q.access==='self'?h.employeeAuthUserId:d.owner});
 const expression=s=>`public.${functions[s.kind]}(${json(s.q)},${quote(s.actor)},${json(s.c)},${s.allow})`;
 const statement=(s,allowedIds=[],includeAllHash=false)=>{
  const protectedFacts=outageReviewRaceProtectedSql(names,d.site,allowedIds);
  return prefix+`do $outage_race_call$ declare race_before text;race_after text;race_value jsonb;begin
   race_before:=${protectedFacts};set local role service_role;race_value:=${expression(s)};
   set constraints all immediate;set constraints all deferred;reset role;race_after:=${protectedFacts};
   assert race_before=race_after,'outage_review_race_protected_rows_changed';
   perform set_config('faolla.outage218_race_value',race_value::text,true);end;$outage_race_call$;
   select current_setting('faolla.outage218_race_value')::jsonb;${includeAllHash?'select '+allSql+';':''}`;
 };
 const parse=(s,output)=>{try{return projectors[s.kind](JSON.parse(String(output).trim()),s.q,s.actor,s.c);}
  catch(error){throw new Error('outage_review_race_projection:'+s.kind+':'+(s.c?.action??s.q.mode)+':'+String(error),{cause:error});}};
 const record=(s,value)=>{assert(s.c&&value.receipt);assert(!committed.has(s.c.operationId));committed.set(s.c.operationId,{...s,receipt:value.receipt});submissions++;return value;};
 const call=(s,replay=false)=>{
  const value=parse(s,exec(statement(s,s.c&&!replay?[s.c.operationId]:[])));
  if(s.c&&!replay)record(s,value);else{reads++;if(replay)replays++;}return value;
 };
 const reviewCommand=(p,n,action,view)=>({action,operationId:p.fresh(n),expectedRevision:view.revision,expectedResultVersion:view.resultVersion,
  expectedFingerprint:action==='propose'?view.status.basisFingerprint:view.proposal.resultFingerprint,reason:'Synthetic218 explicit '+action+' in '+p.group});
 const preserve=()=>{
  assert.equal(exec('select '+protectedSql+';'),protectedBefore,'outage_review_race_preexisting_facts_changed');
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,savedArchive.artifactText);assert.equal(periodArchive().artifactSha256,savedArchive.artifactSha256);
 };
 async function race(label,holder,waiter,expectedError){
  const allowed=[holder.c.operationId,waiter.c.operationId];
  const result=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
   statement(holder,allowed,true),statement(waiter,allowed));
  assert.equal(result.witnessed,true,label);
  const leftLines=result.left.trim().split(/\r?\n/),holderHash=leftLines.pop();assert.match(holderHash,/^[0-9a-f]{32}$/);assert.equal(leftLines.length,1);
  const left=record(holder,parse(holder,leftLines[0]));let right=null;
  if(expectedError){
   assert(result.right.error,label);assert.equal(result.right.output,null);
   assert.match(String(result.right.error),new RegExp('ERROR:\\s+'+expectedError+'(?:\\s|$)'),label);
   assert.equal(all(),holderHash,label+':failed_waiter_zero_residue');rejections++;
  }else{assert.equal(result.right.error,null,label);right=record(waiter,parse(waiter,result.right.output));}
  preserve();return {left,right,expectedError,exactPidWitnessed:true,failedWaiterZeroWrites:expectedError!==null};
 }
 try{
  for(const p of plans){
   const oq=p.q(),sq=p.q('detail','self');
   call(spec('outage',{siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId},p.incident));
   call(spec('outage',{siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId},p.declaration));
   const preview=call(spec('links',{...oq,mode:'preview',sources:[p.reference]}));assert.equal(preview.preview.eligible,true);
   const apply={action:'apply',operationId:p.fresh(5),expectedRevision:preview.revision,expectedFingerprint:preview.preview.fingerprint,
    sources:[p.reference],reason:'Synthetic218 explicit unchanged historical session association'};
   const linked=call(spec('links',oq,apply));assert.equal(linked.receipt.entry.revision,1);
   const initial=call(spec('review',oq));assert.equal(initial.status.canPropose,true);
   const proposal=call(spec('review',oq,reviewCommand(p,10,'propose',initial))).receipt;
   const ownerView=call(spec('review',oq)),selfView=call(spec('review',sq));
   assert.equal(ownerView.revision,1);assert.equal(ownerView.resultVersion,1);assert.equal(selfView.status.canConfirm,true);
   assert.equal(ownerView.status.canPropose,true);assert.deepEqual(ownerView.proposal,selfView.proposal);
   let result;
   if(p.group==='confirm_first'||p.group==='propose_first'){
    const confirm=spec('review',sq,reviewCommand(p,11,'confirm',selfView));
    const propose=spec('review',oq,reviewCommand(p,13,'propose',ownerView));
    assert.equal(confirm.c.expectedRevision,propose.c.expectedRevision);assert.equal(confirm.c.expectedResultVersion,propose.c.expectedResultVersion);
    const first=p.group==='confirm_first';result=await race(p.group,first?confirm:propose,first?propose:confirm,'attendance_outage_review_changed');
    const current=call(spec('review',oq));assert.equal(current.revision,2);assert.equal(current.resultVersion,first?1:2);
    assert.equal(current.current.action,first?'confirm':'propose');assert.equal(current.status.resolved,false);
    if(first)assert.equal(current.response.actorId,h.employeeAuthUserId);else assert.equal(current.response,null);
   }else{
    call(spec('review',sq,reviewCommand(p,11,'confirm',selfView)));
    const confirmed=call(spec('review',oq));assert.equal(confirmed.status.canResolve,true);
    const resolve=spec('review',oq,reviewCommand(p,12,'resolve',confirmed));
    const revoke=spec('links',oq,{action:'revoke',operationId:p.fresh(14),expectedRevision:linked.receipt.entry.revision,
     expectedFingerprint:linked.receipt.entry.fingerprint,reason:'Synthetic218 revoke prepared link, never edit clock facts'});
    const first=p.group==='revoke_first';result=await race(p.group,first?revoke:resolve,first?resolve:revoke,first?'attendance_outage_review_blocked':null);
    const current=call(spec('review',oq));assert.equal(current.revision,first?2:3);assert.equal(current.resultVersion,1);
    assert.equal(current.current.action,first?'confirm':'resolve');assert.equal(current.status.resolved,false);
    for(const blocker of ['link_revoked','link_changed','result_changed'])assert(current.status.blockers.includes(blocker),blocker);
    assert.deepEqual(current.proposal,proposal.proposal);
    const latestLink=call(spec('links',oq));assert.equal(latestLink.revision,2);assert.equal(latestLink.current.action,'revoke');
   }
   //Every earlier result remains an immutable same-actor receipt after either
   //losing a CAS or becoming dynamically unresolved; no automatic resubmission.
   const originals=[...committed.values()].filter(x=>x.q.declarationId===p.declaration.declarationId&&['links','review'].includes(x.kind));
   for(const original of originals){
    const recovered=call(spec(original.kind,p.q('recover',original.q.access,original.c.operationId),null,false));
    assert.deepEqual(recovered.receipt,original.receipt);
   }
   for(const entry of [result.left,result.right].filter(Boolean)){
    const original=committed.get(entry.receipt.operationId);assert(original);
    assert.deepEqual(call({...original,allow:false},true).receipt,original.receipt);
   }
   const history=call(spec('review',p.q('history'))),expected=p.group==='resolve_first'?3:2;
   assert.deepEqual(history.history.map(x=>x.revision),Array.from({length:expected},(_,i)=>expected-i));
   assert.equal(history.historyTruncated,false);
   groups.push({group:p.group,exactPidWitnessed:result.exactPidWitnessed,holderAction:result.left.receipt.entry.action,
    waiterError:result.expectedError,waiterCommitted:result.right!==null,failedWaiterZeroWrites:result.failedWaiterZeroWrites});preserve();
  }
  const committedIds=[...committed.keys()],counts=JSON.parse(exec('select jsonb_build_object('+tables.map(name=>quote(name)+`,(select count(*) from public.${name} where operation_id=any(array[${allIds.map(x=>quote(x)+'::uuid').join(',')}]::uuid[]))`).join(',')+');'));
  assert.equal(committedIds.length,23);assert.equal(submissions,23);assert.equal(rejections,3);
  assert.deepEqual(counts,{merchant_attendance_outage_incidents:4,merchant_attendance_outage_declarations:4,merchant_attendance_outage_operations:8,
   merchant_attendance_outage_link_operations:6,merchant_attendance_outage_review_operations:9});
  for(const name of tables)assert.equal(exec(`select count(*) from public.${name} where operation_id=any(array[${allIds.filter(x=>!committed.has(x)).map(x=>quote(x)+'::uuid').join(',')}]::uuid[]);`),'0');
  const periodAfter=await period(pq('detail','owner',periodId));assert.equal(periodAfter.period.sealed,true);
  assert.equal(periodAfter.sourceChanged,periodBefore.sourceChanged);assert.deepEqual(periodAfter.period,periodBefore.period);
  native.pass('218 four exact-PID178 confirmation/proposal and177-link-revoke/resolution races; old facts and both archives preserved');
  return {groups,exactPidRaces:4,reads,submissions,rejections,replays,committedRows:counts,preexistingRowsUnchanged:true,
   allReadsAndReplaysZeroWrites:true,failedWaitersZeroWrites:true,old155ArchivePreserved:true,actualSealedArchivePreserved:true,
   definitionsAndCatalogUnchanged:true,syntheticHistoricalSession:true,actualHistoricalClockRequests:false,newClockRows:0,
   committedOnlyInCallerOwnedSchema:true,allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true,browser:false,productionAccess:false,newCluster:false};
 }finally{preserve();}
}
