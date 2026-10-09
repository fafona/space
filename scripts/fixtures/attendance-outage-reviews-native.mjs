//214 inert caller-owned acceptance. Reuses disclosed204 synthetic history;
//176/177/178 and source correction operations are real RPCs, all rolled back.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
import {outageLinksNativeTables} from './attendance-outage-links-native.mjs';
const require=createRequire(import.meta.url),stamp=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');
const startId=id(204710),endId=id(204711);
export const outageReviewsNativeTables=Object.freeze(['merchant_attendance_outage_review_operations']);
export function createOutageReviewsNativePlan(input,group='no_original'){
 const groups=['no_original','known_original','unknown_original'];assert(groups.includes(group));
 const fresh=n=>id(214000000+groups.indexOf(group)*1000+n);
 const interval={startAt:stamp(Math.min(Date.parse(input.sealedStart),Date.parse(input.startAt))),
  endAt:stamp(Math.max(Date.parse(input.sealedEnd),Date.parse(input.endAt))+900000),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.startAt)<Date.parse(interval.endAt)&&Date.parse(interval.endAt)<Date.parse(input.now));
 assert(Date.parse(interval.endAt)-Date.parse(interval.startAt)<31*86400000);
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic214 reported outage, not reconstructed clock work'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic214 statement for exact-version employee review',
  originalOperationId:group==='no_original'?null:group==='known_original'?input.originalOperationId:fresh(999),
  originalChannel:group==='no_original'?null:'web',paperReference:null};
 const q=(mode='detail',access='owner',value=null)=>({siteId:input.site,access,mode,declarationId:declaration.declarationId,
  ...(mode==='history'?{beforeRevision:value}:mode==='recover'?{operationId:value}:{})});
 const reference={kind:'session',startEventId:startId,lastEventId:endId,lastSequence:4,effectOperationId:null,effectRevision:null};
 return {fresh,incident,declaration,q,reference};
}

