// Pure oracle/source checks. Importing this module must not start a browser,
// harness or database; actual Portal/SQL acceptance is run separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertInitialPasswordPortalPending,assertInitialPasswordPortalReplay} from './merchant-attendance-initial-password-portal-browser-check.mjs';

const authId='00000000-0000-4000-8000-000000000002';
const operationId='20000000-0000-4000-8000-000000000001';
const invite=()=>({actor:{id:authId},version:7,token:'A'.repeat(43)});
const pending=()=>({attemptId:'10000000-0000-4000-8000-000000000001',authUserId:authId,
  createdAt:1791000000000,initialPasswordOperationId:operationId,
  invitationVersion:7,invitationToken:invite().token,stage:'password_pending'});
const receipt=()=>[{employee_id:'employee',operation_id:operationId,state:'completed',completed_at:'2026-10-03T01:02:03.123456Z'}];
const replay=()=>({records:[{path:'/api/merchant-enterprise/invitations/initial-password',method:'POST',status:200,operationId,
  originalCredentials:true,originalPassword:true,factsUnchanged:true,passwordUpdatesDelta:0,
  rpcNames:['faolla_claim_merchant_employee_initial_password_setup_v1']}],operationId,
  authProof:{updates:1,initialized:true},before:receipt(),after:receipt()});
const source=()=>readFileSync(new URL('./merchant-attendance-initial-password-portal-browser-check.mjs',import.meta.url),'utf8');

test('password-pending proof accepts the exact natural handoff and does not mutate either snapshot',()=>{
  const stored=pending(),prior=pending();
  assert.doesNotThrow(()=>assertInitialPasswordPortalPending(stored,invite()));
  assert.doesNotThrow(()=>assertInitialPasswordPortalPending(stored,invite(),prior));
  assert.deepEqual(stored,pending());assert.deepEqual(prior,pending());
});

test('password-pending proof rejects malformed, consumed, unbound or secret-bearing storage',()=>{
  const missing=pending();delete missing.initialPasswordOperationId;
  for(const value of [null,undefined,[],{},missing,{...pending(),newPassword:'synthetic-secret'},
    {...pending(),stage:'accept_pending'},{...pending(),stage:'exchange_pending'},
    {...pending(),authUserId:null},{...pending(),authUserId:'00000000-0000-4000-8000-000000000001'},
    {...pending(),invitationVersion:8},{...pending(),invitationToken:'B'.repeat(43)},
    {...pending(),initialPasswordOperationId:null},{...pending(),initialPasswordOperationId:'not-a-uuid'},
    {...pending(),attemptId:'10000000-0000-1000-8000-000000000001'},
    {...pending(),createdAt:0},{...pending(),createdAt:1.5},{...pending(),createdAt:Number.MAX_SAFE_INTEGER+1}])
    assert.throws(()=>assertInitialPasswordPortalPending(value,invite()));
});

test('valid replacement IDs or timestamps cannot masquerade as continuity of the original attempt',()=>{
  for(const change of [{attemptId:'30000000-0000-4000-8000-000000000001'},
    {initialPasswordOperationId:'40000000-0000-4000-8000-000000000001'},{createdAt:pending().createdAt+1}])
    assert.throws(()=>assertInitialPasswordPortalPending({...pending(),...change},invite(),pending()));
  for(const change of [{authUserId:'00000000-0000-4000-8000-000000000001'},
    {invitationVersion:8},{invitationToken:'B'.repeat(43)}])
    assert.throws(()=>assertInitialPasswordPortalPending(pending(),invite(),{...pending(),...change}));
});

test('completed replay proof accepts one claim-only request with unchanged SQL receipt and one lifetime Auth mutation',()=>{
  const proof=replay();assert.doesNotThrow(()=>assertInitialPasswordPortalReplay(proof));
  assert.deepEqual(proof,replay());
});

test('replay proof rejects missing, duplicated, foreign or unconfirmed requests and any non-original credentials',()=>{
  const valid=replay();
  for(const records of [[],[valid.records[0],valid.records[0]]])
    assert.throws(()=>assertInitialPasswordPortalReplay({...replay(),records}));
  for(const change of [{path:'/api/merchant-enterprise/employees/accept'},{status:null},{status:503},
    {operationId:'40000000-0000-4000-8000-000000000001'},{originalCredentials:false},
    {originalCredentials:undefined},{originalPassword:false},{originalPassword:undefined}])
    assert.throws(()=>assertInitialPasswordPortalReplay({...replay(),records:[{...valid.records[0],...change}]}));
});

