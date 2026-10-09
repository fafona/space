// Inert import. Only the explicit caller starts the existing stopped-PG runner.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {prepareShiftCheckNativeFixture,shiftCheckExpression,shiftCheckRpc} from './fixtures/attendance-shift-check-native.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {sourcesNativePlan} from './merchant-attendance-sources-native.mjs';

export const shiftCheckNativeLabels=Object.freeze([
  '138 additive installation and reapply preserve all old definitions and business facts',
  'real137 selected shift complete events and actual086 approval compare separately under one original frozen rule',
  'actual095 approved follow-up changes selected evidence without changing original events point hash or plan selection',
  'missing unverified open-break and synthetic cross-night full sessions never invent original fixed rules or window ends',
  'current owner identity and immutable anchor fences fail closed while paused inactive matching identities remain readable',
  '2002 complete events remain complete and2003 probes fail closed with constraints enabled inside owned rollback',
  'actual read-only handler service and138 reject disabled methods auth and foreign owner with private ACL and unchanged facts',
]);
const require=createRequire(import.meta.url);
export function assertShiftCheckBrowserProjection(value){
  if(!value||typeof value!=='object')return;
  for(const [key,child]of Object.entries(value)){assert(!['sourceText','sourceGraph','history'].includes(key),`shift_check_browser_leak_${key}`);assertShiftCheckBrowserProjection(child);}
}
export function shiftCheckDenseEventsSql(d,count,offset=0,size=count){
  assert([2002,2003].includes(count));assert.match(d.site,/^\d{8}$/);assert.match(d.day(-1),/^\d{4}-\d{2}-\d{2}$/);
  assert(Number.isInteger(offset)&&offset>=0&&Number.isInteger(size)&&size>0&&offset+size<=count);
  return `insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id,break_paid)
    select ('00000000-0000-4000-8000-'||lpad((163000+n)::text,12,'0'))::uuid,'${d.site}','${d.geoWorker}','${d.geoLocation}',
      ('00000000-0000-4000-8000-'||lpad((173000+n)::text,12,'0'))::uuid,3+n,
      case when n=0 then 'clock_in' ${count===2002?"when n=2001 then 'clock_out'":''} when n%2=1 then 'break_start' else 'break_end' end,
      'web','${d.day(-1)}T10:00:00.000123Z'::timestamptz,'Europe/Madrid','${d.geoEmployee}',case when n%2=1 ${count===2002?'and n<>2001':''} then false else null end
    from generate_series(${offset},${offset+size-1}) n;set constraints all immediate;`;
}

