//212 inert caller-owned probes.204's past events remain expressly synthetic
//history;176 declarations,177 links and old correction/missing decisions below
//use actual RPCs. Every scenario rolls back, with all guards and limits intact.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';

const require=createRequire(import.meta.url),stamp=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');
const knownSessionStart=id(204710),knownSessionEnd=id(204711),knownMissingRoot=id(204715);
export const outageLinksNativeTables=Object.freeze(['merchant_attendance_outage_link_operations']);
export function outageLinksNativeExpression(q,actor,c=null,allow=false){
 assert.equal(typeof allow,'boolean');return `public.faolla_attendance_outage_links_v1(${json(q)},${quote(actor)},${json(c)},${allow})`;
}
export function createOutageLinksNativePlan(input,group='session'){
 assert(['session','missing'].includes(group));
 const base=212000000+(group==='missing'?1000:0),fresh=n=>id(base+n);
 const starts=[input.sealedStart,input.sessionStart,input.missingStart].map(Date.parse),ends=[input.sealedEnd,input.sessionEnd,input.missingEnd].map(Date.parse);
 assert(starts.every(Number.isFinite)&&ends.every(Number.isFinite));
 const interval={startAt:stamp(Math.min(...starts)),endAt:stamp(Math.max(...ends)+900000),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.endAt)<Date.parse(input.now));assert(Date.parse(interval.endAt)-Date.parse(interval.startAt)<31*86400000);
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,
  interval,reason:'Synthetic212 reported outage, no trusted clock reconstruction'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic212 unresolved statement; explicit links do not close or count work',
  originalOperationId:group==='session'?input.originalOperationId:null,originalChannel:group==='session'?'web':null,paperReference:null};
 const q=(mode='detail',access='owner',value=null)=>({siteId:input.site,access,mode,declarationId:declaration.declarationId,
  ...(mode==='preview'?{sources:value}:mode==='history'?{beforeRevision:value}:mode==='recover'?{operationId:value}:{})});
 return {fresh,incident,declaration,q,sessionReference:input.sessionReference,missingReference:input.missingReference};
}

