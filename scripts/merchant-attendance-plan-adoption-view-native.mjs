import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative,planAdoptionViewExpression as expression,viewRpc,coverageRpc} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {selfScheduleAdoptionExpression} from './fixtures/attendance-self-schedule-adoption-native.mjs';
import {lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);let phase='entry';
export async function checkPlanAdoptionViewNative(native,scope,browserCheck=null){
  phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope),{exec,site,owner,worker,employee,slots}=d;
  const {projectShiftCheckAdoption,projectPlanCoverageAdoptions}=require('../src/lib/merchantAttendancePlanAdoptionView.server.ts');
  const {parseShiftCheckAdoptionResponse,parsePlanCoverageAdoptionsResponse}=require('../src/lib/merchantAttendancePlanAdoptionView.ts');
  const {parseShiftCheckResult}=require('../src/lib/merchantAttendanceShiftCheck.ts');
  const {parsePlanCoverageResult}=require('../src/lib/merchantAttendancePlanCoverage.ts');
  const {projectShiftCheck}=require('../src/lib/merchantAttendanceShiftCheck.server.ts');
  const {projectPlanCoverage}=require('../src/lib/merchantAttendancePlanCoverage.server.ts');
  let checks=0;const pass=m=>{checks++;native.pass(m);};
  const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({body:r.body,sql:d.viewFailures.at(-1)??d.geoFailures.at(-1)??d.failures.at(-1)}));return r.body;};
  const unchanged=async fn=>{const before=d.fingerprint(),defs=d.definitions();try{return await fn();}finally{assert.equal(d.fingerprint(),before,'plan_adoption_read_changed_facts');assert.equal(d.definitions(),defs);}};
  const readShift=async(start,overrides={})=>{const q=d.viewQuery(start),body=await expect(d.readView('shift-check-adoption',q,overrides));return parseShiftCheckAdoptionResponse(body,q,owner);};
  const readPlan=async(slot=slots.main,overrides={})=>{const q=d.coverageQuery(slot),body=await expect(d.readView('plan-coverage-adoptions',q,overrides));return parsePlanCoverageAdoptionsResponse(body,q,owner);};
  const savedApproval=a=>({operationId:a.operationId,revision:a.revision,sourceId:a.sourceId,sourceSha256:a.sourceSha256,recordedAt:a.recordedAt});
  pass('145 adds three readers only; all old function OIDs/definitions/ACLs tables rows and reapplication preserved');
  phase='four-channels';const rows=[];
  const record=async(channel,p)=>{const r=await expect(p);assert.equal(r.adoption.channel,channel);assert.equal(r.adoption.status,'adopted');
    assert.deepEqual(r.adoption.approval,savedApproval(d.mainApproval));rows.push(r);await(channel==='location'?d.geoFinish():d.oldClock());};
  await record('self',d.request(d.command(),d.selected(slots.main),null,{bindRules:()=>true}));
  d.configureGeo(true);
  await record('location',d.geoRequest(await d.geoCommand(),d.selected(slots.main)));
  d.configureGeo(false);
  await record('onsite',d.onsite.request(await d.onsite.command(),d.selected(slots.main),null,{bindRules:()=>true}));
  d.pinChannel.resetAuthBudget();await record('pin',d.pinChannel.request(d.pinChannel.command(),d.selected(slots.main),null,{bindRules:()=>true}));
  assert.equal(d.counts().bindings,4);
  for(const row of rows)await unchanged(async()=>{const r=await readShift(row.adoption.startEventId);assert.deepEqual(r.adoption,row.adoption);
    assert.equal(r.check.rule.binding.channel,row.adoption.channel);assert.equal(r.check.rule.worker.employeeAuthUserId,d.auth);assert.notEqual(d.auth,owner);});
  pass('four real self/location/HMAC onsite/PIN clock paths with133 bindings read the exact saved140 approval under owner auth');
  phase='legacy';const legacy=await expect(d.legacyRequest(d.command(),d.selected(slots.main)));await d.oldClock();
  const plain=await d.oldClock('clock_in');await d.oldClock();
  await unchanged(async()=>{const old=await readShift(legacy.clock.receipt.id),bare=await readShift(plain.receipt.id);assert.equal(old.adoption,null);assert.equal(old.check.relation.status,'linked');
    assert.equal(bare.adoption,null);assert.equal(bare.check.relation,null);});
  pass('actual old137 selection and plain111 history stay null without guessed or backfilled adoption');
  phase='collections';await unchanged(async()=>{
    const q=d.coverageQuery(),raw=d.readRawView(coverageRpc,q),projected=projectPlanCoverageAdoptions(raw,q,owner),newer=parsePlanCoverageAdoptionsResponse({ok:true,moduleEnabled:true,data:projected},q,owner);
    assert.deepEqual(newer.coverage,parsePlanCoverageResult(projectPlanCoverage(raw.coverage,q,owner),q,owner));
    assert.equal(newer.adoptions.length,5);assert.equal(newer.adoptions.filter(a=>a.adoption!==null).length,4);assert.equal(newer.adoptions.find(a=>a.startEventId===legacy.clock.receipt.id).adoption,null);
    for(const child of raw.coverage.sessions){const sq=d.viewQuery(child.binding.event.startEventId),source=d.readRawView(viewRpc,sq),data=projectShiftCheckAdoption(source,sq,owner);
      assert.deepEqual(parseShiftCheckAdoptionResponse({ok:true,moduleEnabled:true,data},sq,owner).check,parseShiftCheckResult(projectShiftCheck(source.check,sq,owner),sq,owner));}
    const empty=await readPlan(slots.browser);assert.equal(empty.adoptions.length,0);assert.equal(empty.coverage.sessions.length,0);
  });pass('five same-plan sessions retain ordered one-to-one references including legacy null; old calculation results and empty collections unchanged');
  phase='statuses';for(const [slot,status] of [[null,'unselected'],[slots.alternate,'not_approved'],[slots.legacy,'unverified']]){
    const row=await expect(d.request(d.command(),slot?d.selected(slot):null));await d.oldClock();
    await unchanged(async()=>{const result=await readShift(row.adoption.startEventId);assert.equal(result.adoption.status,status);assert.deepEqual(result.adoption,row.adoption);assert.equal(result.check.rule.binding,null);});
  }pass('unselected unapproved and publication-missing remain distinct saved decisions even without a133 binding');
  phase='authorization';const sq=d.viewQuery(rows[0].adoption.startEventId),pq=d.coverageQuery();
  const denied=(rpc,q,actor,code)=>`do $deny$ begin begin perform ${expression(rpc,q,actor)};raise assert_failure;exception when others then if sqlerrm<>'${code}' then raise;end if;end;end;$deny$;`;
  for(const[rpc,q]of [[viewRpc,sq],[coverageRpc,pq]])await unchanged(()=>{
    exec(`begin;set local role service_role;${denied(rpc,q,id(98),'attendance_access_denied')}reset role;rollback;`);
    exec(`begin;update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';set local role service_role;
      ${denied(rpc,q,owner,'attendance_shift_rule_binding_identity_changed')}reset role;rollback;`);
    const raw=JSON.parse(exec(`begin;update public.merchant_attendance_settings set enabled=false,version=version+1 where merchant_id='${site}';
      update public.merchant_attendance_workers set active=false,version=version+1 where merchant_id='${site}' and id='${worker}';
      update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${employee}';
      set local role service_role;select ${expression(rpc,q,owner)};reset role;rollback;`));
    const result=rpc===viewRpc?projectShiftCheckAdoption(raw,q,owner):projectPlanCoverageAdoptions(raw,q,owner);
    assert.equal((result.check?.rule??result.coverage).worker.active,false);
  });
  await unchanged(async()=>{for(const[kind,q]of [['shift-check-adoption',sq],['plan-coverage-adoptions',pq]]){
    for(const overrides of [{enabled:()=>false},{siteEnabled:()=>false}]){const before=d.viewCalls.length;await expect(d.readView(kind,q,overrides),404);assert.equal(d.viewCalls.length,before);}
    const before=d.viewCalls.length;await expect(d.readView(kind,q,{},'POST'),405);assert.equal(d.viewCalls.length,before);
    const r=await d.readView(kind,q,{entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})});assert.equal(r.status,200);assert.equal(r.body.moduleEnabled,false);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(d.viewCalls.length,before+1);
  }});pass('owner and dual identity enforced; paused matching history readable; flags/site gate/POST rejected without SQL; one private GET RPC');
  phase='limits';const clockCommand=action=>`jsonb_build_object('expectedWorkerId','${worker}','operationId',gen_random_uuid(),'locationId','${d.location}','action','${action}',
    'expectedSequence',(select max(sequence) from public.merchant_attendance_events where merchant_id='${site}' and worker_id='${worker}'))`;
  const cycle=`set local role service_role;do $cycle$ begin perform public.faolla_attendance_self_schedule_v1('${site}','${d.auth}',${clockCommand('clock_in')},${json(d.selected(slots.main))},null,true,false);
    perform public.faolla_attendance_self_v1('${site}','${d.auth}',${clockCommand('clock_out')},null);end;$cycle$;reset role;`;
  await unchanged(async()=>{const steps=[`begin;reset role;${d.guard}`,...Array.from({length:5},()=>cycle),`set local role service_role;select ${expression(coverageRpc,pq,owner)};reset role;`,cycle,
      `set local role service_role;${denied(coverageRpc,pq,owner,'attendance_plan_coverage_too_large')}reset role;`,'rollback;'];
    const raw=JSON.parse(await native.querySteps(steps.map(scope.sql)));assert.equal(raw.adoptions.length,10);assert.equal(raw.coverage.sessions.length,10);
    projectPlanCoverageAdoptions(raw,pq,owner);});pass('actual137 writes inside rollback demonstrate complete10 same-plan sessions and original11 refusal without truncation');
  phase='acl';await unchanged(()=>exec(`do $acl$ declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
    assert has_function_privilege(r,'public.${viewRpc}(jsonb,uuid)','EXECUTE')=(r='service_role');
    assert has_function_privilege(r,'public.${coverageRpc}(jsonb,uuid)','EXECUTE')=(r='service_role');
    assert not has_function_privilege(r,'public.faolla_attendance_shift_plan_adoption_read_v1(jsonb)','EXECUTE');
    assert not has_table_privilege(r,'public.merchant_attendance_shift_plan_adoptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');end loop;end;$acl$;`));
  pass('both public wrappers service-role only; trusted private helper and immutable proof table inaccessible to business roles');
  phase='browser';d.viewBrowser={sourceQuery:{siteId:site,workerId:worker,fromDate:d.today,throughDate:d.day(1)},handleSources:d.handleSources,
    handleShift:d.handleShift,handlePlan:d.handlePlan,handleOldShift:d.handleOldShift,handleOldPlan:d.handleOldPlan,owner,site,
    startEventId:rows[0].adoption.startEventId,slotId:slots.main.id,slotRevision:slots.main.revision,approvedStartEventIds:rows.map(r=>r.adoption.startEventId),legacyStartEventId:legacy.clock.receipt.id};
  const browser=browserCheck?await unchanged(()=>browserCheck(d)):null;
  phase='locks';const races=[];
  const holder=`reset role;${d.guard}set local role service_role;select ${expression(coverageRpc,pq,owner)};`;
  const newArgs=d.input(d.command(),d.selected(slots.browser)),waiter=`reset role;${d.guard}savepoint probe;set local role service_role;select ${selfScheduleAdoptionExpression(newArgs)};reset role;rollback to savepoint probe;`;
  await unchanged(async()=>{exec(`begin;${holder}${waiter}rollback;`);const r=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,waiter);assert(r.witnessed);assert.equal(r.right.error,null);races.push(true);});
  const cancel=d.cancelCommand(slots.main),cancelHolder=`reset role;${d.guard}set local role service_role;select ${d.cancelExpression(cancel)};`,readWaiter=`reset role;${d.guard}set local role service_role;
    do $cancelled$ declare r jsonb;begin r:=${expression(coverageRpc,pq,owner)};assert r->'coverage'->'slot'->>'cancelled'='true';assert jsonb_array_length(r->'adoptions')=5;end;$cancelled$;`;
  exec(`begin;${cancelHolder}${readWaiter}rollback;`);const cancellation=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},cancelHolder,readWaiter);assert(cancellation.witnessed);assert.equal(cancellation.right.error,null);races.push(true);
  const fixed=await unchanged(()=>readPlan());assert(fixed.coverage.sessions.every(s=>s.relation.currentCancelled));for(const row of rows)assert.deepEqual(fixed.adoptions.find(a=>a.startEventId===row.adoption.startEventId).adoption,row.adoption);
  const rebindHolder=`reset role;${d.guard}update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';`,rebindWaiter=`reset role;${d.guard}set local role service_role;${denied(viewRpc,sq,owner,'attendance_shift_rule_binding_identity_changed')}`;
  exec(`begin;${rebindHolder}${rebindWaiter}rollback;`);const rebinding=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},rebindHolder,rebindWaiter);assert(rebinding.witnessed);assert.equal(rebinding.right.error,null);races.push(true);
  pass('three exact blocked-PID witnesses serialize new clock cancellation and rebind against owner reads; immutable references never become latest-head guesses');
  phase='reapply';const before=d.fingerprint();d.reapplyView();assert.equal(d.fingerprint(),before);assert.equal(d.definitions(),d.viewDefinitions);assert.equal(d.previousViewDefinitions(),d.oldViewDefinitions);
  pass('final reapplication preserves every actual clock reference and all previous definitions');
  return {checks,browser,channels:4,samePlanSessions:5,relation10:true,rejectRelation11:true,exactPidRaces:races.length,handlerSql:d.viewCalls.length,...d.counts(),
    readWrites:0,oldAlgorithmsUnchanged:true,realAuth:false,newCluster:false,productionAccess:false};
}
export async function runPlanAdoptionViewNative(args,browserCheck=null){
  let result;const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(k=>process.env[k]);
  process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=randomBytes(32).toString('hex');process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    result=await checkPlanAdoptionViewNative(native,scope,browserCheck);}));return result;}
  finally{keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),browser=args.at(-1)==='--with-browser';if(browser)args.pop();
  const run=async()=>runPlanAdoptionViewNative(args,browser?(await import('./fixtures/attendance-plan-adoption-view-browser.mjs')).runPlanAdoptionViewBrowserAcceptance:null);
  run().then(r=>console.log(JSON.stringify(r))).catch(error=>{
    console.error(JSON.stringify({error:'plan_adoption_view_native_failed',phase,detail:String(error).slice(0,2200)}));process.exitCode=1;});
}
