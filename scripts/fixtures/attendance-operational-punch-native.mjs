//242 INERT. Owned local synthetic schema only; caller owns PostgreSQL lifecycle.
//All business facts come from actual services/RPCs. A disclosed four-row191
//past-time seed is NOT a historical RPC publication or an advanced wall clock.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {pinScheduleExpression} from './attendance-pin-schedule-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(242600000+n);
export const operationalPunchFixtureIds=Object.freeze({draft:uid(1),publish:uid(2),seedDraft:uid(3),seedPublish:uid(4)});
// Use the actual UI intent adapter: safe-finish references the original shift's
// versions and null notice revision, never a current-location notice.
export function operationalPunchNativeFinishCommand(channel,result,operationId,safeFinish=false){
 assert.equal(result.channel,channel);
 return require('../../src/lib/merchantAttendanceOperationalPunchUi.ts').operationalPunchUiCommand(result,'clock_out',operationId,null,null,safeFinish);
}
const FLAGS=['p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules'];
export function operationalPunchRpcExpression(name,a){
 const exact=keys=>assert.deepEqual(Object.keys(a).sort(),keys.sort());
 if(name==='faolla_attendance_operational_punch_activation_v1'){
  exact(['p_query','p_auth_user_id','p_command','p_allow_activate']);assert.equal(typeof a.p_allow_activate,'boolean');
  return `public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a.p_allow_activate})`;
 }
 if(name==='faolla_attendance_operational_rules_v1'){
  exact(['p_query','p_auth_user_id','p_command','p_allow_write']);assert.equal(typeof a.p_allow_write,'boolean');
  return `public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a.p_allow_write})`;
 }
 const channel=/^faolla_attendance_operational_punch_(self|location|pin|onsite)_v1$/.exec(name)?.[1];
 if(channel){
  const keys=['p_site','p_query','p_command',...FLAGS,...(channel==='pin'?['p_terminal','p_secret_hash','p_no','p_lease','p_verified']:['p_auth']),
   ...(channel==='location'?['p_expected_worker','p_assertion','p_require_clock']:channel==='onsite'?['p_claims']:[])];exact(keys);
  for(const k of [...FLAGS,...(channel==='pin'?['p_verified']:channel==='location'?['p_require_clock']:[])])assert.equal(typeof a[k],'boolean');
  assert.match(a.p_site,/^9999000[1-6]$/);
  const args=channel==='pin'?[quote(a.p_site),quote(a.p_terminal),quote(a.p_secret_hash),quote(a.p_no),quote(a.p_lease),String(a.p_verified),json(a.p_query),json(a.p_command)]
   :channel==='location'?[quote(a.p_site),quote(a.p_auth),quote(a.p_expected_worker),json(a.p_query),json(a.p_command),json(a.p_assertion)]
   :channel==='onsite'?[quote(a.p_site),quote(a.p_auth),json(a.p_claims),json(a.p_query),json(a.p_command)]:[quote(a.p_site),quote(a.p_auth),json(a.p_query),json(a.p_command)];
  args.push(String(a.p_allow_new_sessions));if(channel==='location')args.push(String(a.p_require_clock));args.push(...FLAGS.slice(1).map(k=>String(a[k])));
  return `public.${name}(${args.join(',')})`;
 }
 if(name==='faolla_attendance_pin_schedule_v1')return pinScheduleExpression(a);
 if(name==='faolla_attendance_location_clock_v1')return boundClockRpcExpression('faolla_attendance_location_clock_v2',a).replace('location_clock_v2(','location_clock_v1(');
 return boundClockRpcExpression(name,a);
}

