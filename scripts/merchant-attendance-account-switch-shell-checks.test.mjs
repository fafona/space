// Pure evidence-oracle tests. These fabricated objects are NOT SQL/UI success.
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAccountSwitchPending,assertAccountSwitchFacts,assertAccountSwitchHistory,assertAccountSwitchCrossProbe} from './merchant-attendance-account-switch-shell-checks.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const c={site:'99990001',employees:{a:id(101),b:id(102)},workers:{a:id(201),b:id(202)},authUsers:{a:id(1),b:id(2)},place:id(301),
  labels:{a:'合成员工甲',b:'合成员工乙',workerA:'SYNTHETIC-103',workerB:'SYNTHETIC-109-B'}};
const fixture=()=>{
  const accepted=[['a','clock_in',0],['a','clock_out',1],['b','clock_in',0]].map(([member,action,sequence],index)=>{
    const command={expectedWorkerId:c.workers[member],locationId:c.place,operationId:id(501+index),action,expectedSequence:sequence};
    const receipt={id:id(601+index),siteId:c.site,workerId:c.workers[member],locationId:c.place,operationId:command.operationId,
      action,sequence:sequence+1,occurredAt:'2026-10-03T12:00:0'+index+'.123456Z',timeZone:'Europe/Madrid',breakPaid:null};
    return {member,browserActor:c.authUsers[member],command,result:{ok:true,moduleEnabled:true,workerId:c.workers[member],locationId:c.place,replayed:false,receipt,
      state:{sequence:receipt.sequence,status:action==='clock_out'?'off':'working',lastEvent:receipt}}};
  });
  const facts=accepted.map(({member,command,result})=>({id:result.receipt.id,merchant_id:c.site,worker_id:c.workers[member],location_id:c.place,
    actor_employee_id:c.employees[member],operation_id:command.operationId,action:command.action,
    sequence:command.expectedSequence+1,source:'web',occurred_at:result.receipt.occurredAt.replace('Z','+00:00'),time_zone:'Europe/Madrid',break_paid:null}));
  return {accepted,facts};
};
const rawPending=(member,command)=>JSON.stringify({version:1,siteId:c.site,employeeId:c.employees[member],workerId:c.workers[member],command});
const history=(member,facts)=>({ok:true,moduleEnabled:true,siteId:c.site,employeeId:c.employees[member],workerId:c.workers[member],nextCursor:null,
  items:facts.filter(row=>row.worker_id===c.workers[member]).toReversed().map(row=>({id:row.id,workerId:row.worker_id,locationId:row.location_id,
    sequence:row.sequence,action:row.action,source:row.source,occurredAt:row.occurred_at.replace('+00:00','Z'),workerName:c.labels[member],workerNo:member==='a'?c.labels.workerA:c.labels.workerB}))});

test('account pending oracle keeps employee and auth identities distinct and preserves complete original command',()=>{
  const {accepted}=fixture();
  for(const proof of accepted)assert.deepEqual(assertAccountSwitchPending(rawPending(proof.member,proof.command),
    {consts:c,member:proof.member,action:proof.command.action,sequence:proof.command.expectedSequence}),proof.command);
  const command=accepted[1].command,options={consts:c,member:'a',action:'clock_out',sequence:1},base=JSON.parse(rawPending('a',command));
  for(const patch of [{employeeId:c.authUsers.a},{employeeId:c.employees.b},{workerId:c.workers.b},{siteId:'99990002'},
    {token:'synthetic-private'},{command:{...command,expectedWorkerId:c.workers.b}},{command:{...command,operationId:'bad'}},
    {command:{...command,expectedSequence:0}},{command:{...command,extra:true}}])
    assert.throws(()=>assertAccountSwitchPending(JSON.stringify({...base,...patch}),options));
});

test('SQL evidence oracle matches three independent receipts even when rows are returned in arbitrary ID order',()=>{
  const {facts,accepted}=fixture();
  assert.doesNotThrow(()=>assertAccountSwitchFacts(facts.slice(0,2),facts.toReversed(),{consts:c,accepted}));
});

test('SQL timestamp offsets normalize to the API UTC instant without discarding microseconds',()=>{
  const {facts,accepted}=fixture(),aHistory=history('a',facts),bHistory=history('b',facts);
  facts[0].occurred_at='2026-10-03T14:00:00.123456+02:00';
  facts[1].occurred_at='2026-10-03T07:00:01.123456-05:00';
  facts[2].occurred_at='2026-10-03T17:30:02.123456+05:30';
  assert.doesNotThrow(()=>assertAccountSwitchFacts([],facts,{consts:c,accepted}));
  assertAccountSwitchHistory(aHistory,{consts:c,member:'a',facts});
  assertAccountSwitchHistory(bHistory,{consts:c,member:'b',facts});
  facts[2].occurred_at='2026-10-03T17:30:02.123455+05:30';
  assert.throws(()=>assertAccountSwitchFacts([],facts,{consts:c,accepted}));
  facts[2].occurred_at='2026-10-03T17:30:02.123456';
  assert.throws(()=>assertAccountSwitchFacts([],facts,{consts:c,accepted}),/invalid_fact_timestamp/);
});

