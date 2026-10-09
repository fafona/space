//221 inert extension of the caller's verified219 schema. Every new request,
//withdrawal, approval, link and result is an actual RPC append. No approved
//missing record is cancelled and no immutable history is edited or removed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
import {outageLinksNativeTables} from './attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './attendance-outage-reviews-native.mjs';

const require=createRequire(import.meta.url),rootId=id(204715),rootApproval=id(204716);
const outageTables=Object.freeze([...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables]);
const requestTable='merchant_attendance_missing_requests',entryTable='merchant_attendance_missing_entries';
export const outageMissingRaceWriteTables=Object.freeze([...outageTables,requestTable,entryTable]);
export const outageMissingRaceGroups=Object.freeze(['submit_first','resolve_first']);
const freshId=/^00000000-0000-4000-8000-00022120[01][0-9]{3}$/;
const utc6=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');

export function createOutageMissingRacePlan(input,group){
 assert(outageMissingRaceGroups.includes(group));
 for(const key of ['workerVersion','employeeVersion'])assert(Number.isSafeInteger(input[key])&&input[key]>0);
 assert(Number.isSafeInteger(input.generation)&&input.generation>=0);
 const a=Date.parse(input.startAt),b=Date.parse(input.endAt),now=Date.parse(input.now),sealedA=Date.parse(input.sealedStart),sealedB=Date.parse(input.sealedEnd);
 assert([a,b,now,sealedA,sealedB].every(Number.isFinite));assert(a<b&&b-a===300000&&b+60000<now&&sealedA<sealedB);
 assert(!(a<sealedB&&b+60000>sealedA),'outage_missing_no_existing_sealed_overlap');
 const fresh=n=>id(221200000+outageMissingRaceGroups.indexOf(group)*1000+n);
 const interval={startAt:utc6(a),endAt:utc6(b+60000),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic221 missing-source concurrency, not a reconstructed clock'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic221 explicit missing-source statement '+group,
  originalOperationId:null,originalChannel:null,paperReference:null};
 const q=(mode='detail',access='owner',operationId=null)=>({siteId:input.site,access,mode,declarationId:declaration.declarationId,
  ...(mode==='recover'?{operationId}:mode==='history'?{beforeRevision:null}:{})});
 return {fresh,group,incident,declaration,q,reference:{kind:'missing',requestId:rootId,rootRequestId:rootId,approvalOperationId:rootApproval},
  proposal:{startAt:utc6(a+60000),endAt:utc6(b+60000),breaks:[]},requestId:fresh(30),
  outageOperationIds:(group==='submit_first'?[1,3,5,10,11]:[1,3,5,10,11,12,13,14,15,16,17]).map(fresh),missingOperationIds:[30,31].map(fresh)};
}

//Protect all pre-existing rows, including rows in these same seven tables.
//Only request INSERTs use request_id; terminal entries use operation_id.
export function outageMissingRaceProtectedSql(names,site,{outage=[],missing=[],requests=[]}={}){
 assert(Array.isArray(names)&&names.length&&new Set(names).size===names.length);assert(/^\d{8}$/.test(site));
 for(const list of [outage,missing,requests]){assert(new Set(list).size===list.length);for(const op of list)assert(freshId.test(op),'outage_missing_exact221_ids');}
 return '(select md5(jsonb_object_agg(missing_name,missing_rows order by missing_name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const allowed=outageTables.includes(name)?outage:name===requestTable?requests:name===entryTable?missing:[];
  const key=name===requestTable?'request_id':'operation_id';
  const where=allowed.length?` where not (missing_row.merchant_id=${quote(site)} and missing_row.${key}=any(array[${allowed.map(v=>quote(v)+'::uuid').join(',')}]::uuid[]))`:'';
  return `select ${quote(name)} missing_name,(select coalesce(jsonb_agg(to_jsonb(missing_row) order by to_jsonb(missing_row)::text),'[]') from public.${name} missing_row${where}) missing_rows`;
 }).join(' union all ')+') outage_missing_protected_facts)';
}
export function outageMissingRaceAllowances(...writes){
 assert(writes.length>=1&&writes.length<=2);const allowed={outage:[],missing:[],requests:[]},seen=new Set();
 for(const {kind,c}of writes){assert(c&&freshId.test(c.operationId)&&!seen.has(c.operationId));seen.add(c.operationId);
  if(kind==='missing'){assert(['revise','withdraw','approve'].includes(c.action));allowed.missing.push(c.operationId);if(c.action==='revise')allowed.requests.push(c.operationId);}
  else{assert(['outage','links','review'].includes(kind));allowed.outage.push(c.operationId);}
 }
 return allowed;
}

