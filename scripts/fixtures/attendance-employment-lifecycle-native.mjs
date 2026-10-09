//196 inert acceptance, invoked only inside the existing owned synthetic schema.
//Real064/164/166 commands; no system-clock changes, disabled constraints or fake
//success receipts. New test identities are explicit synthetic prerequisites.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {verifyEmploymentLifecycleHistoricalRejoin} from './attendance-employment-lifecycle-history-native.mjs';
const require=createRequire(import.meta.url);
const migration='202610060166_merchant_attendance_employment_lifecycle.sql';
const rpc='faolla_attendance_employment_lifecycle_v1';
const fid=n=>id(196000000+n);
export const employmentLifecycleExpression=(query,actor,command=null,allow=true)=>`public.${rpc}(${json(query)},${quote(actor)},${json(command)},${allow})`;
export function employmentLifecycleNativePlan(n,owner){
  assert(Number.isInteger(n)&&n>=0&&n<20);assert(/^[0-9a-f-]{36}$/.test(owner));
  return {site:String(99990160+n),owner,employee:fid(100+n*10),auth:fid(101+n*10),worker:fid(102+n*10),role:fid(103+n*10),location:fid(104+n*10),
    workerNo:`SYNTHETIC196-${n}`,name:`Synthetic196 subject ${n}`};
}
export function employmentLifecycleCommandFromDetail(detail,action,operationId,reason='Synthetic196 explicit lifecycle action'){
  assert(detail?.suspension&&detail.periods?.length);assert(action==='close'||action==='rejoin');const last=detail.periods.at(-1);
  return {action,operationId,workerId:detail.worker.id,employeeId:detail.worker.employeeId,employeeAuthUserId:detail.worker.employeeAuthUserId,
    expectedWorkerVersion:detail.worker.version,expectedEmployeeVersion:detail.worker.employeeVersion,expectedSettingsVersion:detail.settingsVersion,
    expectedRevision:detail.revision,expectedPeriodId:last.id,suspensionId:detail.suspension.id,expectedGeneration:detail.suspension.generation,expectedDate:detail.today,reason};
}

