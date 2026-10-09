// Pure proof/source checks only; importing the native runner must not execute it.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertOnboardingEnrollment,assertOnboardingFirstPunch} from './merchant-attendance-onboarding-native.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const site='99990001',employeeId=id(102),ownerId=id(99),workerId=id(201),locationId=id(301),operationId=id(1001);
const worker=()=>({id:workerId,employeeId,workerNo:'SYNTHETIC-ONBOARD',displayName:'Synthetic new employee',locationId,active:true,startsOn:'2000-01-01'});
const base=()=>({enterprise:{employees:[{id:employeeId,status:'active',auth_user_id:id(2)}],setups:[{employee_id:employeeId,state:'completed'}],
  audits:[{id:id(800),event_type:'invitation.accepted',entity_id:employeeId}]},
  roles:[{id:id(30),permissions:['enterprise.view','attendance.self.view'],version:2}],
  settings:[{merchant_id:site,time_zone:'Europe/Madrid',enabled:true,web_clock_enabled:false,web_break_paid:false,version:2,updated_at:'2026-10-03T00:00:00Z'}],
  locations:[{id:locationId,merchant_id:site,name:'Synthetic place',time_zone:'Europe/Madrid',active:true}],workers:[],periods:[],events:[],
  configOperations:[{merchant_id:site,operation_id:id(900),version:1,command:{kind:'settings'}},{merchant_id:site,operation_id:id(901),version:2,command:{kind:'location'}}]});
const enrollment=()=>{
  const before=base(),after=structuredClone(before),values=worker();
  after.workers=[{id:workerId,merchant_id:site,employee_id:employeeId,worker_no:values.workerNo,display_name:values.displayName,
    default_location_id:locationId,active:true,version:1}];
  after.periods=[{id:id(700),merchant_id:site,worker_id:workerId,starts_on:values.startsOn,ends_on:null}];
  after.settings[0].version=3;after.settings[0].updated_at='2026-10-03T00:00:01Z';
  after.configOperations.push({merchant_id:site,operation_id:operationId,actor_auth_user_id:ownerId,version:3,
    command:{operationId,expectedVersion:2,kind:'worker',values:structuredClone(values)},before_value:null,after_value:structuredClone(values)});
  return {before,after,employeeId,worker:values,operationId,ownerId,receipt:{operationId,version:3,kind:'worker',targetId:workerId}};
};
const firstPunch=()=>{
  const before=enrollment().after;before.settings[0].web_clock_enabled=true;
  const after=structuredClone(before),event={id:id(1002),merchant_id:site,worker_id:workerId,actor_employee_id:employeeId,
    location_id:locationId,operation_id:operationId,action:'clock_in',source:'web',sequence:1,time_zone:'Europe/Madrid',
    occurred_at:'2026-10-03T08:00:00.123000Z',received_at:'2026-10-03T08:00:00.123000Z',break_paid:null};
  after.events=[event];
  // self_v1 emits its millisecond DTO; PostgreSQL may serialize the same raw
  // timestamptz with six fractional digits or an explicit local offset.
  const receipt={id:event.id,siteId:site,workerId,locationId,operationId,action:'clock_in',sequence:1,timeZone:'Europe/Madrid',occurredAt:'2026-10-03T08:00:00.123Z',breakPaid:null};
  const body={ok:true,workerId,locationId,replayed:false,state:{status:'working',sequence:1,lastEvent:structuredClone(receipt)},receipt};
  return {before,after,body,employeeId,operationId};
};
const source=()=>readFileSync(new URL('./merchant-attendance-onboarding-native.mjs',import.meta.url),'utf8');

test('enrollment proof binds one real worker/period and exact owner config receipt without mutating its inputs',()=>{
  const proof=enrollment(),copy=structuredClone(proof);assert.doesNotThrow(()=>assertOnboardingEnrollment(proof));assert.deepEqual(proof,copy);
});

