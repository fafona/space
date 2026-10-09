import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {runDelegationRecoveryBrowserAcceptance,delegationRecoveryBrowserPending,delegationRecoveryBrowserAuthSource,cleanupDelegationRecoveryBrowser} from './attendance-delegation-recovery-browser.mjs';
const source=readFileSync(new URL('./attendance-delegation-recovery-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-delegation-recovery-browser.tsx',import.meta.url),'utf8');
const id=n=>`19100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function seed(){const query={siteId:'99191001',access:'delegate',mode:'decide',grantId:id(1),requestId:id(2),operationId:null,beforeAt:null,beforeId:null,afterId:null};
  const command={grantId:id(1),expectedGrantRevision:1,expectedEvidenceFingerprint:'a'.repeat(64),decision:{action:'approve',operationId:id(3),requestId:id(2),expectedRevision:1,reason:'Synthetic original private reason'}};
  const receipt={operationId:id(3),requestId:id(2),grantId:id(1),category:'leave',action:'approve',status:'approved',actorId:id(4),recordedAt:'2026-10-06T10:00:00.000000Z',commandFingerprint:'b'.repeat(64)};
  return {site:query.siteId,delegateAuth:id(4),delegateEmployee:id(5),approved:{query,command,receipt,recovery:{...query,mode:'recover',grantId:null,requestId:null,operationId:id(3)}}};}
test('inert import/callback rejects missing owned context before browser or role mutation',async()=>{
  let changed=false;await assert.rejects(runDelegationRecoveryBrowserAcceptance({roleWithoutSelf(){changed=true;}}),/dependencies/);assert.equal(changed,false);
  assert.doesNotMatch(source,/initdb|pg_ctl|writeFile|mkdir|screenshot\(/);assert.match(source,/bundle:true,write:false/);assert.match(source,/scope\?\.schema===d.owned.schema/);
});
test('lost-response seed retains exact actual intent and receipt binding, not a fake completed UI result',()=>{
  const input=seed(),original=JSON.stringify(input),p=delegationRecoveryBrowserPending(input),raw=JSON.parse(p.raw);
  assert.equal(JSON.stringify(input),original);assert.deepEqual(Object.keys(raw),['version','anchorId','actorId','employeeId','query','command','commandFingerprint']);
  assert.deepEqual(raw.command,input.approved.command);assert.deepEqual(raw.query,input.approved.query);assert.equal(raw.actorId,input.delegateAuth);assert.equal(raw.employeeId,input.delegateEmployee);
  assert.equal(p.key,`faolla:attendance:application-delegation:v1:${input.site}:delegate:${input.delegateEmployee}`);assert(!('receipt' in raw));
  for(const mutate of [s=>s.approved.receipt.actorId=id(99),s=>s.approved.receipt.operationId=id(99),s=>s.approved.receipt.requestId=id(99),s=>s.approved.recovery.operationId=id(99),s=>s.approved.query.siteId='00000000']){
    const bad=seed();mutate(bad);assert.throws(()=>delegationRecoveryBrowserPending(bad));}
});
test('synthetic session identity and remote getUser failure are independent and neither permits auth writes',async()=>{
  for(const mode of ['correct','wrong','failed']){const auth=mode==='wrong'?id(9):id(4),probe={getUser:0,getSession:0};
    const authStub=runInNewContext(delegationRecoveryBrowserAuthSource.replace(/\bexport /g,'')+';({merchantEnterpriseSupabase,signInEnterpriseWithPassword,signOutEnterpriseSession});',
      {window:{__delegationRecoverySeed:{mode,auth,token:'test-token'},__delegationRecoveryProbe:probe}});
    const local=await authStub.merchantEnterpriseSupabase.auth.getSession();assert.equal(local.data.session.user.id,auth);
    const verified=await authStub.merchantEnterpriseSupabase.auth.getUser('test-token');assert.equal(verified.data.user?.id??null,mode==='failed'?null:auth);assert.equal(Boolean(verified.error),mode==='failed');
    assert.deepEqual(probe,{getUser:1,getSession:1});assert.throws(()=>authStub.signInEnterpriseWithPassword(),/write_forbidden/);assert.throws(()=>authStub.signOutEnterpriseSession(),/write_forbidden/);
    await assert.rejects(authStub.merchantEnterpriseSupabase.auth.getUser('wrong-token'),/token_mismatch/);}
});
test('actual selector link leads to actual route wrapper via same-tab navigation, never direct panel-only mounting',()=>{
  for(const text of ['src/app/enterprise/EnterpriseSelectorClient','src/app/enterprise/attendance-recovery/page','<RecoveryRoute/>','<EnterpriseSelectorClient/>'])assert(entry.includes(text),text);
  assert(!entry.includes('MerchantAttendanceDelegationRecoveryPanel'));
  for(const text of ["selectorPath='/enterprise',recoveryPath='/enterprise/attendance-recovery'",'assert.equal(await link.getAttribute(\'href\'),recoveryPath)',
    'page.waitForURL(origin+recoveryPath),link.click()','assert.equal(context.pages().length,1)',"getByRole('button',{name:'无法进入'",'actualSelectorAndRecoveryPage:true','nextLinkNativeAnchorShim:true'])assert(source.includes(text),text);
});
test('restricted role, original GET only, private receipt filtering, auth refusal and full read-only fingerprints are witnessed',()=>{
  for(const text of ['await roleWithoutSelf(async()=>','const restrictedFacts=d.fingerprint()',"assert.equal(request.method(),'GET','delegation_recovery_zero_post')",'assert.equal(url.origin,origin',
    'approved.recovery','await handle(new Request(canonical+url.pathname+url.search',"),'delegate',false)",'assert.deepEqual(body.receipt,approved.receipt)','assert.equal(body.detail,null)',
    "['correct','wrong','failed']",'approved.command.decision.reason','delegation_recovery_receipt_disclosed_private_context',"mode==='correct'?null:pending.raw",
    'assert.equal(d.fingerprint(),originalFacts','assert.deepEqual(d.inventory(),inventory)','assert.equal(delegationRequests().length,1)','originalRecoveryGets:1','posts:0',
    'getUserFailurePendingHidden:true','pendingPreservedOnAuthFailures:true','document.documentElement.scrollWidth>innerWidth+2'])assert(source.includes(text),text);
});
test('cleanup attempts later owned resources and preserves the primary failure; tuple/string shape is rejected',async()=>{
  const calls=[],primary=Error('original failure');await assert.rejects(cleanupDelegationRecoveryBrowser([
    {name:'first',run:()=>{calls.push('first');throw Error('teardown failure');}},{name:'second',run:()=>{calls.push('second');}},
  ],primary),error=>error instanceof AggregateError&&error.cause===primary&&error.errors[0]===primary);assert.deepEqual(calls,['first','second']);
  await assert.rejects(cleanupDelegationRecoveryBrowser([['tuple',()=>{}]]),/cleanup_shape/);await assert.rejects(cleanupDelegationRecoveryBrowser('label'),/cleanup_shape/);
  for(const text of ["{name:'delegation recovery inflight',run:","{name:'delegation recovery contexts',run:","{name:'delegation recovery browser',run:",
    "{name:'delegation recovery HTTP listener',run:","{name:'delegation recovery esbuild service',run:",'closeAllConnections?.()','],failure)'])assert(source.includes(text),text);
});