export async function verifyAttendanceOutageReviewsNative(ctx){
 const {d,h,native,scope,archive,oldArchive,period,pq,periodId,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 assert((await period(pq('detail','owner',periodId))).period.sealed);
 const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),sealedArchive=periodArchive();
 for(const table of [...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables])assert(names.includes(table),table);
 const fullHash=outageNativeFingerprintSql(names),protect=allowed=>outageNativeFingerprintSql(names.filter(name=>!allowed.includes(name)));
 const site=quote(d.site),owner=quote(d.owner),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId);
 const format='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC',${quote(format)}),
  'session',public.faolla_attendance_period_session_v1(${site},w.id,${quote(startId)},e.id,e.auth_user_id,clock_timestamp()),
  'originalOperationId',(select operation_id from public.merchant_attendance_events where merchant_id=${site} and id=${quote(startId)}))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${site} and w.id=${worker} and e.id=${employee} and e.auth_user_id=${auth} and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert(profile?.session);assert.equal(d.fingerprint(),baseline);
 const events=profile.session.item.events;assert.deepEqual(events.map(e=>[e.id,e.sequence,e.action]),[[startId,3,'clock_in'],[endId,4,'clock_out']]);
 assert.equal(profile.session.item.effect,null);assert.equal(profile.session.ruleBinding.employeeId,h.employeeId);assert.equal(profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);
 const input={site:d.site,owner:d.owner,employee:h.employeeId,auth:h.employeeAuthUserId,worker:h.workerId,location:h.slot.locationId,...profile,
  startAt:events[0].occurredAt,endAt:events.at(-1).occurredAt,sealedStart:h.slot.startAt,sealedEnd:h.slot.endAt};
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const {projectOutageLinksResult}=require('../../src/lib/merchantAttendanceOutageLinks.server.ts');
 const {projectOutageReviewResult}=require('../../src/lib/merchantAttendanceOutageReview.server.ts');
 const {parseOutageReviewQuery,parseOutageReviewCommand}=require('../../src/lib/merchantAttendanceOutageReview.ts');
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const saved=label=>`(current_setting('faolla.outage214_${label}')::jsonb->'value')`;
 const savedCommand=label=>`(current_setting('faolla.outage214_${label}')::jsonb->'command')`;
 const archives=()=>{
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,sealedArchive.artifactText);assert.equal(periodArchive().artifactSha256,sealedArchive.artifactSha256);
 };
 const groups=[];let totalReads=0,totalWrites=0,totalRejects=0,totalSourceWrites=0;
 async function scenario(group){
  const p=createOutageReviewsNativePlan(input,group),steps=[],expected=new Map();let reads=0,writes=0,rejections=0,sourceWrites=0;
  const oq=json(p.q()),sq=json(p.q('detail','self'));
  const rpc=(q,c,actor=d.owner,allow=true)=>`public.faolla_attendance_outage_review_v1(${q},${quote(actor)},${c},${allow})`;
  const command=(number,action,basis)=>`jsonb_build_object('action',${quote(action)},'operationId',${quote(p.fresh(number))},
   'expectedRevision',${saved(basis)}->'revision','expectedResultVersion',${saved(basis)}->'resultVersion',
   'expectedFingerprint',${saved(basis)}${action==='propose'?"->'status'->'basisFingerprint'":"->'proposal'->'resultFingerprint'"},
   'reason',${quote('Synthetic214 explicit '+action)})`;
  const call=(label,{q=oq,c='null',kind='review',actor=d.owner,allow=true,write=false,replay=false,expression,allowed=[]}={})=>{
   assert(/^[a-z_]+$/.test(label)&&!expected.has(label));expected.set(label,{kind,write,replay});
   if(write&&!replay){if(kind==='correction')sourceWrites++;else writes++;}else reads++;
   const hash=write&&!replay?protect(allowed.length?allowed:kind==='review'?outageReviewsNativeTables:kind==='links'?outageLinksNativeTables:outageNativeTables):fullHash;
   steps.push(prefix+`do $outage_review_call$ declare review_before text;review_after text;review_query jsonb;review_command jsonb;review_value jsonb;begin
    review_before:=${hash};review_query:=${q};review_command:=${c};set local role service_role;
    review_value:=${expression??rpc('review_query','review_command',actor,allow)};
    set constraints all immediate;set constraints all deferred;reset role;review_after:=${hash};
    assert review_after=review_before,'outage_reviews_read_or_protected_facts_changed';
    perform set_config(${quote('faolla.outage214_'+label)},jsonb_build_object('label',${quote(label)},'kind',${quote(kind)},'query',review_query,
     'actor',${quote(actor)},'command',review_command,'value',review_value,'before',review_before,'after',review_after)::text,true);
   end;$outage_review_call$;select current_setting(${quote('faolla.outage214_'+label)})::jsonb;`);
  };
  const reject=(label,q,c,code,{actor=d.owner,allow=true,setup=''}={})=>{
   rejections++;steps.push(prefix+`do $outage_review_denied$ declare review_before text;begin review_before:=${fullHash};
    begin ${setup}set local role service_role;perform ${rpc(q,c,actor,allow)};raise exception 'outage_review_expected_rejection_missing';
    exception when others then if sqlerrm<>${quote(code)} then raise;end if;end;reset role;
    assert ${fullHash}=review_before,'outage_reviews_rejected_write';end;$outage_review_denied$;
    select jsonb_build_object('kind','rejection','label',${quote(label)},'code',${quote(code)});`);
  };
  const seal=`assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and sealed),'outage_reviews_actual_seal_required';`;
  steps.push('begin;'+prefix+`do $outage_reviews_start$ begin ${seal}
   assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_reviews_all_guards_enabled';
   assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${site}),'outage_reviews_empty176_required';
   assert not exists(select 1 from public.merchant_attendance_outage_link_operations where merchant_id=${site}),'outage_reviews_empty177_required';
   assert not exists(select 1 from public.merchant_attendance_outage_review_operations where merchant_id=${site}),'outage_reviews_empty178_required';end;$outage_reviews_start$;`);
  call('incident',{q:json({siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId}),c:json(p.incident),kind:'outage',write:true,
   expression:`public.faolla_attendance_outage_v1(review_query,${owner},review_command,true)`});
  call('declaration',{q:json({siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId}),c:json(p.declaration),kind:'outage',write:true,
   expression:`public.faolla_attendance_outage_v1(review_query,${owner},review_command,true)`});
  const linkPreview=refs=>`(${oq}||jsonb_build_object('mode','preview','sources',${refs}))`;
  call('link_preview',{q:linkPreview(json([p.reference])),kind:'links',expression:`public.faolla_attendance_outage_links_v1(review_query,${owner},null,true)`});
  const linkCommand=(n,version,label,refs)=>`jsonb_build_object('action','apply','operationId',${quote(p.fresh(n))},'expectedRevision',${version},
   'expectedFingerprint',${saved(label)}->'preview'->'fingerprint','sources',${refs},'reason','Synthetic214 explicit source association')`;
  call('link_apply',{c:linkCommand(5,0,'link_preview',json([p.reference])),kind:'links',write:true,
   expression:`public.faolla_attendance_outage_links_v1(review_query,${owner},review_command,true)`});
  call('initial');
  reject('fresh_gate_off',oq,command(10,'propose','initial'),'attendance_outage_review_disabled',{allow:false});
  reject('stale_basis',oq,`(${command(10,'propose','initial')}||jsonb_build_object('expectedFingerprint',repeat('0',64)))`,'attendance_outage_review_changed');
  call('propose',{c:command(10,'propose','initial'),write:true});
  call('proposal_detail');call('self_proposal',{q:sq,actor:h.employeeAuthUserId});
  call('proposal_replay_off',{c:savedCommand('propose'),write:true,replay:true,allow:false});
  call('proposal_recover_off',{q:json(p.q('recover','owner',p.fresh(10))),allow:false});
  reject('same_operation_conflict',oq,`(${savedCommand('propose')}||jsonb_build_object('reason','Not the original proposal'))`,'attendance_operation_conflict');
  reject('unknown_recovery',json(p.q('recover','owner',p.fresh(990))),'null','attendance_outage_review_not_found',{allow:false});
  reject('employee_cannot_owner_read',oq,'null','attendance_access_denied',{actor:h.employeeAuthUserId});
  reject('other_merchant',json({...p.q(),siteId:'99990002'}),'null','attendance_access_denied');
  const permission=`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.request') where merchant_id=${site} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`;
  reject('self_permission_revoked',sq,'null','attendance_access_denied',{actor:h.employeeAuthUserId,setup:permission});
  if(group==='unknown_original'){
   reject('unknown_original_confirm',sq,command(11,'confirm','self_proposal'),'attendance_outage_review_blocked',{actor:h.employeeAuthUserId});
   reject('unknown_original_resolve',oq,command(12,'resolve','proposal_detail'),'attendance_outage_review_blocked');
   call('dispute',{q:sq,c:command(13,'dispute','self_proposal'),actor:h.employeeAuthUserId,write:true});
   call('disputed_detail');call('self_dispute_recover',{q:json(p.q('recover','self',p.fresh(13))),actor:h.employeeAuthUserId,allow:false});
  }else{
   call('confirm',{q:sq,c:command(11,'confirm','self_proposal'),actor:h.employeeAuthUserId,write:true});
   call('confirmed_detail');
   call('resolve',{c:command(12,'resolve','confirmed_detail'),write:true});call('resolved_detail');
   call('self_confirm_recover',{q:json(p.q('recover','self',p.fresh(11))),actor:h.employeeAuthUserId,allow:false});
   if(group==='no_original'){
    //Real old writers modify only an unsealed source day, never the sealed
    //date crossed by the declaration. Existing150 checks remain enabled.
    const proposal={startAt:stamp(Date.parse(input.startAt)-60000),endAt:stamp(Date.parse(input.endAt)+60000),breaks:[]};
    steps.push(prefix+`do $outage_review_old_range$ begin ${seal}
     assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker} and sealed
      and start_at<${quote(proposal.endAt)}::timestamptz and end_at>${quote(proposal.startAt)}::timestamptz),'outage_reviews_old_writer_range_must_not_be_sealed';
     assert public.faolla_attendance_correction_proposal_v1(${json(proposal)},clock_timestamp())=${json(proposal)},'outage_reviews_utc6_proposal_required';end;$outage_review_old_range$;`);
    const correction=p.fresh(30),approval=p.fresh(31),cq=json({mode:'detail',expectedWorkerId:h.workerId,requestId:correction,operationId:null});
    const submit=`(${json({action:'submit',operationId:correction,expectedRevision:0,reason:'Synthetic214 actual source change',startEventId:startId,expectedLastEventId:endId,proposal})}
     ||jsonb_build_object('expectedPolicyRevision',(select max(revision) from public.merchant_attendance_correction_controls where merchant_id=${site})))`;
    call('source_submit',{q:cq,c:submit,kind:'correction',actor:h.employeeAuthUserId,write:true,allowed:['merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings'],
     expression:`public.faolla_attendance_correction_self_v3(${site},${auth},review_query,review_command,true)`});
    call('pending_detail');
    call('resolve_recover_after_pending',{q:json(p.q('recover','owner',p.fresh(12))),allow:false});
    call('source_review',{kind:'correction',expression:`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(correction)},null,null,true)`});
    const approve=`jsonb_build_object('action','approve','operationId',${quote(approval)},'requestId',${quote(correction)},'expectedRevision',${saved('source_review')}->'review'->'item'->'revision',
     'expectedEvidence',${saved('source_review')}->'evidenceToken','reason','Synthetic214 actual approved source change')`;
    call('source_approve',{c:approve,kind:'correction',write:true,allowed:['merchant_attendance_correction_decisions','merchant_attendance_correction_effects'],
     expression:`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(correction)},review_command,null,true)`});
    call('changed_detail');
    reject('changed_old_confirm',sq,command(14,'confirm','changed_detail'),'attendance_outage_review_blocked',{actor:h.employeeAuthUserId});
    call('reopen',{c:command(15,'reopen','changed_detail'),write:true});call('reopened_detail');
    const refs=json([{...p.reference,effectOperationId:approval,effectRevision:1}]);
    call('new_link_preview',{q:linkPreview(refs),kind:'links',expression:`public.faolla_attendance_outage_links_v1(review_query,${owner},null,true)`});
    call('new_link_apply',{c:linkCommand(6,1,'new_link_preview',refs),kind:'links',write:true,
     expression:`public.faolla_attendance_outage_links_v1(review_query,${owner},review_command,true)`});
    call('new_basis');call('new_propose',{c:command(16,'propose','new_basis'),write:true});call('new_self_proposal',{q:sq,actor:h.employeeAuthUserId});
    call('dispute',{q:sq,c:command(17,'dispute','new_self_proposal'),actor:h.employeeAuthUserId,write:true});call('disputed_detail');
    reject('dispute_blocks_resolve',oq,command(18,'resolve','disputed_detail'),'attendance_outage_review_blocked');
    call('confirm_after_dispute',{q:sq,c:command(19,'confirm','disputed_detail'),actor:h.employeeAuthUserId,write:true});call('reconfirmed_detail');
    call('new_resolve',{c:command(20,'resolve','reconfirmed_detail'),write:true});call('new_resolved_detail');
    call('final_reopen',{c:command(21,'reopen','new_resolved_detail'),write:true});call('final_reopened_detail');
    reject('reopened_requires_new_confirmation',oq,command(22,'resolve','final_reopened_detail'),'attendance_outage_review_blocked');
   }
  }
  call('old_proposal_after_all',{q:json(p.q('recover','owner',p.fresh(10))),allow:false});
  call('history',{q:json(p.q('history'))});call('self_history',{q:json(p.q('history','self',2)),actor:h.employeeAuthUserId});
  steps.push(prefix+`do $outage_reviews_finish$ begin ${seal}end;$outage_reviews_finish$;set constraints all immediate;
   select jsonb_build_object('kind','counts','reviews',(select count(*) from public.merchant_attendance_outage_review_operations where merchant_id=${site}),
    'links',(select count(*) from public.merchant_attendance_outage_link_operations where merchant_id=${site}),
    'incidents',(select count(*) from public.merchant_attendance_outage_incidents where merchant_id=${site}),
    'declarations',(select count(*) from public.merchant_attendance_outage_declarations where merchant_id=${site}),
    'operations',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${site}));rollback;`);
  assert(steps.length<=70,'outage_reviews_bounded_steps');let rows;const failures=[];
  try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  catch(error){failures.push(new Error('outage_reviews_actual_sql_failed:'+group+':'+String(error?.message??error),{cause:error}));}
  finally{
   for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),defs],['catalog',()=>d.tableCatalog(),catalog]])try{assert.equal(read(),want,'outage_reviews_rollback_'+label);}catch(error){failures.push(error);}
   try{archives();}catch(error){failures.push(error);}
  }
  if(failures.length)throw new AggregateError(failures,'outage_reviews_native_failed:'+group+':'+failures.map(e=>e.message).join(' | '));
  const parsed=new Map();
  for(const row of rows){
   if(row.kind==='rejection'||row.kind==='counts')continue;assert(expected.has(row.label));assert.equal(row.before,row.after);
   try{
    if(row.kind==='review'){
     parseOutageReviewQuery(row.query);if(row.command)parseOutageReviewCommand(row.command);
     parsed.set(row.label,projectOutageReviewResult(row.value,row.query,row.actor,row.command));
    }else if(row.kind==='links')parsed.set(row.label,projectOutageLinksResult(row.value,row.query,row.actor,row.command));
    else if(row.kind==='outage')parsed.set(row.label,projectOutageResult(row.value,row.query,row.actor,row.command));
    else parsed.set(row.label,row.value);
   }catch(error){throw new Error('outage_reviews_projection_failed:'+group+':'+row.label+':'+String(error?.message??error),{cause:error});}
  }
  assert.equal(parsed.size,expected.size);assert.equal(rows.filter(row=>row.kind==='rejection').length,rejections);
  const proposal=parsed.get('propose').receipt.proposal,original=parsed.get('propose').receipt;
  for(const label of ['proposal_replay_off','proposal_recover_off','old_proposal_after_all'])assert.deepEqual(parsed.get(label).receipt,original,label);
  assert.equal(proposal.resultVersion,1);assert.equal(proposal.evidence.linkOperationId,p.fresh(5));
  assert.deepEqual(parsed.get('self_proposal').proposal,proposal);assert.equal(parsed.get('self_proposal').actorId,h.employeeAuthUserId);
  const counts=rows.find(row=>row.kind==='counts');
  assert.equal(counts.incidents,1);assert.equal(counts.declarations,1);assert.equal(counts.operations,2);
  const expectedOriginal=group==='no_original'?'not_required':group==='known_original'?'verified':'unresolved';
  assert.equal(proposal.evidence.original.status,expectedOriginal);
  assert.equal(proposal.evidence.original.operationId,p.declaration.originalOperationId);
  assert.equal(proposal.evidence.original.eventId,group==='known_original'?startId:null);
  if(group==='unknown_original'){
   assert(parsed.get('self_proposal').status.blockers.includes('original_unknown'));assert.equal(parsed.get('self_proposal').status.canConfirm,false);
   assert.equal(parsed.get('disputed_detail').response.action,'dispute');assert.equal(parsed.get('disputed_detail').status.resolved,false);
   assert.deepEqual(parsed.get('self_dispute_recover').receipt,parsed.get('dispute').receipt);assert.equal(counts.reviews,2);assert.equal(counts.links,1);
  }else{
   assert.equal(parsed.get('resolved_detail').status.resolved,true);assert.equal(parsed.get('resolved_detail').current.action,'resolve');
   assert.equal(parsed.get('confirm').receipt.entry.actorId,h.employeeAuthUserId);assert.equal(parsed.get('resolve').receipt.entry.actorId,d.owner);
   assert.deepEqual(parsed.get('self_confirm_recover').receipt,parsed.get('confirm').receipt);
   if(group==='no_original'){
    for(const label of ['pending_detail','changed_detail']){
     assert.equal(parsed.get(label).status.resolved,false);assert.deepEqual(parsed.get(label).proposal,proposal);
     assert.deepEqual(parsed.get(label).current,parsed.get('resolve').receipt.entry);
    }
    assert(parsed.get('pending_detail').status.blockers.includes('pending_source'));
    assert(parsed.get('changed_detail').status.blockers.includes('source_changed'));
    assert.deepEqual(parsed.get('resolve_recover_after_pending').receipt,parsed.get('resolve').receipt);
    const next=parsed.get('new_propose').receipt.proposal;assert.equal(next.resultVersion,2);assert.notEqual(next.resultFingerprint,proposal.resultFingerprint);
    assert.equal(next.evidence.linkRevision,2);assert.equal(next.evidence.linkEvidence.items[0].reference.effectOperationId,p.fresh(31));
    assert.equal(parsed.get('new_self_proposal').response,null);assert.equal(parsed.get('disputed_detail').response.action,'dispute');
    assert(parsed.get('disputed_detail').status.blockers.includes('disputed'));assert.equal(parsed.get('new_resolved_detail').status.resolved,true);
    assert.equal(parsed.get('final_reopened_detail').status.resolved,false);assert(parsed.get('final_reopened_detail').status.blockers.includes('reopened'));
    assert.equal(counts.reviews,9);assert.equal(counts.links,2);
   }else{assert.equal(counts.reviews,3);assert.equal(counts.links,1);}
  }
  assert.deepEqual(parsed.get('history').history.map(e=>e.revision),Array.from({length:counts.reviews},(_,i)=>counts.reviews-i));
  assert.deepEqual(parsed.get('self_history').history.map(e=>e.revision),[1]);
  groups.push({group,reads,submissions:writes,rejections,legacySourceWrites:sourceWrites,transactionSteps:steps.length,rollbackRestored:true});
  totalReads+=reads;totalWrites+=writes;totalRejects+=rejections;totalSourceWrites+=sourceWrites;
 }
 await scenario('no_original');await scenario('known_original');await scenario('unknown_original');
 archives();assert.equal(d.fingerprint(),baseline);assert((await period(pq('detail','owner',periodId))).period.sealed);
 native.pass('214 real176/177/178 versioned propose-confirm-dispute-resolve-reopen, source invalidation and original evidence with exact recovery and rollback');
 return {groups,reads:totalReads,submissions:totalWrites,rejections:totalRejects,legacySourceWrites:totalSourceWrites,
  actualProposeConfirmDisputeResolveReopen:true,sourceChangesInvalidateResolution:true,originalKnownAndUnknownChecked:true,
  exactReplayAndRecovery:true,allReadsAndRejectionsZeroWrites:true,old155ArchivePreserved:true,actualSealedArchivePreserved:true,
  allTransactionsRolledBack:true,definitionsAndCatalogUnchanged:true,syntheticHistoricalOriginalEvent:true,actualHistoricalClockRequests:false,newSyntheticClockRows:0,
  periodOutageGateImplemented:false,productionUiImplemented:false,browser:false,productionAccess:false,newCluster:false};
}