test('enrollment proof rejects pre-existing/extra facts, foreign identity/location, inactive worker, changed name or employment period',()=>{
  const edits=[p=>p.before.workers.push({id:id(202)}),p=>p.before.periods.push({id:id(701)}),
    p=>p.after.workers.push(structuredClone(p.after.workers[0])),p=>p.after.periods.push(structuredClone(p.after.periods[0])),p=>p.after.events.push({id:id(5)}),
    p=>p.after.workers[0].employee_id=id(101),p=>p.after.workers[0].merchant_id='99990002',p=>p.after.workers[0].default_location_id=id(302),
    p=>p.after.workers[0].active=false,p=>p.after.workers[0].display_name='Wrong name',p=>p.after.workers[0].worker_no='Wrong number',
    p=>p.after.periods[0].worker_id=id(202),p=>p.after.periods[0].starts_on='2000-01-02',p=>p.after.periods[0].ends_on='2000-01-02',
    p=>{p.before.enterprise.employees[0].status='invited';p.after.enterprise.employees[0].status='invited';}];
  for(const edit of edits){const proof=enrollment();edit(proof);assert.throws(()=>assertOnboardingEnrollment(proof));}
});

test('enrollment proof rejects hidden settings, old audit, original setup, role or config changes and forged new receipt provenance',()=>{
  const edits=[p=>p.after.settings[0].version=4,p=>p.after.settings[0].web_clock_enabled=true,
    p=>p.after.settings[0].time_zone='UTC',p=>p.after.configOperations[0].version=99,
    p=>p.after.enterprise.setups[0].state='claimed',p=>p.after.enterprise.audits[0].event_type='employee.updated',
    p=>p.after.roles[0].permissions.push('attendance.self.clock'),p=>p.after.enterprise.employees[0].auth_user_id=id(1),
    p=>p.after.configOperations.at(-1).actor_auth_user_id=id(98),p=>p.after.configOperations.at(-1).merchant_id='99990002',
    p=>p.after.configOperations.at(-1).operation_id=id(1003),p=>p.after.configOperations.at(-1).version=4,
    p=>p.after.configOperations.at(-1).command.expectedVersion=1,p=>p.after.configOperations.at(-1).command.values.active=false,
    p=>p.after.configOperations.at(-1).before_value={},p=>p.after.configOperations.at(-1).after_value.displayName='Wrong name',
    p=>p.receipt.operationId=id(1003),p=>p.receipt.version=4,p=>p.receipt.kind='location',p=>p.receipt.targetId=id(202)];
  for(const edit of edits){const proof=enrollment();edit(proof);assert.throws(()=>assertOnboardingEnrollment(proof));}
});

test('first-punch proof uses raw actor_employee_id and binds the actual DTO to one immutable web event',()=>{
  const proof=firstPunch(),copy=structuredClone(proof);assert.doesNotThrow(()=>assertOnboardingFirstPunch(proof));assert.deepEqual(proof,copy);
  assert.equal(Object.hasOwn(proof.after.events[0],'actor_auth_user_id'),false);
  const offset=firstPunch();offset.after.events[0].occurred_at='2026-10-03T10:00:00.123+02:00';
  assert.doesNotThrow(()=>assertOnboardingFirstPunch(offset));
});

