import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {cleanupWorkArrangementBrowser,workArrangementParentMock,runWorkArrangementBrowserAcceptance} from './attendance-work-arrangement-browser.mjs';
const source=readFileSync(new URL('./attendance-work-arrangement-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-work-arrangement-browser.tsx',import.meta.url),'utf8');
test('inert callback uses actual parents but explicitly synthetic parent initialization',()=>{
  assert.equal(typeof runWorkArrangementBrowserAcceptance,'function');
  for(const name of ['SelfPanel','AdminPanel'])assert(entry.includes(`<${name}`));
  assert(entry.includes('workArrangementsEnabled={enabled}'));assert(entry.includes('canClock={false}'));
  assert(source.includes('parentInitializationSynthetic:true'));assert(!source.includes('process.argv'));
  assert(!source.includes('runAttendanceLabelsReuse'));assert(!source.includes('pg_ctl'));assert(!source.includes('writeFile'));
});
test('synthetic parent adapter only allows correct-site initial reads',()=>{
  const args={site:'99990001',worker:'00000000-0000-4000-8000-000000000004',zone:'UTC'};
  const self=new URL('http://127.0.0.1/api/merchant-enterprise/attendance/self?siteId=99990001');
  assert.equal(workArrangementParentMock(self,'GET',args).state.status,'off');
  const admin=new URL('http://127.0.0.1/api/merchant-enterprise/attendance/admin?siteId=99990001&view=settings');
  assert.equal(workArrangementParentMock(admin,'GET',args).settings.webClockEnabled,false);
  assert.throws(()=>workArrangementParentMock(self,'POST',args));self.searchParams.set('operationId',args.worker);assert.throws(()=>workArrangementParentMock(self,'GET',args));
  self.searchParams.delete('operationId');self.searchParams.set('siteId','99990002');assert.throws(()=>workArrangementParentMock(self,'GET',args));
});
test('cleanup validates object steps, executes every owned resource and retains original failure',async()=>{
  await assert.rejects(()=>cleanupWorkArrangementBrowser('label'),/cleanup_shape/);
  await assert.rejects(()=>cleanupWorkArrangementBrowser([['bad',()=>{}]]),/cleanup_shape/);
  const calls=[],primary=Error('primary');
  await assert.rejects(()=>cleanupWorkArrangementBrowser([{name:'first',run:()=>{calls.push('first');throw Error('cleanup');}},
    {name:'second',run:()=>calls.push('second')}],primary),error=>error instanceof AggregateError&&error.cause===primary&&error.errors[0]===primary);
  assert.deepEqual(calls,['first','second']);
  for(const name of ['context','browser','HTTP listener','esbuild service'])assert(source.includes(`name:'work arrangement ${name}'`));
  assert(source.includes('run:()=>stop()'));
});
test('read/write verification is bound to actual response and keeps all pre-reload storage evidence',()=>{
  assert(source.includes('Promise.all([page.waitForResponse'));assert(source.includes('await response.finished()'));
  assert(source.includes("if(method==='GET')assert.equal(d.fingerprint(),before"));
  assert(source.includes('d.fingerprint(protectedTables),protectedBefore'));assert(source.includes('after.requests-beforeCounts.requests,2'));
  assert(source.includes('after.entries-beforeCounts.entries,3'));assert(source.includes('storageHistory.push(...preReloadProbe.writes)'));
  assert(source.includes('storageHistory.every'));assert(source.includes('newRequests().length<25'));
});
