// Inert164 acceptance. Root alone owns the existing stopped-PG lifecycle.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
import {sourcesNativePlan} from './merchant-attendance-sources-native.mjs';
import {preparePlanCoverageNativeFixture,planCoverageExpression,planCoverageRpc} from './fixtures/attendance-plan-coverage-native.mjs';
import {assertShiftCheckBrowserProjection} from './merchant-attendance-shift-check-native.mjs';

const require=createRequire(import.meta.url);
export const planCoverageNativeLabels=Object.freeze([
  '139 concurrent partial index and one reader install and reapply without changing old facts or definitions',
  'actual137 multiple sessions same slot retain complete original anchors while zero and missing-publication collections remain distinct',
  'real086 and095 change selected union on explicit synthetic historical events relations and plan for a separate worker',
  'empty-set owner authorization dual identity paused inactive and later-cancelled reads preserve facts',
  'complete10 relation collection succeeds and11 fails using actual137 writes only inside owned rollback',
  'aggregate2002 events succeed and2003 fail with original per-row constraints and bounded setup steps',
  'actual139 lock witnesses block real111 clock-out and099 cancellation attempts without committing probe writes',
  'GET handler service139 private ACL strict bytes and indexes preserve all read fingerprints',
]);
export function planCoverageDenseEventsSql(d,total,offset,size){
  assert([2002,2003].includes(total));const rows=total-7;
  assert.match(d.ongoing.id,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert(Number.isInteger(offset)&&offset>=1&&Number.isInteger(size)&&size>=1&&size<=100&&offset+size-1<=rows);
  return `insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id,break_paid)
    select ('00000000-0000-4000-8000-'||lpad((264000+n)::text,12,'0'))::uuid,e.merchant_id,e.worker_id,e.location_id,
      ('00000000-0000-4000-8000-'||lpad((274000+n)::text,12,'0'))::uuid,e.sequence+n,
      case ${total===2002?`when n=${rows} then 'clock_out'`:''} when n%2=1 then 'break_start' else 'break_end' end,
      'web',e.occurred_at,e.time_zone,e.actor_employee_id,case when n%2=1 ${total===2002?`and n<>${rows}`:''} then false else null end
    from public.merchant_attendance_events e cross join generate_series(${offset},${offset+size-1}) n where e.id='${d.ongoing.id}';set constraints all immediate;`;
}
export async function checkAttendancePlanCoverageNative(native,scope,browserCheck=null){
  const d=await preparePlanCoverageNativeFixture(native,scope),{exec,site,owner,worker,employee,auth,slots}=d;
  const {projectPlanCoverage,executePlanCoverage}=require('../src/lib/merchantAttendancePlanCoverage.server.ts');
  const {parsePlanCoverageResponse}=require('../src/lib/merchantAttendancePlanCoverage.ts');
  const {handlePlanCoverage}=require('../src/app/api/merchant-enterprise/attendance/plan-coverage/route-handler.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const parse=(raw,q=d.query(slots.future),actor=owner)=>parsePlanCoverageResponse({ok:true,moduleEnabled:true,data:projectPlanCoverage(raw,q,actor)},q,actor);
  const read=(slot=slots.future)=>parse(d.readRaw(d.query(slot)),d.query(slot));
  const unchanged=async fn=>{const before=d.fingerprint(),defs=d.definitions();try{return await fn();}finally{assert.equal(d.fingerprint(),before,'plan_native_changed_facts');assert.equal(d.definitions(),defs);}};
  const denied=(query,actor,code)=>`do $deny$ begin begin perform ${planCoverageExpression(query,actor)};raise assert_failure using message='plan_native_unexpected_success';exception when others then if sqlerrm<>'${code}' then raise;end if;end;end;$deny$;`;
  const reject=(code,slot=slots.future,actor=owner,setup='',patch={})=>unchanged(()=>exec(`begin;${setup}set local role service_role;${denied({...d.query(slot),...patch},actor,code)}reset role;rollback;`));
  const probe=(setup,slot=slots.future)=>unchanged(()=>parse(JSON.parse(exec(`begin;${setup}set local role service_role;select ${planCoverageExpression(d.query(slot),owner)};reset role;rollback;`)),d.query(slot)));
  native.pass(planCoverageNativeLabels[0]);
  const future=read(),empty=read(slots.zero),legacy=read(slots.legacy);
  assert.equal(future.sessions.length,3);assert.equal(future.original.closedCount,2);assert.equal(future.original.openIds.length,1);assert.equal(future.original.coveredUs,'0');assert.equal(future.original.gaps,null);
  assert.deepEqual(future.sessions.map(s=>s.rule.event.startEventId),future.sessions.map(s=>s.rule.event.startEventId).sort());
  assert(future.sessions.some(s=>s.rule.status==='missing'&&s.relation.status==='linked'),'missing_rules_must_not_erase_trusted_relation');
  assert.equal(empty.sessions.length,0);assert.equal(empty.original.coveredUs,'0');assert.equal(legacy.sessions.length,1);assert.equal(legacy.original.unverifiedIds.length,1);
  assert.equal(legacy.sessions[0].relation.reason,'publication_missing');assert.equal(legacy.original.gaps,null);assertShiftCheckBrowserProjection(future);
  native.pass(planCoverageNativeLabels[1]);
  const historical=read(slots.historical);assert.equal(historical.sessions.length,2);assert.equal(historical.original.coveredUs,'0');assert.equal(historical.selected.coveredUs,'3600000000');
  assert.equal(historical.worker.workerId,d.geoWorker);assert.equal(future.worker.workerId,worker);
  assert.equal(historical.selected.coverage.length,2);assert.equal(historical.selected.gaps.length,2);assert.equal(historical.selected.overlapUs,'0');
  assert(historical.sessions.every(s=>s.rule.status==='missing'&&s.relation.status==='linked'));
  const revision=d.reviseHistorical(false),moved=read(slots.historical);assert.equal(moved.selected.coveredUs,'1800000000');assert.equal(moved.selected.outsideIds.length,1);
  assert.equal(moved.sessions.find(s=>s.rule.event.startEventId===d.historicalFirst.id).effect.operationId,revision.operationId);
  assert.deepEqual(moved.original,historical.original);assert.deepEqual(moved.sessions.map(s=>s.relation),historical.sessions.map(s=>s.relation));
  native.pass(planCoverageNativeLabels[2]);
  for(const slot of [slots.zero,slots.future])await reject('attendance_access_denied',slot,id(98));
  await reject('attendance_plan_coverage_not_found',slots.zero,owner,'',{workerId:d.geoWorker});
  await reject('attendance_shift_rule_binding_identity_changed',slots.zero,owner,`update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';`);
  await reject('attendance_shift_rule_binding_identity_changed',slots.future,owner,`update public.merchant_enterprise_employees set status='disabled',auth_user_id=null where merchant_id='${site}' and id='${employee}';`);
  const inactive=await probe(`update public.merchant_attendance_workers set active=false,version=version+1 where merchant_id='${site}' and id='${worker}';
    update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${employee}';
    update public.merchant_attendance_settings set enabled=false,version=version+1 where merchant_id='${site}';`);
  assert.equal(inactive.worker.active,false);assert.equal(inactive.worker.employeeActive,false);assert.equal(inactive.sessions.length,3);
  const cancelCommand={action:'cancel',operationId:id(164900),expectedRevision:4,expectedSettingsVersion:1,reason:'Synthetic164 rollback cancellation',slotId:slots.future.id};
  const scheduleQuery={siteId:site,access:'owner',workerId:worker,fromDate:d.day(-1),throughDate:d.day(1),operationId:null};
  const cancelSql=`select public.faolla_attendance_schedule_v1(${json(scheduleQuery)},'${owner}',${json(cancelCommand)},true);`;
  // perform avoids a second JSON line in the rollback projection probe.
  const cancelled=await probe(`set local role service_role;do $cancel$ begin perform public.faolla_attendance_schedule_v1(${json(scheduleQuery)},'${owner}',${json(cancelCommand)},true);end;$cancel$;reset role;`);
  assert.equal(cancelled.slot.cancelled,true);assert(cancelled.sessions.every(s=>s.relation.slot.cancelled===false&&s.relation.currentCancelled===true));
  native.pass(planCoverageNativeLabels[3]);
  const fp=sourcesNativePlan(d.owned,d.inventory()).fingerprint,q=d.query(slots.future);
  const clockCommand=action=>`jsonb_build_object('expectedWorkerId','${worker}','operationId',gen_random_uuid(),'locationId','${d.plainLocation}','action','${action}',
    'expectedSequence',(select max(sequence) from public.merchant_attendance_events where merchant_id='${site}' and worker_id='${worker}'))`;
  const clockOut=`public.faolla_attendance_self_v1('${site}','${auth}',${clockCommand('clock_out')},null)`;
  const cycle=`set local role service_role;do $cycle$ begin perform public.faolla_attendance_self_schedule_v1('${site}','${auth}',${clockCommand('clock_in')},${json(d.selected(slots.future))},null,true,false);perform ${clockOut};end;$cycle$;reset role;`;
  const checkedRead=`select ${fp};set local role service_role;select ${planCoverageExpression(q,owner)};reset role;select ${fp};`;
  const cap10=await unchanged(async()=>{
    const steps=[`begin;reset role;${d.foundation.plan.guard}set local role service_role;do $finish$ begin perform ${clockOut};end;$finish$;reset role;`,
      ...Array.from({length:7},()=>cycle),checkedRead,cycle,`select ${fp};set local role service_role;${denied(q,owner,'attendance_plan_coverage_too_large')}reset role;select ${fp};`,'rollback;'];
    const lines=(await native.querySteps(steps.map(scope.sql))).trim().split(/\r?\n/);assert.equal(lines.length,5);assert.equal(lines[0],lines[2]);assert.equal(lines[3],lines[4]);return parse(JSON.parse(lines[1]));
  });
  assert.equal(cap10.sessions.length,10);assert.equal(cap10.original.closedCount,10);native.pass(planCoverageNativeLabels[4]);
  for(const total of [2002,2003])await unchanged(async()=>{
    const steps=[`begin;reset role;${d.foundation.plan.guard}`],rows=total-7;
    for(let offset=1;offset<=rows;offset+=100)steps.push(planCoverageDenseEventsSql(d,total,offset,Math.min(100,rows-offset+1)));
    steps.push(total===2002?checkedRead:`select ${fp};set local role service_role;${denied(q,owner,'attendance_plan_coverage_too_large')}reset role;select ${fp};`,'rollback;');
    const lines=(await native.querySteps(steps.map(scope.sql))).trim().split(/\r?\n/);assert.equal(lines.length,total===2002?3:2);assert.equal(lines[0],lines.at(-1));
    if(total===2002){const result=parse(JSON.parse(lines[1]));assert.equal(result.sessions.reduce((n,s)=>n+s.events.length,0),2002);assert.equal(result.original.closedCount,3);}
  });native.pass(planCoverageNativeLabels[5]);
  const guard=d.foundation.plan.guard,holder=`reset role;${guard}set local role service_role;select ${planCoverageExpression(q,owner)};`;
  const races=[];await unchanged(async()=>{
    for(const sql of [`select ${clockOut};`,cancelSql]){
      const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,
        `reset role;${guard}savepoint write_probe;set local role service_role;${sql}reset role;rollback to savepoint write_probe;`);
      assert.equal(race.witnessed,true);assert.equal(race.right.error,null);assert.equal(JSON.parse(race.left).sessions.length,3);races.push(true);
    }
  });native.pass(planCoverageNativeLabels[6]);
  let handlerSql=0;
  const service={rpc:async(name,args)=>{assert.equal(name,planCoverageRpc);assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);handlerSql++;
    try{return {data:d.readRaw(args.p_query,args.p_auth_user_id),error:null};}catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),execute:input=>executePlanCoverage(input,service)};
  const request=(method='GET')=>new Request('https://www.faolla.com/api/merchant-enterprise/attendance/plan-coverage?'+new URLSearchParams(q),{method,headers:{Host:'www.faolla.com',Origin:'https://www.faolla.com'}});
  const response=await handlePlanCoverage(request(),dependencies);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  const projected=parsePlanCoverageResponse(await response.json(),q,owner);assert.equal(projected.moduleEnabled,false);assert.equal(projected.sessions.length,3);assertShiftCheckBrowserProjection(projected);
  for(const[method,overrides,status]of [['POST',{},405],['GET',{enabled:()=>false},404],['GET',{authenticate:async()=>{throw new MerchantEnterpriseAccessError('unauthorized',401);}},401]]){
    const before=handlerSql,rejected=await handlePlanCoverage(request(method),{...dependencies,...overrides});assert.equal(rejected.status,status);assert.equal(handlerSql,before);}
  await unchanged(()=>exec(`do $acl$ declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
    assert has_function_privilege(r,'public.${planCoverageRpc}(jsonb,uuid)','EXECUTE')=(r='service_role');
    assert not has_table_privilege(r,'public.merchant_attendance_shift_schedule_relations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');end loop;end;$acl$;`));
  const plan=JSON.parse(exec(`set local enable_seqscan=off;explain(format json) select start_event_id from public.merchant_attendance_shift_schedule_relations
    where merchant_id='${site}' and slot_id='${slots.future.id}' and slot_id is not null order by start_event_id limit 11;`));
  assert(JSON.stringify(plan).includes('attendance_shift_schedule_slot_idx'));assert.equal(d.oldDefinitions(),d.oldDefs);native.pass(planCoverageNativeLabels[7]);
  const browser=browserCheck?await browserCheck(native,scope,d):null;
  if(d.isCurrentOpen())await d.finishCurrent();assert.deepEqual(d.counts(),{events:24,bindings:3,sources:2,relations:6});
  assert.equal(d.oldDefinitions(),d.oldDefs);assert.equal(d.definitions(),d.installedDefinitions);
  return {checks:planCoverageNativeLabels.length,browser,...d.counts(),handlerSql,reads:d.reads(),actualSameSlotSessions:true,actual086095:true,
    syntheticHistoricalPlan:true,syntheticHistoricalEvents:4,syntheticHistoricalRelations:2,realPastPublication:false,aggregate2002:true,rejectAggregate2003:true,relation10:true,rejectRelation11:true,
    actualClockCancellationLockWitnesses:races.length,indexUsableWithSeqScanDisabled:true,capacityBenchmark:false,readWrites:0,realAuth:false,newCluster:false,productionAccess:false};
}
export async function runAttendancePlanCoverageNative(args,browserCheck=null){let result;await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  result=await checkAttendancePlanCoverageNative(native,scope,browserCheck);}));return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendancePlanCoverageNative(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.error(JSON.stringify({error:'plan_coverage_native_failed',code:String(error).match(/attendance_[a-z_]+/)?.[0]??'local_check_failed'}));process.exitCode=1;});
