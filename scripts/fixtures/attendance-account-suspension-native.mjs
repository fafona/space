//193 synthetic acceptance. All writes run only inside the caller-owned schema.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {verifyAccountSuspensionBoundaries} from './attendance-account-suspension-native-boundaries.mjs';
import {verifyAccountSuspensionRestoreSecurityNative} from './attendance-account-suspension-restore-security-native.mjs';
const require=createRequire(import.meta.url);
const {parseAccountSuspensionResult,accountSuspensionCommandFingerprint,accountStatusCommandFingerprint}=require('../../src/lib/merchantAttendanceAccountSuspension.ts');
const migration='202610060164_merchant_attendance_account_suspensions.sql';
const rpc='faolla_attendance_account_suspensions_v1';
const statusRpc='faolla_update_merchant_enterprise_employee_v1';
export const suspensionExpression=(q,actor,c=null,allow=true)=>`public.${rpc}(${json(q)},${quote(actor)},${json(c)},${allow})`;

export async function verifyAccountSuspensionNative(context,browserCheck=null){
  const {d,h,native,scope}=context,{exec}=d;
  assert(d.syntheticOnly&&h.syntheticOnly&&context.enterprise.syntheticOnly);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  let phase='prepare',counter=193100000,reads=0,rejections=0;
  const next=()=>id(++counter),site=d.site,owner=d.owner;
  const worker=h.workerId,employee=h.employeeId,auth=h.employeeAuthUserId;
  const query=(mode='list',patch={})=>({siteId:site,mode,afterId:null,suspensionId:null,operationId:null,...patch});
  const stateEmployee=(target=employee)=>JSON.parse(exec(`select to_jsonb(e) from public.merchant_enterprise_employees e where merchant_id=${quote(site)} and id=${quote(target)};`));
  const stateWorker=(target=worker)=>JSON.parse(exec(`select to_jsonb(w) from public.merchant_attendance_workers w where merchant_id=${quote(site)} and id=${quote(target)};`));
  const statusInput=(status,target=employee,extra={})=>({merchant_id:site,employee_id:target,expected_version:stateEmployee(target).version,
    actor_type:'owner',actor_id:owner,status,...(status==='disabled'?{offboarding_mode:'unassign'}:{}),...extra});
  const statusExpr=p=>`public.${statusRpc}(${json(p)})`;
  const mutate=p=>JSON.parse(exec('set local role service_role;select '+statusExpr(p)+';'));
  const tracked=(status,target=employee,enabled=true)=>statusInput(status,target,{attendance_operation_id:next(),attendance_suspension_enabled:enabled});
  const readRaw=(q,c=null,allow=true,a=owner)=>parseAccountSuspensionResult(JSON.parse(exec('set local role service_role;select '+suspensionExpression(q,a,c,allow)+';')),q,a,c);
  const read=(q,a=owner)=>{const before=d.fingerprint(),r=readRaw(q,null,true,a);assert.equal(d.fingerprint(),before);reads++;return r;};
  const reject=(fn,pattern='attendance_|enterprise_|permission_')=>{const before=d.fingerprint();assert.throws(fn,new RegExp('ERROR:\\s+(?:'+pattern+')'));assert.equal(d.fingerprint(),before);rejections++;};
  const protectedFacts=()=>d.fingerprint(['merchant_attendance_events','merchant_attendance_employment_periods','merchant_attendance_leave_requests','merchant_attendance_leave_entries',
    'merchant_attendance_work_arrangement_requests','merchant_attendance_work_arrangement_entries','merchant_attendance_missing_requests','merchant_attendance_missing_entries']);
  const grantUsable=(category,g)=>exec(`select public.faolla_attendance_${category}_delegation_usable_v1(g,clock_timestamp()) from public.merchant_attendance_${category}_delegations g where merchant_id=${quote(site)} and grant_id=${quote(g)};`)==='t';
  const detail=pause=>read(query('detail',{suspensionId:pause})).detail;
  const restoreCommand=value=>({action:'restore',operationId:next(),suspensionId:value.suspension.suspensionId,expectedGeneration:value.suspension.generation,
    workerId:value.suspension.workerId,expectedWorkerVersion:value.workerVersion,expectedEmployeeVersion:value.employeeVersion,
    employeeId:value.suspension.employeeId,employeeAuthUserId:value.suspension.employeeAuthUserId,reason:'Synthetic193 核验同身份 "原状态"'});
  const restore=pause=>{const c=restoreCommand(detail(pause));return {command:c,result:readRaw(query('detail',{suspensionId:pause}),c)};};
  const clockExpr=(action=null,operation=next())=>{
    const w=stateWorker(),e=stateEmployee(),last=JSON.parse(exec(`select coalesce((select to_jsonb(e) from public.merchant_attendance_events e where merchant_id=${quote(site)} and worker_id=${quote(worker)} order by sequence desc limit 1),'null'::jsonb);`));
    assert.equal(e.auth_user_id,auth);
    const c=action?{operationId:operation,expectedWorkerId:worker,locationId:w.default_location_id,action,expectedSequence:last?.sequence??0}:null;
    return `public.faolla_attendance_self_v1(${quote(site)},${quote(auth)},${json(c)},null)`;
  };
  const clock=action=>JSON.parse(exec('set local role service_role;select '+clockExpr(action)+';'));
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
  const race=(left,right)=>lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},prefix+left,prefix+right);
  try{
    // Attendance-only fixtures did not need invitation acceptance. The real
    // employee restore RPC does; seed that explicit synthetic prerequisite.
    exec(`update public.merchant_enterprise_employees set accepted_at=timestamp '2026-01-01 00:00:00' at time zone 'UTC'
      where merchant_id=${quote(site)} and id in(${quote(employee)},${quote(d.employee)}) and accepted_at is null;`);
    // Create real grants BEFORE164: absent epoch-sidecars must remain valid at
    // generation zero, and permanently stop after either identity is suspended.
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.missing.review','attendance.self.clock','tasks.view']) p order by p)
      where merchant_id=${quote(site)} and id in(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(site)} and id in(${quote(employee)},${quote(d.employee)}));`);
    const oldApplication=context.grant();context.raw(context.ownerQuery(),oldApplication);
    const location=stateWorker().default_location_id;
    const oldMissing={action:'grant',operationId:next(),delegateEmployeeId:d.employee,delegateAuthUserId:d.auth,workerId:worker,employeeId:employee,employeeAuthUserId:auth,
      locationId:location,validFrom:new Date(Date.now()-60000).toISOString().replace('Z','000Z'),validUntil:new Date(Date.now()+3600000).toISOString().replace('Z','000Z'),reason:'Synthetic193 old missing grant'};
    const missingQuery={siteId:site,access:'owner',mode:'list',catalog:null,afterId:null,grantId:null,operationId:null};
    exec(`set local role service_role;select public.faolla_attendance_missing_delegations_v1(${json(missingQuery)},${quote(owner)},${json(oldMissing)},true);`);
    assert(grantUsable('application',oldApplication.operationId)&&grantUsable('missing',oldMissing.operationId));
    // Existing preparation installs exact required019 functions/triggers, not
    // every unrelated enterprise RPC. Mark this only in the owned test schema
    // after its catalog assertions, never as a production migration execution.
    exec("insert into public.faolla_schema_migrations(version,name) values(202608020019,'merchant_enterprise_audit');");
    phase='install';const prior=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(prior);
    const install=()=>exec(boundClockMigrationBody(native.root,migration).replace(/(set search_path\s*=\s*)public\b/g,`$1${d.owned.schema}`));install();assert.equal(d.fingerprint(prior),facts);
    const installedFacts=d.fingerprint(),defs=d.definitions();install();assert.equal(d.fingerprint(),installedFacts);assert.equal(d.definitions(),defs);
    assert(grantUsable('application',oldApplication.operationId)&&grantUsable('missing',oldMissing.operationId));
    native.pass('164 installation/reentry does not backfill old data or invalidate generation-zero grants');
    phase='old-path';
    const old=mutate(statusInput('disabled'));assert.equal(old.employee.status,'disabled');assert.equal(read(query()).items.length,0);
    mutate(statusInput('active'));assert.equal(stateWorker().active,true);
    const noOpOld=statusInput('disabled');mutate(noOpOld);reject(()=>mutate(noOpOld),'enterprise_version_conflict');mutate(statusInput('active'));
    assert.equal(read(query()).items.length,0);assert(grantUsable('application',oldApplication.operationId));
    native.pass('non-opted old status calls retain version-conflict behavior and create no suspension');
    phase='in-work';clock('clock_in');clock('break_start');const beforePause=protectedFacts();
    const board=next(),column=next(),task=next();
    exec(`insert into public.merchant_task_boards(id,merchant_id,name,position) values(${quote(board)},${quote(site)},'Synthetic193 offboarding board',0);
      insert into public.merchant_task_columns(id,merchant_id,board_id,name) values(${quote(column)},${quote(site)},${quote(board)},'Synthetic open column');
      insert into public.merchant_tasks(id,merchant_id,board_id,column_id,title) values(${quote(task)},${quote(site)},${quote(board)},${quote(column)},'Synthetic193 owned task');
      insert into public.merchant_task_assignees(merchant_id,task_id,employee_id) values(${quote(site)},${quote(task)},${quote(employee)});`);
    const first=tracked('disabled'),firstResult=mutate(first),firstReceipt=read(query('recover-status',{operationId:first.attendance_operation_id})).statusReceipt;
    assert.equal(firstResult.employee.status,'disabled');assert(firstReceipt?.suspensionId);const pause=firstReceipt.suspensionId;
    assert.equal(firstReceipt.actorId,owner);assert.equal(firstReceipt.expectedVersion,first.expected_version);
    assert.equal(firstReceipt.commandFingerprint,await accountStatusCommandFingerprint(site,{operationId:first.attendance_operation_id,employeeId:employee,version:first.expected_version,status:'disabled',offboardingMode:'unassign'}));
    assert.equal(firstResult.affected_task_count,1);assert.equal(exec(`select count(*) from public.merchant_task_assignees where merchant_id=${quote(site)} and task_id=${quote(task)};`),'0');
    assert.equal(exec(`select count(*) from public.merchant_task_events where merchant_id=${quote(site)} and task_id=${quote(task)} and event_type='employee_offboarded';`),'1');
    assert.equal(stateWorker().active,false);assert.equal(protectedFacts(),beforePause);assert.equal(detail(pause).originalAction,'break_start');
    assert(!grantUsable('application',oldApplication.operationId)&&!grantUsable('missing',oldMissing.operationId));
    const afterFirst=d.fingerprint();assert.deepEqual(mutate(first),firstResult);assert.equal(d.fingerprint(),afterFirst);
    reject(()=>mutate({...first,status:'active'}));
    mutate(tracked('active'));assert.equal(stateWorker().active,false);assert.equal(detail(pause).canRestore,true);
    reject(()=>exec(`update public.merchant_attendance_workers set active=true where merchant_id=${quote(site)} and id=${quote(worker)};`),'attendance_account_suspended');
    reject(()=>clock('break_end'),'attendance_access_denied');
    mutate(tracked('disabled',employee,false));assert.equal(read(query()).items.find(x=>x.employeeId===employee).suspensionId,pause);
    assert.equal(detail(pause).suspension.wasActive,true);mutate(tracked('active',employee,false));
    const rc=restoreCommand(detail(pause));reject(()=>readRaw(query('detail',{suspensionId:pause}),{...rc,employeeAuthUserId:d.auth}));
    reject(()=>readRaw(query('detail',{suspensionId:pause}),rc,false),'attendance_platform_paused');
    const restored=restore(pause);assert.equal(restored.result.receipt.workerActive,true);assert.equal(stateWorker().active,true);
    assert.equal(restored.result.receipt.commandFingerprint,await accountSuspensionCommandFingerprint(site,restored.command));
    assert.equal(protectedFacts(),beforePause);assert(!grantUsable('application',oldApplication.operationId)&&!grantUsable('missing',oldMissing.operationId));
    assert.equal(clock(null).state.status,'break');clock('break_end');clock('clock_out');
    assert.deepEqual(read(query('recover',{operationId:restored.command.operationId})).receipt,restored.result.receipt);
    reject(()=>read(query('recover',{operationId:restored.command.operationId}),d.auth),'attendance_access_denied');
    native.pass('actual011/017/019 stop pauses an open break atomically; same-identity restore retains raw events and never revives old grants');
    // The original employee SQL accepts surrounding whitespace. Existing epoch
    // protection must normalize exactly as that old successful input domain.
    const spaced=statusInput('disabled',employee,{attendance_suspension_enabled:false});
    for(const key of ['employee_id','actor_type','actor_id','status'])spaced[key]=' '+spaced[key]+' ';
    mutate(spaced);assert.equal(stateWorker().active,false);
    const spacedPause=read(query()).items.find(item=>item.employeeId===employee);assert(spacedPause);
    mutate(statusInput('active'));restore(spacedPause.suspensionId);
    native.pass('legacy whitespace-normalized status and actor inputs cannot bypass an existing attendance epoch');
    phase='new-authority';
    const newApplication=context.grant();context.raw(context.ownerQuery(),newApplication);assert(grantUsable('application',newApplication.operationId));
    const newMissing={...oldMissing,operationId:next()};exec(`set local role service_role;select public.faolla_attendance_missing_delegations_v1(${json(missingQuery)},${quote(owner)},${json(newMissing)},true);`);assert(grantUsable('missing',newMissing.operationId));
    const originalHistory=context.read(context.approved.recovery,false).receipt;assert.deepEqual(originalHistory,context.approved.receipt);
    // A delegate's own worker is distinct from the target worker. Disabling the
    // delegate must invalidate BOTH grant types held over the target.
    const delegateStop=tracked('disabled',d.employee),delegateReceipt=(mutate(delegateStop),read(query('recover-status',{operationId:delegateStop.attendance_operation_id})).statusReceipt);
    assert(delegateReceipt.suspensionId);assert(!grantUsable('application',newApplication.operationId)&&!grantUsable('missing',newMissing.operationId));
    mutate(tracked('active',d.employee));restore(delegateReceipt.suspensionId);
    assert(!grantUsable('application',newApplication.operationId)&&!grantUsable('missing',newMissing.operationId));
    assert.deepEqual(context.read(context.approved.recovery,false).receipt,originalHistory);
    native.pass('fresh grants require explicit issue; suspending the delegate separately invalidates authority over other workers and retains historical receipts');
    phase='pin-lease';
    const {executePinAdmin}=require('../../src/lib/merchantAttendancePin.server.ts');
    const {terminalHash}=require('../../src/lib/merchantAttendanceTerminal.server.ts');
    const pinService={rpc:async(name,a)=>{
      assert.equal(name,'faolla_attendance_pin_admin_v1');
      try{return {data:JSON.parse(exec('set local role service_role;select '+boundClockRpcExpression(name,a)+';')),error:null};}
      catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
    }};
    const pinQuery={siteId:site,authUserId:owner,workerNo:stateWorker().worker_no,operationId:null,command:null,allowSet:true};
    const issuePin=async()=>{const current=await executePinAdmin(pinQuery,pinService);return executePinAdmin({...pinQuery,command:{action:'set',operationId:next(),expectedRevision:current.revision,
      workerId:worker,employeeId:employee,pin:'05283941',salt:'12'.repeat(16)}},pinService);};
    await issuePin();const lease=next();
    const beginPin=`public.faolla_attendance_pin_begin_v1(${quote(site)},${quote(d.terminal)},${quote(terminalHash(d.secret))},${quote(pinQuery.workerNo)},${quote(lease)},true)`;
    const leased=JSON.parse(exec('set local role service_role;select '+beginPin+';'));assert.equal(leased.workerId,worker);
    const finishPin=`public.faolla_attendance_pin_finish_v1(${quote(site)},${quote(d.terminal)},${quote(terminalHash(d.secret))},${quote(pinQuery.workerNo)},${quote(lease)},true,true)`;
    const pinStop=tracked('disabled');const pinRace=await race('select '+statusExpr(pinStop)+';','select '+finishPin+';');
    assert(pinRace.witnessed&&!pinRace.right.error);assert.deepEqual(JSON.parse(pinRace.right.output),{verified:false});
    const pinPause=read(query('recover-status',{operationId:pinStop.attendance_operation_id})).statusReceipt.suspensionId;
    assert.equal(detail(pinPause).pinInvalidated,true);mutate(tracked('active'));restore(pinPause);
    const invalidPin=await executePinAdmin(pinQuery,pinService);assert.equal(invalidPin.enabled,false);assert.equal(invalidPin.revision,leased.revision+1);
    assert.equal((await issuePin()).enabled,true);
    native.pass('actual PIN credential issuance then witnessed suspension/lease-consumption race rejects old lease; restoring attendance keeps old PIN revoked until explicit reissue');
    phase='atomic-rollback';
    exec(`insert into public.merchant_task_assignees(merchant_id,task_id,employee_id) values(${quote(site)},${quote(task)},${quote(employee)});`);
    const rollbackBefore=d.fingerprint(),failureInput=tracked('disabled');
    const failureName='account_suspension_synthetic_failure_193';
    exec(`create function public.${failureName}() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'synthetic193_failure';end;$$;
      create trigger ${failureName} before insert on public.merchant_attendance_account_status_operations for each row execute function public.${failureName}();`);
    try{reject(()=>mutate(failureInput),'synthetic193_failure');}finally{exec(`drop trigger ${failureName} on public.merchant_attendance_account_status_operations;drop function public.${failureName}();`);}
    assert.equal(d.fingerprint(),rollbackBefore);assert.equal(read(query('recover-status',{operationId:failureInput.attendance_operation_id})).statusReceipt,null);
    native.pass('injected final receipt failure rolls employee/audit/worker/PIN/pause/epoch back together and GET reports no confirmed receipt');
    phase='inactive-worker';
    exec(`update public.merchant_attendance_workers set active=false where merchant_id=${quote(site)} and id=${quote(worker)};`);
    const inactiveStop=tracked('disabled');mutate(inactiveStop);const inactivePause=read(query('recover-status',{operationId:inactiveStop.attendance_operation_id})).statusReceipt.suspensionId;
    assert.equal(detail(inactivePause).suspension.wasActive,false);mutate(tracked('active'));assert.equal(restore(inactivePause).result.receipt.workerActive,false);
    assert.equal(stateWorker().active,false);exec(`update public.merchant_attendance_workers set active=true where merchant_id=${quote(site)} and id=${quote(worker)};`);
    native.pass('explicit restore of a previously inactive worker removes only the pause and does not enable attendance');
    phase='races';
    clock('clock_in');const stopRace=tracked('disabled'),clockOut=clockExpr('clock_out');
    const stopped=await race('select '+statusExpr(stopRace)+';','select '+clockOut+';');assert(stopped.witnessed&&stopped.right.error);assert.match(String(stopped.right.error),/attendance_access_denied/);
    const rp=read(query('recover-status',{operationId:stopRace.attendance_operation_id})).statusReceipt.suspensionId;
    mutate(tracked('active'));const rcmd=restoreCommand(detail(rp)),again=tracked('disabled',employee,false);
    const restoreStop=await race('select '+suspensionExpression(query('detail',{suspensionId:rp}),owner,rcmd)+';','select '+statusExpr(again)+';');
    assert(restoreStop.witnessed&&!restoreStop.right.error);assert.equal(stateWorker().active,false);
    const newer=read(query('recover-status',{operationId:again.attendance_operation_id})).statusReceipt.suspensionId;assert.notEqual(newer,rp);
    mutate(tracked('active'));restore(newer);clock('clock_out');
    native.pass('two distinct PostgreSQL backends witness stop versus clock and restore versus repeat-stop serialization');
    phase='authority-races';
    const racingGrant=context.grant();context.raw(context.ownerQuery(),racingGrant);
    const racingRequest=await context.submit(),racingView=context.detail(racingGrant.operationId,racingRequest);
    assert(racingView.canApprove);
    const racingDecision=context.decide(racingGrant.operationId,racingRequest,racingView),decisionStop=tracked('disabled');
    const decisionRace=await race('select '+statusExpr(decisionStop)+';',
      'select '+context.expr(context.post(racingGrant.operationId,racingRequest),racingDecision)+';');
    assert(decisionRace.witnessed&&decisionRace.right.error);assert.match(String(decisionRace.right.error),/attendance_(access_denied|application_delegation)/);
    const decisionPause=read(query('recover-status',{operationId:decisionStop.attendance_operation_id})).statusReceipt.suspensionId;
    mutate(tracked('active'));restore(decisionPause);
    assert.equal((await context.oldRead('leave',racingRequest.requestId)).detail.status,'submitted');
    const newGrantDuringStop=context.grant(),grantStop=tracked('disabled',d.employee);
    const grantRace=await race('select '+statusExpr(grantStop)+';','select '+context.expr(context.ownerQuery(),newGrantDuringStop)+';');
    assert(grantRace.witnessed&&grantRace.right.error);assert.match(String(grantRace.right.error),/attendance_(access_denied|account_suspended|application_delegation)/);
    const grantPause=read(query('recover-status',{operationId:grantStop.attendance_operation_id})).statusReceipt.suspensionId;
    mutate(tracked('active',d.employee));restore(grantPause);
    native.pass('witnessed stop versus delegated approval and new grant races leave the old request submitted and create no new authority');
    phase='pure-delegate-boundaries';
    const boundaries=await verifyAccountSuspensionBoundaries({d,h,native,scope});
    phase='restore-security';
    const security=await verifyAccountSuspensionRestoreSecurityNative({d,h,native,scope});
    phase='browser';
    const browser=browserCheck?await runAccountSuspensionActualUi({...context,site,owner,employeeId:employee,employeeName:stateEmployee().display_name,query,clock,stateEmployee,stateWorker,readRaw,restore,next,issuePin},browserCheck):null;
    phase='final-install';const terminal=d.fingerprint(),definitions=d.definitions();install();assert.equal(d.fingerprint(),terminal);assert.equal(d.definitions(),definitions);
    return {reads,rejections,originalEmployeeChain:true,oldVersionBehavior:true,openBreakPreserved:true,repeatPausePreservesOriginal:true,
      bothGrantTypesAndRolesInvalidated:true,originalHistoryReceipt:true,pinLeaseInvalidated:true,atomicRollback:true,priorInactiveRemainsInactive:true,
      actualProtocolParsed:true,commandFingerprintsCrossChecked:true,legacyWhitespaceProtected:true,realConcurrentWaits:5,boundaries,security,browser,production:false,deployed:false};
  }catch(error){throw new Error('account_suspension_phase='+phase+': '+String(error),{cause:error});}
}

async function runAccountSuspensionActualUi(ctx,browserCheck){
  const {d,native}=ctx,{exec}=d;
  // Minimal synthetic workspace prerequisites, not a simulated bootstrap result.
  // The real overview still reads these rows and computes needsBootstrap itself.
  for(const [index,key] of ['administrator','supervisor','employee'].entries())
    exec(`insert into public.merchant_enterprise_roles(id,merchant_id,name,system_key,is_system,permissions)
      select ${quote(id(193500001+index))},${quote(ctx.site)},${quote('Synthetic193 system '+key)},${quote(key)},true,array['enterprise.view']::text[]
      where not exists(select 1 from public.merchant_enterprise_roles where merchant_id=${quote(ctx.site)} and system_key=${quote(key)});`);
  exec(`insert into public.merchant_task_boards(id,merchant_id,name,system_key,position)
    select ${quote(id(193500010))},${quote(ctx.site)},'Synthetic193 default board','default',
      (select coalesce(max(position)+1,0) from public.merchant_task_boards where merchant_id=${quote(ctx.site)})
    where not exists(select 1 from public.merchant_task_boards where merchant_id=${quote(ctx.site)} and system_key='default');`);
  const defaultBoard=exec(`select id from public.merchant_task_boards where merchant_id=${quote(ctx.site)} and system_key='default';`);
  for(const [index,key] of ['todo','in_progress','blocked','done'].entries())
    exec(`insert into public.merchant_task_columns(id,merchant_id,board_id,name,system_key,position,is_done)
      select ${quote(id(193500020+index))},${quote(ctx.site)},${quote(defaultBoard)},${quote('Synthetic193 '+key)},${quote(key)},${index},${key==='done'}
      where not exists(select 1 from public.merchant_task_columns where merchant_id=${quote(ctx.site)} and board_id=${quote(defaultBoard)} and system_key=${quote(key)});`);
  exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['employees.view','employees.manage','roles.view']) p order by p)
    where merchant_id=${quote(ctx.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(ctx.site)} and id=${quote(d.employee)});`);
  const {withAttendanceApplicationAuth}=require('./attendance-application-auth.ts');
  const {createAttendanceEmployeeManagementReadTransport}=require('./attendance-employee-management-read-transport.ts');
  const reads=createAttendanceEmployeeManagementReadTransport(sql=>exec(sql),{syntheticAuthUserIds:[ctx.owner,d.auth,ctx.h.employeeAuthUserId]});
  const {PATCH}=require('../../src/app/api/merchant-enterprise/employees/route-handler.ts');
  const {GET}=require('../../src/app/api/merchant-enterprise/overview/route-handler.ts');
  const {handleAccountSuspension}=require('../../src/app/api/merchant-enterprise/attendance/account-suspensions/route-handler.ts');
  const {handleAttendanceAdmin}=require('../../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
  const {handleMerchantEnterpriseCurrentOperationsGet}=require('../../src/app/api/merchant-enterprise/current-operations/route-handler.ts');
  const {handleMerchantEnterpriseNotificationsGet}=require('../../src/app/api/merchant-enterprise/notifications/route-handler.ts');
  const env='FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED',saved=process.env[env];process.env[env]='1';
  const service={rpc:async(name,a)=>{
    let expression;
    if(name===statusRpc)expression=`public.${name}(${json(a.p_input)})`;
    else if(name===rpc)expression=suspensionExpression(a.p_query,a.p_auth_user_id,a.p_command,a.p_allow_restore);
    else if(name==='faolla_attendance_admin_v1')expression=`public.${name}(${quote(a.p_site_id)},${quote(a.p_auth_user_id)},${json(a.p_query)},${json(a.p_command)},${quote(a.p_operation_id)})`;
    else throw Error('account_suspension_unexpected_rpc:'+name);
    try{return {data:JSON.parse(exec('set local role service_role;select '+expression+';')),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+([a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  try{
    return await withAttendanceApplicationAuth([{id:ctx.owner,email:'suspension-owner@example.test'},{id:d.auth,email:'suspension-manager@example.test'}],service.rpc,async auth=>{
      const token=await auth.login({id:ctx.owner,email:'suspension-owner@example.test'});
      const authenticated=request=>{const headers=new Headers(request.headers);headers.set('x-merchant-access-token',token);return new Request(request,{headers});};
      const entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}});
      const overview=async()=>{const response=await GET(authenticated(new Request('https://www.faolla.com/api/merchant-enterprise/overview?siteId='+ctx.site,{headers:{origin:'https://www.faolla.com'}})));assert.equal(response.status,200);const body=await response.json();assert.equal(body.needsBootstrap,false);return body;};
      const handleEmployee=request=>PATCH(authenticated(request));
      const handleSuspension=request=>handleAccountSuspension(authenticated(request),{entitlement,allow:()=>true});
      const handleAdmin=request=>handleAttendanceAdmin(authenticated(request),{entitlement,allow:()=>true,enabled:()=>true});
      // Unrelated task-current-operations storage is outside this fixture. Keep
      // its real authentication/query handler, explicitly return unavailable,
      // and never fabricate a successful business result to quiet the parent.
      const handleCurrentOperations=request=>handleMerchantEnterpriseCurrentOperationsGet(authenticated(request),{
        loadCurrentOperations:async()=>{throw Error('enterprise_schema_unavailable');}});
      const managerToken=await auth.login({id:d.auth,email:'suspension-manager@example.test'});
      const managerRequest=(path,body)=>new Request('https://www.faolla.com'+path,{method:body?'PATCH':'GET',headers:{origin:'https://www.faolla.com','x-merchant-access-token':managerToken,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const managerOverview=await GET(managerRequest('/api/merchant-enterprise/overview?siteId='+ctx.site));assert.equal(managerOverview.status,200);
      const currentManager=await managerOverview.json();assert.equal(currentManager.currentAuthUserId,d.auth);assert.equal(currentManager.actor.id,d.employee);
      assert(currentManager.snapshot.employees.every(value=>value.authUserId===''));
      let managerPause;
      for(const status of ['disabled','active']){
        const operationId=ctx.next(),version=ctx.stateEmployee().version;
        const response=await PATCH(managerRequest('/api/merchant-enterprise/employees',{siteId:ctx.site,employeeId:ctx.employeeId,version,status,operationId,...(status==='disabled'?{offboardingMode:'unassign'}:{})}));
        const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.ok,true);
        const recovered=await handleAccountSuspension(managerRequest('/api/merchant-enterprise/attendance/account-suspensions?siteId='+ctx.site+'&mode=recover-status&operationId='+operationId),{entitlement,allow:()=>true});
        const recovery=await recovered.json();assert.equal(recovered.status,200,JSON.stringify(recovery));assert.equal(recovery.statusReceipt.actorId,d.auth);
        assert.equal(recovery.statusReceipt.expectedVersion,version);if(status==='disabled')managerPause=recovery.statusReceipt.suspensionId;
      }
      assert(managerPause);ctx.restore(managerPause);await ctx.issuePin();
      native.pass('actual employee-manager overview exposes only own verified Auth; real status PATCH and minimal original recovery retain the employee Auth actor');
      ctx.clock('clock_in');
      // 194's independent recovery browser must send the original manager's
      // real synthetic token. These inert ports never substitute the owner.
      const statusRecoveryPorts={managerAuth:d.auth,managerToken,handleEmployee:PATCH,handleOverview:GET,
        handleSuspension:request=>handleAccountSuspension(request,{entitlement,allow:()=>true}),
        handleNotifications:request=>handleMerchantEnterpriseNotificationsGet(request,{
          loadNotifications:async()=>{throw Error('enterprise_schema_unavailable');}}),
        handleCurrentOperations:request=>handleMerchantEnterpriseCurrentOperationsGet(request,{
          loadCurrentOperations:async()=>{throw Error('enterprise_schema_unavailable');}})};
      const result=await browserCheck({...ctx,handleEmployee,handleSuspension,overview,handleAdmin,handleCurrentOperations,statusRecoveryPorts});
      assert.equal(reads.errors.length,0,reads.errors.join('\n'));
      native.pass('actual manager PATCH→route→store→audited SQL and owner attendance UI verified through in-memory authentication fixture');
      return result;
    },undefined,reads.read);
  }finally{if(saved===undefined)delete process.env[env];else process.env[env]=saved;}
}