test('first-punch proof rejects duplicate/foreign facts, changed configuration and mismatched receipt or current-state identity',()=>{
  const edits=[p=>p.before.events.push({id:id(6)}),p=>p.after.events.push(structuredClone(p.after.events[0])),
    p=>p.after.events[0].actor_employee_id=id(101),p=>p.after.events[0].actor_employee_id=null,
    p=>p.after.events[0].merchant_id='99990002',p=>p.after.events[0].worker_id=id(202),p=>p.after.events[0].location_id=id(302),
    p=>p.after.events[0].operation_id=id(1003),p=>p.after.events[0].action='clock_out',p=>p.after.events[0].source='kiosk',p=>p.after.events[0].sequence=2,
    p=>p.after.settings[0].version++,p=>p.after.enterprise.employees[0].status='disabled',p=>p.after.configOperations.push({}),
    p=>p.body.ok=false,p=>p.body.workerId=id(202),p=>p.body.replayed=true,p=>p.body.state.status='off',p=>p.body.state.sequence=2,
    p=>p.body.state.lastEvent=null,p=>p.body.receipt.id=id(1003),p=>p.body.receipt.operationId=id(1003)];
  for(const edit of edits){const proof=firstPunch();edit(proof);assert.throws(()=>assertOnboardingFirstPunch(proof));}
  // Keep lastEvent internally consistent: the independent raw SQL mapping,
  // rather than just equality between two forged DTO fields, must reject this.
  for(const patch of [{siteId:'99990002'},{workerId:id(202)},{locationId:id(302)},{sequence:2},{timeZone:'UTC'},
    {occurredAt:'2026-10-03T08:00:00.124Z'}]){
    const proof=firstPunch();Object.assign(proof.body.receipt,patch);proof.body.state.lastEvent=structuredClone(proof.body.receipt);
    assert.throws(()=>assertOnboardingFirstPunch(proof));
  }
});

