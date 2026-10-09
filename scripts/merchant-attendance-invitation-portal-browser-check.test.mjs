// Pure proof/source checks only. Importing the runner must not start its CLI,
// browser, harness or database. The real Portal/SQL acceptance is run separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertInvitationPortalPreserved,assertInvitationPortalAccountRejected} from './merchant-attendance-invitation-portal-browser-check.mjs';

const actor='00000000-0000-4000-8000-000000000001';
const expected=()=>({actor:{id:actor},version:7,token:'A'.repeat(43)});
const prior=()=>({attemptId:'10000000-0000-4000-8000-000000000001',authUserId:actor,
  createdAt:1791000000000,initialPasswordOperationId:'20000000-0000-4000-8000-000000000001',
  invitationVersion:7,invitationToken:expected().token,stage:'password_pending'});
const pending=()=>({...prior(),initialPasswordOperationId:null,stage:'accept_pending'});
const rejected=()=>({stored:prior(),prior:prior(),sdkAccounts:['00000000-0000-4000-8000-000000000002'],
  passwordSubject:'00000000-0000-4000-8000-000000000002',expectedAccount:'00000000-0000-4000-8000-000000000002',
  apiAttempts:[{path:'/api/merchant-enterprise/invitations/initial-password',method:'POST'}],workspaceVisible:false,
  beforeFacts:{employees:[{id:'employee',status:'invited'}],audits:[],setups:[]},
  afterFacts:{employees:[{id:'employee',status:'invited'}],audits:[],setups:[]}});
const source=()=>readFileSync(new URL('./merchant-attendance-invitation-portal-browser-check.mjs',import.meta.url),'utf8');

test('pending proof permits only the password-to-accept stage transition while retaining the original handoff',()=>{
  const original=prior(),value=pending();
  assert.doesNotThrow(()=>assertInvitationPortalPreserved(value,expected(),original));
  assert.deepEqual(original,prior());assert.deepEqual(value,pending());
  assert.doesNotThrow(()=>assertInvitationPortalPreserved(value,expected()));
});

test('pending proof rejects absent handoff, wrong stage, actor, generation, bearer and a retained password operation',()=>{
  for(const value of [null,undefined,{}, {...pending(),stage:'password_pending'}, {...pending(),stage:'exchange_pending'},
    {...pending(),authUserId:'00000000-0000-4000-8000-000000000002'},
    {...pending(),invitationVersion:8},{...pending(),invitationToken:'B'.repeat(43)},
    {...pending(),initialPasswordOperationId:prior().initialPasswordOperationId},
    {...pending(),attemptId:'not-an-attempt'},{...pending(),createdAt:1.25}])
    assert.throws(()=>assertInvitationPortalPreserved(value,expected(),prior()));
});

test('a new well-formed attempt or creation time is not proof that the original invitation survived a failed reply',()=>{
  assert.throws(()=>assertInvitationPortalPreserved({...pending(),attemptId:'30000000-0000-4000-8000-000000000001'},expected(),prior()));
  assert.throws(()=>assertInvitationPortalPreserved({...pending(),createdAt:prior().createdAt+1},expected(),prior()));
});

test('prior account, generation and bearer must also match rather than being silently replaced by the current expected fixture',()=>{
  for(const change of [{authUserId:'00000000-0000-4000-8000-000000000002'},
    {invitationVersion:8},{invitationToken:'B'.repeat(43)}])
    assert.throws(()=>assertInvitationPortalPreserved(pending(),expected(),{...prior(),...change}));
});

test('account rejection proof permits an actual different SDK login only when original handoff, SQL facts and private UI remain unchanged',()=>{
  const input=rejected();assert.doesNotThrow(()=>assertInvitationPortalAccountRejected(input));
  assert.deepEqual(input,rejected());
  assert.doesNotThrow(()=>assertInvitationPortalAccountRejected({...input,stored:pending(),prior:pending()}));
});

