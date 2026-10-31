import test from 'node:test';
import assert from 'node:assert/strict';
import {executeApplicationRetentionCommit} from './application-release-retention.mjs';
import {applicationRetentionFixture} from './test-support/application-release-retention-fixture.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';

function harness(failure){
 const f=applicationRetentionFixture(),events=[];let history=f.history,staged=null,published=null;
 const event=name=>{events.push(name);if(failure===name)throw Error('injected_'+name);};
 return {events,get staged(){return staged;},get published(){return published;},get history(){return history;},
  operations:{history:()=>history,observe:async()=>{event('observe');return structuredClone(f.before);},wait:async()=>event('wait'),
   now:()=>'2026-10-26T10:02:00.000Z',finalCheck:async()=>{event('finalCheck');return structuredClone(f.before);},
   stage:async receipt=>{event('stage');staged=receipt;},publish:async receipt=>{event('publish');published=receipt;},
   reconcile:async receipt=>{event('reconcile');history={...history,entries:[...history.entries,receipt.certificate],headSha256:retentionHash(receipt.certificate)};},
  }};
}
test('all five files and final unchanged-host checks precede publishing a complete certificate directory',async()=>{
 const h=harness(),receipt=await executeApplicationRetentionCommit(h.operations);
 assert.deepEqual([...h.staged.files.keys()].sort(),['prepared.json','before.json','after.json','recovery-pm2.json','certificate.json'].sort());
 assert.deepEqual(h.events,['observe','wait','observe','finalCheck','stage','finalCheck','publish','reconcile']);
 assert.equal(h.history.headSha256,retentionHash(receipt));assert.equal(h.staged,h.published);
});
test('every pre-commit failure leaves public history unchanged; complete-tail uncertainty never repeats a mutation',async()=>{
 for(const failure of ['observe','wait','finalCheck','stage','publish','reconcile']){
  const h=harness(failure),original=structuredClone(h.history);
  await assert.rejects(executeApplicationRetentionCommit(h.operations),new RegExp('injected_'+failure));
  assert.deepEqual(h.history,original);
  assert.equal(h.events.filter(name=>name==='publish').length,failure==='publish'||failure==='reconcile'?1:0);
  assert.ok(!h.events.some(name=>['stop','restart','migrate','save','route'].includes(name)));
  if(failure==='reconcile')assert.equal(h.published.files.size,5);
 }
});
test('unknown authority, changed source, changed host and changed history all refuse before publishing',async()=>{
 for(const mutation of [value=>value.applicationRelease=undefined,value=>value.kind='retire',value=>value.sourceClean=false,value=>value.processes[0].pid++]){
  const h=harness();h.operations.observe=async()=>{const f=applicationRetentionFixture();mutation(f.before);return f.before;};
  await assert.rejects(executeApplicationRetentionCommit(h.operations));assert.equal(h.published,null);
 }
 const h=harness();let checks=0;h.operations.finalCheck=async()=>{const f=applicationRetentionFixture();if(++checks===2)f.before.identityProofs[0].startTicks='999';return f.before;};
 await assert.rejects(executeApplicationRetentionCommit(h.operations));assert.equal(h.published,null);
});
