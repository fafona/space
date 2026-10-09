// Pure proof/source checks, not browser or database execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertOnboardingUiPunch,onboardingBrowserRecord} from './merchant-attendance-onboarding-browser-check.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const site='99990001',employeeId=id(102),operationId=id(12001);
const prefix='/api/merchant-enterprise/',admin=prefix+'attendance/admin',self=prefix+'attendance/self';
const source=()=>readFileSync(new URL('./merchant-attendance-onboarding-browser-check.mjs',import.meta.url),'utf8');
const punch=(workerId=id(12002),locationId=id(12003))=>{
  const before={enterprise:{employees:[{id:employeeId,status:'active'}],setups:[{state:'completed'}],audits:[{id:id(12004),event_type:'invitation.accepted'}]},
    roles:[{id:id(30),permissions:['enterprise.view','attendance.self.view','attendance.self.clock']}],
    settings:[{merchant_id:site,version:4,enabled:true,web_clock_enabled:true}],
    workers:[{id:workerId,employee_id:employeeId,default_location_id:locationId}],periods:[{worker_id:workerId,starts_on:'2000-01-01',ends_on:null}],
    locations:[{id:locationId,active:true}],configOperations:[{operation_id:id(12005)}],events:[]};
  const after=structuredClone(before),event={id:id(12006),merchant_id:site,worker_id:workerId,actor_employee_id:employeeId,
    location_id:locationId,operation_id:operationId,source:'web',action:'clock_in',sequence:1,time_zone:'Europe/Madrid',
    occurred_at:'2026-10-03T10:00:00.123000+02:00',break_paid:null};
  after.events=[event];
  const receipt={id:event.id,siteId:site,workerId,locationId,operationId,action:'clock_in',sequence:1,timeZone:'Europe/Madrid',occurredAt:'2026-10-03T08:00:00.123Z',breakPaid:null};
  return {before,after,employeeId,workerId,locationId,operationId,body:{ok:true,workerId,locationId,replayed:false,
    state:{status:'working',sequence:1,lastEvent:structuredClone(receipt)},receipt}};
};
const selfCommand=()=>({siteId:site,expectedWorkerId:id(12002),operationId,locationId:id(12003),action:'clock_in',expectedSequence:0});
const adminCommand=kind=>({siteId:site,operationId,expectedVersion:2,kind,values:kind==='settings'
  ?{timeZone:'Europe/Madrid',enabled:true,webClockEnabled:false,webBreakPaid:false}
  :kind==='location'?{id:id(12003),name:'Synthetic place',timeZone:'Europe/Madrid',active:true}
    :{id:id(12002),employeeId,workerNo:'SYNTHETIC-120',displayName:'Synthetic employee',locationId:id(12003),active:true,startsOn:'2000-01-01'}});

test('punch oracle accepts independently generated worker/location IDs and offset SQL time without changing snapshots',()=>{
  for(const ids of [[id(12002),id(12003)],[id(22002),id(22003)]]){
    const proof=punch(...ids),copy=structuredClone(proof);assert.doesNotThrow(()=>assertOnboardingUiPunch(proof));assert.deepEqual(proof,copy);
    assert.equal(Object.hasOwn(proof.after.events[0],'actor_auth_user_id'),false);
  }
});

test('punch oracle rejects wrong dynamic bindings, actor, operation, channel, action, duplicate facts and unrelated writes',()=>{
  const edits=[p=>p.before.events.push({id:id(1)}),p=>p.after.events.push(structuredClone(p.after.events[0])),
    p=>p.after.events[0].actor_employee_id=id(101),p=>p.after.events[0].actor_employee_id=null,
    p=>p.after.events[0].merchant_id='99990002',p=>p.after.events[0].worker_id=id(201),p=>p.after.events[0].location_id=id(301),
    p=>p.after.events[0].operation_id=id(12007),p=>p.after.events[0].source='kiosk',p=>p.after.events[0].action='clock_out',p=>p.after.events[0].sequence=2,
    p=>p.after.settings[0].version++,p=>p.after.workers[0].employee_id=id(101),p=>p.after.enterprise.setups[0].state='claimed',
    p=>p.after.enterprise.audits.push({id:id(12007)}),p=>p.after.configOperations[0].operation_id=id(12007),
    p=>p.body.ok=false,p=>p.body.replayed=true,p=>p.body.state.status='off',p=>p.body.state.sequence=2];
  for(const edit of edits){const proof=punch();edit(proof);assert.throws(()=>assertOnboardingUiPunch(proof));}
});