test('source chains actual setup/SDK/accept, owner role/admin and default self executors without active/worker/event seed writes',()=>{
  const text=source();
  for(const name of ['createMerchantEnterpriseInitialPasswordHandler','resolveValidatedMerchantEnterpriseAuthUser','handleAttendanceAdmin','handleAttendanceSelf'])assert(text.includes(name));
  assert.match(text,/handlers=\{admin:request=>handleAttendanceAdmin\(request,\{entitlement\}\),self:request=>handleAttendanceSelf\(request,\{entitlement\}\),role:updateRole,accept\}/);
  assert.match(text,/await sdk\.auth\.signInWithPassword\(\{email:invite\.actor\.email,password\}\)/);
  assert.match(text,/getAuthUserById:model\.getAuthUserById,updateAuthUserById:model\.updateAuthUserById/);
  assert.match(text,/prepared\.onboardingRead,\(actor,value\)=>actor\.id===owner\.id\?value===ownerPassword:actor\.id===invite\.actor\.id&&model\.proof\(\)\.initialized&&model\.passwordMatches\(value\)/);
  assert.doesNotMatch(text,/\b(?:insert into|update|delete from)\s+public\./i);
  assert.doesNotMatch(text,/serveShell|allow:\s*\(\)\s*=>\s*true|execute:\s*(?:async\s*)?\(/);
  assert.match(text,/realBrowser:false,realAuthService:false,realEmail:false,realPhone:false,productionAccess:false/);
});

test('source preserves independent rejects and original config/punch replay instead of counting manufactured responses',()=>{
  const text=source();
  assert.match(text,/before=prepared\.onboardingFacts\(\),result=await call\(kind,token,options\)/);
  assert.match(text,/assert\.equal\(result\.status,status\);assert\.equal\(result\.body\.error,error\);assert\.deepEqual\(prepared\.onboardingFacts\(\),before\)/);
  for(const error of ['employee_password_authentication_required','attendance_employee_invalid','attendance_access_denied','attendance_web_disabled','attendance_platform_paused','attendance_worker_changed','attendance_operation_conflict'])assert(text.includes(`'${error}'`));
  assert.match(text,/query:\{operationId:workerCommand\.operationId\}/);
  assert.match(text,/assert\.deepEqual\(prepared\.onboardingFacts\(\),afterEnrollment\)/);
  assert.match(text,/query:\{operationId:punch\.operationId\}/);
  assert.match(text,/const replayed=await success\('self',employeeToken,\{body:punch\}\)/);
  assert.match(text,/assert\.equal\(replayed\.replayed,true\)/);
  assert.match(text,/body:\{\.\.\.punch,action:'clock_out'\}/);
  assert.match(text,/assert\.deepEqual\(prepared\.onboardingFacts\(\),afterPunch\)/);
  assert.match(text,/no browser network abort or\s*\/\/ client pending-storage behavior is claimed/);
});

test('acceptance and final audit proofs use baseline differences and preserve every pre-existing audit instead of assuming empty audit history',()=>{
  const text=source();
  assert.match(text,/assert\.equal\(acceptedFacts\.enterprise\.audits\.length,setupFacts\.enterprise\.audits\.length\+1\)/);
  assert.match(text,/const acceptanceAudit=acceptedFacts\.enterprise\.audits\.filter\(row=>!setupFacts\.enterprise\.audits\.some\(old=>old\.id===row\.id\)\)/);
  assert.match(text,/assert\.equal\(acceptanceAudit\.length,1\)/);
  assert.match(text,/acceptanceAudit\[0\]\.event_type,'invitation\.accepted'/);
  assert.match(text,/acceptanceAudit\[0\]\.entity_id,invite\.employeeId/);
  assert.match(text,/for\(const row of setupFacts\.enterprise\.audits\)assert\.deepEqual\(acceptedFacts\.enterprise\.audits\.find\(next=>next\.id===row\.id\),row\)/);
  assert.match(text,/assert\.equal\(final\.enterprise\.audits\.length,initial\.enterprise\.audits\.length\+3\)/);
  assert.match(text,/const newAudits=final\.enterprise\.audits\.filter\(row=>!initial\.enterprise\.audits\.some\(old=>old\.id===row\.id\)\)/);
  assert.match(text,/assert\.equal\(newAudits\.length,3\)/);
  assert.match(text,/newAudits\.filter\(row=>row\.event_type==='role\.updated'\)\.length,2/);
  assert.match(text,/newAudits\.filter\(row=>row\.event_type==='invitation\.accepted'\)\.length,1/);
  assert.match(text,/for\(const row of initial\.enterprise\.audits\)assert\.deepEqual\(final\.enterprise\.audits\.find\(next=>next\.id===row\.id\),row\)/);
  assert.doesNotMatch(text,/assert\.equal\((?:acceptedFacts|final)\.enterprise\.audits\.length,\s*(?:1|3)\s*\)/);
  assert.doesNotMatch(text,/final\.enterprise\.audits\.filter\(row=>row\.event_type==='(?:role\.updated|invitation\.accepted)'\)/);
});

test('owner exception remains exact token/method/path scoped, and cleanup restores fetch/environment without logging credentials',()=>{
  const text=source();
  assert.match(text,/ownerToken=await protocol\.login\(owner\),protocolFetch=globalThis\.fetch/);
  assert.match(text,/url\.origin===authOrigin&&url\.pathname==='\/auth\/v1\/user'&&request\.method==='GET'\s*&&request\.headers\.get\('authorization'\)==='Bearer '\+ownerToken\)return protocolFetch\(request\)/);
  assert.match(text,/return bridge\.fetch\(request\)/);
  assert.match(text,/finally\{sdk\.auth\.stopAutoRefresh\(\);globalThis\.fetch=protocolFetch;\}/);
  assert.match(text,/finally\{if\(savedMode===undefined\)delete process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;/);
  assert.match(text,/requests\.push\(\{kind,method,status:response\.status,error:result\.error\?\?null\}\)/);
  assert.doesNotMatch(text,/console\.(?:log|error)\((?:error|input|invite|model|employeeToken|ownerToken|initial|final)/);
  // A source line extracted from this script's own stack frame is safe; the
  // diagnostic must not emit the original message, stack or exception object.
  assert(text.includes("const sourceLine=String(error?.stack??'').match(/merchant-attendance-onboarding-native\\.mjs:(\\d+):\\d+/)?.[1]??null;"));
  assert.match(text,/console\.error\(JSON\.stringify\(\{attendanceOnboardingFailed:true,phase,sourceLine,requests\}\)\)/);
  assert.doesNotMatch(text,/console\.(?:log|error)\([^\n]*(?:error\??\.(?:stack|message)|String\(error)/);
  assert.match(text,/process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)/);
});
