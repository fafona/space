import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runApplicationDelegationBrowserAcceptance,cleanupApplicationDelegationBrowser} from './attendance-application-delegation-browser.mjs';
const source=readFileSync(new URL('./attendance-application-delegation-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-application-delegation-browser.tsx',import.meta.url),'utf8');
test('inert callback requires owned context before creating any applications or runtime',async()=>{
  let called=false;await assert.rejects(runApplicationDelegationBrowserAcceptance({submit(){called=true;}}));assert.equal(called,false);
  assert.doesNotMatch(source,/initdb|pg_ctl|writeFile|mkdir|screenshot\(/);assert.match(source,/bundle:true,write:false/);assert.match(source,/url.origin,origin/);assert.match(source,/scope.schema===d.owned.schema/);
});
test('actual parent entries use only explicit synthetic old GET initialization and real delegated SQL',()=>{
  for(const text of ['<SelfPanel','<AdminPanel','applicationDelegationEnabled={enabled}','missingDelegationEnabled={false}','credentials: "omit"'])assert(entry.includes(text),text);
  for(const text of ['workArrangementParentMock','await handle(new Request(canonical+url.pathname+url.search',"await submit('leave')","submit('work_arrangement','remote')",'preparedRealSelfRequests:3',
    'actualHandlerServiceSql:true','parentInitializationSynthetic:true','actualAdminAndSelfParents:true','newRequests().length<40','requests.length<60'])assert(source.includes(text),text);
});
test('separate grants require actual catalog choices, explicit kind and affirmative historical access',()=>{
  for(const text of ["createGrant('leave',true)","createGrant('work_arrangement')","getByLabel('包含此前仍待审申请'","getByLabel('确认历史待审授权'","getByLabel('授权远程审批'",
    'assert.equal(command.includePending,true)',"category==='leave'?[]:['remote']",'getByLabel(\'确认申请审批委托\',',"isDisabled(),true",'historyDefaultOffAndExplicitConsent:true'])assert(source.includes(text),text);
});
test('actual decisions have response gates and lost reply can only recover original receipt',()=>{
  for(const text of ['page.waitForResponse','await response.finished()',"action:'approve'",'dropPost=true',"stage='flagoff_minimal_recovery';serverEnabled=false",'assert.equal(newRequests().length,beforeReload)',
    'assert.equal(posts().length,postCount)','includes(privateReason)',"oldRead(category,item.requestId)","oldRead('leave',rejected.requestId)","window.dispatchEvent(new Event('focus'))",
    'recoveredReceiptSurvivesFocus:true','settledEntryDisappearsOnClose:true','readOnlyGetFingerprints:true','independentOuterRecoveryNotCovered:true'])assert(source.includes(text),text);
  assert.match(source,/state:'detached'/);assert.match(source,/dialog_failed:/);assert.match(source,/element.scrollWidth>element.clientWidth\+2/);
});
test('cleanup attempts every owned resource and preserves original failure rather than masking it',async()=>{
  const calls=[],primary=Error('acceptance failure');await assert.rejects(cleanupApplicationDelegationBrowser([
    {name:'one',run:()=>{calls.push('one');throw Error('cleanup failure');}},{name:'two',run:()=>{calls.push('two');}},
  ],primary),error=>error instanceof AggregateError&&error.errors[0]===primary&&error.cause===primary);assert.deepEqual(calls,['one','two']);
  await assert.rejects(cleanupApplicationDelegationBrowser([['bad shape',()=>{}]]),/cleanup_shape/);
  for(const text of ["{name:'application delegation inflight',run:","{name:'application delegation context',run:","{name:'application delegation browser',run:",
    "{name:'application delegation HTTP listener',run:","{name:'application delegation esbuild service',run:",'closeAllConnections?.()','],failure)'])assert(source.includes(text),text);
});