test('internally consistent forged DTO still fails independent SQL receipt mapping',()=>{
  for(const patch of [{id:id(12007)},{siteId:'99990002'},{workerId:id(201)},{locationId:id(301)},{operationId:id(12007)},
    {action:'clock_out'},{sequence:2},{timeZone:'UTC'},{breakPaid:true},{occurredAt:'2026-10-03T08:00:00.124Z'}]){
    const proof=punch();Object.assign(proof.body.receipt,patch);proof.body.state.lastEvent=structuredClone(proof.body.receipt);
    assert.throws(()=>assertOnboardingUiPunch(proof));
  }
});

test('record projection omits setup/invitation/Auth bodies, reply credentials and query capabilities',()=>{
  const secrets={newPassword:'Never-store-password!2026',password:'Never-store-password!2026',invitationToken:'invite-secret',
    access_token:'synthetic.jwt.secret',refresh_token:'synthetic-refresh',cookie:'synthetic-cookie'};
  for(const path of [prefix+'invitations/initial-password',prefix+'employees/accept','/auth/v1/token','/auth/v1/user',prefix+'roles',prefix+'overview']){
    const record=onboardingBrowserRecord(path,'POST',200,{ok:true,...secrets},secrets,{...secrets,operationId});
    assert.deepEqual(record,{path,method:'POST',status:200,error:null});
    for(const secret of Object.values(secrets))assert.equal(JSON.stringify(record).includes(secret),false);
  }
  for(const error of ['Never-store-password!2026','synthetic.jwt.secret','token=invite-secret','a'.repeat(81),{password:'secret'}])
    assert.equal(onboardingBrowserRecord(prefix+'employees/accept','POST',503,{error},secrets).error,null);
  assert.equal(onboardingBrowserRecord(prefix+'employees/accept','POST',503,{error:'employee_invitation_unavailable'},secrets).error,'employee_invitation_unavailable');
});

test('admin/self log projection retains only exact safe intent fields and deep-copies them, including malformed requests rejected by handlers',()=>{
  const injected={newPassword:'Never-store-password!2026',invitationToken:'Never-store-invite',access_token:'Never-store-token'};
  for(const command of [selfCommand(),...['settings','location','worker'].map(adminCommand)]){
    const path=Object.hasOwn(command,'kind')?admin:self;
    const input={...structuredClone(command),...injected};
    if(input.values)Object.assign(input.values,injected);
    const result=onboardingBrowserRecord(path,'POST',400,{error:'attendance_invalid_request',...injected},input,injected);
    assert.deepEqual(result,{path,method:'POST',status:400,error:'attendance_invalid_request',operationId,command});
    for(const secret of Object.values(injected))assert.equal(JSON.stringify(result).includes(secret),false);
    input.operationId=id(12007);if(input.values)input.values.name='Changed after capture';
    assert.deepEqual(result.command,command);
  }
  assert.deepEqual(onboardingBrowserRecord(self,'GET',200,{ok:true},null,{operationId,invitationToken:'Never-store-invite'}),
    {path:self,method:'GET',status:200,error:null,recoveryOperationId:operationId});
});