export async function verifyAttendanceOutageMissingRacesNative(ctx){
 const {d,h,native,scope,period,pq,periodId,archive,oldArchive,periodArchive,outageContinuityFoundation}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(outageContinuityFoundation?.phase,219);
 assert.equal(outageContinuityFoundation.oldRowsPreserved,true);assert.equal(outageContinuityFoundation.sourceRaces.finalPendingRequestId,null);
 assert.equal(typeof native.connect,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard,exec=sql=>d.exec(prefix+sql);
 const names=d.inventory(),defs=d.definitions(),catalog=d.tableCatalog(),allSql=outageNativeFingerprintSql(names),all=()=>exec('select '+allSql+';');
 const savedArchive=periodArchive(),frame=JSON.parse(savedArchive.artifactText).period;
 let reads=0,submissions=0,rejections=0,replays=0;const committed=new Map(),groups=[];
 const readPeriod=async()=>{const before=all(),value=await period(pq('detail','owner',periodId));assert.equal(all(),before);reads++;return value;};
 const periodBefore=await readPeriod();assert(periodBefore.period.sealed);assert.equal(periodBefore.sourceChanged,false);
 //The callback's h.slot is full-leave day-3. Obtain the real204 approved root
 //by identity/root ID, never infer its day-2 interval from that unrelated slot.
 const profileBefore=all(),profile=JSON.parse(exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'today',(clock_timestamp() at time zone 'UTC')::date,'now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'location',m.location_id,'timeZone',m.time_zone,'startAt',to_char(m.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'endAt',to_char(m.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'proposal',m.proposal,
  'proof',public.faolla_attendance_plan_posthoc_missing_v1(${quote(d.site)},w.id,e.id,e.auth_user_id,m.request_id))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  join public.merchant_attendance_missing_current_v1 m on m.merchant_id=w.merchant_id and m.worker_id=w.id and m.employee_id=e.id and m.actor_auth_user_id=e.auth_user_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)}
   and coalesce(m.root_request_id,m.request_id)=${quote(rootId)} and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert.equal(all(),profileBefore);reads++;assert(profile?.proof);assert.equal(profile.timeZone,'UTC');assert.equal(profile.location,d.location);
 assert.equal(profile.proof.current,true);assert.equal(profile.proof.pending,false);assert.deepEqual(profile.proof.reference,{kind:'missing',requestId:rootId,rootRequestId:rootId,approvalOperationId:rootApproval});
 assert.deepEqual(profile.proposal,{startAt:profile.startAt,endAt:profile.endAt,breaks:[]});
 const input={...profile,site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,sealedStart:frame.startAt,sealedEnd:frame.endAt};
 const plans=outageMissingRaceGroups.map(group=>createOutageMissingRacePlan(input,group));
 const additions={outage:plans.flatMap(p=>p.outageOperationIds),missing:plans.flatMap(p=>p.missingOperationIds),requests:plans.map(p=>p.requestId)};
 const protectedSql=outageMissingRaceProtectedSql(names,d.site,additions),protectedBefore=exec('select '+protectedSql+';');
 const allIds=[...additions.outage,...additions.missing,plans[0].fresh(12),plans[1].fresh(18)];assert.equal(new Set(allIds).size,allIds.length);
 for(const table of outageMissingRaceWriteTables)assert(names.includes(table));
 exec(`do $missing_race_guard$ begin
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_missing_guards_enabled';
  ${outageMissingRaceWriteTables.map(table=>`assert exists(select 1 from pg_class c where c.oid='public.${table}'::regclass and c.relnamespace=${owned.oid} and c.relrowsecurity),'outage_missing_owned_table';
   assert not exists(select 1 from public.${table} where ${table===requestTable?'request_id':'operation_id'}=any(array[${allIds.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])),'outage_missing_fresh_ids';`).join('\n')}
  assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${quote(d.site)} and worker_id=${quote(h.workerId)} and sealed
   and start_at<${quote(plans[0].declaration.interval.endAt)}::timestamptz and end_at>${quote(plans[0].declaration.interval.startAt)}::timestamptz),'outage_missing_unsealed_original_and_proposed_range';
 end;$missing_race_guard$;`);
 const projectors={outage:require('../../src/lib/merchantAttendanceOutage.server.ts').projectOutageResult,
  links:require('../../src/lib/merchantAttendanceOutageLinks.server.ts').projectOutageLinksResult,
  review:require('../../src/lib/merchantAttendanceOutageReview.server.ts').projectOutageReviewResult};
 const {parseMissingBody,parseMissingResult}=require('../../src/lib/merchantAttendanceMissing.ts');
 const functions={outage:'faolla_attendance_outage_v1',links:'faolla_attendance_outage_links_v1',review:'faolla_attendance_outage_review_v1',missing:'faolla_attendance_missing_v1'};
 const mq=(access='self',requestId=null,operationId=null)=>({siteId:d.site,access,fromDate:profile.today,throughDate:profile.today,requestId,operationId,beforeAt:null,beforeId:null});
 const spec=(kind,q,c=null,allow=true)=>({kind,q,c,allow,actor:q.access==='self'?h.employeeAuthUserId:d.owner});
 const expression=s=>`public.${functions[s.kind]}(${json(s.q)},${quote(s.actor)},${json(s.c)},${s.allow})`;
 const parse=(s,output)=>{
  const raw=JSON.parse(String(output).trim());if(s.kind!=='missing')return projectors[s.kind](raw,s.q,s.actor,s.c);
  const value=parseMissingResult(raw,{...s.q,operationId:s.c?.operationId??s.q.operationId},false);
  if(s.q.access==='self'){assert.equal(value.workerId,h.workerId);assert.equal(value.employeeId,h.employeeId);}
  if(s.c){assert(value.receipt);assert.deepEqual(value.receipt.command,parseMissingBody({query:s.q,command:s.c}).command);
   assert.equal(value.receipt.revision,s.c.action==='revise'?1:2);assert.equal(value.receipt.requestId,s.c.action==='revise'?s.c.operationId:s.c.requestId);}
  return value;
 };
 const statement=(s,allowed={},withHash=false)=>{
  const hash=outageMissingRaceProtectedSql(names,d.site,allowed);
  return prefix+`do $outage_missing_call$ declare missing_before text;missing_value jsonb;begin missing_before:=${hash};set local role service_role;
   missing_value:=${expression(s)};set constraints all immediate;set constraints all deferred;reset role;
   assert missing_before=${hash},'outage_missing_protected_call_changed';
   perform set_config('faolla.outage221_missing_value',missing_value::text,true);end;$outage_missing_call$;
   select current_setting('faolla.outage221_missing_value')::jsonb;${withHash?'select '+allSql+';':''}`;
 };
 const record=(s,value)=>{assert(s.c&&value.receipt&&!committed.has(s.c.operationId));committed.set(s.c.operationId,{...s,receipt:value.receipt});submissions++;return value;};
 const call=(s,replay=false)=>{const value=parse(s,exec(statement(s,s.c&&!replay?outageMissingRaceAllowances(s):{})));
  if(s.c&&!replay)record(s,value);else{reads++;if(replay)replays++;}return value;};
 const reject=(s,code)=>{const before=all();assert.throws(()=>exec(statement(s)),error=>new RegExp('ERROR:\\s+'+code+'(?:\\s|$)').test(String(error)));
  assert.equal(all(),before,'outage_missing_rejection_zero_writes');rejections++;};
 const reviewCommand=(p,n,action,view)=>({action,operationId:p.fresh(n),expectedRevision:view.revision,expectedResultVersion:view.resultVersion,
  expectedFingerprint:action==='propose'?view.status.basisFingerprint:view.proposal.resultFingerprint,reason:'Synthetic221 explicit '+action+' '+p.group});
 const preserve=()=>{
  assert.equal(exec('select '+protectedSql+';'),protectedBefore,'outage_missing_preexisting_rows_changed');
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,savedArchive.artifactText);assert.equal(periodArchive().artifactSha256,savedArchive.artifactSha256);
 };
 const recover=(original)=>{
  const q=original.kind==='missing'?mq(original.q.access,original.receipt.requestId,original.c.operationId)
   :original.kind==='outage'?{siteId:d.site,access:original.q.access,mode:'recover',operationId:original.c.operationId}
    :{siteId:d.site,access:original.q.access,mode:'recover',declarationId:original.q.declarationId,operationId:original.c.operationId};
  assert.deepEqual(call(spec(original.kind,q,null,false)).receipt,original.receipt);
  assert.deepEqual(call({...original,allow:false},true).receipt,original.receipt);
 };
 const rootReceipts=[spec('missing',mq('self',rootId,rootId),null,false),spec('missing',mq('owner',rootId,rootApproval),null,false)]
  .map(s=>({s,receipt:call(s).receipt}));for(const item of rootReceipts)assert(item.receipt);
 try{
  for(const p of plans){
   const oq=p.q(),sq=p.q('detail','self'),home=call(spec('missing',mq('self',rootId)));
   assert(home.canRequest&&home.policyRevision>0&&home.detail.lineage.canRevise);
   assert.equal(home.detail.lineage.currentRequestId,rootId);assert.equal(home.detail.lineage.currentApprovalOperationId,rootApproval);
   assert.equal(home.locationId,input.location);assert.equal(home.timeZone,'UTC');
   call(spec('outage',{siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId},p.incident));
   call(spec('outage',{siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId},p.declaration));
   const preview=call(spec('links',{...oq,mode:'preview',sources:[p.reference]}));assert.equal(preview.preview.eligible,true);
   const savedLink=call(spec('links',oq,{action:'apply',operationId:p.fresh(5),expectedRevision:preview.revision,expectedFingerprint:preview.preview.fingerprint,
    sources:[p.reference],reason:'Synthetic221 explicit original approved missing link'})).receipt.entry;
   const initial=call(spec('review',oq));assert.equal(initial.status.canPropose,true);
   const proposal=call(spec('review',oq,reviewCommand(p,10,'propose',initial))).receipt.proposal;
   const self=call(spec('review',sq));assert.equal(self.status.canConfirm,true);
   call(spec('review',sq,reviewCommand(p,11,'confirm',self)));
   const confirmed=call(spec('review',oq));assert.equal(confirmed.status.canResolve,true);
   const resolve=spec('review',oq,reviewCommand(p,12,'resolve',confirmed));
   //Each missing child has its own revision1/terminal2. This is NOT the
   //correction stream's monotonically increasing submit/withdraw revision.
   const submit=spec('missing',mq('self'),{action:'revise',operationId:p.requestId,reason:'Synthetic221 real employee missing replacement '+p.group,
    expectedWorkerId:h.workerId,expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:home.policyRevision,locationId:home.locationId,timeZone:home.timeZone,
    proposal:p.proposal,supersedesRequestId:home.detail.lineage.currentRequestId,expectedApprovalOperationId:home.detail.lineage.currentApprovalOperationId});
   const first=p.group==='submit_first',holder=first?submit:resolve,waiter=first?resolve:submit;
   const raceAllowed=outageMissingRaceAllowances(holder,waiter);
   const raced=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    statement(holder,raceAllowed,true),statement(waiter,raceAllowed));
   assert.equal(raced.witnessed,true,p.group);
   const lines=raced.left.trim().split(/\r?\n/),holderHash=lines.pop();assert.match(holderHash,/^[0-9a-f]{32}$/);assert.equal(lines.length,1);
   record(holder,parse(holder,lines[0]));
   if(first){assert(raced.right.error);assert.equal(raced.right.output,null);assert.match(String(raced.right.error),/ERROR:\s+attendance_outage_review_blocked(?:\s|$)/);
    assert.equal(all(),holderHash,'outage_missing_failed_waiter_zero_writes');rejections++;
    assert.equal(exec(`select count(*) from public.merchant_attendance_outage_review_operations where merchant_id=${quote(d.site)} and operation_id=${quote(resolve.c.operationId)};`),'0');
   }else{assert.equal(raced.right.error,null);record(waiter,parse(waiter,raced.right.output));}
   const pending=call(spec('review',oq));assert.equal(pending.status.resolved,false);assert.equal(pending.current.action,first?'confirm':'resolve');
   assert.equal(pending.revision,first?2:3);assert.deepEqual(pending.proposal,proposal);
   for(const blocker of ['pending_source','source_changed','result_changed'])assert(pending.status.blockers.includes(blocker),blocker);
   const pendingLink=call(spec('links',oq));assert.deepEqual(pendingLink.current,savedLink);
   const observation=pendingLink.preview.observations[0];assert.equal(observation.pending,true);assert.equal(observation.current.pending,true);
   assert.deepEqual(observation.current.reference,p.reference);assert.deepEqual(observation.current.selected,{startAt:input.startAt,endAt:input.endAt});
   const child=call(spec('missing',mq('self',p.requestId)));assert.equal(child.detail.status,'submitted');assert.equal(child.detail.revision,1);
   for(const original of [...committed.values()].filter(v=>v.kind==='review'&&v.q.declarationId===oq.declarationId))recover(original);
   recover(committed.get(p.requestId));preserve();
   if(first){
    const withdrawn=call(spec('missing',mq('self',p.requestId),{action:'withdraw',operationId:p.fresh(31),requestId:p.requestId,expectedRevision:1,
     reason:'Synthetic221 explicit withdrawal frees this root for the second race'}));
    assert.equal(withdrawn.detail.status,'withdrawn');assert.equal(withdrawn.receipt.revision,2);
    const restored=call(spec('review',oq));assert.equal(restored.status.basisFingerprint,confirmed.status.basisFingerprint);
    assert.equal(restored.status.canResolve,true);assert.equal(restored.status.resolved,false);assert.deepEqual(restored.proposal,proposal);
    assert(!restored.status.blockers.includes('pending_source'));recover(committed.get(p.fresh(31)));
    groups.push({group:p.group,exactPidWitnessed:true,waiterError:'attendance_outage_review_blocked',failedWaiterZeroWrites:true,
     actualPendingChildWithdrawal:true,afterWithdrawalCanResolve:true,afterWithdrawalResolved:false});
   }else{
    const oldResolve=committed.get(p.fresh(12)),review=call(spec('missing',mq('owner',p.requestId)));
    assert.equal(review.detail.canApprove,true,JSON.stringify(review.detail.issues));assert.deepEqual(review.detail.issues,[]);
    const approved=call(spec('missing',mq('owner',p.requestId),{action:'approve',operationId:p.fresh(31),requestId:p.requestId,expectedRevision:1,
     evidenceToken:review.detail.evidenceToken,reason:'Synthetic221 actual owner approves replacement after witnessed submit race'}));
    assert.equal(approved.detail.status,'approved');assert.equal(approved.detail.lineage.rootRequestId,rootId);
    const newRef={kind:'missing',requestId:p.requestId,rootRequestId:rootId,approvalOperationId:p.fresh(31)};
    assert.equal(approved.detail.lineage.currentRequestId,newRef.requestId);assert.equal(approved.detail.lineage.currentApprovalOperationId,newRef.approvalOperationId);
    const changed=call(spec('review',oq)),changedLink=call(spec('links',oq));
    assert.equal(changed.status.resolved,false);assert.equal(changed.status.canResolve,false);assert.equal(changed.current.action,'resolve');
    assert.deepEqual(changed.current,oldResolve.receipt.entry);assert.deepEqual(changed.proposal,proposal);assert.deepEqual(changedLink.current,savedLink);
    for(const blocker of ['source_changed','result_changed'])assert(changed.status.blockers.includes(blocker));assert(!changed.status.blockers.includes('pending_source'));
    assert.equal(changedLink.preview.observations[0].changed,true);assert.deepEqual(changedLink.preview.observations[0].reference,p.reference);
    assert.deepEqual(changedLink.preview.observations[0].current.reference,newRef);assert.deepEqual(changedLink.preview.observations[0].current.selected,{startAt:p.proposal.startAt,endAt:p.proposal.endAt});
    const stale=call(spec('links',{...oq,mode:'preview',sources:[p.reference]}));assert.equal(stale.preview.eligible,false);assert(stale.preview.blockers.includes('source_changed'));
    reject(spec('links',oq,{action:'apply',operationId:p.fresh(18),expectedRevision:stale.revision,expectedFingerprint:stale.preview.fingerprint,
     sources:[p.reference],reason:'Synthetic221 must not silently adopt a replacement through stale references'}),'attendance_outage_links_blocked');
    recover(oldResolve);recover(committed.get(p.fresh(5)));recover(committed.get(p.requestId));recover(committed.get(p.fresh(31)));
    call(spec('review',oq,reviewCommand(p,13,'reopen',changed)));
    const fresh=call(spec('links',{...oq,mode:'preview',sources:[newRef]}));assert.equal(fresh.preview.eligible,true);assert.deepEqual(fresh.preview.blockers,[]);
    const linked=call(spec('links',oq,{action:'apply',operationId:p.fresh(14),expectedRevision:fresh.revision,expectedFingerprint:fresh.preview.fingerprint,
     sources:[newRef],reason:'Synthetic221 explicitly select the new approved head; no automatic migration'})).receipt.entry;
    assert.equal(linked.revision,2);assert.deepEqual(linked.sources,[newRef]);
    const reproposable=call(spec('review',oq));assert.equal(reproposable.status.canPropose,true);
    const newProposal=call(spec('review',oq,reviewCommand(p,15,'propose',reproposable))).receipt.proposal;
    assert.equal(newProposal.resultVersion,2);assert.notEqual(newProposal.resultFingerprint,proposal.resultFingerprint);
    const reconfirmable=call(spec('review',sq));assert.equal(reconfirmable.status.canConfirm,true);
    call(spec('review',sq,reviewCommand(p,16,'confirm',reconfirmable)));
    const resolvable=call(spec('review',oq));assert.equal(resolvable.status.canResolve,true);
    call(spec('review',oq,reviewCommand(p,17,'resolve',resolvable)));
    const final=call(spec('review',oq));assert.equal(final.status.resolved,true);assert.deepEqual(final.status.blockers,[]);
    assert.equal(final.revision,7);assert.equal(final.resultVersion,2);assert.deepEqual(final.proposal,newProposal);recover(oldResolve);
    groups.push({group:p.group,exactPidWitnessed:true,waiterError:null,bothCommitted:true,actualReplacementApproval:true,
     savedSourceAndResultUnchanged:true,staleReferenceRejectedZeroWrites:true,explicitReopenRelinkAndBothParties:true,finalResolved:true,finalResultVersion:2});
   }
   preserve();
  }
  //The later replacement legitimately makes group1's old confirmed proposal
  //stale again. It does not alter its saved entries or magically resolve it.
  const earlier=call(spec('review',plans[0].q()));assert.equal(earlier.current.action,'confirm');assert.equal(earlier.status.resolved,false);
  assert(earlier.status.blockers.includes('source_changed'));assert(earlier.status.blockers.includes('result_changed'));
  for(const item of rootReceipts)assert.deepEqual(call(item.s).receipt,item.receipt);
  for(const original of committed.values())recover(original);
  const periodAfter=await readPeriod();assert.deepEqual(periodAfter.period,periodBefore.period);assert.equal(periodAfter.sourceChanged,false);
  assert.equal(submissions,20);assert.equal(rejections,2);
  const counts=JSON.parse(exec(`select jsonb_build_object('requests',(select count(*) from public.${requestTable} where merchant_id=${quote(d.site)} and request_id=any(array[${additions.requests.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])),
   'entries',(select count(*) from public.${entryTable} where merchant_id=${quote(d.site)} and operation_id=any(array[${additions.missing.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])),
   'links',(select count(*) from public.merchant_attendance_outage_link_operations where merchant_id=${quote(d.site)} and operation_id=any(array[${additions.outage.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])),
   'reviews',(select count(*) from public.merchant_attendance_outage_review_operations where merchant_id=${quote(d.site)} and operation_id=any(array[${additions.outage.map(v=>quote(v)+'::uuid').join(',')}]::uuid[])));`));
  assert.deepEqual(counts,{requests:2,entries:4,links:3,reviews:9});preserve();
  native.pass('221 two exact-PID real missing revise versus178resolve races; withdrawal and actual approval/relink/reconfirmation; exact old receipts and archives preserved');
  return {groups,exactPidRaces:2,reads,submissions,rejections,replays,counts,actualMissingRevisions:2,actualMissingWithdrawals:1,actualMissingApprovals:1,
   approvalRace:false,approvedMissingCancellation:false,oldRowsPreserved:true,oldArchivesPreserved:true,originalRawEventsAndEffectsUnchanged:true,
   firstGroupStaleAfterLaterRootReplacement:true,secondGroupExplicitlyResolved:true,sameFiveMinuteApprovedDuration:true,
   allowedAppendTables:outageMissingRaceWriteTables,committedOnlyInCallerOwnedSchema:true,allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true,
   browser:false,productionAccess:false,newCluster:false};
 }finally{preserve();}
}
