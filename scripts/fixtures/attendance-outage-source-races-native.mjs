//219 inert, real correction-submit versus outage-resolve races. The caller owns
//the synthetic schema and its final removal. No historical events/effects are
//edited: each pending correction is explicitly withdrawn through the same RPC.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
import {outageLinksNativeTables} from './attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './attendance-outage-reviews-native.mjs';
const require=createRequire(import.meta.url),startId=id(204710),endId=id(204711);
export const outageSourceRaceGroups=Object.freeze(['submit_first','resolve_first']);
const outageTables=Object.freeze([...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables]);
const correctionTable='merchant_attendance_correction_entries',bindingTable='merchant_attendance_correction_rule_bindings';
const utc6=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');

export function createOutageSourceRacePlan(input,group){
 assert(outageSourceRaceGroups.includes(group));
 for(const n of [input.workerVersion,input.employeeVersion])assert(Number.isSafeInteger(n)&&n>0);
 assert(Number.isSafeInteger(input.generation)&&input.generation>=0);
 const a=Date.parse(input.startAt),b=Date.parse(input.endAt),now=Date.parse(input.now);
 assert(a<b&&b+60000<now&&b-a<31*86400000);
 assert(![a,b].some(n=>!Number.isFinite(n)));
 assert(!(a<Date.parse(input.sealedEnd)&&b+60000>Date.parse(input.sealedStart)),
  'outage_source_race_must_not_overlap_existing_sealed_frame');
 const fresh=n=>id(219200000+outageSourceRaceGroups.indexOf(group)*1000+n);
 const interval={startAt:utc6(a),endAt:utc6(b),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic219 independently recorded outage, no raw clock reconstruction'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic219 source submission race '+group,originalOperationId:null,originalChannel:null,paperReference:null};
 const q=(mode='detail',access='owner',operationId=null)=>({siteId:input.site,access,mode,declarationId:declaration.declarationId,
  ...(mode==='recover'?{operationId}:mode==='history'?{beforeRevision:null}:{})});
 const reference={kind:'session',startEventId:startId,lastEventId:endId,lastSequence:4,effectOperationId:null,effectRevision:null};
 return {fresh,group,incident,declaration,q,reference,proposal:{startAt:utc6(a+60000),endAt:utc6(b+60000),breaks:[]},
  outageOperationIds:[1,3,5,10,11,12].map(fresh),correctionOperationIds:[30,31].map(fresh),requestId:fresh(30)};
}

//Exclude only this phase's precise new rows; rule bindings use request_id,
//not operation_id. Original effects, events and every other row stay protected.
export function outageSourceRaceProtectedSql(names,site,{outage=[],correction=[],requests=[]}={}){
 assert(Array.isArray(names)&&names.length&&new Set(names).size===names.length);assert(/^\d{8}$/.test(site));
 for(const list of [outage,correction,requests]){
  assert(new Set(list).size===list.length);
  for(const op of list)assert(/^00000000-0000-4000-8000-00021920[01][0-9]{3}$/.test(op),'outage_source_race_exact_ids');
 }
 return '(select md5(jsonb_object_agg(source_name,source_rows order by source_name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const ids=outageTables.includes(name)?outage:name===correctionTable?correction:name===bindingTable?requests:[];
  const key=name===bindingTable?'request_id':'operation_id';
  const where=ids.length?` where not (source_row.merchant_id=${quote(site)} and source_row.${key}=any(array[${ids.map(v=>quote(v)+'::uuid').join(',')}]::uuid[]))`:'';
  return `select ${quote(name)} source_name,(select coalesce(jsonb_agg(to_jsonb(source_row) order by to_jsonb(source_row)::text),'[]') from public.${name} source_row${where}) source_rows`;
 }).join(' union all ')+') outage_source_race_facts)';
}

//Both race participants can become visible between a statement's before/after
//hashes. Exclude those TWO exact intents in their own tables, never all219 rows.
//Single writes call this with one intent; withdrawals never permit a binding.
export function outageSourceRaceAllowances(...writes){
 assert(writes.length>=1&&writes.length<=2);
 const allowed={outage:[],correction:[],requests:[]},seen=new Set();
 for(const {kind,c}of writes){
  assert(c&&/^00000000-0000-4000-8000-00021920[01][0-9]{3}$/.test(c.operationId));
  assert(!seen.has(c.operationId));seen.add(c.operationId);
  if(kind==='correction'){
   assert(['submit','withdraw'].includes(c.action));allowed.correction.push(c.operationId);
   if(c.action==='submit')allowed.requests.push(c.operationId);
  }else{assert(['outage','links','review'].includes(kind));allowed.outage.push(c.operationId);}
 }
 return allowed;
}