test('source runs actual AdminClient/Portal and complete role/admin forms through real handlers instead of injected successful state',()=>{
  const text=source();
  assert.match(text,/attendance-self-browser-harness\.mjs','--merchant-shell','--database-entry'/);
  assert.match(text,/response=await setup\(request\)/);assert.match(text,/response=await accept\(request\)/);
  assert.match(text,/response=await overview\(request\)/);assert.match(text,/response=await updateRole\(request\)/);
  assert.match(text,/response=await handleAttendanceAdmin\(request,\{entitlement\}\)/);
  assert.match(text,/response=await handleAttendanceSelf\(request,\{entitlement\}\)/);
  assert.match(text,/worker=workerCommit\.input\.values/);
  assert.match(text,/locationId=prepared\.uiFacts\(\)\.locations\[0\]\.id/);
  assert.match(text,/workerId:worker\.id,locationId,operationId:first\.input\.operationId/);
  assert.match(text,/await grant\('attendance\.self\.view'\);await refreshEmployee/);
  assert.match(text,/await grant\('attendance\.self\.clock'\);await refreshEmployee/);
  assert.match(text,/getByRole\('button',\{name:'保存角色',exact:true\}\)\.click\(\)/);
  assert.doesNotMatch(text,/sessionStorage\.(?:setItem|removeItem|clear)\s*\(/);
  assert.doesNotMatch(text,/\b(?:insert into|update|delete from)\s+public\./i);
  assert.doesNotMatch(text,/execute:\s*(?:async\s*)?\(|allow:\s*\(\)\s*=>\s*true/);
  assert.match(text,/syntheticMerchantCookieAndBootstrap:true,injectedSetupReads:true,realMerchantLoginPage:false,realAuthService:false/);
});

test('both lost responses occur after real successful SQL and original IDs recover through GET with facts and POST counts unchanged',()=>{
  const text=source(),adminCall=text.indexOf('response=await handleAttendanceAdmin(request,{entitlement})'),selfCall=text.indexOf('response=await handleAttendanceSelf(request,{entitlement})');
  const committed=text.indexOf("commits.push({path:url.pathname,input:structuredClone(input),body:payload})");
  const workerLoss=text.indexOf("if(dropWorker&&url.pathname===adminPath&&input?.kind==='worker'&&response.status===200)"),punchLoss=text.indexOf("if(dropPunch&&url.pathname===selfPath&&r.method()==='POST'&&response.status===200)");
  assert(adminCall>=0&&selfCall>=0&&committed>adminCall&&committed>selfCall&&workerLoss>committed&&punchLoss>committed);
  assert.match(text,/JSON\.parse\(storedConfig\)\.command\.operationId,workerCommit\.input\.operationId/);
  assert.match(text,/assert\.equal\(posts\(adminPath\)\.length,configPosts\);assert\.deepEqual\(prepared\.uiFacts\(\),afterWorker\)/);
  assert.match(text,/JSON\.parse\(savedPending\)\.command\.operationId,first\.input\.operationId/);
  assert.match(text,/await phone\.reload\(\);await nav\(\)\.waitFor\(\)/);
  assert.match(text,/assert\.equal\(await pending\(\),savedPending\)/);
  assert.match(text,/assert\.equal\(posts\(selfPath\)\.length,postCount\);assert\.deepEqual\(prepared\.uiFacts\(\),afterPunch\)/);
  assert.match(text,/row\.method==='GET'&&row\.recoveryOperationId===first\.input\.operationId/);
});

test('closed loopback routing and separate identity contexts clean up before restoring Auth, with safe diagnostic projection',()=>{
  const text=source();
  assert.match(text,/if\(url\.origin!==origin\)\{external\.push\('external_request'\);return route\.abort\(\);\}/);
  assert.match(text,/if\(owner&&url\.pathname==='\/downloads\/faolla-android-version\.json'\)\{assert\.equal\(r\.method\(\),'GET'\);return route\.fulfill\(\{status:404/);
  assert.match(text,/if\(owner\)await context\.addCookies\(\[\{name:MERCHANT_AUTH_COOKIE,value:ownerToken,url:origin,secure:true,httpOnly:true,sameSite:'Lax'\}\]\)/);
  assert.match(text,/else\{assert\(headers\.get\('x-merchant-access-token'\)\);assert\.equal\(headers\.get\('cookie'\),null\);\}/);
  assert.match(text,/if\(closing\)return route\.abort\(\)/);
  const authStart=text.indexOf('await withAttendanceApplicationAuth('),authEnd=text.indexOf('},undefined,prepared.uiRead,',authStart);
  assert(authStart>=0&&authEnd>authStart);const authBody=text.slice(authStart,authEnd);
  assert.match(authBody,/closing=true;try\{await runAttendanceCleanupSteps/);
  assert.match(authBody,/name:'auth-owned-browser',run:\(\)=>browser\?\.close\(\)/);
  assert.match(authBody,/name:'auth-owned-routes',run:\(\)=>Promise\.allSettled\(\[\.\.\.pendingRoutes\]\)/);
  assert.match(authBody,/finally\{globalThis\.fetch=protocolFetch;\}/);
  assert.match(text.slice(authEnd),/name:'harness',timeoutMs:10000/);
  assert.match(text.slice(authEnd),/finally\{if\(savedMode===undefined\)delete process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;/);
  assert.match(text,/requests:requests\.map\(\(\{path,method,status,error\}\)=>\(\{path,method,status,error\}\)\)/);
  assert.doesNotMatch(text,/console\.(?:log|error)\((?:error|input|invite|model|employeeToken|ownerToken|initial|final)/);
  assert.match(text,/process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)/);
});
