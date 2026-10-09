import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOnsiteManagementFacts,assertOnsiteManagementPending} from './merchant-attendance-onsite-management-shell-checks.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={site:'99990001',employeeId:id(101),authUserId:id(1),workerId:id(201),placeId:id(301),terminalId:id(701)};
const empty={events:[],receipts:[]};
const fixture=(count=4)=>{
  const accepted=Array.from({length:count},(_,i)=>{const action=['clock_in','break_start','break_end','clock_out'][i];
    const command={expectedWorkerId:scope.workerId,expectedEmployeeId:scope.employeeId,operationId:id(501+i),locationId:scope.placeId,action,expectedSequence:i};
    return {command,claims:{nonce:id(801+i),siteId:scope.site},result:{workerId:scope.workerId,employeeId:scope.employeeId,receipt:{id:id(601+i),operationId:command.operationId,action,sequence:i+1}}};});
  const facts={events:accepted.map((a,i)=>({id:a.result.receipt.id,merchant_id:scope.site,worker_id:scope.workerId,actor_employee_id:scope.employeeId,
    location_id:scope.placeId,source:'web',sequence:i+1,action:a.command.action,operation_id:a.command.operationId})),
  receipts:accepted.map(a=>({event_id:a.result.receipt.id,merchant_id:scope.site,worker_id:scope.workerId,employee_id:scope.employeeId,
    terminal_id:scope.terminalId,operation_id:a.command.operationId,nonce:a.claims.nonce,claims:a.claims,command:a.command}))};
  return {accepted,facts};
};
test('onsite evidence accepts four exact ordered facts with independent API/command/nonce provenance',()=>{
  const data=fixture();assert.doesNotThrow(()=>assertOnsiteManagementFacts(fixture(2).facts,data.facts,{...scope,accepted:data.accepted}));
});
test('onsite evidence rejects changed old facts, missing or duplicate origin receipts',()=>{
  for(const change of [x=>x.events[0].source='kiosk',x=>x.receipts.pop(),x=>x.receipts[1]=x.receipts[0],x=>x.receipts[0].claims={nonce:'changed'}]){
    const {facts,accepted}=fixture();change(facts);assert.throws(()=>assertOnsiteManagementFacts(fixture(1).facts,facts,{...scope,accepted}));
  }
});
test('onsite proof ties response receipt, operation, sequence and employee to actual SQL fact',()=>{
  for(const change of [x=>x[0].result.receipt.id=id(999),x=>x[0].result.receipt.operationId=id(999),x=>x[0].result.receipt.sequence=2,x=>x[0].result.employeeId=id(999)]){
    const {facts,accepted}=fixture();change(accepted);assert.throws(()=>assertOnsiteManagementFacts(empty,facts,{...scope,accepted}));
  }
});
test('onsite origin binding cannot change tenant, terminal, nonce or exact command',()=>{
  for(const change of [x=>x.receipts[0].merchant_id='99990002',x=>x.receipts[0].terminal_id=id(999),x=>x.receipts[0].nonce=id(999),x=>x.receipts[0].command={...x.receipts[0].command,expectedSequence:9}]){
    const {facts,accepted}=fixture();change(facts);assert.throws(()=>assertOnsiteManagementFacts(empty,facts,{...scope,accepted}));
  }
});
test('pending evidence requires original auth principal and complete original employee/worker command',()=>{
  const command=fixture(1).accepted[0].command,value={version:1,siteId:scope.site,authUserId:scope.authUserId,command};
  assert.deepEqual(assertOnsiteManagementPending(JSON.stringify(value),{...scope,action:'clock_in',sequence:0}),command);
  for(const patch of [{authUserId:id(999)},{siteId:'99990002'},{command:{...command,expectedEmployeeId:id(999)}},{command:{...command,expectedWorkerId:id(999)}},{command:{...command,expectedSequence:1}}])
    assert.throws(()=>assertOnsiteManagementPending(JSON.stringify({...value,...patch}),{...scope,action:'clock_in',sequence:0}));
});
test('pending cannot contain a scanned capability or silently add/drop command fields',()=>{
  const command=fixture(1).accepted[0].command,value={version:1,siteId:scope.site,authUserId:scope.authUserId,command};
  for(const raw of [JSON.stringify({...value,token:'aq1.private.capability'}),JSON.stringify({...value,command:{...command,token:'private'}}),
    JSON.stringify({...value,command:{...command,operationId:'invalid'}}),'x'.repeat(2049)])
    assert.throws(()=>assertOnsiteManagementPending(raw,{...scope,action:'clock_in',sequence:0}));
});
