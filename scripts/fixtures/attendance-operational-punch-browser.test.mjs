import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPunchBrowserModel,punchBrowserLimits} from './attendance-operational-punch-browser.mjs';
test('242 browser fixture is bounded and starts without synthetic business writes',async()=>{
 const m=await createPunchBrowserModel();assert.equal(m.writes.length,0);assert.deepEqual(punchBrowserLimits,{ttlMs:180000,http:70,api:25});
 const response=await m.respond(`http://127.0.0.1/api/merchant-enterprise/attendance/operational-punch-self?siteId=${m.seed.siteId}&mode=prepare`,'GET','');
 const data=JSON.parse(response.text).data;assert.equal(data.canStart,true);assert.equal(data.clock.state.sequence,0);assert.equal(m.writes.length,0);
});
test('242 browser model records one full intent before a deliberately truncated reply; recovery is read only',async()=>{
 const m=await createPunchBrowserModel(),url=`http://127.0.0.1/api/merchant-enterprise/attendance/operational-punch-self`;
 const data=JSON.parse((await m.respond(`${url}?siteId=${m.seed.siteId}&mode=prepare`,'GET','')).text).data;
 const operationId='24200000-0000-4000-8000-000000000300';
 const command={clock:{expectedWorkerId:m.seed.worker,operationId,locationId:data.clock.locationId,action:'clock_in',expectedSequence:0},choice:{kind:'start',expectedPolicyFingerprint:data.policy.policyFingerprint,selection:null}};
 const response=await m.respond(url,'POST',JSON.stringify({siteId:m.seed.siteId,query:{mode:'recover',operationId},command}));assert.equal(response.text,'{"ok":');assert.deepEqual(m.writes,[command]);
 const recovered=JSON.parse((await m.respond(`${url}?siteId=${m.seed.siteId}&mode=recover&operationId=${operationId}`,'GET','')).text).data;
 assert.equal(recovered.operation.operationId,operationId);assert.equal(recovered.session,null);assert.equal(recovered.canStart,false);assert.equal(m.writes.length,1);
});

const url=channel=>`http://127.0.0.1/api/merchant-enterprise/attendance/operational-punch-${channel}`;
function command(m,data,action,number){const operationId='24200000-0000-4000-8000-'+String(number).padStart(12,'0');
 return{clock:{expectedWorkerId:m.seed.worker,expectedEmployeeId:m.seed.employee,operationId,locationId:data.clock.locationId,action,expectedSequence:data.clock.state.sequence},
  choice:action==='clock_in'?{kind:'start',expectedPolicyFingerprint:data.policy.policyFingerprint,selection:null}:{kind:'finish'}};}

test('242 PIN synthetic model revalidates each prepare/write/recovery transport and binds null actor, never authenticates by prior prepare',async()=>{
 const m=await createPunchBrowserModel(),send=(query,command=null,pin=m.syntheticPin)=>m.respond(url('pin'),'POST',JSON.stringify({workerNo:'qa-worker',pin,query,command}));
 assert.equal((await send({mode:'prepare'},null,'00000000')).status,403);assert.equal(m.writes.length,0);
 const prepared=JSON.parse((await send({mode:'prepare'})).text).data;assert.equal(prepared.channel,'pin');assert.equal(prepared.clock.terminalId,m.seed.terminal);
 const c=command(m,prepared,'clock_in',310),q={mode:'recover',operationId:c.clock.operationId};
 assert.equal((await send(q,c,'00000000')).status,403);assert.equal(m.writes.length,0);assert.equal(m.records.has(c.clock.operationId),false);
 assert.equal((await send(q,c)).text,'{"ok":');assert.equal(m.writes.length,1);
 const recovered=JSON.parse((await send(q)).text).data;assert.equal(recovered.operation.actorAuthUserId,null);assert.equal(recovered.operation.employeeId,m.seed.employee);
 assert.deepEqual(recovered.operation,m.records.get(c.clock.operationId).data.operation);assert.equal(recovered.session,null);
 const working=JSON.parse((await send({mode:'prepare'})).text).data,c2=command(m,working,'clock_out',311);
 const closed=JSON.parse((await send({mode:'recover',operationId:c2.clock.operationId},c2)).text).data;assert.equal(closed.clock.state.status,'off');assert.equal(m.writes.length,2);
 assert.equal(m.credentialChecks.filter(x=>x.valid).length,5);assert.equal(m.credentialChecks.filter(x=>!x.valid).length,2);
 assert(!JSON.stringify(m.writes).includes(m.syntheticPin));assert(!JSON.stringify(m.credentialChecks).includes(m.syntheticPin));
 await assert.rejects(m.respond(url('pin')+`?siteId=${m.seed.siteId}&mode=prepare`,'GET',''));
});

