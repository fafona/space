//198 INERT. Eight finite real-RPC groups in one 90s rollback-only transaction.
//Two synthetic reviewers, an explicit rollback-only self-work permission on the
//inherited synthetic source role, and the disclosed four-row191 past-source seed
//are prerequisites. No historical RPC, clock shift or authorization bypass.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {operationalPunchPastSeed,operationalPunchFixtureIds} from './attendance-operational-punch-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(198600000+n),instant=d=>d.toISOString().replace('Z','000Z');
export const reviewRoutingNativeIds=Object.freeze({role:uid(1),delegate:uid(2),delegateAuth:uid(3),otherDelegate:uid(4),otherAuth:uid(5),correctionOnlyRole:uid(6)});
export const reviewRoutingNativePermissions=Object.freeze({full:Object.freeze(['enterprise.view','attendance.self.view','attendance.correction.review','attendance.missing.review','attendance.leave.review','attendance.work_arrangement.review']),
 correctionOnly:Object.freeze(['enterprise.view','attendance.correction.review'])});
export function reviewRoutingNativeSourceRoleProjection(tableName){
 assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(tableName));
 //Only the exact owned setup after-image maps to its exact before-image. Any
 //later permission/timestamp/other-field change still fails row preservation.
 return tableName==='merchant_enterprise_roles'
  ? "case when to_jsonb(x)=current_setting('faolla.rr198_source_role')::jsonb->'after' then current_setting('faolla.rr198_source_role')::jsonb->'before' else to_jsonb(x) end"
  : 'to_jsonb(x)';
}
export function reviewRoutingNativeApplicationCommand(category,{operationId,workerId,settingsVersion,policyRevision,timeZone,date,reason}){
 assert(['leave','work_arrangement'].includes(category));assert.match(date,/^20\d\d-\d\d-\d\d$/);
 const command={action:'submit',operationId,reason,expectedWorkerId:workerId,expectedSettingsVersion:settingsVersion,timeZone,
  startAt:date+'T05:00:00.000Z',endAt:date+'T06:00:00.000Z',...(category==='work_arrangement'?{kind:'remote',expectedPolicyRevision:policyRevision}:{})};
 //Use each original production command parser before an RPC, including the
 //three-digit interval contract (not the six-digit recorded-at contract).
 return category==='leave'?require('../../src/lib/merchantAttendanceLeave.ts').parseLeaveCommand(command)
  :require('../../src/lib/merchantAttendanceWorkArrangement.ts').parseWorkArrangementCommand(command);
}
export function reviewRoutingNativeRpcExpression(name,a){
 const flag=name==='faolla_attendance_operational_consumer_activation_v1'?'p_allow_activate':'p_allow_write';
 const ordinary=['faolla_attendance_review_routing_v1','faolla_attendance_operational_consumer_activation_v1','faolla_attendance_operational_rules_v1',
  'faolla_attendance_leave_v1','faolla_attendance_work_arrangement_v1','faolla_attendance_correction_delegations_v1','faolla_attendance_delegated_corrections_v1',
  'faolla_attendance_missing_delegations_v1','faolla_attendance_delegated_missing_v1','faolla_attendance_application_delegations_v1','faolla_attendance_delegated_applications_v1'];
 assert(ordinary.includes(name),'review_routing_native_RPC_allowlist');
 const keys=['p_query','p_auth_user_id','p_command',flag,...(name.includes('application_delegations')||name.includes('delegated_applications')?['p_capture_notifications']:[])];
 assert.deepEqual(Object.keys(a).sort(),keys.sort());assert.equal(typeof a[flag],'boolean');assert.match(a.p_query.siteId,/^9999000[1-6]$/);
 if(keys.includes('p_capture_notifications'))assert.equal(typeof a.p_capture_notifications,'boolean');
 return `public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a[flag]}${keys.includes('p_capture_notifications')?','+a.p_capture_notifications:''})`;
}
export async function verifyReviewRoutingNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {executeReviewRouting}=require('../../src/lib/merchantAttendanceReviewRouting.server.ts');
 const {executeOperationalConsumerActivation}=require('../../src/lib/merchantAttendanceOperationalConsumerActivation.server.ts');
 const {executeOperationalRuleLedger}=require('../../src/lib/merchantAttendanceOperationalRuleLedger.server.ts');
 const {parseCorrectionResult}=require('../../src/lib/merchantAttendanceCorrection.ts');
 const {parseCurrentCorrectionDecision}=require('../../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
 const {parseRevisionCycleResult}=require('../../src/lib/merchantAttendanceRevisionCycle.ts');
 const {parseMissingResult}=require('../../src/lib/merchantAttendanceMissing.ts');
 const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts');
 const {executeWorkArrangement}=require('../../src/lib/merchantAttendanceWorkArrangement.server.ts');
 const {executeCorrectionDelegation}=require('../../src/lib/merchantAttendanceCorrectionDelegation.server.ts');
 const {executeMissingDelegation}=require('../../src/lib/merchantAttendanceMissingDelegation.server.ts');
 const {executeApplicationDelegation}=require('../../src/lib/merchantAttendanceApplicationDelegation.server.ts');
 const p=reviewRoutingNativeIds,names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),start=id(204710),end=id(204711);
 const allowed=['correction_entries','correction_rule_bindings','correction_decisions','correction_effects','revision_requests','missing_requests','missing_entries',
  'leave_requests','leave_entries','work_arrangement_requests','work_arrangement_entries','operational_rule_operations','operational_rule_streams','operational_rule_publications',
  'operational_consumer_activations','review_responsibility_entries','review_responsibility_heads','correction_delegations','correction_delegation_revocations',
  'correction_delegation_decisions','missing_delegations','application_delegations','delegation_epochs'].map(n=>'merchant_attendance_'+n);
 const all=outageNativeFingerprintSql(names),outside=outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n))),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 //All pre-existing rows are protected individually, including old projection
 //heads. Synthetic rows appended in this transaction may evolve normally.
 for(const n of names)assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(n));
 const originals=`(select jsonb_object_agg(n,rows) from (${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select prior.value from jsonb_array_elements(current_setting('faolla.rr198_originals')::jsonb->${quote(n)}) prior(value) except select ${reviewRoutingNativeSourceRoleProjection(n)} from public.${n} x),'rr198_old_row_changed:${n}';`).join('\n');
 let steps=0,reads=0,writes=0,rejections=0,serial=100,slot=0,stage='begin',lastRpc=null,rolledBack=false,replayOnly=false;const groups=[];
 const next=()=>uid(++serial),day=(today,offset)=>new Date(Date.parse(today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
 const step=async(label,sql)=>{stage=label;assert(++steps<=150,'review_routing_max150_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const call=async(label,expression,{write=false,role='service_role',replay=false}={})=>{
  const r=JSON.parse(await step(label,`do $rr198_call$ declare before_hash text;outside_hash text;value jsonb;failure text;state_code text;context_text text;begin
   before_hash:=${all};outside_hash:=${outside};begin set local role ${role};assert current_user=${quote(role)};value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=before_hash,'rr198_read_reject_or_replay_changed_facts';end if;
   assert ${outside}=outside_hash,'rr198_unrelated_table_changed';${preserve}perform set_config('faolla.rr198_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text)::text,true);
  end;$rr198_call$;select current_setting('faolla.rr198_result')::jsonb;`));
  lastRpc=r;if(r.error||r.value?.error)rejections++;else if(write)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{const r=await call('rpc_'+name+'_'+(args.p_command?.action??args.p_query.mode??'read'),reviewRoutingNativeRpcExpression(name,args),{write:!!args.p_command,replay:replayOnly});return{data:r.value,error:r.error?{message:r.error}:null};}};
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(r));return r.value;};
 const save=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${all};`);};
 const restore=async(name,hash)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${all};`),hash);
 const detailQ=(family,requestId)=>({siteId:d.site,mode:'detail',family,requestId});
 const routing=(query,command=null,allowWrite=true,authUserId=d.owner)=>executeReviewRouting({query,command,authUserId,allowWrite},service);
 const routeDetail=(family,requestId)=>routing(detailQ(family,requestId));
 const activation=(command=null,allowActivate=true)=>executeOperationalConsumerActivation({query:{siteId:d.site,consumer:'review_routing',mode:'current'},command,authUserId:d.owner,allowActivate},service);
 const toggle=(action,expectedRevision)=>({siteId:d.site,consumer:'review_routing',action,expectedRevision,operationId:next(),reason:'Synthetic198 explicit '+action});
 const routeCommand=(detail,action,grantId=null)=>({action,operationId:next(),expectedResponsibilityRevision:detail.current?.revision??0,
  expectedResponsibilityOperationId:detail.current?.operationId??null,expectedRequestRevision:detail.observation.requestRevision,
  expectedObservationFingerprint:detail.observation.observationFingerprint,grantId,reason:'Synthetic198 explicit '+action});
 const ownerGrantQ=(patch={})=>({siteId:d.site,access:'owner',mode:'list',catalog:null,afterId:null,grantId:null,operationId:null,...patch});
 const delegateQ=(patch={})=>({siteId:d.site,access:'delegate',mode:'grants',grantId:null,requestId:null,operationId:null,beforeAt:null,beforeId:null,afterId:null,...patch});
 const grants=(type,query,command=null,who=d.owner)=> (type==='correction'?executeCorrectionDelegation:type==='missing'?executeMissingDelegation:executeApplicationDelegation)({query,command,authUserId:who,allowWrite:true},service);
 let profile;
 const grant=(type,patch={})=>({action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,
  workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,
  ...(type==='application'?{category:'leave',kinds:[],includePending:false}:{locationId:profile.locationId,...(type==='correction'?{includePending:false}:{})}),
  validFrom:profile.from,validUntil:profile.until,reason:'Synthetic198 actual '+type+' authority',...patch});
 const wire=q=>Object.fromEntries(Object.entries(q).filter(([k])=>k!=='siteId'));
 const correction=async(command=null,legacy=false)=>{
  const q={siteId:d.site,expectedWorkerId:h.workerId,mode:command?'detail':'prepare',...(command?{requestId:command.operationId,operationId:null}:{startEventId:start})};
  const raw=await ok('actual_correction_'+(command?'submit':'prepare'),`public.faolla_attendance_correction_self_v${legacy?1:3}(${site},${auth},${json(wire(q))},${json(command)},true)`,{write:!!command,role:legacy?'postgres':'service_role',replay:replayOnly});
  return parseCorrectionResult(raw,command?{...q,operationId:command.operationId}:q,!legacy,!legacy);
 };
 const correctionCommand=prepared=>({action:'submit',operationId:next(),expectedRevision:prepared.revision,expectedPolicyRevision:prepared.rules.policy.revision,
  startEventId:start,expectedLastEventId:end,proposal:{startAt:prepared.basis.events[0].occurredAt,endAt:instant(new Date(Date.parse(prepared.basis.events.at(-1).occurredAt)+60000)),breaks:[]},reason:'Synthetic198 real employee correction'});
 const ownerApprove=async requestId=>{
  const q={siteId:d.site,requestId,operationId:null},r=parseCurrentCorrectionDecision(await ok('actual_owner096_detail',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},null,null,true)`),q);assert(r.canApprove,JSON.stringify(r));
  const c={action:'approve',operationId:next(),requestId,expectedRevision:r.review.application.item.revision,expectedEvidence:r.evidenceToken,reason:'Synthetic198 unchanged owner096 decision'};
  return parseCurrentCorrectionDecision(await ok('actual_owner096_approve',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(requestId)},${json(c)},null,true)`,{write:true}),{...q,operationId:c.operationId});
 };
 const missingQ=(patch={})=>({siteId:d.site,access:'self',fromDate:profile.today,throughDate:profile.today,requestId:null,operationId:null,beforeAt:null,beforeId:null,...patch});
 const missing=async(q,command=null)=>parseMissingResult(await ok('actual_missing_'+(command?.action??'read'),`public.faolla_attendance_missing_v1(${json(q)},${q.access==='owner'?owner:auth},${json(command)},true)`,{write:!!command,replay:replayOnly}),command?{...q,operationId:command.operationId}:q,false);
 const missingCommand=home=>{const dt=day(profile.today,-8-(slot++));return{action:'submit',operationId:next(),reason:'Synthetic198 actual missing',expectedWorkerId:h.workerId,
  expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:home.policyRevision,locationId:home.locationId,timeZone:home.timeZone,
  proposal:{startAt:dt+'T08:00:00.000000Z',endAt:dt+'T10:00:00.000000Z',breaks:[]}};};
 const applicationQ=(category,patch={})=>({siteId:d.site,access:'self',requestId:null,operationId:null,beforeAt:null,beforeId:null,...(category==='work_arrangement'?{preview:null}:{}),...patch});
 const application=(category,query,command=null)=> (category==='leave'?executeLeave:executeWorkArrangement)({query,command,authUserId:query.access==='owner'?d.owner:h.employeeAuthUserId,allowWrite:true},service);
 const applicationSubmit=async(category='leave')=>{
  const q=applicationQ(category),home=await application(category,q);assert(home.canSubmit);
  const command=reviewRoutingNativeApplicationCommand(category,{operationId:next(),workerId:h.workerId,settingsVersion:home.settingsVersion,policyRevision:home.policy?.revision,
   timeZone:home.timeZone,date:day(profile.today,3+(slot++)),reason:'Synthetic198 actual original '+category});
  const result=await application(category,q,command);assert.equal(result.detail.status,'submitted');return{query:q,command,result};
 };
 const captured=async(family,requestId,kind='owner')=>{const r=(await routeDetail(family,requestId)).data;assert.equal(r.kind,'detail');assert.equal(r.current.action,'capture');assert.equal(r.current.revision,1);
  assert.equal(r.current.operationId,requestId);assert.equal(r.current.actorId,h.employeeAuthUserId);assert.equal(r.current.assignment.kind,kind);assert.equal(r.request.workerId,h.workerId);
  assert.equal(r.request.employeeId,h.employeeId);assert.equal(r.request.employeeAuthUserId,h.employeeAuthUserId);assert.equal(r.current.origin.observedAt,r.current.recordedAt);return r;};
 try{
  profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $rr198_seed$ declare source_role public.merchant_enterprise_roles%rowtype;before_role jsonb;after_role jsonb;begin assert current_user='postgres';
   assert not exists(select 1 from public.merchant_attendance_review_responsibility_entries);assert not exists(select 1 from public.merchant_attendance_operational_rule_streams);
   assert not exists(select 1 from public.merchant_attendance_operational_consumer_activations where consumer='review_routing');
   assert not exists(select 1 from public.merchant_enterprise_roles where id in(${quote(p.role)},${quote(p.correctionOnlyRole)}));
   assert not exists(select 1 from public.merchant_enterprise_employees where id in(${quote(p.delegate)},${quote(p.otherDelegate)}) or auth_user_id in(${quote(p.delegateAuth)},${quote(p.otherAuth)}));
   perform set_config('faolla.rr198_originals',${originals}::text,true);
   select r.* into strict source_role from public.merchant_enterprise_roles r join public.merchant_enterprise_employees e on e.merchant_id=r.merchant_id and e.role_id=r.id
    where e.merchant_id=${site} and e.id=${quote(h.employeeId)};
   assert source_role.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(source_role.permissions),'rr198_source_role_invalid';
   before_role:=to_jsonb(source_role);
   if not('attendance.self.work_arrangement'=any(source_role.permissions)) then
    update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.work_arrangement']) p order by p)
     where merchant_id=${site} and id=source_role.id returning to_jsonb(merchant_enterprise_roles.*) into after_role;
   else after_role:=before_role;end if;
   assert before_role-array['permissions','updated_at','version'] is not distinct from after_role-array['permissions','updated_at','version'],'rr198_source_role_setup_changed_other_field';
   --The existing foundation BEFORE trigger sets now() and increments exactly
   --one version on the actual UPDATE; do not disable or ignore that trigger.
   assert (after_role->>'version')::bigint=source_role.version+(case when 'attendance.self.work_arrangement'=any(source_role.permissions) then 0 else 1 end),'rr198_source_role_setup_wrong_version';
   assert (after_role->>'updated_at')::timestamptz=(case when 'attendance.self.work_arrangement'=any(source_role.permissions) then source_role.updated_at else now() end),'rr198_source_role_setup_wrong_timestamp';
   assert after_role->'permissions'=to_jsonb(array(select distinct p from unnest(source_role.permissions||array['attendance.self.work_arrangement']) p order by p)),'rr198_source_role_setup_wrong_permission';
   perform set_config('faolla.rr198_source_role',jsonb_build_object('before',before_role,'after',after_role)::text,true);end;$rr198_seed$;
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
    (${quote(p.role)},${site},'Synthetic198 explicit full reviewer',array[${reviewRoutingNativePermissions.full.map(quote).join(',')}]),
    (${quote(p.correctionOnlyRole)},${site},'Synthetic198 correction-only reviewer',array[${reviewRoutingNativePermissions.correctionOnly.map(quote).join(',')}]);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
    (${quote(p.delegate)},${site},${quote(p.delegateAuth)},'synthetic198-a@example.test','Synthetic198 reviewer A',${quote(p.role)},'active',clock_timestamp(),1),
    (${quote(p.otherDelegate)},${site},${quote(p.otherAuth)},'synthetic198-b@example.test','Synthetic198 reviewer B',${quote(p.correctionOnlyRole)},'active',clock_timestamp(),1);
   select jsonb_build_object('today',(clock_timestamp() at time zone 'UTC')::date::text,
    'localToday',(select (clock_timestamp() at time zone time_zone)::date::text from public.merchant_attendance_settings where merchant_id=${site}),
    'from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'locationId',(select location_id from public.merchant_attendance_events where merchant_id=${site} and id=${quote(start)}),
    'correctionOnlyPermissions',(select permissions from public.merchant_enterprise_roles where merchant_id=${site} and id=${quote(p.correctionOnlyRole)}));`));
  assert.deepEqual(profile.correctionOnlyPermissions,reviewRoutingNativePermissions.correctionOnly);assert(!profile.correctionOnlyPermissions.includes('attendance.self.view'));
  assert.equal((await activation()).current,null);
  const legacyBranch=await save('rr198_legacy'),legacyPrep=await correction(),legacyCommand=correctionCommand(legacyPrep);delete legacyCommand.expectedPolicyRevision;
  const legacy=await correction(legacyCommand,true);assert.equal(legacy.item.status,'submitted');const legacyD=(await routeDetail('correction',legacyCommand.operationId)).data;assert.equal(legacyD.current,null);
  const legacyGrant=grant('correction',{includePending:true});await grants('correction',ownerGrantQ(),legacyGrant);
  const register=routeCommand(legacyD,'register',legacyGrant.operationId),legacyReceipt=(await routing(detailQ('correction',legacyCommand.operationId),register)).receipt;assert.equal(legacyReceipt.revision,1);
  const manual=(await routeDetail('correction',legacyCommand.operationId)).data;assert.deepEqual(manual.current.origin,{kind:'manual_registration'});
  replayOnly=true;try{assert.deepEqual((await routing(detailQ('correction',legacyCommand.operationId),register,false)).receipt,legacyReceipt);}finally{replayOnly=false;}
  assert.deepEqual((await routing({siteId:d.site,mode:'recover',family:'correction',operationId:register.operationId},null,false)).receipt,legacyReceipt);
  assert.equal(await step('legacy_no_binding_backfill',`select count(*) from public.merchant_attendance_correction_rule_bindings where merchant_id=${site} and request_id=${quote(legacyCommand.operationId)};`),'0');
  await restore('rr198_legacy',legacyBranch);groups.push('default_off_actual082_manual_registration_exact_receipt_no_binding_backfill');

  await activation(toggle('activate',0));const sixBranch=await save('rr198_six');
  const cp=await correction(),cc=correctionCommand(cp);await correction(cc);await captured('correction',cc.operationId);await ownerApprove(cc.operationId);
  const rq={siteId:d.site,expectedWorkerId:h.workerId,baseRequestId:cc.operationId,mode:'prepare',requestId:null,operationId:null};
  const rp=parseRevisionCycleResult(await ok('actual_revision_prepare',`public.faolla_attendance_revision_self_v2(${site},${auth},${json(wire(rq))},null,true)`),rq);assert(rp.canSubmit);
  const rc={action:'submit',operationId:next(),expectedRevision:rp.revision,expectedBaseOperationId:rp.current.lineage.rootOperationId,expectedEffectiveOperationId:rp.current.operationId,
   expectedPolicyRevision:rp.currentRules.policy.revision,proposal:{...cc.proposal,endAt:instant(new Date(Date.parse(cc.proposal.endAt)+60000))},reason:'Synthetic198 actual correction revision'};
  const rdq={...rq,mode:'detail',requestId:rc.operationId};parseRevisionCycleResult(await ok('actual_revision_submit',`public.faolla_attendance_revision_self_v2(${site},${auth},${json(wire(rdq))},${json(rc)},true)`,{write:true}),{...rdq,operationId:rc.operationId});
  assert.equal((await captured('correction_revision',rc.operationId)).current.origin.selection,'owner_only_revision');
  const mh=await missing(missingQ()),mc=missingCommand(mh);assert(mh.canRequest&&mh.policyRevision>0);await missing(missingQ(),mc);await captured('missing',mc.operationId);
  const moq=missingQ({access:'owner',requestId:mc.operationId}),md=await missing(moq);assert(md.detail.canApprove);const ma={action:'approve',operationId:next(),requestId:mc.operationId,expectedRevision:1,evidenceToken:md.detail.evidenceToken,reason:'Synthetic198 original missing approval'};await missing(moq,ma);
  const mrc={...mc,action:'revise',operationId:next(),supersedesRequestId:mc.operationId,expectedApprovalOperationId:ma.operationId,proposal:{...mc.proposal,endAt:mc.proposal.endAt.replace('10:00:','10:01:')}};await missing(missingQ(),mrc);await captured('missing_revision',mrc.operationId);
  const leave=await applicationSubmit('leave'),work=await applicationSubmit('work_arrangement');await captured('leave',leave.command.operationId);await captured('work_arrangement',work.command.operationId);
  await restore('rr198_six',sixBranch);groups.push('all_six_actual_original_submit_triggers_revision_owner_only');

  //Actual191 future draft/publication produces the constrained four-row past
  //template. This is explicitly not a historical RPC or a modified wall clock.
  const templateBranch=await save('rr198_template'),scopeValue={kind:'enterprise'},ruleQ=(mode='detail',patch={})=>({siteId:d.site,scope:scopeValue,mode,...patch});
  const ledger=(query,command=null)=>executeOperationalRuleLedger({query,command,authUserId:d.owner,allowWrite:true},service);
  const rules=Object.fromEntries(['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders'].map(k=>[k,{mode:'inherit'}]));
  rules.reviewRouting={mode:'value',value:Object.fromEntries(['correction','missing','leave','work_arrangement'].map(k=>[k,{delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth}]))};
  const ruleDetail=(await ledger(ruleQ())).data;await ledger(ruleQ(),{siteId:d.site,scope:scopeValue,action:'save_draft',operationId:operationalPunchFixtureIds.draft,expectedRevision:0,reason:'Synthetic198 actual routing draft',expectedContext:ruleDetail.context,rules});
  const tomorrow=day(profile.localToday,1),preview=(await ledger(ruleQ('preview',{sourceDraftRevision:1,effectiveOn:tomorrow,endsOn:null}))).data;
  await ledger(ruleQ(),{siteId:d.site,scope:scopeValue,action:'publish',operationId:operationalPunchFixtureIds.publish,expectedRevision:1,sourceDraftRevision:1,effectiveOn:tomorrow,endsOn:null,previewFingerprint:preview.previewFingerprint,reason:'Synthetic198 actual future routing publication'});
  const templates=JSON.parse(await step('read_real191_template',`select jsonb_build_object('head',(select to_jsonb(x) from public.merchant_attendance_operational_rule_streams x),
   'operations',(select jsonb_agg(to_jsonb(x) order by revision) from public.merchant_attendance_operational_rule_operations x));`));await restore('rr198_template',templateBranch);
  await step('disclosed_four_past_source_rows',operationalPunchPastSeed(templates,profile.localToday)+'select 1;');
  const cg=grant('correction'),mg=grant('missing'),lg=grant('application');await grants('correction',ownerGrantQ(),cg);await grants('missing',ownerGrantQ(),mg);await grants('application',ownerGrantQ(),lg);
  const ac=correctionCommand(await correction());await correction(ac);const cd=await captured('correction',ac.operationId,'delegate');assert.equal(cd.current.assignment.grantId,cg.operationId);assert.equal(cd.current.assignment.epochProofKind,'embedded');
  const am=missingCommand(await missing(missingQ()));await missing(missingQ(),am);const mrd=await captured('missing',am.operationId,'delegate');assert.equal(mrd.current.assignment.grantId,mg.operationId);
  const al=await applicationSubmit('leave'),lrd=await captured('leave',al.command.operationId,'delegate');assert.equal(lrd.current.assignment.grantId,lg.operationId);
  for(const r of [cd,mrd,lrd]){assert.equal(r.current.origin.selectedLayer,'enterprise');assert.equal(r.current.origin.selection,'value');assert.equal(r.current.assignment.employeeId,p.delegate);assert.equal(r.current.assignment.authUserId,p.delegateAuth);}
  groups.push('actual191_source_and_real189_160_162_qualified_grant_adapters');

  const no=await applicationSubmit('work_arrangement'),noRoute=await captured('work_arrangement',no.command.operationId,'needs_assignment');assert.equal(noRoute.current.assignment.reason,'no_grant');
  const candidateBranch=await save('rr198_candidates'),second=grant('application');await grants('application',ownerGrantQ(),second);
  const multi=await applicationSubmit('leave'),multiRoute=await captured('leave',multi.command.operationId,'needs_assignment');assert.equal(multiRoute.current.assignment.reason,'ambiguous_grant');
  for(let i=0;i<24;i++)await grants('application',ownerGrantQ(),grant('application'));
  const limit=await applicationSubmit('leave'),limitRoute=await captured('leave',limit.command.operationId,'needs_assignment');assert.equal(limitRoute.current.assignment.reason,'candidate_limit');
  const choices=await routing({...detailQ('leave',limit.command.operationId),mode:'grants',cursor:null});assert.equal(choices.data.items.length,25);assert(choices.data.nextCursor);
  assert.equal((await routeDetail('leave',limit.command.operationId)).data.current.revision,1,'candidate_reads_must_not_auto_register');
  const explicit=routeCommand(limitRoute,'register',lg.operationId);assert.equal((await routing(detailQ('leave',limit.command.operationId),explicit)).receipt.revision,2,'manual_selected_grant_not_blocked_by_sentinel');
  await restore('rr198_candidates',candidateBranch);groups.push('zero_two_and26_raw_candidates_keep_original_success_no_automatic_registration');

  const otherBranch=await save('rr198_other'),og=grant('correction',{delegateEmployeeId:p.otherDelegate,delegateAuthUserId:p.otherAuth,includePending:true});await grants('correction',ownerGrantQ(),og);
  const odq=delegateQ({mode:'detail',grantId:og.operationId,requestId:ac.operationId}),od=await grants('correction',odq,null,p.otherAuth);assert(od.detail.canApprove);
  const oc={grantId:og.operationId,expectedGrantRevision:1,decision:{action:'approve',operationId:next(),requestId:ac.operationId,expectedRevision:od.detail.revision,expectedEvidence:od.detail.evidenceToken,reason:'Synthetic198 other genuine delegate approval'}};
  assert.equal((await grants('correction',{...odq,mode:'decide'},oc,p.otherAuth)).receipt.actorId,p.otherAuth);assert.equal((await routeDetail('correction',ac.operationId)).data.observation.routeState,'closed');
  await restore('rr198_other',otherBranch);groups.push('other_current_legal_delegate_not_blocked_by_responsibility_head');

  await grants('correction',ownerGrantQ({mode:'detail',grantId:cg.operationId}),{action:'revoke',operationId:next(),grantId:cg.operationId,expectedRevision:1,reason:'Synthetic198 revoke original grant'});
  const handover=(await routeDetail('correction',ac.operationId)).data;assert.equal(handover.observation.routeState,'handover_needed');assert.equal(handover.observation.reason,'grant_unavailable');assert(handover.canTakeOver);
  const takeover=routeCommand(handover,'take_over'),takeReceipt=(await routing(detailQ('correction',ac.operationId),takeover)).receipt;assert.equal(takeReceipt.revision,2);
  const taken=(await routeDetail('correction',ac.operationId)).data;assert.deepEqual(taken.current.assignment,{kind:'owner',authUserId:d.owner});assert.deepEqual(taken.current.origin,cd.current.origin);
  await ownerApprove(ac.operationId);assert.equal((await routeDetail('correction',ac.operationId)).data.observation.routeState,'closed');
  groups.push('readonly_revoked189_handover_explicit_owner_takeover_original096_approval');

  const faultQ=applicationQ('work_arrangement'),faultHome=await application('work_arrangement',faultQ),faultCommand=reviewRoutingNativeApplicationCommand('work_arrangement',{
   operationId:next(),workerId:h.workerId,settingsVersion:faultHome.settingsVersion,policyRevision:faultHome.policy.revision,timeZone:faultHome.timeZone,
   date:day(profile.today,3+(slot++)),reason:'Synthetic198 atomic proof fault'});
  await step('inject_new_proof_constraint',`alter table public.merchant_attendance_review_responsibility_entries add constraint synthetic198_fault check(operation_id<>${quote(faultCommand.operationId)}) not valid;select 1;`);
  const beforeFault=steps;await assert.rejects(()=>application('work_arrangement',faultQ,faultCommand));assert.equal(steps,beforeFault+1);assert.equal(lastRpc.sqlstate,'23514');assert.match(lastRpc.error,/synthetic198_fault/);
  await step('remove_new_proof_constraint','alter table public.merchant_attendance_review_responsibility_entries drop constraint synthetic198_fault;select 1;');
  assert.equal(await step('fault_zero_original_and_sidecar',`select (select count(*) from public.merchant_attendance_work_arrangement_requests where merchant_id=${site} and request_id=${quote(faultCommand.operationId)})+
   (select count(*) from public.merchant_attendance_review_responsibility_entries where merchant_id=${site} and operation_id=${quote(faultCommand.operationId)});`),'0');
  const successful=await application('work_arrangement',faultQ,faultCommand);assert.equal(successful.detail.status,'submitted');await activation(toggle('deactivate',1),false);
  replayOnly=true;try{await application('work_arrangement',faultQ,faultCommand);}finally{replayOnly=false;}
  await captured('work_arrangement',faultCommand.operationId,'needs_assignment');const off=await applicationSubmit('work_arrangement');assert.equal((await routeDetail('work_arrangement',off.command.operationId)).data.current,null);
  groups.push('proof_failure_rolls_back_original_old_number_no_new_capture_off_keeps_old_reads');

  const forbidden=await call('no_delegate_owner_catalog',`public.faolla_attendance_review_routing_v1(${json({siteId:d.site,mode:'list',cursor:null})},${quote(p.delegateAuth)},null,false)`);assert.equal(forbidden.error,'attendance_access_denied');
  const self=await routing({siteId:d.site,mode:'self',family:'leave',requestId:al.command.operationId},null,false,h.employeeAuthUserId);assert.equal(self.data.route,'delegate');
  assert.deepEqual(Object.keys(self.data).sort(),['kind','family','requestId','submittedAt','route','handoverNeeded','capturedAt'].sort());
  await step('actual_table_ACL_and_guard',`do $rr198_security$ declare denied boolean:=false;begin
   begin set local role service_role;update public.merchant_attendance_review_responsibility_entries set revision=revision where merchant_id=${site};exception when insufficient_privilege then denied:=true;end;reset role;
   assert denied,'rr198_service_DML_not_denied';denied:=false;
   begin update public.merchant_attendance_review_responsibility_entries set revision=revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_review_routing_immutable';denied:=true;end;
   assert denied,'rr198_postgres_immutable_guard_not_denied';${preserve}end;$rr198_security$;select 1;`);
  groups.push('minimal_self_current_owner_gate_append_only_ACL_and_all_old_rows_preserved');
  assert.equal(groups.length,8);await step('rollback','rollback;');rolledBack=true;
  return{phase:198,groups,steps,reads,writes,rejections,actualFamilies:['correction','correction_revision','missing','missing_revision','leave','work_arrangement'],
   realGrantAdapters:['189','160','162'],candidateCounts:[0,2,26],originalApprovalWritersUnchanged:true,proofFailureAtomic:true,oldNumberExact:true,
   syntheticPastTimeSeed:{rows:4,realDraft:1,realFuturePublication:1,notHistoricalRpc:true},
   syntheticSourceRoleSetup:{capability:'attendance.self.work_arrangement',exactBeforeAndAfterProtected:true,rollbackOnly:true},
   rollbackRestored:true,oldFactsUnchanged:true,oldArchivesUnchanged:true,realAuth:false,production:false};
 }catch(error){throw new Error('review_routing_native_stage:'+stage+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc).slice(0,16000));}
 finally{try{if(!rolledBack)await connection.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
}