export function operationalPunchPastSeed(templates,today){
 assert.match(today,/^20\d\d-\d\d-\d\d$/);assert.equal(templates.operations.length,2);
 assert.deepEqual(templates.operations.map(r=>r.action),['save_draft','publish']);
 return `do $op242_seed$ declare seed_head public.merchant_attendance_operational_rule_streams%rowtype;
  seed_op public.merchant_attendance_operational_rule_operations%rowtype;seed_value jsonb;seed_stamp timestamptz;seed_day text;seed_at text;seed_preview text;
 begin
  assert not exists(select 1 from public.merchant_attendance_operational_rule_streams),'op242_requires_empty_191';
  seed_head:=jsonb_populate_record(null::public.merchant_attendance_operational_rule_streams,${json(templates.head)});
  seed_day:=(${quote(today)}::date-1)::text;
  seed_stamp:=public.faolla_attendance_rule_day_start_v1((${quote(today)}::date-2)::text,${json(templates.operations[0])}->'item'->'context'->>'timeZone');
  seed_at:=to_char(public.faolla_attendance_rule_day_start_v1(seed_day,${json(templates.operations[0])}->'item'->'context'->>'timeZone') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  for seed_value in select value from jsonb_array_elements(${json(templates.operations)}) order by (value->>'revision')::bigint loop
   seed_op:=jsonb_populate_record(null::public.merchant_attendance_operational_rule_operations,seed_value);
   seed_op.operation_id:=case when seed_op.revision=1 then ${quote(operationalPunchFixtureIds.seedDraft)}::uuid else ${quote(operationalPunchFixtureIds.seedPublish)}::uuid end;
   seed_op.recorded_at:=seed_stamp+(seed_op.revision-1)*interval '1 microsecond';
   seed_op.command:=seed_op.command||jsonb_build_object('operationId',seed_op.operation_id,'reason','Synthetic242 past-time fixture, not historical RPC');
   seed_op.item:=seed_op.item||jsonb_build_object('operationId',seed_op.operation_id,'reason','Synthetic242 past-time fixture, not historical RPC','recordedAt',to_char(seed_op.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   if seed_op.action='publish' then
    seed_preview:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-publish-preview-v1',seed_op.merchant_id,
     public.faolla_attendance_operational_rule_scope_v1(seed_op.scope),1,1,seed_op.item->>'rulesFingerprint',seed_op.item->>'referenceFingerprint',seed_day,null,seed_at,null));
    seed_op.command:=seed_op.command||jsonb_build_object('effectiveOn',seed_day,'previewFingerprint',seed_preview);
    seed_op.item:=seed_op.item||jsonb_build_object('effectiveOn',seed_day,'effectiveAt',seed_at,'previewFingerprint',seed_preview);
   end if;
   seed_op.command_fingerprint:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-command-v1',seed_op.actor_auth_user_id::text,public.faolla_attendance_operational_rule_command_v1(seed_op.command)));
   seed_op.item:=seed_op.item||jsonb_build_object('commandFingerprint',seed_op.command_fingerprint);
   perform public.faolla_attendance_operational_rule_item_v1(seed_op);insert into public.merchant_attendance_operational_rule_operations select(seed_op).*;
  end loop;
  seed_head.created_at:=seed_stamp;seed_head.updated_at:=seed_stamp+interval '1 microsecond';
  insert into public.merchant_attendance_operational_rule_streams select(seed_head).*;
  insert into public.merchant_attendance_operational_rule_publications(merchant_id,stream_key,published_revision,operation_id,effective_at,ends_at)
   values(seed_head.merchant_id,seed_head.stream_key,2,${quote(operationalPunchFixtureIds.seedPublish)},seed_at::timestamptz,null);
  perform public.faolla_attendance_operational_rule_check_v1(seed_head.merchant_id,seed_head.stream_key,2);
  set constraints all immediate;set constraints all deferred;
 end;$op242_seed$;`;
}