export async function verifyAttendanceOutageLinksNative(ctx){
 const {d,h,native,scope,archive,oldArchive,period,pq,periodId,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 assert((await period(pq('detail','owner',periodId))).period.sealed);
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),savedArchive=periodArchive();
 for(const table of [...outageNativeTables,...outageLinksNativeTables])assert(names.includes(table),table);
 const fullHash=outageNativeFingerprintSql(names),oldHash=outageNativeFingerprintSql(names.filter(n=>![...outageNativeTables,...outageLinksNativeTables].includes(n)));
 const fmt='YYYY-MM-DD"T"HH24:MI:SS.US"Z"',site=quote(d.site),owner=quote(d.owner),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId);
 //Reuse exact204 fixtures, not arbitrary records.148 verifies both current and
 //historical employee/Auth evidence;103 supplies the actual CURRENT approval.
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC',${quote(fmt)}),'session',public.faolla_attendance_period_session_v1(${site},w.id,${quote(knownSessionStart)},e.id,e.auth_user_id,clock_timestamp()),
  'originalOperationId',(select operation_id from public.merchant_attendance_events where merchant_id=${site} and id=${quote(knownSessionStart)}),
  'missing',(select jsonb_build_object('reference',jsonb_build_object('kind','missing','requestId',m.request_id,'rootRequestId',coalesce(m.root_request_id,m.request_id),'approvalOperationId',a.operation_id),
   'startAt',to_char(m.start_at at time zone 'UTC',${quote(fmt)}),'endAt',to_char(m.end_at at time zone 'UTC',${quote(fmt)}),'proposal',m.proposal)
   from public.merchant_attendance_missing_current_v1 m join public.merchant_attendance_missing_entries a on a.merchant_id=m.merchant_id and a.request_id=m.request_id and a.action='approve' and a.revision=2
   where m.merchant_id=${site} and m.worker_id=w.id and m.employee_id=e.id and m.actor_auth_user_id=e.auth_user_id and coalesce(m.root_request_id,m.request_id)=${quote(knownMissingRoot)}) )
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${site} and w.id=${worker} and e.id=${employee} and e.auth_user_id=${auth} and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert(profile?.session&&profile.missing);assert.equal(d.fingerprint(),baseline);
 const events=profile.session.item.events;assert.deepEqual(events.map(e=>[e.id,e.sequence,e.action]),[[knownSessionStart,3,'clock_in'],[knownSessionEnd,4,'clock_out']]);
 assert.equal(profile.session.item.effect,null);assert.equal(profile.session.ruleBinding.employeeId,h.employeeId);assert.equal(profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);
 assert.equal(profile.session.ruleBinding.status,'unverified');assert.equal(profile.session.ruleBinding.reason,'source_unavailable');
 const sessionReference={kind:'session',startEventId:knownSessionStart,lastEventId:knownSessionEnd,lastSequence:4,effectOperationId:null,effectRevision:null};
 const input={site:d.site,owner:d.owner,employee:h.employeeId,auth:h.employeeAuthUserId,worker:h.workerId,location:h.slot.locationId,...profile,
  sealedStart:h.slot.startAt,sealedEnd:h.slot.endAt,sessionStart:events[0].occurredAt,sessionEnd:events.at(-1).occurredAt,
  missingStart:profile.missing.startAt,missingEnd:profile.missing.endAt,sessionReference,missingReference:profile.missing.reference};
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const {projectOutageLinksResult}=require('../../src/lib/merchantAttendanceOutageLinks.server.ts');
 const {parseOutageLinksQuery,parseOutageLinksCommand}=require('../../src/lib/merchantAttendanceOutageLinks.ts');
 const {parseMissingResult}=require('../../src/lib/merchantAttendanceMissing.ts');
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const saved=label=>`(current_setting('faolla.outage212_${label}')::jsonb->'value')`;
 const savedCommand=label=>`(current_setting('faolla.outage212_${label}')::jsonb->'command')`;
 const sourceRef=()=>`jsonb_build_object('kind','session','startEventId',${quote(knownSessionStart)},'lastEventId',${quote(knownSessionEnd)},'lastSequence',4,
  'effectOperationId',(select operation_id from public.merchant_attendance_effect_current_v2 where merchant_id=${site} and worker_id=${worker} and start_event_id=${quote(knownSessionStart)}),
  'effectRevision',(select revision from public.merchant_attendance_effect_current_v2 where merchant_id=${site} and worker_id=${worker} and start_event_id=${quote(knownSessionStart)}))`;
 const checkArchives=()=>{
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,savedArchive.artifactText);assert.equal(periodArchive().artifactSha256,savedArchive.artifactSha256);
 };
 const groups=[];let totalReads=0,totalSubmissions=0,totalRejections=0,totalLegacyWrites=0;
 async function scenario(group){
  const p=createOutageLinksNativePlan(input,group),steps=[],expected=new Map();let reads=0,submissions=0,rejections=0,legacyWrites=0;
  const command=(label,action,preview,head,refs=null)=>`jsonb_build_object('action',${quote(action)},'operationId',${quote(p.fresh(label))},
   'expectedRevision',${saved(head)}->'revision','expectedFingerprint',${action==='apply'?saved(preview)+"->'preview'->'fingerprint'":saved(head)+"->'current'->'fingerprint'"},
   'reason','Synthetic212 explicit unresolved source '||${quote(action)})${action==='apply'?"||jsonb_build_object('sources',"+refs+')':''}`;
  const rpc=(q,c,who=d.owner,allow=true)=>`public.faolla_attendance_outage_links_v1(${q},${quote(who)},${c},${allow})`;
  const call=(label,{q,c='null',expression,kind='links',who=d.owner,write=false,replay=false,allowed=[],timeZone='UTC'})=>{
   assert(/^[a-z_]+$/.test(label)&&!expected.has(label));expected.set(label,{kind,write,replay});
   assert(['UTC','Europe/Madrid'].includes(timeZone));
   if(write&&!replay){if(kind==='links'||kind==='outage')submissions++;else legacyWrites++;}else reads++;
   const hash=!write||replay?fullHash:allowed.length?outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n))):oldHash;
   steps.push(prefix+`set local time zone ${quote(timeZone)};do $outage_link_call$ declare link_before text;link_after text;link_value jsonb;link_command jsonb;link_query jsonb;link_record jsonb;begin
    link_before:=${hash};link_command:=${c};link_query:=${q};set local role service_role;
    link_value:=${expression??rpc('link_query','link_command',who)};
    set constraints all immediate;set constraints all deferred;reset role;link_after:=${hash};
    assert link_after=link_before,'outage_links_read_or_protected_facts_changed';
    link_record:=jsonb_build_object('label',${quote(label)},'kind',${quote(kind)},'query',link_query,'actor',${quote(who)},'command',link_command,'value',link_value,'before',link_before,'after',link_after);
    perform set_config(${quote('faolla.outage212_'+label)},link_record::text,true);end;$outage_link_call$;
    select current_setting(${quote('faolla.outage212_'+label)})::jsonb;`);
  };
  const reject=(label,q,c,code,{who=d.owner,allow=true,setup=''}={})=>{
   rejections++;steps.push(prefix+`do $outage_link_denied$ declare link_before text;begin link_before:=${fullHash};
    begin ${setup}set local role service_role;perform ${rpc(q,c,who,allow)};raise exception 'outage_links_expected_rejection_missing';
    exception when others then if sqlerrm<>${quote(code)} then raise;end if;end;reset role;
    assert ${fullHash}=link_before,'outage_links_rejected_write';end;$outage_link_denied$;
    select jsonb_build_object('kind','rejection','label',${quote(label)},'code',${quote(code)});`);
  };
  const sealCheck=`assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and sealed),'outage_links_actual_seal_missing';`;
  steps.push('begin;'+prefix+`do $outage_links_start$ begin ${sealCheck}
   assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_links_guards_enabled';
   assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${site}),'outage_links_empty176_required';
   assert not exists(select 1 from public.merchant_attendance_outage_link_operations where merchant_id=${site}),'outage_links_empty177_required';end;$outage_links_start$;`);
  const iq={siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId},dq={siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId};
  call('incident',{q:json(iq),c:json(p.incident),kind:'outage',write:true,expression:`public.faolla_attendance_outage_v1(link_query,${owner},link_command,true)`});
  call('declaration',{q:json(dq),c:json(p.declaration),kind:'outage',write:true,expression:`public.faolla_attendance_outage_v1(link_query,${owner},link_command,true)`});
  const initialRefs=group==='session'?[p.sessionReference]:[p.missingReference],detailQ=json(p.q()),previewQ=refs=>`(${detailQ}||jsonb_build_object('mode','preview','sources',${refs}))`;
  call('empty_detail',{q:detailQ});
  call('preview',{q:previewQ(json(initialRefs))});
  const first=command(10,'apply','preview','empty_detail',json(initialRefs));
  reject('fresh_gate_off',detailQ,first,'attendance_outage_links_disabled',{allow:false});
  reject('stale_preview',detailQ,`(${first}||jsonb_build_object('expectedFingerprint',repeat('0',64)))`,'attendance_outage_links_changed');
  reject('duplicate_source',previewQ(json([...initialRefs,...initialRefs])),'null','attendance_invalid_request');
  call('apply',{q:detailQ,c:first,write:true});
  call('replay_off',{q:detailQ,c:savedCommand('apply'),write:true,replay:true,expression:rpc('link_query','link_command',d.owner,false)});
  call('recover_off',{q:json(p.q('recover','owner',p.fresh(10))),expression:rpc('link_query','link_command',d.owner,false)});
  call('detail',{q:detailQ});call('self_detail',{q:json(p.q('detail','self')),who:h.employeeAuthUserId});
  reject('operation_conflict',detailQ,`(${savedCommand('apply')}||jsonb_build_object('reason','Changed original operation'))`,'attendance_operation_conflict');
  reject('unknown_operation',json(p.q('recover','owner',p.fresh(999))), 'null','attendance_outage_links_not_found',{allow:false});
  reject('employee_cannot_owner_read',detailQ,'null','attendance_access_denied',{who:h.employeeAuthUserId});
  reject('other_merchant',json({...p.q(),siteId:'99990002'}),'null','attendance_access_denied');
  reject('platform_paused_fresh',detailQ,`(${first}||jsonb_build_object('operationId',${quote(p.fresh(900))},'expectedRevision',1))`,'attendance_platform_paused',
   {setup:`update public.merchant_attendance_settings set enabled=false where merchant_id=${site};`});
  //The fullLeave seal is a different day. Do NOT change it or bypass150 to
  //manufacture a successful source correction; prove these old-writer ranges
  //are outside every current seal before invoking the actual old RPCs.
  const proposal=group==='session'?{startAt:stamp(Date.parse(input.sessionStart)-60000),endAt:stamp(Date.parse(input.sessionEnd)+60000),breaks:[]}
   :{...profile.missing.proposal,startAt:stamp(Date.parse(input.missingStart)+300000),endAt:stamp(Date.parse(input.missingEnd)+300000)};
  steps.push(prefix+`do $outage_links_old_range$ begin ${sealCheck}
   assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker} and sealed
    and start_at<${quote(proposal.endAt)}::timestamptz and end_at>${quote(proposal.startAt)}::timestamptz),'outage_links_old_writer_range_must_not_be_sealed';
   assert public.faolla_attendance_correction_proposal_v1(${json(proposal)},clock_timestamp())=${json(proposal)},'outage_links_utc6_proposal_required';end;$outage_links_old_range$;`);
  const request=p.fresh(30),approval=p.fresh(31);
  if(group==='session'){
   const cq={mode:'detail',expectedWorkerId:h.workerId,requestId:request,operationId:null};
   const submit=`(${json({action:'submit',operationId:request,expectedRevision:0,reason:'Synthetic212 actual original correction request',startEventId:knownSessionStart,expectedLastEventId:knownSessionEnd,proposal})}
    ||jsonb_build_object('expectedPolicyRevision',(select max(revision) from public.merchant_attendance_correction_controls where merchant_id=${site})))`;
   call('source_submit',{q:json(cq),c:submit,kind:'correction',who:h.employeeAuthUserId,write:true,allowed:['merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings'],
    expression:`public.faolla_attendance_correction_self_v3(${site},${auth},link_query,link_command,true)`});
   call('pending_detail',{q:detailQ});call('pending_preview',{q:previewQ(json(initialRefs))});
   call('pending_preview_madrid',{q:previewQ(json(initialRefs)),timeZone:'Europe/Madrid'});
   call('source_review',{q:json({siteId:d.site,requestId:request,operationId:null}),kind:'correction_decision',expression:`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(request)},null,null,true)`});
   const approve=`jsonb_build_object('action','approve','operationId',${quote(approval)},'requestId',${quote(request)},'expectedRevision',${saved('source_review')}->'review'->'item'->'revision',
    'expectedEvidence',${saved('source_review')}->'evidenceToken','reason','Synthetic212 actual owner correction approval')`;
   call('source_approve',{q:json({siteId:d.site,requestId:request,operationId:null}),c:approve,kind:'correction_decision',write:true,
    allowed:['merchant_attendance_correction_decisions','merchant_attendance_correction_effects'],expression:`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(request)},link_command,null,true)`});
   call('changed_detail',{q:detailQ});
   call('new_preview',{q:previewQ(`jsonb_build_array(${sourceRef()})`)});
  }else{
   const today=profile.now.slice(0,10),mq=(access,requestId=null)=>({siteId:d.site,access,fromDate:today,throughDate:today,requestId,operationId:null,beforeAt:null,beforeId:null});
   call('source_home',{q:json(mq('self',p.missingReference.requestId)),kind:'missing',who:h.employeeAuthUserId,
    expression:`public.faolla_attendance_missing_v1(link_query,${auth},null,true)`});
   const revise=`(${json({action:'revise',operationId:request,reason:'Synthetic212 actual missing replacement',expectedWorkerId:h.workerId,locationId:input.location,timeZone:'UTC',proposal,
    supersedesRequestId:p.missingReference.requestId,expectedApprovalOperationId:p.missingReference.approvalOperationId})}||jsonb_build_object('expectedSettingsVersion',${saved('source_home')}->'settingsVersion','expectedPolicyRevision',${saved('source_home')}->'policyRevision'))`;
   call('source_submit',{q:json(mq('self')),c:revise,kind:'missing',who:h.employeeAuthUserId,write:true,allowed:['merchant_attendance_missing_requests','merchant_attendance_missing_entries'],
    expression:`public.faolla_attendance_missing_v1(link_query,${auth},link_command,true)`});
   call('pending_detail',{q:detailQ});call('pending_preview',{q:previewQ(json(initialRefs))});
   call('pending_preview_madrid',{q:previewQ(json(initialRefs)),timeZone:'Europe/Madrid'});
   call('source_review',{q:json(mq('owner',request)),kind:'missing',expression:`public.faolla_attendance_missing_v1(link_query,${owner},null,true)`});
   const approve=`jsonb_build_object('action','approve','operationId',${quote(approval)},'requestId',${quote(request)},'expectedRevision',1,
    'evidenceToken',${saved('source_review')}->'detail'->'evidenceToken','reason','Synthetic212 actual owner missing replacement approval')`;
   call('source_approve',{q:json(mq('owner',request)),c:approve,kind:'missing',write:true,allowed:['merchant_attendance_missing_entries'],
    expression:`public.faolla_attendance_missing_v1(link_query,${owner},link_command,true)`});
   call('changed_detail',{q:detailQ});
   call('new_preview',{q:previewQ(json([{kind:'missing',rootRequestId:p.missingReference.rootRequestId,requestId:request,approvalOperationId:approval}]))});
  }
  call('old_recover_after_change',{q:json(p.q('recover','owner',p.fresh(10))),expression:rpc('link_query','link_command',d.owner,false)});
  const newRefs=saved('new_preview')+"->'preview'->'evidence'->'items'";
  const refArray=`(select jsonb_agg(value->'reference' order by ordinal) from jsonb_array_elements(${newRefs}) with ordinality as outage_refs(value,ordinal))`;
  call('apply_new',{q:detailQ,c:command(11,'apply','new_preview','detail',refArray),write:true});
  call('new_detail',{q:detailQ});call('new_self_detail',{q:json(p.q('detail','self')),who:h.employeeAuthUserId});
  //Only synthetic identity changes inside this savepoint. Existing triggers
  //remain enabled; original-owner recovery is historical, not renewed access.
  steps.push(prefix+`do $outage_links_identity_hash$ begin perform set_config('faolla.outage212_identity_hash',${fullHash},true);end;$outage_links_identity_hash$;savepoint outage_links_identity;
   update public.merchant_enterprise_employees set auth_user_id=${quote(p.fresh(998))} where merchant_id=${site} and id=${employee};`);
  call('rebound_owner_detail',{q:detailQ});
  call('rebound_owner_recover',{q:json(p.q('recover','owner',p.fresh(10))),expression:rpc('link_query','link_command',d.owner,false)});
  reject('old_self_after_rebind',json(p.q('detail','self')),'null','attendance_access_denied',{who:h.employeeAuthUserId});
  reject('new_self_cannot_see_old',json(p.q('detail','self')),'null','attendance_access_denied',{who:p.fresh(998)});
  reject('fresh_after_rebind',detailQ,command(13,'apply','new_preview','new_detail',refArray),'attendance_outage_links_changed');
  steps.push(prefix+`rollback to savepoint outage_links_identity;release savepoint outage_links_identity;
   do $outage_links_identity_restored$ begin assert ${fullHash}=current_setting('faolla.outage212_identity_hash'),'outage_links_identity_fixture_not_restored';end;$outage_links_identity_restored$;`);
  call('revoke',{q:detailQ,c:command(12,'revoke',null,'new_detail'),write:true});
  call('revoked_detail',{q:detailQ});call('history',{q:json(p.q('history'))});call('older_history',{q:json(p.q('history','self',2)),who:h.employeeAuthUserId});
  call('old_recover_after_revoke',{q:json(p.q('recover','owner',p.fresh(10))),expression:rpc('link_query','link_command',d.owner,false)});
  const permission=`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.request') where merchant_id=${site} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`;
  reject('self_permission_revoked',json(p.q('detail','self')),'null','attendance_access_denied',{who:h.employeeAuthUserId,setup:permission});
  steps.push(prefix+`do $outage_links_finish$ begin ${sealCheck}end;$outage_links_finish$;set constraints all immediate;
   select jsonb_build_object('kind','counts','links',(select count(*) from public.merchant_attendance_outage_link_operations where merchant_id=${site}),
    'incidents',(select count(*) from public.merchant_attendance_outage_incidents where merchant_id=${site}),
    'declarations',(select count(*) from public.merchant_attendance_outage_declarations where merchant_id=${site}),
    'operations',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${site}));rollback;`);
  assert(steps.length<=55,'outage_links_bounded_steps');let rows;const failures=[];
  try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  catch(error){failures.push(new Error('outage_links_actual_sql_failed:'+group+':'+String(error?.message??error),{cause:error}));}
  finally{
   for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog]])try{assert.equal(read(),want,'outage_links_rollback_'+label);}catch(error){failures.push(error);}
   try{checkArchives();}catch(error){failures.push(error);}
  }
  if(failures.length)throw new AggregateError(failures,'outage_links_native_failed:'+group+':'+failures.map(e=>e.message).join(' | '));
  const parsed=new Map();
  for(const row of rows){
   if(row.kind==='rejection'||row.kind==='counts')continue;const meta=expected.get(row.label);assert(meta);assert.equal(row.before,row.after);
    try{
     if(row.kind==='links'){
      parseOutageLinksQuery(row.query);if(row.command)parseOutageLinksCommand(row.command);
      parsed.set(row.label,projectOutageLinksResult(row.value,row.query,row.actor,row.command));
     }else if(row.kind==='outage')parsed.set(row.label,projectOutageResult(row.value,row.query,row.actor,row.command));
     else if(row.kind==='missing'){
      //Match executeAttendanceMissing's SQL-to-service boundary: SQL has no
      //HTTP moduleEnabled flag, and a POST receipt is bound to its actual op.
      const value=parseMissingResult(row.value,{...row.query,operationId:row.command?.operationId??row.query.operationId},false);
      if(row.command)assert.deepEqual(value.receipt.command,row.command);parsed.set(row.label,value);
     }else parsed.set(row.label,row.value);
    }catch(error){throw new Error('outage_links_projection_failed:'+group+':'+row.label+':'+String(error?.message??error),{cause:error});}
  }
  assert.equal(parsed.size,expected.size);assert.equal(rows.filter(row=>row.kind==='rejection').length,rejections);
  assert.deepEqual(rows.find(row=>row.kind==='counts'),{kind:'counts',links:3,incidents:1,declarations:1,operations:2});
  const original=parsed.get('apply').receipt,applied=original.entry;
  for(const label of ['replay_off','recover_off','old_recover_after_change','old_recover_after_revoke','rebound_owner_recover'])assert.deepEqual(parsed.get(label).receipt,original,label);
  for(const label of ['detail','self_detail','pending_detail','changed_detail'])assert.deepEqual(parsed.get(label).current,applied,label+':immutable_saved_entry');
  assert.equal(parsed.get('empty_detail').revision,0);assert(parsed.get('preview').preview.eligible);
  assert.equal(applied.revision,1);assert.equal(applied.evidence.workerId,h.workerId);assert.equal(applied.evidence.employeeId,h.employeeId);assert.equal(applied.evidence.employeeAuthUserId,h.employeeAuthUserId);
  assert.equal(parsed.get('pending_preview').preview.observations[0].pending,true);assert(parsed.get('pending_preview').preview.blockers.includes('pending_source'));
  assert.deepEqual(parsed.get('pending_preview_madrid').preview,parsed.get('pending_preview').preview,'outage_links_pending_canonical_ignores_session_timezone');
  assert.deepEqual(parsed.get('pending_preview_madrid').current,applied,'outage_links_saved_entry_ignores_session_timezone');
  assert(parsed.get('pending_preview').preview.eligible,'pending evidence is preparation, not resolution');
  assert.equal(parsed.get('changed_detail').preview.observations[0].changed,true);assert(parsed.get('changed_detail').preview.blockers.includes('source_changed'));
  assert(parsed.get('new_preview').preview.eligible);assert.equal(parsed.get('new_detail').preview.observations[0].changed,false);
  assert.deepEqual(parsed.get('new_self_detail').current,parsed.get('new_detail').current);
  const latest=parsed.get('new_detail').current;assert.equal(latest.revision,2);assert.notEqual(latest.fingerprint,applied.fingerprint);
  assert.deepEqual(parsed.get('rebound_owner_detail').current,latest);assert(parsed.get('rebound_owner_detail').preview.blockers.includes('identity_changed'));
  assert.notDeepEqual(latest.sources,applied.sources);assert.equal(parsed.get('revoke').receipt.entry.revision,3);
  assert.equal(parsed.get('revoked_detail').current.action,'revoke');assert.equal(parsed.get('revoked_detail').preview,null);
  assert.deepEqual(parsed.get('history').history.map(e=>e.revision),[3,2,1]);assert.deepEqual(parsed.get('older_history').history.map(e=>e.revision),[1]);
  if(group==='session'){
   assert.deepEqual(applied.evidence.items[0].original,applied.evidence.items[0].selected);assert.equal(applied.sources[0].effectOperationId,null);
   assert.equal(latest.sources[0].effectOperationId,approval);assert.equal(latest.sources[0].effectRevision,1);
   assert.deepEqual(latest.evidence.items[0].original,applied.evidence.items[0].original);
   assert.deepEqual(latest.evidence.items[0].selected,{startAt:proposal.startAt,endAt:proposal.endAt});
   assert.equal(parsed.get('source_approve').current.operationId,approval);
  }else{
   assert.equal(applied.evidence.items[0].original,null);assert.equal(latest.sources[0].requestId,request);assert.equal(latest.sources[0].approvalOperationId,approval);
   assert.equal(parsed.get('source_approve').detail.status,'approved');assert.equal(parsed.get('source_approve').detail.lineage.currentRequestId,request);
  }
  groups.push({group,reads,submissions,rejections,legacySourceWrites:legacyWrites,transactionSteps:steps.length,rollbackRestored:true});
  totalReads+=reads;totalSubmissions+=submissions;totalRejections+=rejections;totalLegacyWrites+=legacyWrites;
 }
 await scenario('session');await scenario('missing');checkArchives();
 assert((await period(pq('detail','owner',periodId))).period.sealed);assert.equal(d.fingerprint(),baseline);
 native.pass('212 actual176 declarations and177 explicit immutable links; real correction/missing source changes, zero-write reads/rejections and rollback with old155/current seal preserved');
 return {groups,reads:totalReads,submissions:totalSubmissions,rejections:totalRejections,legacySourceWrites:totalLegacyWrites,
  currentSourceChangedSavedUnchanged:true,exactReplayAndRecovery:true,allReadsAndRejectionsZeroWrites:true,pendingCanonicalSessionTimeZoneStable:true,
  actualOriginalAndEffectiveSession:true,actualApprovedMissingReplacement:true,ownerLinksDoNotResolve:true,
  preexistingSyntheticSessionRows:3,actualHistoricalClockRequests:false,newSyntheticClockRows:0,
  old155ArchivePreserved:true,actualSealedArchivePreserved:true,allTransactionsRolledBack:true,definitionsAndCatalogUnchanged:true,
  sourceResolutionImplemented:false,periodOutageGateImplemented:false,browser:false,productionAccess:false,newCluster:false};
}