test('replay proof rejects hidden SQL mutations, another password write and complete/release RPCs',()=>{
  for(const change of [{factsUnchanged:false},{factsUnchanged:undefined},{passwordUpdatesDelta:1},
    {passwordUpdatesDelta:undefined},{rpcNames:[]},
    {rpcNames:['faolla_claim_merchant_employee_initial_password_setup_v1','faolla_complete_merchant_employee_initial_password_setup_v1']},
    {rpcNames:['faolla_release_merchant_employee_initial_password_setup_v1']}])
    assert.throws(()=>assertInitialPasswordPortalReplay({...replay(),records:[{...replay().records[0],...change}]}));
  for(const authProof of [{updates:0,initialized:true},{updates:2,initialized:true},{updates:1,initialized:false}])
    assert.throws(()=>assertInitialPasswordPortalReplay({...replay(),authProof}));
  for(const after of [[],[{...receipt()[0],state:'claimed'}],[{...receipt()[0],completed_at:'2026-10-03T01:02:03.123457Z'}]])
    assert.throws(()=>assertInitialPasswordPortalReplay({...replay(),after}));
});

test('runner uses the real Portal, setup factory, SDK protocol and SQL patch without manufacturing stored state or business facts',()=>{
  const text=source();
  assert.match(text,/attendance-self-browser-harness\.mjs','--portal'/);
  assert.match(text,/createMerchantEnterpriseInitialPasswordHandler\(\{resolveAuthUser:resolveValidatedMerchantEnterpriseAuthUser/);
  assert.match(text,/loadInvitation:prepared\.loadInvitation,loadRole:prepared\.loadRole,loadStaffIdentity:prepared\.loadStaffIdentity/);
  assert.match(text,/prepared\.initialPasswordRpc\(/);
  assert.match(text,/applyInitialPasswordReplayFixture\(native,scope,prepared\)/);
  assert.match(text,/response=await accept\(request\)/);assert.match(text,/response=await overview\(request\)/);
  assert.match(text,/protocol\.issue\(invite\.actor,\['invite'\]\)/);
  assert.doesNotMatch(text,/sessionStorage\.(?:setItem|removeItem|clear)\s*\(/);
  assert.doesNotMatch(text,/\b(?:update|insert into|delete from)\s+public\./i);
  assert.match(text,/modeledSharedPasswordState:true,injectedSetupReads:true,defaultSetupDependencies:false,realAuthService:false/);
  assert.match(text,/realNextServer:false,productionAccess:false,externalRequests:0/);
});

test('setup response loss occurs after actual execution and immutable replay proof is captured before any browser-driven acceptance',()=>{
  const text=source(),call=text.indexOf('response=await handleSetup(request);');
  const facts=text.indexOf('record.factsUnchanged=isDeepStrictEqual(prepared.facts(),setupBefore);',call);
  const updates=text.indexOf('record.passwordUpdatesDelta=model.proof().updates-updatesBefore;',call);
  const loss=text.indexOf("if(url.pathname===setupPath&&response.status===200&&dropSetup)");
  assert(call>=0&&facts>call&&updates>call&&loss>facts&&loss>updates);
  assert.match(text,/setupBefore=prepared\.facts\(\),updatesBefore=model\.proof\(\)\.updates/);
  assert.match(text,/dropSetup=false;record\.dropped=true;return route\.abort\('connectionreset'\)/);
  assert.match(text,/if\(url\.pathname===acceptPath&&response\.status===200&&dropAccept\)/);
  assert.match(text,/assertInitialPasswordPortalReplay\(\{records:replayed,operationId:originalPending\.initialPasswordOperationId/);
  assert.match(text,/before:completed\.setups,after:afterAccept\.setups/);
});

test('new-password SDK authentication is tied to the same updated model and not the legacy fixed password fixture',()=>{
  const text=source();
  assert.match(text,/password='Synthetic-new-staff-only!2026'/);
  assert.match(text,/createInitialPasswordAuthBridge\(protocolFetch,invite\.actor,model\)/);
  assert.match(text,/getAuthUserById:model\.getAuthUserById,updateAuthUserById:model\.updateAuthUserById/);
  assert.match(text,/prepared\.read,\(actor,value\)=>actor\.id===invite\.actor\.id&&model\.proof\(\)\.initialized&&model\.passwordMatches\(value\)/);
  assert.match(text,/bridge\.proof\(\)\.passwordAccepted>0,'initial_password_new_login_required_before_accept'/);
  assert.match(text,/assert\.equal\(bridge\.proof\(\)\.passwordAccepted,1\)/);
  assert.match(text,/row\.path==='\/auth\/v1\/logout'&&row\.method==='POST'/);
  assert.doesNotMatch(text,/Synthetic-attendance-only!/);
});

test('reload proves empty passwords, identical durable operation, no automatic submission and independently preserved non-target facts',()=>{
  const text=source(),start=text.indexOf("phase='reload-empty-passwords'"),end=text.indexOf("phase='original-completed-request-retry'",start);
  assert(start>=0&&end>start);const reload=text.slice(start,end);
  assert.match(reload,/await page\.reload\(\)/);
  assert.match(reload,/assertInitialPasswordPortalPending\(await stored\(\),invite,originalPending\)/);
  for(const label of ['新密码','确认新密码'])assert(reload.includes(`getByLabel('${label}',{exact:true}).inputValue(),'')`));
  assert.match(reload,/\.isDisabled\(\)/);assert.match(reload,/assert\.equal\(requests\.length,beforeRequests\)/);
  assert.match(reload,/assert\.deepEqual\(prepared\.facts\(\),completed\)/);
  assert.match(text,/initial\.employees\.filter\(row=>row\.id!==invite\.employeeId\)/);
  assert.match(text,/for\(const row of initial\.audits\)assert\.deepEqual/);
  assert.match(text,/newAudit\[0\]\.event_type,'invitation\.accepted'/);
  assert.match(text,/prepared\.protectedFingerprint\(\),baseline/);
});

test('closed routing and safe diagnostics exclude external access, cookies, credentials and raw error output',()=>{
  const text=source();
  assert.match(text,/if\(url\.origin!==origin\)\{external\.push\('external_request'\);return route\.abort\(\);\}/);
  assert.match(text,/assert\.equal\(headers\.get\('cookie'\),null\)/);
  assert(text.includes("assert(['/enterprise/'+site,'/harness.js','/harness.css'].includes(url.pathname))"));
  assert.match(text,/assert\.deepEqual\(external,\[\]\)/);
  assert.match(text,/requests:requests\.map\(\(\{path,method,status,error\}\)=>\(\{path,method,status,error\}\)\)/);
  assert.doesNotMatch(text,/console\.(?:log|error)\((?:error|input|invite|stored|model|callbackToken|originalPending)/);
  assert.doesNotMatch(text,/error\.(?:stack|message)|page\.content\(\)|innerHTML|outerHTML/);
  assert.match(text,/process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)/);
});

test('browser/routes close inside the Auth boundary and finally restores fetch plus environment even when cleanup rejects',()=>{
  const text=source(),start=text.indexOf('await withAttendanceApplicationAuth('),end=text.indexOf('},undefined,prepared.read,',start);
  assert(start>=0&&end>start);const body=text.slice(start,end),cleanup=body.slice(body.lastIndexOf('}finally{'));
  // Fetch restoration is nested inside the outer auth callback cleanup.
  assert.match(body,/closing=true;\s*try\{await runAttendanceCleanupSteps/);
  assert.match(body,/name:'auth-owned-browser',run:\(\)=>browser\?\.close\(\)/);
  assert.match(body,/name:'auth-owned-routes',run:\(\)=>Promise\.allSettled\(\[\.\.\.pendingRoutes\]\)/);
  assert.match(cleanup,/globalThis\.fetch=protocolFetch/);
  assert.match(text,/if\(closing\)return route\.abort\(\)/);
  assert.match(text.slice(end),/name:'harness',timeoutMs:10000/);
  assert.match(text.slice(end),/finally\{if\(savedMode===undefined\)delete process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;/);
});
