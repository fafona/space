import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingHandoffFixture} from './test-support/booking-handoff-retention-fixture.mjs';
import {executeBookingHandoffJournal,createBookingHandoffRetentionOperations,enableCommittedBookingWorker} from './booking-handoff-journal.mjs';
import {assertOnlineRetentionHistory,retentionHash} from './online-release-retention-policy.mjs';

function fixture(failAt){
  const f=bookingHandoffFixture(),events=[],files=new Map();let certificate;
  const step=(name,work=()=>{})=>async(...args)=>{events.push(name);if(name===failAt)throw Error('unknown_'+name);return work(...args);};
  const operations={history:()=>structuredClone(f.history),verifyPrerequisites:step('verifyPrerequisites'),persistProcesses:step('persistProcesses'),
    observe:step('observe',()=>structuredClone(f.before)),wait:step('wait'),now:()=> '2026-10-26T10:01:00.000Z',
    recovery:step('recovery',()=>({version:2,process:null})),begin:step('begin'),finalCheck:step('finalCheck',()=>structuredClone(f.before)),
    write:async(file,text)=>{events.push(file);if(file===failAt)throw Error('unknown_'+file);assert.equal(files.has(file),false);files.set(file,text);},
    complete:step('complete',value=>{certificate=value;const next={...f.history,entries:[...f.history.entries,value],headSha256:retentionHash(value)};assertOnlineRetentionHistory(next);})};
  return {f,events,files,operations,certificate:()=>certificate};
}
test('handoff writer verifies then persists, writes all five strict files, and commits the external history head last',async()=>{
  const f=fixture(),cert=await executeBookingHandoffJournal(f.operations);
  assert.equal(cert.kind,'booking-handoff');assert.deepEqual(f.certificate(),cert);
  assert.deepEqual([...f.files.keys()],['prepared.json','before.json','recovery-pm2.json','after.json','certificate.json']);
  assert.equal(f.events[0],'verifyPrerequisites');assert.equal(f.events[1],'persistProcesses');assert.equal(f.events.at(-1),'complete');
  assert.equal(f.events.some(n=>/stop|restart|enable|database|publish/.test(n)),false);
  assert.deepEqual(JSON.parse(f.files.get('before.json')).bookingHandoff,f.f.handoff);
});
for(const stage of ['verifyPrerequisites','persistProcesses','observe','wait','recovery','begin','prepared.json','before.json','recovery-pm2.json','finalCheck','after.json','certificate.json','complete']){
  test('unknown '+stage+' keeps partial evidence without retries or opening the worker gate',async()=>{
    const f=fixture(stage);await assert.rejects(executeBookingHandoffJournal(f.operations),/unknown_/);
    assert.equal(f.events.filter(n=>n===stage).length,1);assert.equal(f.certificate(),undefined);
    assert.equal(f.events.some(n=>/enable|stop|restart|deactivate/.test(n)),false);
  });
}
test('generic convergence cannot enter the one-time booking writer',async()=>{
  const f=fixture();f.operations.observe=async()=>({...f.f.before,kind:'converge'});
  await assert.rejects(executeBookingHandoffJournal(f.operations),/journal_kind/);assert.equal(f.files.size,0);
});
test('drift after the initial observation cannot receive a completed certificate',async()=>{
  const f=fixture();let seen=0;f.operations.observe=async()=>{const b=structuredClone(f.f.before);if(++seen>1)b.markerSha256='9'.repeat(64);return b;};
  await assert.rejects(executeBookingHandoffJournal(f.operations),/observations_changed/);assert.equal(f.certificate(),undefined);
});
test('actual host collector requires real locks/current-main source and is not a caller-supplied-facts CLI',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0){
    assert.throws(()=>createBookingHandoffRetentionOperations({lock:true,toolRevision:'f'.repeat(40)}),/linux_root/);
    assert.throws(()=>enableCommittedBookingWorker({lock:true,toolRevision:'f'.repeat(40)}),/linux_root/);
  }
  const source=readFileSync(new URL('./booking-handoff-journal.mjs',import.meta.url),'utf8');
  for(const required of ['assertOnlineRetentionHeldLocks(lock)','verifyOnlineReleaseTool','assertBookingHandoffToolClosure',
    'createOnlineRetentionJournal(prior)','journal.complete(certificate)','assertOnlineRetentionPersistedProcesses','assertBookingLegacyRuntimeEnvironmentTransition',
    'rawEnv(legacy.pid)','atomic-runtime.json','legacy-runtime-transition.json','assertBookingAtomicWorkerGate','committed_handoff_required','worker-enabled.json'])assert.ok(source.includes(required),required);
  assert.doesNotMatch(source,/process\.argv|--skip|--force|\['stop'|\['restart'|\['delete'|installInactive|guardedProductionBooking|update public\.|set active=false/);
  assert.match(source,/bookingHandoffActivationSnapshotSql/);
});
