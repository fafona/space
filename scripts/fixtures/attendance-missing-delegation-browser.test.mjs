import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runMissingDelegationBrowserAcceptance,cleanupMissingDelegationBrowser} from './attendance-missing-delegation-browser.mjs';
const source=readFileSync(new URL('./attendance-missing-delegation-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-missing-delegation-browser.tsx',import.meta.url),'utf8');

test('inert callback rejects missing owned context before creating fixtures or runtime',async()=>{
  let called=false;await assert.rejects(runMissingDelegationBrowserAcceptance({submit(){called=true;}}));assert.equal(called,false);
  assert.doesNotMatch(source,/initdb|pg_ctl|writeFile|mkdir|screenshot\(/);assert.match(source,/bundle:true,write:false/);
  assert.match(source,/url.origin,origin/);assert.match(source,/scope.schema===d.owned.schema/);
});
test('real parent entry and synthetic-only old initialization lead to the actual delegated endpoint',()=>{
  for(const text of ['<SelfPanel','<AdminPanel','missingDelegationEnabled={enabled}','credentials: "omit"','workArrangementsEnabled={false}'])assert(entry.includes(text),text);
  for(const text of ['workArrangementParentMock','await handle(new Request(canonical+url.pathname+url.search',
    "const first=await submit(),second=await submit()",'preparedRealSelfRequests:2','actualHandlerServiceSql:true','parentInitializationSynthetic:true',
    'actualAdminAndSelfParents:true',"assert.equal(url.pathname,endpoint",'newRequests().length<25'])assert(source.includes(text),text);
});
test('new actual writes have response-gated waits, private pending stays hidden and recovery cannot repeat POST',()=>{
  for(const text of ['page.waitForResponse','await response.finished()',"action:'grant'","action:'approve'",'dropPost=true',
    "stage='flagoff_minimal_recovery';serverEnabled=false",'assert.equal(newRequests().length,beforeReload)',
    'assert.equal(posts().length,postCount)','includes(privateReason)','readOnlyGetFingerprints:true','oldSelfResults:true',
    'await missing(mq({requestId:first.operationId}))','await missing(mq({requestId:second.operationId}))',
    'page.keyboard.press(\'Escape\')','element.scrollWidth>element.clientWidth+2'])assert(source.includes(text),text);
  assert.match(source,/state:'detached'/);assert.match(source,/dialog_failed:/);
});
test('flag-off recovered receipt survives focus without network and settled entry disappears only after close',()=>{
  for(const text of ["stage='flagoff_recovered_receipt_focus'","window.dispatchEvent(new Event('focus'))",
    'assert.equal(newRequests().length,beforeFocus)','recoveredReceiptSurvivesFocus:true','settledEntryDisappearsOnClose:true',
    "getByRole('button',{name:'核对待确认漏卡委托操作',exact:true}).waitFor({state:'detached'})"])assert(source.includes(text),text);
  const stage=source.slice(source.indexOf("stage='flagoff_recovered_receipt_focus'"),source.indexOf('const probe=await page.evaluate'));
  assert(stage.indexOf("new Event('focus')")<stage.indexOf("[data-missing-delegation-receipt]"));
  assert(stage.indexOf("[data-missing-delegation-receipt]")<stage.indexOf('await close()'));
  assert(stage.indexOf('await close()')<stage.indexOf("name:'核对待确认漏卡委托操作'"));
});
test('all owned browser resources are attempted and cleanup preserves the original failure',async()=>{
  const called=[],primary=Error('original acceptance failure');
  await assert.rejects(cleanupMissingDelegationBrowser([
    {name:'one',run:()=>{called.push('one');throw Error('cleanup failed');}},
    {name:'two',run:()=>{called.push('two');}},
  ],primary),error=>error instanceof AggregateError&&error.errors[0]===primary&&error.cause===primary);
  assert.deepEqual(called,['one','two']);await assert.rejects(cleanupMissingDelegationBrowser([['wrong shape',()=>{}]]),/cleanup_shape/);
  for(const text of ["{name:'missing delegation inflight',run:","{name:'missing delegation context',run:","{name:'missing delegation browser',run:",
    "{name:'missing delegation HTTP listener',run:","{name:'missing delegation esbuild service',run:",'closeAllConnections?.()','],failure)'])assert(source.includes(text),text);
});