export async function verifyEmploymentLifecycleNative(context,browserCheck=null){
  const {d,h,native,scope,enterprise}=context,{exec}=d;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&enterprise?.syntheticOnly===true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const {parseEmploymentLifecycleResult,employmentLifecycleCommandFingerprint}=require('../../src/lib/merchantAttendanceEmploymentLifecycle.ts');
  let phase='install',counter=196100000,reads=0,rejections=0,writes=0,oldWrites=0;
  const next=()=>id(++counter),all=()=>d.fingerprint(d.inventory());
  const protectedTables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),beforeInstall=d.fingerprint(protectedTables);
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const oldDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid)::text)
    from pg_proc where oid=any(${quote(oldOids)}::oid[]) and proname not in('faolla_attendance_admin_v1','faolla_attendance_account_detail_v1');`);
  const originalDefinitions=oldDefinitions();
  const install=()=>exec(boundClockMigrationBody(native.root,migration));
  install();assert.equal(d.fingerprint(protectedTables),beforeInstall);assert.equal(oldDefinitions(),originalDefinitions);
  const installedFacts=all(),installedDefinitions=d.definitions(),installedCatalog=d.tableCatalog();
  install();assert.equal(all(),installedFacts);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),installedCatalog);
  const acl=JSON.parse(exec(`select jsonb_build_object('service',has_function_privilege('service_role','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),
    'anon',has_function_privilege('anon','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.${rpc}(jsonb,uuid,jsonb,boolean)','EXECUTE'),
    'privateTable',has_table_privilege('service_role','public.merchant_attendance_employment_operations','SELECT'));`));
  assert.deepEqual(acl,{service:true,anon:false,authenticated:false,privateTable:false});
  const call=expression=>JSON.parse(exec('set local role service_role;select '+expression+';'));
  const reject=(expression,code)=>{const before=all();assert.throws(()=>call(expression),new RegExp('ERROR:\\s+'+code+'(?:\\s|$)'));assert.equal(all(),before);rejections++;};
  const q=(p,mode='detail',extra={})=>({siteId:p.site,mode,workerId:['detail','history'].includes(mode)?p.worker:null,afterId:null,afterRevision:null,operationId:null,...extra});
  const read=(p,query=q(p),actor=p.owner)=>{const before=all(),r=parseEmploymentLifecycleResult(call(employmentLifecycleExpression(query,actor)),query,actor);assert.equal(all(),before);reads++;return r;};
  const write=async(p,c,allow=true)=>{const query=q(p),r=parseEmploymentLifecycleResult(call(employmentLifecycleExpression(query,p.owner,c,allow)),query,p.owner,c);
    assert.equal(r.receipt.commandFingerprint,await employmentLifecycleCommandFingerprint(p.site,c));writes++;return r;};
  const row=(table,p,where='')=>JSON.parse(exec(`select to_jsonb(el_row) from public.${table} el_row where merchant_id=${quote(p.site)} ${where};`));
  const settings=p=>row('merchant_attendance_settings',p),employee=p=>row('merchant_enterprise_employees',p,`and id=${quote(p.employee)}`),worker=p=>row('merchant_attendance_workers',p,`and id=${quote(p.worker)}`);
  const admin=(p,kind,values,operationId=next())=>{const c={kind,operationId,expectedVersion:exec(`select count(*) from public.merchant_attendance_settings where merchant_id=${quote(p.site)};`)==='0'?0:settings(p).version,values};
    const expression=`public.faolla_attendance_admin_v1(${quote(p.site)},${quote(p.owner)},${json({view:'workers',cursor:null,search:''})},${json(c)},null)`;
    const result=call(expression);oldWrites++;return {command:c,result,expression};};
  const settingsValues=zone=>({timeZone:zone,enabled:true,webClockEnabled:true,webBreakPaid:false});
  const workerValues=(p,active,startsOn='2000-01-01',displayName=p.name)=>({id:p.worker,employeeId:p.employee,workerNo:p.workerNo,displayName,locationId:p.location,active,startsOn});
  const seed=(n,{active=true,zone='UTC'}={})=>{const p=employmentLifecycleNativePlan(n,d.owner);
    exec(`do $el_seed$ begin assert not exists(select 1 from public.merchants where id=${quote(p.site)}),'el_synthetic_site_unused';
      assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(p.employee)} or auth_user_id=${quote(p.auth)}),'el_synthetic_identity_unused';end;$el_seed$;
      insert into public.merchants(id,user_id,name,email) values(${quote(p.site)},${quote(p.owner)},'Synthetic196 lifecycle','synthetic196@example.test');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(p.role)},${quote(p.site)},'Synthetic196 role',
        array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request','attendance.self.export','attendance.self.leave','attendance.self.work_arrangement']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
        values(${quote(p.employee)},${quote(p.site)},${quote(p.auth)},${quote('synthetic196-'+n+'@example.test')},${quote(p.name)},${quote(p.role)},'active',clock_timestamp(),1);`);
    admin(p,'settings',settingsValues(zone));admin(p,'location',{id:p.location,name:'Synthetic196 original location',timeZone:'UTC',active:true});
    admin(p,'worker',workerValues(p,active));return p;};
  const status=(p,value)=>{const c={merchant_id:p.site,employee_id:p.employee,expected_version:employee(p).version,actor_type:'owner',actor_id:p.owner,status:value,
    ...(value==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:next(),attendance_suspension_enabled:true};
    const result=call(`public.faolla_update_merchant_enterprise_employee_v1(${json(c)})`);oldWrites++;return {command:c,result};};
  const suspensionQ=(p,mode,idValue)=>({siteId:p.site,mode,afterId:null,suspensionId:mode==='detail'?idValue:null,operationId:mode==='recover-status'?idValue:null});
  const suspensionExpr=(p,query,c=null)=>`public.faolla_attendance_account_suspensions_v1(${json(query)},${quote(p.owner)},${json(c)},true)`;
  const suspensionRead=(p,query)=>{const before=all(),r=call(suspensionExpr(p,query));assert.equal(all(),before);reads++;return r;};
  const pause=p=>{const stopped=status(p,'disabled'),r=suspensionRead(p,suspensionQ(p,'recover-status',stopped.command.attendance_operation_id));assert(r.statusReceipt?.suspensionId);return r.statusReceipt.suspensionId;};
  const restoreCommand=(p,sid)=>{const z=suspensionRead(p,suspensionQ(p,'detail',sid)).detail;
    return {action:'restore',operationId:next(),suspensionId:sid,expectedGeneration:z.suspension.generation,workerId:p.worker,expectedWorkerVersion:z.workerVersion,
      expectedEmployeeVersion:z.employeeVersion,employeeId:p.employee,employeeAuthUserId:p.auth,reason:'Synthetic196 same identity explicit restore'};};
  const restore=(p,sid)=>{const c=restoreCommand(p,sid),result=call(suspensionExpr(p,suspensionQ(p,'detail',sid),c));oldWrites++;return {command:c,result};};
  const clockExpression=(p,action=null,operation=next())=>{const last=JSON.parse(exec(`select coalesce((select to_jsonb(el_event) from public.merchant_attendance_events el_event
    where merchant_id=${quote(p.site)} and worker_id=${quote(p.worker)} order by sequence desc limit 1),'null'::jsonb);`));
    return `public.faolla_attendance_self_v1(${quote(p.site)},${quote(p.auth)},${json(action?{operationId:operation,expectedWorkerId:p.worker,locationId:p.location,action,expectedSequence:last?.sequence??0}:null)},null)`;};
  const clock=(p,action)=>{const r=call(clockExpression(p,action));if(action)oldWrites++;return r;};
  const historyHash=p=>exec(`select md5(jsonb_build_array(
    (select coalesce(jsonb_agg(to_jsonb(el_event) order by sequence),'[]') from public.merchant_attendance_events el_event where merchant_id=${quote(p.site)}),
    (select coalesce(jsonb_agg(to_jsonb(el_op) order by revision),'[]') from public.merchant_attendance_employment_operations el_op where merchant_id=${quote(p.site)}))::text);`);
  const ports={d,h,native,scope,enterprise,call,reject,q,read,write,settings,employee,worker,admin,settingsValues,workerValues,seed,status,pause,suspensionQ,suspensionExpr,suspensionRead,restoreCommand,restore,clockExpression,clock,historyHash,next,all};
  try{
    phase='real-civil-date-chain';
    const chains=[];
    for(const [n,active] of [[0,true],[1,false]]){
      const p=seed(n,{active,zone:'Etc/GMT+12'}),sid=pause(p),before=read(p).detail;
      assert.equal(before.suspension.wasActive,active);assert(before.canClose);assert.equal(before.currentAction,null);
      const close=employmentLifecycleCommandFromDetail(before,'close',next()),closed=await write(p,close);
      const stable=all();assert.deepEqual((await write(p,close,false)).receipt,closed.receipt);assert.equal(all(),stable);
      assert.deepEqual(read(p,q(p,'recover',{operationId:close.operationId})).receipt,closed.receipt);
      reject(employmentLifecycleExpression(q(p,'recover',{operationId:close.operationId}),p.auth),'attendance_access_denied');
      reject(employmentLifecycleExpression(q(p),p.owner,{...close,reason:'Changed exact intent'}),'attendance_operation_conflict');
      assert.equal(read(p).detail.canRejoin,false);
      reject(employmentLifecycleExpression(q(p),p.owner,employmentLifecycleCommandFromDetail(read(p).detail,'rejoin',next())),'attendance_employment_lifecycle_blocked');
      status(p,'active');const paused=suspensionRead(p,suspensionQ(p,'detail',sid));
      assert(paused.detail.blockers.includes('employment_closed'));assert.equal(paused.detail.canRestore,false);
      reject(suspensionExpr(p,suspensionQ(p,'detail',sid),restoreCommand(p,sid)),'attendance_account_suspension_changed');
      assert.equal(worker(p).active,false);
      // Real064 zone update advances the civil date, NOT the system clock or a
      // purported overnight wait. No events exist, as required by064 itself.
      admin(p,'settings',settingsValues('Etc/GMT-14'));
      const ready=read(p).detail;assert(ready.today>closed.receipt.endsOn);assert(ready.canRejoin);
      const rejoin=employmentLifecycleCommandFromDetail(ready,'rejoin',next()),rejoined=await write(p,rejoin);
      assert.equal(worker(p).active,false);assert.equal(rejoined.receipt.startsOn,ready.today);
      const afterRejoin=all();assert.deepEqual((await write(p,rejoin,false)).receipt,rejoined.receipt);assert.equal(all(),afterRejoin);
      admin(p,'settings',settingsValues('Etc/GMT+12'));
      const notStarted=suspensionRead(p,suspensionQ(p,'detail',sid)).detail;assert.equal(notStarted.canRestore,false);assert(notStarted.blockers.includes('employment_closed'));
      reject(suspensionExpr(p,suspensionQ(p,'detail',sid),restoreCommand(p,sid)),'attendance_account_suspension_changed');
      admin(p,'settings',settingsValues('Etc/GMT-14'));
      const restored=restore(p,sid);assert.equal(restored.result.receipt.workerActive,active);assert.equal(worker(p).active,active);
      assert.equal(read(p,q(p,'history')).history.length,2);
      const oldPeriods=exec(`select jsonb_agg(to_jsonb(el_period) order by starts_on)::text from public.merchant_attendance_employment_periods el_period where merchant_id=${quote(p.site)} and worker_id=${quote(p.worker)};`);
      admin(p,'worker',workerValues(p,active,rejoin.expectedDate,p.name+' explicit metadata'));
      assert.equal(exec(`select jsonb_agg(to_jsonb(el_period) order by starts_on)::text from public.merchant_attendance_employment_periods el_period where merchant_id=${quote(p.site)} and worker_id=${quote(p.worker)};`),oldPeriods);
      if(!active){assert.equal(worker(p).active,false);admin(p,'worker',workerValues(p,true,rejoin.expectedDate,p.name+' explicitly enabled'));}
      assert.equal(clock(p,'clock_in').state.status,'working');assert.equal(clock(p,'clock_out').state.status,'off');
      const historical=historyHash(p);read(p,q(p,'recover',{operationId:close.operationId}));assert.equal(historyHash(p),historical);
      chains.push({subject:n,wasActive:active,closeDate:close.expectedDate,rejoinDate:rejoin.expectedDate,actualCivilDateAdvance:true,waitedOvernight:false});
    }
    native.pass('actual064 civil-date advance,166 close/rejoin,164 explicit restore and fresh clocks; wasActive false stays false until separate enable');
    phase='additional-boundaries';
    const boundaries=await verifyEmploymentLifecycleBoundaries(ports);
    phase='late-ledger-failure-and-schedule-race';const atomicity=await verifyEmploymentLifecycleAtomicAndScheduleRace(ports);
    phase='original113-safe-finish';const safeFinish=await verifyEmploymentLifecycleSafeFinish(ports);
    phase='historical-rejoin';const historical=await verifyEmploymentLifecycleHistoricalRejoin(context);
    phase='actual-service-route';const integration=await verifyEmploymentLifecycleService(ports);
    phase='browser';const browser=browserCheck?await browserCheck(ports):null;
    phase='reapply';const terminal=all(),definitions=d.definitions(),catalog=d.tableCatalog();install();
    assert.equal(all(),terminal);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(oldDefinitions(),originalDefinitions);
    return {reads,rejections,parsedLifecycleWrites:writes,trackedLegacyWrites:oldWrites,chains,boundaries,atomicity,safeFinish,historical,integration,browser,actualProtocolParsed:true,independentCommandHashes:true,oldDefinitionsProtected:true,
      original193Retained:true,production:false,deployed:false};
  }catch(error){throw new Error('employment_lifecycle_phase='+phase+': '+String(error),{cause:error});}
}

async function verifyEmploymentLifecycleBoundaries(p){
  const {d,native,scope,seed,call,reject,q,read,write,pause,status,restore,restoreCommand,suspensionQ,suspensionExpr,
    settings,worker,admin,workerValues,clock,clockExpression,next,all}=p;
  const u=seed(2),now=Date.now(),minute=Math.ceil(now/60000)*60000,at=offset=>new Date(minute+offset*60000).toISOString();
  const scheduleQuery={siteId:u.site,access:'owner',workerId:u.worker,fromDate:at(60).slice(0,10),throughDate:at(60).slice(0,10),operationId:null};
  const scheduleCommand={action:'publish',operationId:next(),expectedRevision:0,expectedSettingsVersion:settings(u).version,reason:'Synthetic196 unended schedule',
    locationId:u.location,timeZone:'UTC',slots:[[at(60),at(120)]]};
  const scheduleExpr=(c)=>`public.faolla_attendance_schedule_evidenced_v1(${json(scheduleQuery)},${quote(u.owner)},${json(c)},true)`;
  const published=call(scheduleExpr(scheduleCommand));assert.equal(published.entries.length,1);
  const leaveQuery=(access='self',requestId=null)=>({siteId:u.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
  const leaveExpr=(query,command=null)=>`public.faolla_attendance_leave_v1(${json(query)},${quote(query.access==='self'?u.auth:u.owner)},${json(command)},true)`;
  const leaveSubmit=(startAt,endAt,reason)=>{const c={action:'submit',operationId:next(),expectedWorkerId:u.worker,expectedSettingsVersion:settings(u).version,timeZone:'UTC',startAt,endAt,reason};
    const r=call(leaveExpr(leaveQuery(),c));assert.equal(r.receipt.requestId,c.operationId);return c;};
  const past=leaveSubmit(at(-2880),at(-2820),'Synthetic196 historical pending retained');
  const futureLeave=leaveSubmit(at(180),at(240),'Synthetic196 future approved leave');
  call(leaveExpr(leaveQuery('owner',futureLeave.operationId),{action:'approve',operationId:next(),requestId:futureLeave.operationId,expectedRevision:1,reason:'Synthetic196 explicit leave approval'}));
  const workQuery=(access='self',requestId=null)=>({...leaveQuery(access,requestId),preview:null});
  const workExpr=(query,command=null)=>`public.faolla_attendance_work_arrangement_v1(${json(query)},${quote(query.access==='self'?u.auth:u.owner)},${json(command)},true)`;
  const workCommand={action:'submit',operationId:next(),expectedWorkerId:u.worker,expectedSettingsVersion:settings(u).version,expectedPolicyRevision:0,
    kind:'trip',timeZone:'UTC',startAt:at(300),endAt:at(360),reason:'Synthetic196 pending trip'};
  assert.equal(call(workExpr(workQuery(),workCommand)).receipt.item.status,'submitted');
  pause(u);const blocked=read(u).detail;
  assert.equal(blocked.canClose,false);assert.equal(blocked.pending.historicalPending,'not_checked');
  assert.deepEqual(blocked.pending.items.map(x=>x.kind).sort(),['leave','schedule','trip']);
  assert(blocked.pending.items.some(x=>x.kind==='leave'&&x.status==='approved'));
  reject(employmentLifecycleExpression(q(u),u.owner,employmentLifecycleCommandFromDetail(blocked,'close',next())),'attendance_employment_lifecycle_blocked');
  call(scheduleExpr({action:'cancel',operationId:next(),expectedRevision:published.revision,expectedSettingsVersion:settings(u).version,slotId:published.entries[0].id,reason:'Synthetic196 explicit plan cancellation'}));
  call(leaveExpr(leaveQuery('owner',futureLeave.operationId),{action:'cancel',operationId:next(),requestId:futureLeave.operationId,expectedRevision:2,reason:'Synthetic196 explicit leave cancellation'}));
  call(workExpr(workQuery('owner',workCommand.operationId),{action:'reject',operationId:next(),requestId:workCommand.operationId,expectedRevision:1,reason:'Synthetic196 explicit trip rejection'}));
  const ready=read(u).detail;assert(ready.canClose);assert.deepEqual(ready.pending.items,[]);
  await write(u,employmentLifecycleCommandFromDetail(ready,'close',next()));
  assert.equal(call(leaveExpr(leaveQuery('owner',past.operationId))).detail.status,'submitted');
  assert.equal(call(leaveExpr(leaveQuery('owner',futureLeave.operationId))).detail.status,'cancelled');
  native.pass('real future schedule/approved leave/pending trip block closure; only explicit existing actions remove blockers; historical pending remains');

  const open=seed(3);clock(open,'clock_in');clock(open,'break_start');const sid=pause(open),openDetail=read(open).detail;
  assert.equal(openDetail.currentAction,'break_start');assert.equal(openDetail.canClose,false);
  reject(employmentLifecycleExpression(q(open),open.owner,employmentLifecycleCommandFromDetail(openDetail,'close',next())),'attendance_employment_lifecycle_blocked');
  status(open,'active');restore(open,sid);assert.equal(clock(open,'break_end').state.status,'working');assert.equal(clock(open,'clock_out').state.status,'off');
  pause(open);assert(read(open).detail.canClose);
  const close=employmentLifecycleCommandFromDetail(read(open).detail,'close',next());
  reject(employmentLifecycleExpression(q(open),open.owner,{...close,expectedDate:'2000-01-01'}),'attendance_employment_lifecycle_changed');
  reject(employmentLifecycleExpression(q(open),open.auth,close),'attendance_access_denied');
  reject(employmentLifecycleExpression(q(open),open.owner,close,false),'attendance_employment_lifecycle_disabled');
  const eventRows=d.exec(`select jsonb_agg(to_jsonb(el_event) order by sequence)::text from public.merchant_attendance_events el_event where merchant_id=${quote(open.site)};`);
  await write(open,close);
  assert.equal(d.exec(`select jsonb_agg(to_jsonb(el_event) order by sequence)::text from public.merchant_attendance_events el_event where merchant_id=${quote(open.site)};`),eventRows);
  admin(open,'worker',workerValues(open,false,'2000-01-01',open.name+' closed metadata'));
  assert.equal(worker(open).active,false);
  native.pass('real open break blocks close without altering events; original193 restoration and explicit break-end/clock-out remain available');

  const race=(holder,waiter)=>lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    "reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;'+holder,
    "reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;'+waiter);
  const duplicate=seed(4);pause(duplicate);const dup=employmentLifecycleCommandFromDetail(read(duplicate).detail,'close',next());
  const raced=await race('select '+employmentLifecycleExpression(q(duplicate),duplicate.owner,dup)+';','select '+employmentLifecycleExpression(q(duplicate),duplicate.owner,dup)+';');
  assert(raced.witnessed&&!raced.right.error);const a=JSON.parse(raced.left),b=JSON.parse(raced.right.output);assert.deepEqual(a.receipt,b.receipt);
  assert.equal(read(duplicate,q(duplicate,'history')).history.length,1);
  const competing=seed(5),competingPause=pause(competing);status(competing,'active');
  const closing=employmentLifecycleCommandFromDetail(read(competing).detail,'close',next()),restoring=restoreCommand(competing,competingPause);
  const restoreRace=await race('select '+employmentLifecycleExpression(q(competing),competing.owner,closing)+';',
    'select '+suspensionExpr(competing,suspensionQ(competing,'detail',competingPause),restoring)+';');
  assert(restoreRace.witnessed&&restoreRace.right.error);assert.match(String(restoreRace.right.error),/attendance_account_suspension_changed/);assert.equal(worker(competing).active,false);
  const punches=seed(6);pause(punches);status(punches,'active');const finish=employmentLifecycleCommandFromDetail(read(punches).detail,'close',next());
  const clockRace=await race('select '+employmentLifecycleExpression(q(punches),punches.owner,finish)+';','select '+clockExpression(punches,'clock_in')+';');
  assert(clockRace.witnessed&&clockRace.right.error);assert.match(String(clockRace.right.error),/attendance_worker_inactive|attendance_access_denied/);
  assert.equal(d.exec(`select count(*) from public.merchant_attendance_events where merchant_id=${quote(punches.site)};`),'0');
  const after=all();read(punches,q(punches,'recover',{operationId:finish.operationId}));assert.equal(all(),after);
  native.pass('three exact-backend lock witnesses: duplicate close returns one receipt; close serializes with restore and ordinary clock');
  return {futureBlockers:true,historicalPendingRetained:true,openRawShiftPreserved:true,realConcurrentWaits:3};
}

async function verifyEmploymentLifecycleAtomicAndScheduleRace(p){
  const {d,native,scope,seed,pause,q,read,next,all,settings,call,reject}=p,u=seed(9);pause(u);
  const command=employmentLifecycleCommandFromDetail(read(u).detail,'close',next());
  const constraint='attendance_employment_fixture_fail_196';
  const constraints=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,conname,pg_get_constraintdef(oid),convalidated) order by oid),'[]'::jsonb)::text)
    from pg_constraint where conrelid='public.merchant_attendance_employment_operations'::regclass;`);
  const baseline=all(),definitions=d.definitions(),catalog=d.tableCatalog(),originalConstraints=constraints();
  let installed=false;
  try{
    // New-ledger fault only, in this explicitly owned schema. The real RPC first
    // updates ends_on, then this final ledger INSERT fails. No trigger is bypassed.
    d.exec(`alter table public.merchant_attendance_employment_operations add constraint ${constraint}
      check(operation_id<>${quote(command.operationId)}::uuid) not valid;`);installed=true;
    d.exec(`set local role service_role;do $el_late_insert$ declare fault_constraint text;fault_state text;begin
      begin
        perform ${employmentLifecycleExpression(q(u),u.owner,command)};
        raise exception 'el_expected_final_ledger_failure_missing';
      exception when check_violation then
        get stacked diagnostics fault_constraint=CONSTRAINT_NAME,fault_state=RETURNED_SQLSTATE;
        assert fault_state='23514' and fault_constraint=${quote(constraint)},'el_exact_final_ledger_constraint_required';
      end;
    end;$el_late_insert$;`);
    assert.equal(all(),baseline,'el_failed_close_all_tables_unchanged');
  }finally{
    if(installed)d.exec(`alter table public.merchant_attendance_employment_operations drop constraint ${constraint};set constraints all immediate;`);
    assert.equal(all(),baseline,'el_fault_fixture_facts_restored');assert.equal(d.definitions(),definitions);
    assert.equal(d.tableCatalog(),catalog);assert.equal(constraints(),originalConstraints);
  }
  assert(read(u).detail.canClose);assert.equal(read(u,q(u,'recover',{operationId:command.operationId})).receipt,null);
  native.pass('actual166 late-ledger23514 rolls back period/worker/settings/ledger; targeted fixture constraint removed and catalog restored');

  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10),start=tomorrow+'T12:00:00.000Z',end=tomorrow+'T13:00:00.000Z';
  const sq={siteId:u.site,access:'owner',workerId:u.worker,fromDate:tomorrow,throughDate:tomorrow,operationId:null};
  const publish={action:'publish',operationId:next(),expectedRevision:0,expectedSettingsVersion:settings(u).version,
    reason:'Synthetic196 concurrent future publication',locationId:u.location,timeZone:'UTC',slots:[[start,end]]};
  const expression=c=>`public.faolla_attendance_schedule_evidenced_v1(${json(sq)},${quote(u.owner)},${json(c)},true)`;
  const protectedNames=d.inventory().filter(t=>!['merchant_attendance_employment_periods','merchant_attendance_employment_operations','merchant_attendance_workers','merchant_attendance_settings'].includes(t));
  const protectedBefore=d.fingerprint(protectedNames);
  const racePrefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
  const raced=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},
    racePrefix+'select '+employmentLifecycleExpression(q(u),u.owner,command)+';',racePrefix+'select '+expression(publish)+';');
  assert(raced.witnessed&&raced.right.error);assert.match(String(raced.right.error),/attendance_version_conflict/);
  const winner=JSON.parse(raced.left);assert.equal(winner.receipt.operationId,command.operationId);assert.equal(winner.receipt.action,'close');
  assert.equal(read(u).detail.state,'closed');assert.equal(d.fingerprint(protectedNames),protectedBefore);
  // A refreshed CAS still cannot publish for this paused person. This is the
  // existing worker gate, not a claim that the employment-range branch ran.
  reject(expression({...publish,operationId:next(),expectedSettingsVersion:settings(u).version}),'attendance_schedule_worker_invalid');
  const immutableBefore=all(),empty=call(`public.faolla_attendance_schedule_evidenced_v1(${json(sq)},${quote(u.owner)},null,true)`);
  assert.deepEqual(empty.entries,[]);assert.equal(all(),immutableBefore);
  for(const table of ['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_publication_evidence'])
    assert.equal(d.exec(`select count(*) from public.${table} where merchant_id=${quote(u.site)};`),'0');
  native.pass('exactPID close vs actual136 publish: stale version loses, refreshed paused-worker write refuses and no future schedule/evidence is created');
  return {exactLateLedgerSqlState:'23514',fullFactsRollback:true,constraintCatalogRestored:true,realConcurrentWaits:1,
    publicationLostWith:'attendance_version_conflict',refreshedPublicationDeniedWith:'attendance_schedule_worker_invalid',noFuturePublication:true};
}