export async function verifyOperationalPunchNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 assert.equal(d.owned.schema,scope.schema);assert.equal(d.owned.owner,'postgres');
 const {executeOperationalPunch}=require('../../src/lib/merchantAttendanceOperationalPunch.server.ts');
 const {executeOperationalPunchActivation}=require('../../src/lib/merchantAttendanceOperationalPunchActivation.server.ts');
 const {executeOperationalRuleLedger}=require('../../src/lib/merchantAttendanceOperationalRuleLedger.server.ts');
 const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
 const {executeAttendanceLocationClock}=require('../../src/lib/merchantAttendanceLocationClock.server.ts');
 const {executePinClock}=require('../../src/lib/merchantAttendancePinClock.server.ts');
 const {executeAttendancePinSchedule}=require('../../src/lib/merchantAttendancePinSchedule.server.ts');
 const {executeOnsiteClock,executeOnsiteIssue}=require('../../src/lib/merchantAttendanceOnsiteQr.server.ts');
 const {parseOperationalPunchResult,operationalPunchCommandFingerprint}=require('../../src/lib/merchantAttendanceOperationalPunch.ts');
 const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const oldArchive=periodContinuationArchiveBytes(await archive()),oldPeriod=periodContinuationArchiveBytes(await periodArchive());
 const site=quote(d.site),worker=quote(d.worker),location=quote(d.location),terminal=quote(d.terminal);
 const authTables=['merchant_attendance_pin_credentials','merchant_attendance_pin_attempts'];
 const append=['merchant_attendance_events','merchant_attendance_location_results','merchant_attendance_location_clock_notices',
  'merchant_attendance_pin_clock_receipts','merchant_attendance_onsite_receipts','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions',
  'merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_publications',
  'merchant_attendance_operational_punch_activations','merchant_attendance_operational_punch_sessions','merchant_attendance_operational_punch_operations'];
 const allHash=outageNativeFingerprintSql(names),businessHash=outageNativeFingerprintSql(names.filter(n=>!authTables.includes(n))),protectedHash=outageNativeFingerprintSql(names.filter(n=>!append.includes(n)&&!authTables.includes(n)));
 const projection=n=>n==='merchant_attendance_settings'?`case when x.merchant_id=${site} then to_jsonb(x)-'web_break_paid' else to_jsonb(x) end`
  :n==='merchant_attendance_locations'?`case when x.merchant_id=${site} and x.id=${location} then to_jsonb(x)-array['latitude','longitude','radius_meters'] else to_jsonb(x) end`
  :n==='merchant_attendance_pin_credentials'?`case when x.merchant_id=${site} and x.worker_id=${worker} then to_jsonb(x)-array['attempts','window_at'] else to_jsonb(x) end`
  :n==='merchant_attendance_pin_attempts'?`case when x.merchant_id=${site} and x.terminal_id=${terminal} then to_jsonb(x)-array['attempts','window_at','lease_id','lease_expires','worker_id','employee_id','credential_revision'] else to_jsonb(x) end`:'to_jsonb(x)';
 for(const n of names)assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(n));
 // object_agg avoids PostgreSQL's100 function-argument cap as the inherited
 // schema grows. Each table name is validated; this does not widen mutations.
 const originals=`(select jsonb_object_agg(original_name,original_rows) from (${names.map(n=>`select ${quote(n)} original_name,(select coalesce(jsonb_agg(${projection(n)}),'[]'::jsonb) from public.${n} x) original_rows`).join(' union all ')}) original_tables)`;
 const preserve=names.map(n=>`assert not exists(select prior.value from jsonb_array_elements(current_setting('faolla.op242_originals')::jsonb->${quote(n)}) prior(value) except select ${projection(n)} from public.${n} x),'op242_original_row_changed:${n}';`).join('\n');
 const prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 let steps=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,lastStepFailure=null,rolledBack=false,legacyPrivate=false,replayOnly=false;
 const groups=[],starts=[],operations=[],legacyGates=[];
 const step=async(label,sql)=>{stage=label;assert(++steps<=150,'operational_punch_max150_steps');try{return await connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));}catch(error){lastStepFailure=String(error?.stack??error).slice(0,10000);throw error;}};
 const call=async(label,expression,{write=false,auth=false,replay=false,role='service_role'}={})=>{
  const r=JSON.parse(await step(label,`do $op242_rpc$ declare rpc_before text;rpc_protected text;rpc_value jsonb;rpc_failure text;rpc_state text;rpc_context text;begin
   rpc_before:=${auth?businessHash:allHash};rpc_protected:=${protectedHash};
   begin set local role ${role};assert current_user=${quote(role)};rpc_value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics rpc_failure=message_text,rpc_state=returned_sqlstate,rpc_context=pg_exception_context;end;reset role;
   if rpc_failure is not null or rpc_value ? 'error' or ${!write||replay} then assert ${auth?businessHash:allHash}=rpc_before,'op242_read_or_reject_changed_business';end if;
   assert ${protectedHash}=rpc_protected,'op242_RPC_changed_unrelated_tables';${preserve}
   perform set_config('faolla.op242_result',jsonb_build_object('value',rpc_value,'error',rpc_failure,'sqlstate',rpc_state,'context',rpc_context)::text,true);
  end;$op242_rpc$;select current_setting('faolla.op242_result')::jsonb;`));lastRpc={error:r.error,sqlstate:r.sqlstate,context:r.context,...(r.value?.error?{value:{error:r.value.error}}:{})};
  if(r.error||r.value?.error)rejections++;else if(write)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{
  const actualName=legacyPrivate&&name==='faolla_attendance_location_clock_v2'&&args.p_command?'faolla_attendance_location_clock_v1':name;
  const command=args.p_command??args.p_request?.command,auth=name.includes('_pin_'),write=!!command;
  const actualArgs=actualName==='faolla_attendance_location_clock_v1'?{...args,p_command:Object.fromEntries(Object.entries(args.p_command).filter(([key])=>!['noticeRevision','safeFinish'].includes(key)))}:args;
  //072 is now a private inner writer. Its seven-field intent is exercised as
  //owned postgres only; the real actor/assertion still originate in old service.
  const r=await call('rpc_'+actualName+'_'+(command?.clock?.action??command?.action??args.p_query?.mode??'read'),operationalPunchRpcExpression(actualName,actualArgs),{write,auth,replay:replayOnly,role:actualName==='faolla_attendance_location_clock_v1'?'postgres':'service_role'});
  return {data:r.value,error:r.error?{message:r.error}:null};
 }};
 const save=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${allHash};`);};
 const restore=async(name,hash)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${allHash};`),hash);
 const deny=async(label,run,code)=>{const before=steps;let error;try{await run();}catch(e){error=e;}assert(error,label+':must_reject');assert(steps>before,label+':must_reach_real_SQL');
  const actual=lastRpc.error??lastRpc.value?.error;if(code instanceof RegExp)assert.match(actual??'',code,label+':'+JSON.stringify(lastRpc));else assert.equal(actual,code,label+':'+JSON.stringify(lastRpc));};
 const activation=(command=null,allowActivate=true,authUserId=d.owner,query={siteId:d.site,mode:'current'})=>executeOperationalPunchActivation({query,command,authUserId,allowActivate},service);
 const activate=(action,revision)=>({siteId:d.site,operationId:uid(++serial),action,expectedRevision:revision,reason:'Synthetic242 explicit '+action});
 const base={siteId:d.site,moduleEnabled:true,allowOperationalStart:true,allowSchedule:true,bindRules:false};
 const inputs=channel=>channel==='pin'?{...base,channel,terminalId:d.terminal,secret:d.secret,workerNo:d.workerNo,pin:d.pin}
  :channel==='location'?{...base,channel,authUserId:d.auth,expectedWorkerId:d.worker,position:null,positionFailure:null}
  :channel==='onsite'?{...base,channel,authUserId:d.auth,token:null}:{...base,channel,authUserId:d.auth};
 const punch=async(channel,command=null,patch={})=>{
  let transport={};if(command&&channel==='onsite'&&!Object.hasOwn(patch,'token'))transport={token:(await executeOnsiteIssue({siteId:d.site,terminalId:d.terminal,secret:d.secret},service)).token};
  if(command&&channel==='location')transport=command.clock.safeFinish?{position:null,positionFailure:'not_provided'}:{position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()},positionFailure:null};
  const r=await executeOperationalPunch({...inputs(channel),query:command?{mode:'recover',operationId:command.clock.operationId}:{mode:'prepare'},command,...transport,...patch},service);
  if(command)operations.push(r.operation);return r;
 };
 const clock=(channel,result,action)=>({expectedWorkerId:d.worker,...(['pin','onsite'].includes(channel)?{expectedEmployeeId:d.employee}:{}),operationId:uid(++serial),
  locationId:result.clock.locationId,action,expectedSequence:result.clock.state.sequence,...(channel==='location'?{settingsVersion:result.clock.policy?.settingsVersion??result.clock.finish.settingsVersion,
   workerVersion:result.clock.policy?.workerVersion??result.clock.finish.workerVersion,locationVersion:result.clock.policy?.locationVersion??result.clock.finish.locationVersion,noticeRevision:result.clock.noticeGate.revision,safeFinish:false}:{})});
 const startCommand=(channel,r,selection=null)=>({clock:clock(channel,r,'clock_in'),choice:{kind:'start',expectedPolicyFingerprint:r.policy.policyFingerprint,selection}});
 const endCommand=(channel,r,safeFinish=false)=>operationalPunchNativeFinishCommand(channel,r,uid(++serial),safeFinish);
 const oldSelf=c=>executeAttendanceSelf({siteId:d.site,authUserId:d.auth,command:c,operationId:null},service);
 const oldCommand=(r,action='clock_in')=>({expectedWorkerId:d.worker,operationId:uid(++serial),locationId:d.location,action,expectedSequence:r.clock?.state.sequence??r.state.sequence});
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $op242_pre$ begin assert current_user='postgres';
    assert not exists(select 1 from public.merchant_attendance_operational_punch_activations where merchant_id=${site});
    assert not exists(select 1 from public.merchant_attendance_operational_rule_streams where merchant_id=${site});
    assert exists(select 1 from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.id=w.employee_id and e.merchant_id=w.merchant_id where w.merchant_id=${site} and w.id=${worker} and e.id=${quote(d.employee)} and e.auth_user_id=${quote(d.auth)} and w.active and e.status='active');
    assert exists(select 1 from public.merchant_attendance_pin_credentials where merchant_id=${site} and worker_id=${worker} and enabled and attempts<=2),'op242_PIN_budget_requires_at_least8';
    perform set_config('faolla.op242_originals',${originals}::text,true);
   end;$op242_pre$;
   select jsonb_build_object('today',(select (clock_timestamp() at time zone time_zone)::date::text from public.merchant_attendance_settings where merchant_id=${site}),
    'geometry',(select jsonb_build_array(latitude,longitude,radius_meters) from public.merchant_attendance_locations where merchant_id=${site} and id=${location}),
    'paid',(select web_break_paid from public.merchant_attendance_settings where merchant_id=${site}));`));
  assert.deepEqual(profile.geometry,[null,null,null]);assert.equal(typeof profile.paid,'boolean');
  const initial=await activation();assert.equal(initial.current,null);const off=await punch('self');assert.equal(off.canStart,false);assert.equal(off.policy,null);
  const oldStarted=await oldSelf(oldCommand(off));assert.equal(oldStarted.receipt.action,'clock_in');
  await deny('nonowner_activation',()=>activation(activate('activate',0),true,d.auth),'attendance_access_denied');
  await deny('flagoff_activation',()=>activation(activate('activate',0),false),'attendance_operational_punch_disabled');
  const activationCommand=activate('activate',0),enabled=await activation(activationCommand);assert.equal(enabled.current.revision,1);
  replayOnly=true;try{assert.deepEqual((await activation(activationCommand,false)).receipt,enabled.receipt);}finally{replayOnly=false;}
  await deny('activation_same_number_changed',()=>activation({...activationCommand,reason:'Synthetic242 changed body'}),'attendance_operation_conflict');
  await deny('activation_stale_CAS',()=>activation(activate('deactivate',0)),'attendance_operational_punch_changed');
  await deny('activation_unchanged',()=>activation(activate('activate',1)),'attendance_operational_punch_unchanged');
  await oldSelf(oldCommand(oldStarted,'clock_out'));
  const oldReceipt=await executeAttendanceSelf({siteId:d.site,authUserId:d.auth,command:null,operationId:oldStarted.receipt.operationId},service);assert.deepEqual(oldReceipt.receipt,oldStarted.receipt);
  const unconfigured=await punch('self');assert.deepEqual(unconfigured.policy.origins,[]);
  assert.equal(unconfigured.policy.fields.breakTypes.state,'unconfigured');
  groups.push('activation_and_original_legacy_finish');

  const scopeValue={kind:'enterprise'},q=(mode='detail',extra={})=>({siteId:d.site,scope:scopeValue,mode,...extra}),templateSave=await save('op242_templates');
  const ledger=(query,command=null)=>executeOperationalRuleLedger({query,command,authUserId:d.owner,allowWrite:true},service);
  const rules=Object.fromEntries(['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders'].map(k=>[k,{mode:'inherit'}]));
  rules.breakTypes={mode:'value',value:{allowed:['paid','unpaid'],selection:'explicit'}};
  const detail=(await ledger(q())).data;
  await ledger(q(),{siteId:d.site,scope:scopeValue,action:'save_draft',operationId:operationalPunchFixtureIds.draft,expectedRevision:0,reason:'Synthetic242 actual template draft',expectedContext:detail.context,rules});
  const future=new Date(Date.parse(profile.today+'T00:00:00Z')+86400000).toISOString().slice(0,10),preview=(await ledger(q('preview',{sourceDraftRevision:1,effectiveOn:future,endsOn:null}))).data;
  await ledger(q(),{siteId:d.site,scope:scopeValue,action:'publish',operationId:operationalPunchFixtureIds.publish,expectedRevision:1,reason:'Synthetic242 actual future template publication',sourceDraftRevision:1,effectiveOn:future,endsOn:null,previewFingerprint:preview.previewFingerprint});
  const templates=JSON.parse(await step('read_real191_templates',`select jsonb_build_object('head',(select to_jsonb(x) from public.merchant_attendance_operational_rule_streams x where merchant_id=${site}),
   'operations',(select jsonb_agg(to_jsonb(x) order by revision) from public.merchant_attendance_operational_rule_operations x where merchant_id=${site}));`));
  await restore('op242_templates',templateSave);await step('disclosed_past_time_seed',operationalPunchPastSeed(templates,profile.today)+'select 1;');
  const fresh=await punch('self');assert.equal(fresh.policy.fields.breakTypes.value.selection,'explicit');assert.equal(fresh.policy.origins[0].operationId,operationalPunchFixtureIds.seedPublish);
  const stale=startCommand('self',fresh),changed=await save('op242_settings');
  await step('synthetic_web_break_paid_change',`do $op242_setup$ begin update public.merchant_attendance_settings set web_break_paid=not web_break_paid where merchant_id=${site} and web_break_paid=${profile.paid};assert found,'op242_exact_settings_setup';end;$op242_setup$;select 1;`);
  await deny('independent_baseline_changed',()=>punch('self',stale),'attendance_operational_punch_changed');await restore('op242_settings',changed);
  groups.push('real191_templates_saved_source_and_policy_CAS');

  const selected=fresh.choices?.entries.find(x=>x.id===d.slots.main.id);assert(selected,'op242_existing_approved_slot_not_listed');
  const firstCommand=startCommand('self',fresh,{slotId:selected.id,revision:selected.revision}),first=await punch('self',firstCommand);starts.push(first.operation);
  assert.equal(first.association.status,'linked');assert.equal(first.adoption.status,'adopted');assert.equal(first.adoption.approval.operationId,d.mainApproval.operationId);
  const savedSession=JSON.stringify(first.session);let working=await punch('self');
  await deny('legacy_managed_break',()=>oldSelf(oldCommand(working,'break_start')),'attendance_operational_punch_protocol_required');
  await activation(activate('deactivate',1),false);
  await save('op242_paid_setting');await step('synthetic_fixed_baseline_change',`do $op242_setup$ begin update public.merchant_attendance_settings set web_break_paid=not web_break_paid where merchant_id=${site} and web_break_paid=${profile.paid};assert found,'op242_exact_settings_setup';end;$op242_setup$;select 1;`);
  for(const kind of ['paid','unpaid']){
   working=await punch('self',null,{allowOperationalStart:false});assert.equal(JSON.stringify(working.session),savedSession);
   const c={clock:clock('self',working,'break_start'),choice:{kind:'break',startEventId:first.operation.eventId,expectedSessionFingerprint:first.session.sessionFingerprint,breakType:kind}};
   const begun=await punch('self',c,{allowOperationalStart:false});assert.equal(begun.clock.receipt.breakPaid,kind==='paid');
   const onBreak=await punch('self',null,{allowOperationalStart:false});await punch('self',{clock:clock('self',onBreak,'break_end'),choice:{kind:'finish'}},{allowOperationalStart:false});
  }
  // Preserve both actual breaks; restore ONLY the already-read setup column,
  // then release its savepoint rather than rolling the successful events back.
  await step('restore_exact_paid_column',`do $op242_setup$ begin update public.merchant_attendance_settings set web_break_paid=${profile.paid} where merchant_id=${site} and web_break_paid=${!profile.paid};assert found,'op242_exact_settings_restore';end;$op242_setup$;release savepoint op242_paid_setting;select 1;`);
  working=await punch('self',null,{allowOperationalStart:false});await punch('self',endCommand('self',working),{allowOperationalStart:false});
  await activation(activate('activate',2));groups.push('managed_explicit_breaks_fixed_session_and_finish');

  const legacySnapshot=await punch('self');await deny('legacy_self',()=>oldSelf(oldCommand(legacySnapshot)),'attendance_operational_punch_protocol_required');legacyGates.push('self');
  const pinScope=await save('op242_pin');
  const oldPin=c=>executePinClock({siteId:d.site,terminalId:d.terminal,secret:d.secret,workerNo:d.workerNo,pin:d.pin,allowNew:true,command:c,operationId:null},service);
  const oldPinCommand={...oldCommand(legacySnapshot),expectedEmployeeId:d.employee};
  await deny('legacy_pin_clock',()=>oldPin(oldPinCommand),'attendance_operational_punch_protocol_required');legacyGates.push('pin_clock');
  await deny('legacy_pin_schedule',()=>executeAttendancePinSchedule({siteId:d.site,terminalId:d.terminal,secret:d.secret,workerNo:d.workerNo,pin:d.pin,moduleEnabled:true,allowWrite:true,bindRules:false,command:{...oldPinCommand,operationId:uid(++serial)},operationId:null,selection:null},service),'attendance_operational_punch_protocol_required');legacyGates.push('pin_schedule');
  const pinPrepared=await punch('pin'),pinCommand=startCommand('pin',pinPrepared);
  await deny('PIN_known_business_reject',()=>punch('pin',{...pinCommand,choice:{...pinCommand.choice,expectedPolicyFingerprint:'f'.repeat(64)}}),'attendance_operational_punch_changed');
  assert.equal(await step('PIN_lease_consumed',`select (lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null)::text from public.merchant_attendance_pin_attempts where merchant_id=${site} and terminal_id=${terminal};`),'true');
  const pinStarted=await punch('pin',pinCommand);assert.equal(pinStarted.operation.actorAuthUserId,null);assert.equal(pinStarted.association.status,'unselected');starts.push(pinStarted.operation);
  const pinRecovered=await punch('pin',null,{query:{mode:'recover',operationId:pinCommand.clock.operationId},allowOperationalStart:false});assert.deepEqual(pinRecovered.operation,pinStarted.operation);
  const pinWorking=await punch('pin');await punch('pin',endCommand('pin',pinWorking));await restore('op242_pin',pinScope);

  const onsitePrepared=await punch('onsite'),onsiteOld={...oldCommand(onsitePrepared),expectedEmployeeId:d.employee};
  const issued=await executeOnsiteIssue({siteId:d.site,terminalId:d.terminal,secret:d.secret},service);
  await deny('legacy_onsite',()=>executeOnsiteClock({siteId:d.site,authUserId:d.auth,token:issued.token,command:onsiteOld,operationId:null,allowNew:true},service),'attendance_operational_punch_protocol_required');legacyGates.push('onsite');
  const onsiteCommand=startCommand('onsite',onsitePrepared),onsiteStarted=await punch('onsite',onsiteCommand,{token:issued.token});starts.push(onsiteStarted.operation);assert.equal(onsiteStarted.association.status,'unselected');
  const onsiteWorking=await punch('onsite');await deny('onsite_nonce_reuse',()=>punch('onsite',endCommand('onsite',onsiteWorking),{token:issued.token}),'attendance_qr_used');
  await punch('onsite',endCommand('onsite',onsiteWorking));

  const geoSave=await save('op242_geometry');await step('synthetic_restore_notice_fence',`do $op242_setup$ begin update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id=${site} and id=${location} and latitude is null and longitude is null and radius_meters is null;assert found,'op242_exact_location_setup';end;$op242_setup$;select 1;`);
  const geo=await punch('location');assert.equal(geo.clock.noticeGate.ready,true);const geoC=startCommand('location',geo);
  const oldGeo={...geoC.clock,position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()},positionFailure:null};
  const runOldGeo=()=>executeAttendanceLocationClock({siteId:d.site,expectedWorkerId:d.worker,authUserId:d.auth,command:oldGeo,operationId:null,moduleEnabled:true},service);
  await deny('legacy_location_v2',runOldGeo,'attendance_operational_punch_protocol_required');legacyGates.push('location_v2');
  legacyPrivate=true;try{await deny('legacy_location_v1',runOldGeo,'attendance_operational_punch_protocol_required');}finally{legacyPrivate=false;}legacyGates.push('location_v1');
  const geoStarted=await punch('location',geoC);starts.push(geoStarted.operation);assert.equal(geoStarted.clock.locationResult.reason,'inside');
  const geoWorking=await punch('location');const geoFinished=await punch('location',endCommand('location',geoWorking,true),{allowOperationalStart:false});assert.equal(geoFinished.clock.receiptGate.safeFinish,true);assert.equal(geoFinished.clock.locationResult.reason,'not_provided');
  await restore('op242_geometry',geoSave);assert.equal(starts.length,4);assert.equal(new Set(starts.map(x=>x.channel)).size,4);assert.equal(legacyGates.length,6);
  groups.push('four_actual_channels_and_six_legacy_gates');

  const faultRead=await punch('self'),fault=startCommand('self',faultRead),faultSave=await save('op242_fault');
  await step('inject_owned_proof_failure',`alter table public.merchant_attendance_operational_punch_operations add constraint synthetic242_proof_fault check(operation_id<>${quote(fault.clock.operationId)}) not valid;select 1;`);
  await deny('proof_failure_atomic',()=>punch('self',fault),/violates check constraint "synthetic242_proof_fault"/);assert.equal(lastRpc.sqlstate,'23514');
  await restore('op242_fault',faultSave);groups.push('PIN_consumption_nonce_location_and_atomic_proof_failure');
  const recovered=await punch('self',null,{query:{mode:'recover',operationId:firstCommand.clock.operationId},allowOperationalStart:false,moduleEnabled:false});
  assert.deepEqual(recovered.operation,first.operation);assert.equal(recovered.session,null);assert.equal(recovered.policy,null);assert.equal(recovered.canStart,false);
  const expected={siteId:d.site,channel:'self',authUserId:d.auth,query:{mode:'recover',operationId:firstCommand.clock.operationId},command:firstCommand,write:false};
  assert.deepEqual(await parseOperationalPunchResult(recovered,expected),recovered);
  const changedCommand={...firstCommand,choice:{...firstCommand.choice,selection:null}};
  await assert.rejects(parseOperationalPunchResult(recovered,{...expected,command:changedCommand}));
  assert.equal(await operationalPunchCommandFingerprint(d.site,'self',d.auth,{workerId:d.worker,employeeId:d.employee,employeeAuthUserId:d.auth},firstCommand),first.operation.commandFingerprint);
  assert.deepEqual((await activation(null,false,d.owner,{siteId:d.site,mode:'recover',operationId:activationCommand.operationId})).receipt,enabled.receipt);
  await step('old_rows_before_rollback',`do $op242_last$ begin ${preserve} end;$op242_last$;select 1;`);
  await step('rollback','rollback;');rolledBack=true;groups.push('original_number_full_hash_and_complete_rollback');
  return {phase:242,groups,steps,reads,writes,rejections,actualChannelStarts:starts.map(x=>x.channel),legacyGates,
   syntheticPastTimeSeed:{rows:4,realTemplateDrafts:1,realTemplateFuturePublications:1,notHistoricalRpc:true},
   syntheticSetup:{locationFenceColumns:3,webBreakPaid:true,allRolledBack:true},pinKnownBusinessRejectionConsumesLease:true,proofFailureAtomic:true,
   rollbackRestored:true,oldFactsUnchanged:true,oldArchivesUnchanged:true,realAuth:false,realGps:false,production:false};
 }catch(error){throw new Error('operational_punch_native_stage:'+stage+':'+(error?.stack??error)+':'+JSON.stringify({lastRpc,lastStepFailure}));}
 finally{try{if(!rolledBack)await connection.step('rollback;');}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),oldArchive);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),oldPeriod);
 }
}