test('242 onsite model has per-code synthetic freshness/consumption while GET recovery has no token',async()=>{
 const m=await createPunchBrowserModel(),prepare=()=>m.respond(url('onsite')+`?siteId=${m.seed.siteId}&mode=prepare`,'GET','');
 const prepared=JSON.parse((await prepare()).text).data,c=command(m,prepared,'clock_in',320),q={mode:'recover',operationId:c.clock.operationId};
 const send=(c,token)=>m.respond(url('onsite'),'POST',JSON.stringify({siteId:m.seed.siteId,query:{mode:'recover',operationId:c.clock.operationId},command:c,token}));
 const expired=m.issueToken(true);assert.equal((await send(c,expired)).status,409);assert.equal(m.writes.length,0);
 const token=m.issueToken();assert.equal((await send(c,token)).text,'{"ok":');assert.equal(m.writes.length,1);
 const working=JSON.parse((await prepare()).text).data,c2=command(m,working,'clock_out',321),used=await send(c2,token);
 assert.equal(used.status,409);assert.equal(JSON.parse(used.text).error.code,'attendance_qr_used');assert.equal(m.writes.length,1);
 const checksBefore=m.credentialChecks.length,recovered=JSON.parse((await m.respond(url('onsite')+`?siteId=${m.seed.siteId}&mode=recover&operationId=${q.operationId}`,'GET','')).text).data;
 assert.equal(recovered.operation.operationId,q.operationId);assert.equal(recovered.operation.actorAuthUserId,m.seed.auth);assert.equal(recovered.session,null);assert.equal(m.credentialChecks.length,checksBefore);
 assert.equal(JSON.parse((await send(c2,m.issueToken())).text).data.clock.state.status,'off');assert.equal(m.writes.length,2);
 assert(!JSON.stringify(m.writes).includes(token));assert(!JSON.stringify(m.records.get(q.operationId)).includes(token));
});

test('242 extension keeps original six scenarios and budget; two extra groups are synthetic credentials, not SQL/PIN/HMAC acceptance',()=>{
 const source=readFileSync(new URL('./attendance-operational-punch-browser.mjs',import.meta.url),'utf8'),entry=readFileSync(new URL('./attendance-operational-punch-browser-entry.tsx',import.meta.url),'utf8');
 for(const name of ['shared_host_zero_initial','explicit_start_and_lost_reply','fixed_explicit_breaks','flagoff_finish','hidden_auth_late_body','pin_memory_scope_and_hidden'])assert(source.includes(`stage='${name}'`));
 assert(source.includes('groups:8'));assert(source.includes('actualPinVerification:false,actualTokenHmac:false'));
 assert(source.includes('syntheticPinCredentialChecks:5,syntheticOnsiteCredentialChecks:2'));
 assert(source.includes("expired token must not reach HTTP"));assert(source.includes("consumed code cannot be reused"));
 assert(source.includes('model.writes.at(-1).clock.operationId,JSON.parse(expiredPending[0][1]).command.clock.operationId'));
 assert(source.includes('Object.entries(sessionStorage),Object.entries(localStorage)'));assert(source.includes('noAutomaticPost:true'));
 assert(entry.includes('Synthetic scan bridge, not a camera/HMAC/device authentication substitute'));
 assert(entry.includes('token={token} consumeToken={consumeToken}'));
 assert.deepEqual(punchBrowserLimits,{ttlMs:180000,http:70,api:25});
});