async function verifyEmploymentLifecycleSafeFinish(p){
  const {d,seed,call,pause,status,read,settings,worker,next,all,native}=p,g=seed(7);
  //Owned synthetic operational configuration, not a bypassed location assertion.
  //The actual server below computes its own assertion from a synthetic sample.
  d.exec(`update public.merchant_attendance_settings set location_clock_enabled=true where merchant_id=${quote(g.site)};
    update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id=${quote(g.site)} and id=${quote(g.location)};`);
  const values={purpose:'Synthetic196 location regression',notice:'Synthetic196 published notice',contact:'Synthetic owner',alternative:'Manual review',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
  const nq=access=>({access,locationId:g.location,expectedWorkerId:access==='self'?g.worker:null,operationId:null});
  const sv=settings(g).version;
  call(`public.faolla_attendance_location_policy_draft_v1(${quote(g.site)},${quote(g.owner)},${quote(g.location)},${json({operationId:next(),expectedRevision:0,expectedSettingsVersion:sv,expectedLocationVersion:1,values})},null,true)`);
  call(`public.faolla_attendance_location_notice_v1(${quote(g.site)},${quote(g.owner)},${json(nq('owner'))},${json({action:'publish',operationId:next(),expectedRevision:0,draftRevision:1,expectedSettingsVersion:sv,expectedLocationVersion:1,reason:'Synthetic196 explicit publication'})},true)`);
  call(`public.faolla_attendance_location_notice_v1(${quote(g.site)},${quote(g.auth)},${json(nq('self'))},${json({action:'acknowledge',operationId:next(),expectedRevision:1})},true)`);
  const {executeAttendanceLocationClock}=require('../../src/lib/merchantAttendanceLocationClock.server.ts');
  const service={rpc:async(name,args)=>{assert.equal(name,'faolla_attendance_location_clock_v2');try{return {data:call(boundClockRpcExpression(name,args)),error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
  const input={siteId:g.site,expectedWorkerId:g.worker,operationId:null,command:null,authUserId:g.auth,moduleEnabled:true};
  const ready=await executeAttendanceLocationClock(input,service);assert(ready.policy&&ready.noticeGate.ready);
  const command={expectedWorkerId:g.worker,operationId:next(),locationId:g.location,action:'clock_in',expectedSequence:ready.state.sequence,
    settingsVersion:ready.policy.settingsVersion,workerVersion:ready.policy.workerVersion,locationVersion:ready.policy.locationVersion,noticeRevision:ready.noticeGate.revision,
    safeFinish:false,position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()},positionFailure:null};
  const started=await executeAttendanceLocationClock({...input,command},service);assert.equal(started.state.status,'working');
  pause(g);assert.equal(read(g).detail.canClose,false);
  const beforeDenied=all();await assert.rejects(()=>executeAttendanceLocationClock(input,service),e=>e.code==='attendance_access_denied');assert.equal(all(),beforeDenied);
  status(g,'active');assert.equal(worker(g).active,false);
  const ending=await executeAttendanceLocationClock({...input,moduleEnabled:false},service);assert(ending.finish);
  const safe={expectedWorkerId:g.worker,operationId:next(),locationId:ending.finish.locationId,action:'clock_out',expectedSequence:ending.state.sequence,
    settingsVersion:ending.finish.settingsVersion,workerVersion:ending.finish.workerVersion,locationVersion:ending.finish.locationVersion,noticeRevision:null,
    safeFinish:true,position:null,positionFailure:null};
  const closed=await executeAttendanceLocationClock({...input,moduleEnabled:false,command:safe},service);
  assert.equal(closed.state.status,'off');assert.equal(closed.receiptGate.safeFinish,true);assert.equal(closed.receipt.locationId,started.receipt.locationId);
  assert.equal(closed.receipt.timeZone,started.receipt.timeZone);assert.equal(worker(g).active,false);
  const stable=all(),replayed=await executeAttendanceLocationClock({...input,moduleEnabled:false,command:safe},service);
  assert.equal(replayed.replayed,true);assert.deepEqual(replayed.receipt,closed.receipt);assert.equal(all(),stable);
  native.pass('unchanged113 actual server-generated location start and explicit safeFinish survive operational pause; revoked membership still refuses access');
  return {realLocationService:true,realNoticeAndAcknowledgement:true,pausedMemberDenied:true,workerRemainedPaused:true,explicitSafeFinish:true,exactReplay:true};
}

async function verifyEmploymentLifecycleService(p){
  const {seed,pause,q,call,next,all,native}=p,s=seed(8);pause(s);
  const {executeEmploymentLifecycle}=require('../../src/lib/merchantAttendanceEmploymentLifecycle.server.ts');
  const {handleEmploymentLifecycle}=require('../../src/app/api/merchant-enterprise/attendance/employment-lifecycle/route-handler.ts');
  const {EMPLOYMENT_LIFECYCLE_API,employmentLifecycleQueryString,employmentLifecycleCommandFingerprint,parseEmploymentLifecycleResponse}=require('../../src/lib/merchantAttendanceEmploymentLifecycle.ts');
  const {resolveCanonicalPortalOrigin}=require('../../src/lib/canonicalPortalRequest.ts');
  const calls=[];
  const service={rpc:async(name,args)=>{assert.equal(name,rpc);assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);calls.push({name,write:args.p_command!==null});
    try{return {data:call(employmentLifecycleExpression(args.p_query,args.p_auth_user_id,args.p_command,args.p_allow_write)),error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
  const execute=input=>executeEmploymentLifecycle(input,service);
  const deps={authenticate:async()=>({user:{id:s.owner},authenticationMethods:['password']}),entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),
    allow:()=>true,enabled:()=>true,execute};
  const handle=(request,overrides={})=>handleEmploymentLifecycle(request,{...deps,...overrides});
  const origin=resolveCanonicalPortalOrigin(),url=origin+EMPLOYMENT_LIFECYCLE_API,headers={origin,'sec-fetch-site':'same-origin','content-type':'application/json'};
  const get=query=>new Request(url+'?'+employmentLifecycleQueryString(query),{headers});
  const before=all(),first=await handle(get(q(s)));assert.equal(first.status,200);const detail=parseEmploymentLifecycleResponse(await first.json(),q(s),s.owner).detail;
  assert.equal(all(),before);assert.equal(calls.length,1);
  const command=employmentLifecycleCommandFromDetail(detail,'close',next()),response=await handle(new Request(url,{method:'POST',headers,body:JSON.stringify({query:q(s),command})}));
  assert.equal(response.status,200);const saved=parseEmploymentLifecycleResponse(await response.json(),q(s),s.owner,command);
  assert.equal(saved.receipt.commandFingerprint,await employmentLifecycleCommandFingerprint(s.site,command));
  const recover=q(s,'recover',{operationId:command.operationId}),savedHash=all();
  const recovered=await handle(get(recover),{enabled:()=>false,entitlement:async()=>{throw Error('recover must not read current entitlement');}});
  assert.equal(recovered.status,200);assert.deepEqual(parseEmploymentLifecycleResponse(await recovered.json(),recover,s.owner).receipt,saved.receipt);assert.equal(all(),savedHash);
  const denied=await handle(get(q(s)),{authenticate:async()=>({user:{id:s.auth},authenticationMethods:['password']})});assert.equal(denied.status,403);assert.equal(all(),savedHash);
  const absent=await handle(get(q(s,'recover',{operationId:next()})));assert.equal(absent.status,200);assert.equal((await absent.json()).receipt,null);assert.equal(all(),savedHash);
  assert.equal(calls.filter(x=>x.write).length,1);
  const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
  const {handleAttendanceAdmin}=require('../../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
  const adminService={rpc:async(name,args)=>{assert.equal(name,'faolla_attendance_admin_v1');
    try{return {data:call(`public.${name}(${quote(args.p_site_id)},${quote(args.p_auth_user_id)},${json(args.p_query)},${json(args.p_command)},${quote(args.p_operation_id)})`),error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
  let browserSubject=10;const future=new Map();
  const createBrowserSubject=({blocked=false,active=true}={})=>{const b=p.seed(browserSubject++,{active,zone:'Etc/GMT+12'});
    if(blocked){const a=new Date(Math.ceil(Date.now()/60000)*60000+3600000).toISOString(),z=new Date(Date.parse(a)+3600000).toISOString();
      const sq={siteId:b.site,access:'owner',workerId:b.worker,fromDate:a.slice(0,10),throughDate:a.slice(0,10),operationId:null};
      const c={action:'publish',operationId:p.next(),expectedRevision:0,expectedSettingsVersion:p.settings(b).version,reason:'Synthetic196 browser blocker',locationId:b.location,timeZone:'UTC',slots:[[a,z]]};
      const result=p.call(`public.faolla_attendance_schedule_evidenced_v1(${json(sq)},${quote(b.owner)},${json(c)},true)`);future.set(b.site,{query:sq,slotId:result.entries[0].id,revision:result.revision});}
    p.pause(b);return b;};
  const clearFutureBlocker=b=>{const f=future.get(b.site);assert(f);const c={action:'cancel',operationId:p.next(),expectedRevision:f.revision,expectedSettingsVersion:p.settings(b).version,slotId:f.slotId,reason:'Synthetic196 browser explicit cancellation'};
    p.call(`public.faolla_attendance_schedule_evidenced_v1(${json(f.query)},${quote(b.owner)},${json(c)},true)`);future.delete(b.site);};
  Object.assign(p,{service,execute,handle,handleLifecycle:handle,serviceSubject:s,origin,owner:s.owner,createBrowserSubject,clearFutureBlocker,
    advanceCivilDate:b=>p.admin(b,'settings',p.settingsValues('Etc/GMT-14')),
    readDetail:b=>p.read(b).detail,fingerprint:all,getStatus:b=>({workerActive:p.worker(b).active,employeeStatus:p.employee(b).status,paused:p.read(b).detail.suspension?.paused}),
    handleAdmin:request=>handleAttendanceAdmin(request,{...deps,execute:input=>executeAttendanceAdmin(input,adminService)})});
  native.pass('actual lifecycle handler/service/SQL: one fresh POST, strict parsed hash, owner denial and flag-off original receipt GET without new writes');
  return {actualServiceAndHandler:true,actualSqlCalls:calls.length,freshPosts:1,flagOffRecovery:true,unknownReceiptRemainsNull:true};
}