test('SQL oracle rejects missing/extra/duplicate events and any changed old immutable row',()=>{
  for(const mutate of [rows=>rows.pop(),rows=>rows.push({...rows[0],id:id(999)}),rows=>rows[1]=rows[0],rows=>rows[0].time_zone='UTC']){
    const {facts,accepted}=fixture(),previous=structuredClone(facts.slice(0,2));mutate(facts);
    assert.throws(()=>assertAccountSwitchFacts(previous,facts,{consts:c,accepted}));
  }
});

test('receipt proof fails on crossed employee/worker, browser Auth principal, operation, location, source or one-microsecond drift',()=>{
  for(const patch of [{actor_employee_id:c.employees.a},{worker_id:c.workers.a},
    {merchant_id:'99990002'},{location_id:id(999)},{operation_id:id(999)},{source:'kiosk'},{sequence:2},{action:'clock_out'},
    {occurred_at:'2026-10-03T12:00:02.123455+00:00'}]){
    const {facts,accepted}=fixture();Object.assign(facts[2],patch);assert.throws(()=>assertAccountSwitchFacts([],facts,{consts:c,accepted}));
  }
  const {facts,accepted}=fixture();accepted[2].result.receipt={...accepted[0].result.receipt};
  assert.throws(()=>assertAccountSwitchFacts([],facts,{consts:c,accepted}));
  for(const principal of [c.authUsers.a,c.employees.b,null]){
    const input=fixture();input.accepted[2].browserActor=principal;
    assert.throws(()=>assertAccountSwitchFacts([],input.facts,{consts:c,accepted:input.accepted}));
  }
});

test('history oracle requires exact employee-specific rows, order, labels and no unexpected cursor',()=>{
  const {facts}=fixture();
  assert.deepEqual(assertAccountSwitchHistory(history('a',facts),{consts:c,member:'a',facts}),[id(602),id(601)]);
  assert.deepEqual(assertAccountSwitchHistory(history('b',facts),{consts:c,member:'b',facts}),[id(603)]);
  for(const mutate of [r=>r.employeeId=c.employees.a,r=>r.workerId=c.workers.a,r=>r.items.push(history('a',facts).items[0]),
    r=>r.items=[],r=>r.items[0].workerName=c.labels.a,r=>r.items[0].workerNo=c.labels.workerA,r=>r.nextCursor={id:id(999)}]){
    const result=history('b',facts);mutate(result);assert.throws(()=>assertAccountSwitchHistory(result,{consts:c,member:'b',facts}));
  }
  const reversed=history('a',facts);reversed.items.reverse();assert.throws(()=>assertAccountSwitchHistory(reversed,{consts:c,member:'a',facts}));
});

test('foreign-operation GET is correctly a successful own-state read with null receipt, not an invented403',()=>{
  const {accepted}=fixture(),bReceipt=accepted[2].result.receipt,payload={...accepted[2].result,receipt:null};
  assert.doesNotThrow(()=>assertAccountSwitchCrossProbe('otherReceipt',200,payload,{consts:c,bReceipt}));
  for(const patch of [{receipt:accepted[1].result.receipt},{workerId:c.workers.a},{replayed:true},{state:accepted[1].result.state}])
    assert.throws(()=>assertAccountSwitchCrossProbe('otherReceipt',200,{...payload,...patch},{consts:c,bReceipt}));
  assert.throws(()=>assertAccountSwitchCrossProbe('otherReceipt',403,{ok:false,error:'attendance_access_denied'},{consts:c,bReceipt}));
});

test('direct negative probes require exact business status/code and reject generic authorization or transport failures',()=>{
  const options={consts:c,bReceipt:fixture().accepted[2].result.receipt};
  for(const [kind,status,error] of [['otherCommand',409,'attendance_worker_changed'],['otherSession',404,'attendance_session_not_found'],
    ['otherHistory',409,'attendance_worker_changed'],['oldToken',401,'unauthorized']]){
    assert.doesNotThrow(()=>assertAccountSwitchCrossProbe(kind,status,{ok:false,error},options));
    for(const [wrongStatus,payload] of [[503,{ok:false,error:'attendance_unavailable'}],[403,{ok:false,error:'forbidden_origin'}],
      [status,{ok:false,error,workerId:c.workers.a}],[status,{ok:true,error}],[200,{ok:false,error}]])
      assert.throws(()=>assertAccountSwitchCrossProbe(kind,wrongStatus,payload,options));
  }
});