test('account rejection proof rejects transient alerts with wrong SDK identity, consumed or changed handoff, private UI or database mutations',()=>{
  for(const patch of [{stored:null},{prior:null},{prior:{...prior(),authUserId:null}},
    {stored:{...prior(),stage:'accept_pending',initialPasswordOperationId:null}},
    {stored:{...prior(),attemptId:'30000000-0000-4000-8000-000000000001'}},
    {stored:{...prior(),unexpected:true}},{sdkAccounts:[]},{sdkAccounts:[actor]},
    {sdkAccounts:[rejected().expectedAccount,actor]},{passwordSubject:actor},{expectedAccount:actor},
    {workspaceVisible:true},{afterFacts:{...rejected().afterFacts,audits:[{id:'new-audit'}]}}])
    assert.throws(()=>assertInvitationPortalAccountRejected({...rejected(),...patch}));
});

test('even an unfinished accept or overview request invalidates the rejection proof regardless of eventual HTTP status',()=>{
  for(const path of ['/api/merchant-enterprise/employees/accept','/api/merchant-enterprise/overview'])
    for(const row of [{path,method:'POST'},{path,method:'GET',status:403},{path,method:'GET',status:200}])
      assert.throws(()=>assertInvitationPortalAccountRejected({...rejected(),apiAttempts:[row]}));
});