export async function checkAttendanceShiftCheckNative(native,scope,browserCheck=null){
  const d=await prepareShiftCheckNativeFixture(native,scope),{exec,site,owner,worker,employee,anchors}=d;
  const {projectShiftCheck,executeShiftCheck}=require('../src/lib/merchantAttendanceShiftCheck.server.ts');
  const {parseShiftCheckResponse}=require('../src/lib/merchantAttendanceShiftCheck.ts');
  const {handleShiftCheck}=require('../src/app/api/merchant-enterprise/attendance/shift-check/route-handler.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const q=(startEventId=anchors.verified,patch={})=>({siteId:site,workerId:worker,startEventId,...patch});
  const parse=(raw,query=q(),actor=owner)=>parseShiftCheckResponse({ok:true,moduleEnabled:true,data:projectShiftCheck(raw,query,actor)},query,actor);
  const read=(query=q(),actor=owner)=>parse(d.readRaw(query,actor),query,actor);
  const unchanged=async action=>{const facts=d.fingerprint(),defs=d.definitions();try{return await action();}finally{assert.equal(d.fingerprint(),facts,'shift_check_changed_facts');assert.equal(d.definitions(),defs);}};
  const reject=async(code,query=q(),actor=owner,setup='')=>unchanged(()=>exec(`begin;${setup}set local role service_role;do $denied$ begin
    begin perform ${shiftCheckExpression(query,actor)};raise assert_failure using message='shift_check_unexpected_success';
    exception when others then if sqlerrm<>${"'"+code+"'"} then raise;end if;end;end;$denied$;reset role;rollback;`));
  const probe=async(setup,query=q(),actor=owner)=>unchanged(()=>parse(JSON.parse(exec(`begin;${setup}set local role service_role;select ${shiftCheckExpression(query,actor)};reset role;set constraints all immediate;rollback;`)),query,actor));
  native.pass(shiftCheckNativeLabels[0]);
  const first=read();assert.equal(first.rule.status,'verified');assert.equal(first.events.length,4);assert.equal(first.original.status,'completed');
  assert.equal(first.effect.revision,1);assert.equal(first.effect.operationId,d.effect().operationId);assert.equal(first.checks.open.state,'not_applicable');
  assert.deepEqual(first.checks.breakRule,{state:'value',minutes:1});assert.equal(first.checks.originalBreaks.length,1);assert.equal(first.checks.originalBreaks[0].state,'triggered');
  assert.equal(first.checks.approvedBreaks[0].durationUs,'30000000');assert.equal(first.checks.approvedBreaks[0].state,'triggered');
  assert.equal(first.relation.status,'linked');assert.deepEqual(first.relation.selection,d.selection);assert(first.plan.original.startDeltaUs.startsWith('-'));
  assert(first.plan.approved.startDeltaUs.startsWith('-'));assert.notEqual(first.original.startAt,first.approved.startAt);
  assertShiftCheckBrowserProjection(first);native.pass(shiftCheckNativeLabels[1]);
  const parentBefore=d.readSourceRaw(),revision=d.approveRevision(60),latest=read();
  assert.equal(latest.effect.revision,2);assert.equal(latest.effect.operationId,revision.operationId);assert.equal(latest.effect.lineage.previousOperationId,first.effect.operationId);
  assert.equal(latest.checks.approvedBreaks[0].durationUs,'60000000');assert.equal(latest.checks.approvedBreaks[0].state,'not_triggered');
  assert.deepEqual(latest.events,first.events);assert.deepEqual(latest.rule.evidence,first.rule.evidence);assert.deepEqual(latest.relation,first.relation);
  assert.notEqual(latest.effect.operationId,first.effect.operationId);assert(parentBefore);native.pass(shiftCheckNativeLabels[2]);
  const missing=read(q(anchors.missing)),unverified=read(q(anchors.unverified)),ongoing=read(q(anchors.ongoing));
  assert.equal(missing.rule.status,'missing');assert.equal(missing.checks.breakRule.state,'unavailable');assert.equal(missing.relation,null);
  assert.equal(unverified.rule.status,'unverified');assert.equal(unverified.rule.reason,'inactive_group');assert.equal(unverified.checks.breakRule.state,'unavailable');
  assert.equal(ongoing.original.status,'break');assert.equal(ongoing.original.endAt,null);assert(ongoing.original.openBreak);assert.deepEqual(ongoing.checks.originalBreaks,[]);
  assert.equal(ongoing.checks.open.state,'not_triggered');assert(BigInt(ongoing.checks.open.elapsedUs)>=0n);
  const cross=read(q(d.crossStart,{workerId:d.geoWorker}));assert.equal(cross.events.length,2);assert.equal(cross.events[1].id,d.crossEnd);
  assert.equal(cross.original.endAt,`${d.day(-2)}T00:30:00.000456Z`);assert(cross.original.endAt>d.crossSource.toAt);
  assert.equal(cross.rule.status,'missing');assert.equal(cross.checks.breakRule.state,'unavailable');native.pass(shiftCheckNativeLabels[3]);
  await reject('attendance_access_denied',q(),id(98));await reject('attendance_shift_rule_binding_not_found',q(anchors.verified,{workerId:d.geoWorker}));
  await reject('attendance_shift_rule_binding_not_found',q(first.events.at(-1).id));
  await reject('attendance_shift_rule_binding_identity_changed',q(),owner,`update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where id='${employee}' and merchant_id='${site}';`);
  await reject('attendance_shift_rule_binding_identity_changed',q(),owner,`update public.merchant_enterprise_employees set status='disabled',auth_user_id=null where id='${employee}' and merchant_id='${site}';`);
  await reject('attendance_shift_rule_binding_identity_changed',q(),owner,`update public.merchant_attendance_workers set employee_id=null,version=version+1 where id='${worker}' and merchant_id='${site}';`);
  const paused=await probe(`update public.merchant_attendance_workers set active=false,version=version+1 where id='${worker}' and merchant_id='${site}';
    update public.merchant_enterprise_employees set status='disabled' where id='${employee}' and merchant_id='${site}';
    update public.merchant_attendance_settings set enabled=false,version=version+1 where merchant_id='${site}';`);
  assert.equal(paused.rule.worker.active,false);assert.equal(paused.rule.worker.employeeActive,false);assert.deepEqual(paused.rule.evidence,latest.rule.evidence);
  native.pass(shiftCheckNativeLabels[4]);
  const denseQuery=q(id(163000),{workerId:d.geoWorker});
  // Old per-row zone CHECKs remain enabled. Bounded100-row setup steps keep
  // one owned BEGIN/ROLLBACK without relaxing10s SQL/25s per-step deadlines.
  const denseProbe=async count=>unchanged(async()=>{
    const steps=[`begin;reset role;${d.foundation.plan.guard}`];
    for(let offset=0;offset<count;offset+=100)steps.push(shiftCheckDenseEventsSql(d,count,offset,Math.min(100,count-offset)));
    const fp=sourcesNativePlan(d.owned,d.inventory()).fingerprint;
    steps.push(`reset role;select ${fp};set local role service_role;${count===2002?`select ${shiftCheckExpression(denseQuery,owner)};`:
      `do $cap$ begin begin perform ${shiftCheckExpression(denseQuery,owner)};raise assert_failure using message='shift_check_unexpected_dense_success';
        exception when others then if sqlerrm<>'attendance_shift_check_too_large' then raise;end if;end;end;$cap$;`}
      reset role;select ${fp};`,'rollback;');
    assert(steps.length<=24);const output=await native.querySteps(steps.map(scope.sql)),lines=output.trim().split(/\r?\n/);
    assert.equal(lines.length,count===2002?3:2);assert.equal(lines[0],lines.at(-1),'shift_check_dense_read_changed_facts');
    return count===2002?parse(JSON.parse(lines[1]),denseQuery):null;
  });
  const dense=await denseProbe(2002);
  assert.equal(dense.events.length,2002);assert.equal(dense.original.breaks.length,1000);assert.equal(dense.original.status,'completed');
  assert(dense.checks.originalBreaks.every(b=>b.durationUs==='0'&&b.state==='unavailable'));
  await denseProbe(2003);native.pass(shiftCheckNativeLabels[5]);
  let handlerSql=0;
  const service={rpc:async(name,args)=>{assert.equal(name,shiftCheckRpc);assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);handlerSql++;
    try{return {data:d.readRaw(args.p_query,args.p_auth_user_id),error:null};}catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}),execute:input=>executeShiftCheck(input,service)};
  const request=(method='GET')=>new Request(`https://www.faolla.com/api/merchant-enterprise/attendance/shift-check?${new URLSearchParams(q())}`,{method,headers:{Host:'www.faolla.com',Origin:'https://www.faolla.com'}});
  await unchanged(async()=>{const response=await handleShiftCheck(request(),dependencies);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    const parsed=parseShiftCheckResponse(await response.json(),q(),owner);assert.equal(parsed.moduleEnabled,false);assert.equal(parsed.effect.revision,2);assertShiftCheckBrowserProjection(parsed);});
  for(const[method,overrides,status]of [['POST',{},405],['GET',{enabled:()=>false},404],['GET',{authenticate:async()=>{throw new MerchantEnterpriseAccessError('unauthorized',401);}},401]]){
    const before=handlerSql;const response=await handleShiftCheck(request(method),{...dependencies,...overrides});assert.equal(response.status,status);assert.equal(handlerSql,before);}
  const forbidden=await handleShiftCheck(request(),{...dependencies,authenticate:async()=>({user:{id:id(98)},authenticationMethods:['password']})});assert.equal(forbidden.status,403);
  await unchanged(()=>exec(`do $acl$ declare r text;begin
    foreach r in array array['anon','authenticated'] loop assert not has_function_privilege(r,'public.${shiftCheckRpc}(jsonb,uuid)','EXECUTE'),'shift_check_private_acl';end loop;
    assert has_function_privilege('service_role','public.${shiftCheckRpc}(jsonb,uuid)','EXECUTE');
    foreach r in array array['anon','authenticated','service_role'] loop
      assert not has_table_privilege(r,'public.merchant_attendance_shift_rule_sources','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
      assert not has_table_privilege(r,'public.merchant_attendance_shift_schedule_relations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');end loop;end;$acl$;`));
  native.pass(shiftCheckNativeLabels[6]);
  const browser=browserCheck?await browserCheck(native,scope,d):null;
  if(d.isOpen())await d.finishOpen();
  assert.deepEqual(d.counts(),{events:14,bindings:3,sources:2,relations:1});
  return {checks:shiftCheckNativeLabels.length,browser,...d.counts(),handlerSql,sourceReads:d.sourceReads(),detailReads:d.detailReads(),actualClockCalls:d.clockCalls.length,
    actual086Approval:true,actual095Revision:true,actual137Relation:true,syntheticCrossNight:true,realCrossMidnightWait:false,
    readsWriteNothing:true,otherClockChannelsRetested:false,realAuthentication:false,productionAccess:false,newCluster:false,callerOwnedNamespaceCleanup:true};
}
export async function runAttendanceShiftCheckNative(args,browserCheck=null){
  let result;await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{result=await checkAttendanceShiftCheckNative(native,scope,browserCheck);}));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceShiftCheckNative(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({error:'shift_check_native_failed',code:String(error).match(/attendance_[a-z_]+/)?.[0]??'local_check_failed'}));process.exitCode=1;});
}