export async function verifyAttendanceOutageSourceRacesNative(ctx){
 const {d,h,native,scope,period,pq,periodId,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.connect,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard,exec=sql=>d.exec(prefix+sql);
 const names=d.inventory(),defs=d.definitions(),catalog=d.tableCatalog(),allSql=outageNativeFingerprintSql(names),all=()=>exec('select '+allSql+';');
 const savedArchive=periodArchive(),frame=JSON.parse(savedArchive.artifactText).period;
 let reads=0,submissions=0,rejections=0,replays=0;const committed=new Map(),groups=[];
 const readPeriod=async()=>{const before=all(),value=await period(pq('detail','owner',periodId));assert.equal(all(),before);reads++;return value;};
 const periodBefore=await readPeriod();assert(periodBefore.period.sealed);assert.equal(periodBefore.sourceChanged,false);
 const beforeProfile=all(),profile=JSON.parse(exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'session',public.faolla_attendance_period_session_v1(${quote(d.site)},w.id,${quote(startId)},e.id,e.auth_user_id,clock_timestamp()))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)}
   and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert.equal(all(),beforeProfile);assert(profile?.session);reads++;
 const events=profile.session.item.events;
 assert.deepEqual(events.map(e=>[e.id,e.sequence,e.action]),[[startId,3,'clock_in'],[endId,4,'clock_out']]);
 assert.equal(profile.session.item.effect,null);assert.equal(profile.session.ruleBinding.employeeId,h.employeeId);
 assert.equal(profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);
 const input={site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,...profile,
  startAt:events[0].occurredAt,endAt:events[1].occurredAt,sealedStart:frame.startAt,sealedEnd:frame.endAt};
 const plans=outageSourceRaceGroups.map(group=>createOutageSourceRacePlan(input,group));
 const additions={outage:plans.flatMap(p=>p.outageOperationIds),correction:plans.flatMap(p=>p.correctionOperationIds),requests:plans.map(p=>p.requestId)};
 const protectedSql=outageSourceRaceProtectedSql(names,d.site,additions),protectedBefore=exec('select '+protectedSql+';');
 for(const table of [...outageTables,correctionTable,bindingTable])assert(names.includes(table));
 const allIds=[...additions.outage,...additions.correction];assert.equal(new Set(allIds).size,allIds.length);
 exec(`do $source_race_guard$ begin
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_source_guards_enabled';
  ${[...outageTables,correctionTable,bindingTable].map(table=>`assert not exists(select 1 from public.${table} where ${table===bindingTable?'request_id':'operation_id'}=any(array[${allIds.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])),'outage_source_fresh_ids';`).join('\n')}
  assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${quote(d.site)} and worker_id=${quote(h.workerId)} and sealed
   and start_at<${quote(plans[0].proposal.endAt)}::timestamptz and end_at>${quote(plans[0].declaration.interval.startAt)}::timestamptz),'outage_source_unsealed_raw_and_proposed_range';
 end;$source_race_guard$;`);
 const projectors={outage:require('../../src/lib/merchantAttendanceOutage.server.ts').projectOutageResult,
  links:require('../../src/lib/merchantAttendanceOutageLinks.server.ts').projectOutageLinksResult,
  review:require('../../src/lib/merchantAttendanceOutageReview.server.ts').projectOutageReviewResult};
 const {parseCorrectionResult}=require('../../src/lib/merchantAttendanceCorrection.ts');
 const functions={outage:'faolla_attendance_outage_v1',links:'faolla_attendance_outage_links_v1',review:'faolla_attendance_outage_review_v1'};
 const spec=(kind,q,c=null,allow=true)=>({kind,q,c,allow,actor:kind==='correction'||q.access==='self'?h.employeeAuthUserId:d.owner});
 const expression=s=>s.kind==='correction'?`public.faolla_attendance_correction_self_v3(${quote(d.site)},${quote(s.actor)},${json(s.q)},${json(s.c)},${s.allow})`
  :`public.${functions[s.kind]}(${json(s.q)},${quote(s.actor)},${json(s.c)},${s.allow})`;
 const parse=(s,output)=>{
  const raw=JSON.parse(String(output).trim());
  if(s.kind!=='correction')return projectors[s.kind](raw,s.q,s.actor,s.c);
  const q={siteId:d.site,...s.q,...(s.c?{operationId:s.c.operationId}:{})},value=parseCorrectionResult(raw,q,true,true);
  assert.equal(value.employeeId,h.employeeId);assert.equal(value.workerId,h.workerId);
  if(s.c){assert(value.receipt);assert.equal(value.receipt.action,s.c.action);assert.equal(value.receipt.revision,s.c.expectedRevision+1);
   if(s.c.action==='submit'){assert.deepEqual(value.proposal,s.c.proposal);assert.equal(value.reason,s.c.reason);assert.equal(value.item.startEventId,startId);
    assert.equal(value.basis.events.at(-1).id,endId);assert.equal(value.rules.policy.revision,s.c.expectedPolicyRevision);}
   else assert.equal(value.withdrawal.reason,s.c.reason);}
  return value;
 };
 const statement=(s,allowed={},withHash=false)=>{
  const hash=outageSourceRaceProtectedSql(names,d.site,allowed);
  return prefix+`do $outage_source_call$ declare source_before text;source_value jsonb;begin source_before:=${hash};set local role service_role;
   source_value:=${expression(s)};set constraints all immediate;set constraints all deferred;reset role;
   assert source_before=${hash},'outage_source_protected_call_changed';
   perform set_config('faolla.outage219_source_value',source_value::text,true);end;$outage_source_call$;
   select current_setting('faolla.outage219_source_value')::jsonb;${withHash?'select '+allSql+';':''}`;
 };
 const record=(s,value)=>{assert(s.c&&value.receipt&&!committed.has(s.c.operationId));committed.set(s.c.operationId,{...s,receipt:value.receipt});submissions++;return value;};
 const call=(s,replay=false)=>{const value=parse(s,exec(statement(s,s.c&&!replay?outageSourceRaceAllowances(s):{})));
  if(s.c&&!replay)record(s,value);else{reads++;if(replay)replays++;}return value;};
 const reviewCommand=(p,n,action,view)=>({action,operationId:p.fresh(n),expectedRevision:view.revision,expectedResultVersion:view.resultVersion,
  expectedFingerprint:action==='propose'?view.status.basisFingerprint:view.proposal.resultFingerprint,reason:'Synthetic219 explicit '+action+' '+p.group});
 const preserve=()=>{
  assert.equal(exec('select '+protectedSql+';'),protectedBefore,'outage_source_old_rows_changed');
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,savedArchive.artifactText);assert.equal(periodArchive().artifactSha256,savedArchive.artifactSha256);
 };
 try{
  for(const [index,p]of plans.entries()){
   const oq=p.q(),sq=p.q('detail','self');
   const prepared=call(spec('correction',{mode:'prepare',expectedWorkerId:h.workerId,startEventId:startId}));
   assert.equal(prepared.pendingRequestId,null);assert.equal(prepared.revision,index*2,'outage_source_actual_withdrawn_stream_revision');
   assert.equal(prepared.canRequest,true);assert.deepEqual(prepared.rules.issues,[]);assert(prepared.rules.policy.revision>0);
   call(spec('outage',{siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId},p.incident));
   call(spec('outage',{siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId},p.declaration));
   const preview=call(spec('links',{...oq,mode:'preview',sources:[p.reference]}));assert.equal(preview.preview.eligible,true);
   call(spec('links',oq,{action:'apply',operationId:p.fresh(5),expectedRevision:preview.revision,expectedFingerprint:preview.preview.fingerprint,
    sources:[p.reference],reason:'Synthetic219 explicit unchanged source link'}));
   const initial=call(spec('review',oq));assert.equal(initial.status.canPropose,true);
   const proposal=call(spec('review',oq,reviewCommand(p,10,'propose',initial))).receipt.proposal;
   const self=call(spec('review',sq));assert.equal(self.status.canConfirm,true);
   call(spec('review',sq,reviewCommand(p,11,'confirm',self)));
   const confirmed=call(spec('review',oq));assert.equal(confirmed.status.canResolve,true);
   const resolve=spec('review',oq,reviewCommand(p,12,'resolve',confirmed));
   const cq={mode:'detail',expectedWorkerId:h.workerId,requestId:p.requestId,operationId:null};
   const submit=spec('correction',cq,{action:'submit',operationId:p.requestId,expectedRevision:prepared.revision,
    expectedPolicyRevision:prepared.rules.policy.revision,reason:'Synthetic219 real pending source correction '+p.group,
    startEventId:startId,expectedLastEventId:endId,proposal:p.proposal});
   const first=p.group==='submit_first',holder=first?submit:resolve,waiter=first?resolve:submit;
   const raceAllowed=outageSourceRaceAllowances(holder,waiter);
   const raced=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    statement(holder,raceAllowed,true),statement(waiter,raceAllowed));
   assert.equal(raced.witnessed,true,p.group);
   const lines=raced.left.trim().split(/\r?\n/),holderHash=lines.pop();assert.match(holderHash,/^[0-9a-f]{32}$/);assert.equal(lines.length,1);
   record(holder,parse(holder,lines[0]));
   if(first){assert(raced.right.error);assert.equal(raced.right.output,null);
    assert.match(String(raced.right.error),/ERROR:\s+attendance_outage_review_blocked(?:\s|$)/);
    assert.equal(all(),holderHash,'outage_source_failed_waiter_zero_writes');rejections++;
    assert.equal(exec(`select count(*) from public.merchant_attendance_outage_review_operations where merchant_id=${quote(d.site)} and operation_id=${quote(resolve.c.operationId)};`),'0');
   }else{assert.equal(raced.right.error,null);record(waiter,parse(waiter,raced.right.output));}
   const pending=call(spec('review',oq));assert.equal(pending.status.resolved,false);
   assert.equal(pending.current.action,first?'confirm':'resolve');assert.equal(pending.revision,first?2:3);
   for(const blocker of ['pending_source','source_changed','result_changed'])assert(pending.status.blockers.includes(blocker),blocker);
   assert.deepEqual(pending.proposal,proposal);
   const sourceNow=call(spec('links',{...oq,mode:'preview',sources:[p.reference]}));
   assert.equal(sourceNow.preview.observations[0].current.pending,true);
   assert.deepEqual(sourceNow.preview.observations[0].current.reference,p.reference);
   assert.deepEqual(sourceNow.preview.observations[0].current.selected,{startAt:input.startAt,endAt:input.endAt});
   //Saved receipts remain usable while current source is pending; replay must
   //not silently re-run resolution or submit a second correction.
   for(const original of [...committed.values()].filter(v=>v.kind==='review'&&v.q.declarationId===p.declaration.declarationId)){
    const recovered=call(spec('review',p.q('recover',original.q.access,original.c.operationId),null,false));assert.deepEqual(recovered.receipt,original.receipt);
    if(original.c.action==='resolve')assert.deepEqual(call({...original,allow:false},true).receipt,original.receipt);
   }
   const submitted=committed.get(p.requestId),correction=call(spec('correction',cq));
   assert.equal(correction.item.status,'submitted');assert.equal(correction.item.revision,prepared.revision+1);
   assert.deepEqual(call(spec('correction',{...cq,operationId:p.requestId},null,false)).receipt,submitted.receipt);
   preserve();
   //A real append-only withdrawal frees this SAME session for the second
   //independent declaration. This is not deletion or a forged approval/effect.
   const withdrawn=call(spec('correction',cq,{action:'withdraw',operationId:p.fresh(31),requestId:p.requestId,
    expectedRevision:correction.item.revision,reason:'Synthetic219 explicitly withdraw pending test intent after witnessed race'}));
   assert.equal(withdrawn.item.status,'withdrawn');assert.equal(withdrawn.item.revision,prepared.revision+2);
   assert.deepEqual(call(spec('correction',{...cq,operationId:p.requestId},null,false)).receipt,submitted.receipt);
   assert.deepEqual(call(spec('correction',{...cq,operationId:p.fresh(31)},null,false)).receipt,withdrawn.receipt);
   const restored=call(spec('review',oq));assert(!restored.status.blockers.includes('pending_source'));
   assert.equal(restored.status.basisFingerprint,confirmed.status.basisFingerprint);
   assert.equal(restored.status.resolved,!first);assert.equal(restored.status.canResolve,first);
   assert.deepEqual(restored.proposal,proposal);preserve();
   groups.push({group:p.group,exactPidWitnessed:true,holderAction:holder.c.action,waiterError:first?'attendance_outage_review_blocked':null,
    waiterCommitted:!first,pendingSourceBlocksResolution:true,savedReceiptsPreserved:true,actualWithdrawal:true,afterWithdrawalResolved:!first});
  }
  const after=call(spec('correction',{mode:'prepare',expectedWorkerId:h.workerId,startEventId:startId}));
  assert.equal(after.pendingRequestId,null);assert.equal(after.revision,4);
  const periodAfter=await readPeriod();assert.deepEqual(periodAfter.period,periodBefore.period);assert.equal(periodAfter.sourceChanged,false);
  assert.equal(submissions,15);assert.equal(rejections,1);
  const counts=JSON.parse(exec(`select jsonb_build_object('correctionEntries',(select count(*) from public.${correctionTable} where operation_id=any(array[${additions.correction.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])),
   'ruleBindings',(select count(*) from public.${bindingTable} where request_id=any(array[${additions.requests.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])));`));
  assert.deepEqual(counts,{correctionEntries:4,ruleBindings:2});
  native.pass('219 two exact-PID real correction submit versus178resolve races, actual withdrawals, saved receipts and archives preserved');
  return {groups,exactPidRaces:2,reads,submissions,rejections,replays,actualCorrectionSubmissions:2,actualCorrectionWithdrawals:2,counts,
   failedWaiterZeroWrites:true,oldRowsPreserved:true,oldArchivesPreserved:true,originalEventsAndEffectsUnchanged:true,
   pendingObservedBeforeWithdrawals:true,finalPendingRequestId:null,approvalOrEffectRace:false,syntheticHistoricalSession:true,actualHistoricalClockRequests:false,
   committedOnlyInCallerOwnedSchema:true,allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true,browser:false,productionAccess:false,newCluster:false};
 }finally{preserve();}
}