test('browser source uses actual Portal and handlers and never manufactures a stored invitation or active employee',()=>{
  const text=source();
  assert.match(text,/attendance-self-browser-harness\.mjs','--portal'/);
  assert.match(text,/employees\/accept\/route-handler\.ts/);
  assert.match(text,/merchant-enterprise\/overview\/route-handler\.ts/);
  assert.match(text,/reply=await accept\(request\)/);assert.match(text,/reply=await overview\(request\)/);
  assert.match(text,/auth\.issue\(invite\.actor,\['invite'\]\)/);
  assert.match(text,/new URLSearchParams\(\{iv:String\(invite\.version\),it:invite\.token,access_token:/);
  assert.match(text,/employee_password_already_initialized/);
  assert.match(text,/realPasswordSetup:false/);assert.match(text,/realAuthService:false,realEmail:false/);
  assert.doesNotMatch(text,/sessionStorage\.(?:setItem|removeItem|clear)\s*\(/);
  assert.doesNotMatch(text,/\b(?:update|insert into|delete from)\s+public\./i);
});

test('response loss happens only after the real successful handler and every recovery preserves independent SQL facts',()=>{
  const text=source(),handle=text.indexOf('reply=await accept(request)'),drop=text.indexOf("state.dropNextSuccess=false;record.dropped=true;return route.abort('connectionreset')");
  assert(handle>=0&&drop>handle);assert.match(text,/url\.pathname===endpoint&&reply\.status===200&&state\.dropNextSuccess/);
  assert.match(text,/assert\.deepEqual\(prepared\.facts\(\),committedA\)/);
  assert.match(text,/assert\.deepEqual\(prepared\.facts\(\),committedB\)/);
  assert.match(text,/readFailures>0/);assert.match(text,/row\.status===503/);
  assert.match(text,/prepared\.protectedFingerprint\(\),baseline/);
  assert.match(text,/assert\.deepEqual\(external,\[\]\)/);
  assert.doesNotMatch(text,/console\.(?:log|error)\((?:error|args|input|tokens|invitations|committed)/);
});

test('cross-account rejection waits for idle login text and a cleared password, not an enabled submit button or transient warning',()=>{
  const text=source(),start=text.indexOf('const rejectOtherAccount='),end=text.indexOf('const firstAuditCount=',start);
  assert(start>=0&&end>start);const section=text.slice(start,end);
  assert.match(section,/url\.pathname==='\/auth\/v1\/token'&&url\.searchParams\.get\('grant_type'\)==='password'/);
  assert(section.indexOf('const signedIn=')<section.indexOf('await login(page,wrongAccount)'));
  assert(section.indexOf('(await signedIn).status(),200')<section.indexOf('await idleLogin.waitFor()'));
  assert.match(section,/getByRole\('button',\{name:'登录企业工作台',exact:true\}\);await idleLogin\.waitFor\(\)/);
  assert.match(section,/getByLabel\('密码',\{exact:true\}\)\.inputValue\(\),''/);
  assert.match(section,/assert\(await idleLogin\.isDisabled\(\)/);
  assert(section.indexOf('idleLogin.isDisabled()')<section.indexOf('请使用该邀请已验证的员工账号登录后重试。'));
  assert.doesNotMatch(section,/\.isEnabled\(|!button\.disabled/);
  assert.match(section,/assertInvitationPortalAccountRejected\(/);
  assert.match(section,/key\.endsWith\('-enterprise-auth-token'\)/);
  assert.match(section,/apiAttempts:apiAttempts\.filter\(row=>row\.page===state\.label\)/);
  assert(text.indexOf('apiAttempts.push(')<text.indexOf('reply=await accept(request)'));
  assert.match(text,/rejectOtherAccount\(otherPending,b,originalOtherPending,beforeOtherPending\)/);
  assert.match(text,/rejectOtherAccount\(changed,b,originalChanged,beforeChanged\)/);
  assert.doesNotMatch(text,/DIAGNOSTIC:|accountBindingDefectReproduced|wrongInvitedAccountClearsHandoff/);
});

test('rejection diagnostics distinguish only fixed safe stages without logging SDK storage, DOM, credentials or raw errors',()=>{
  const text=source(),start=text.indexOf('const rejectOtherAccount='),end=text.indexOf('const firstAuditCount=',start);
  const section=text.slice(start,end);
  for(const stage of ['password-login','sdk-response','busy-settled','password-cleared','login-heading','binding-message','sdk-storage','handoff-api-facts-oracle','protected-fingerprint','complete'])
    assert(section.includes(`phase=rejectionPhase+':${stage}'`));
  assert.doesNotMatch(section,/console\.|innerHTML|outerHTML|textContent|\.url\(\).*console|error\.(?:message|stack)/);
  assert.match(text,/invitationPortalFailed:true,phase,routeErrors:errors\.length/);
  const storageSource=readFileSync(new URL('../src/lib/merchantEnterpriseSupabase.ts',import.meta.url),'utf8');
  assert.match(storageSource,/replace\(\/-auth-token\$\/, "-enterprise-auth-token"\)/);
  assert.match(storageSource,/"faolla-enterprise-auth-token"/);
});

test('the blocked C invitation can be accepted by C in the same document with exactly one original-credential request and one additional audit',()=>{
  const text=source(),start=text.indexOf("phase='correct-account-same-page'"),end=text.indexOf('assert.deepEqual(external,[])',start);
  assert(start>=0&&end>start);const section=text.slice(start,end);
  assert.match(section,/await login\(changed\.page,c\);await workspace\(changed\.page,c,'changed'\)/);
  assert.match(section,/performance\.timeOrigin\),changedDocument/);
  assert.match(section,/assert\.equal\(acceptsC\.length,1\)/);
  assert.match(section,/acceptsC\[0\]\.originalCredentials,true/);
  assert.match(section,/acceptsC\[0\]\.authSubject,c\.actor\.id/);
  assert.match(section,/acceptsC\[0\]\.employeeId,c\.employeeId/);
  assert.match(section,/completed\.audits\.length,firstAuditCount\+3/);
  assert.match(text,/accountBindingPassed:true,wrongInvitedAccountRejected:true,wrongActiveAccountRejected:true,correctAccountSamePageAccepted:true,addedAcceptanceAudits:3/);
});

test('browser and pending routes shut down inside the Auth lifetime and unrelated environment restoration survives cleanup failure',()=>{
  const text=source(),authStart=text.indexOf('await withAttendanceApplicationAuth('),authEnd=text.indexOf('},undefined,read);',authStart);
  assert(authStart>=0&&authEnd>authStart);const authBody=text.slice(authStart,authEnd);
  const closing=authBody.lastIndexOf('closing=true;');
  assert(closing>authBody.indexOf('correctAccountSamePageAccepted:true'));
  assert.match(authBody.slice(closing),/name:'auth-owned-browser',run:\(\)=>browser\?\.close\(\)/);
  assert.match(authBody.slice(closing),/name:'auth-owned-routes',run:\(\)=>Promise\.allSettled\(\[\.\.\.pendingRoutes\]\)/);
  assert.match(text.slice(authEnd),/try\{await runAttendanceCleanupSteps\(/);
  assert.match(text.slice(authEnd),/finally\{if\(savedMode===undefined\)delete process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process\.env\.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;/);
  assert.match(text,/if\(closing\)return route\.abort\(\)/);
});
