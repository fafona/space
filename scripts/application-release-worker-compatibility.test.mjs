import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {hostRebootFixture} from './test-support/release-toolchain-host-reboot-fixture.mjs';
import {applicationRetentionFixture} from './test-support/application-release-retention-fixture.mjs';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {retentionHash,assertOnlineRetentionHistory} from './online-release-retention-policy.mjs';
import {assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
import {assertRebootAwareApplicationWorkerSuccessor} from './application-release-worker-compatibility.mjs';
import {assertApplicationWorkerSuccessor} from './application-release-policy.mjs';
import {applicationPublicationProof} from './application-release-publication-proof.mjs';
const clone=structuredClone,digest=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const boot=hostRebootFixture(),application=applicationRetentionFixture();assert.deepEqual(application.history,boot.history);
 const receipt=buildOnlineRetentionReceipt(boot.before,boot.after,{version:2,process:null},boot.history,{preparedAt:boot.before.hostReboot.window.startedAt,completedAt:'2026-11-10T10:01:00.000Z'});
 const history={...clone(boot.history),entries:[...clone(boot.history.entries),receipt.certificate],headSha256:retentionHash(receipt.certificate)},before=clone(application.before);
 Object.assign(before,{sequence:history.entries.length+1,previousSha256:history.headSha256,rollback:clone(boot.before.active),processes:[...clone(boot.after.processes),before.active.process],identityProofs:[...clone(boot.before.hostReboot.identities).filter(p=>p.name!==boot.after.workerIdentity.name),clone(boot.after.workerIdentity),{name:before.active.name,pid:before.active.process.pid,uid:0,parentPid:900,startTicks:'70000',cwd:before.active.directory,executable:'/usr/bin/node',commandSha256:'1'.repeat(64),environmentSha256:'2'.repeat(64)}]});
 before.listeners=before.processes.filter(p=>p.port!==null&&p.status==='online').map(p=>({address:'127.0.0.1',port:p.port,pid:p.pid}));
 before.activeState={...before.activeState,activatedAt:'2026-11-10T10:03:00.000Z',retentionHeadSha256:history.headSha256};before.releaseProofs[0].state=clone(before.activeState);before.releaseProofs[0].stateText=JSON.stringify(before.activeState);before.releaseProofs[0].stateSha256=digest(before.releaseProofs[0].stateText);
 const next=buildOnlineRetentionReceipt(before,clone(before),{version:2,process:null},history,{preparedAt:'2026-11-10T10:03:00.000Z',completedAt:'2026-11-10T10:04:00.000Z'});
 const published={...clone(history),entries:[...clone(history.entries),next.certificate],headSha256:retentionHash(next.certificate)};return{boot,history:published,processes:before.processes,publication:published.entries.find(c=>c.kind==='booking-handoff'),active:before.activeFile,target:application.target};
}
test('a real forward application publication after boot recovery still dispatches the original immutable booking application',()=>{
 const f=fixture();assertOnlineRetentionHistory(f.history);
 assert.throws(()=>assertApplicationWorkerSuccessor({history:f.history,publication:f.publication,actualActive:f.active}),/worker_successor/);
 assertRebootAwareApplicationWorkerSuccessor({history:f.history,publication:f.publication,actualActive:f.active});
 assertBookingAtomicWorkerGate({gate:f.boot.gate,history:f.history,actualActive:f.active,current:f.processes,toolRevision:f.boot.gate.toolRevision});
 assert.equal(applicationPublicationProof(f.history,f.target).manifestSha256,'d'.repeat(64));
});
test('boot projection cannot hide an invalid certificate, changed site, rollback edge or unapproved application',()=>{
 for(const mutate of [f=>f.history.entries.find(c=>c.kind==='host-reboot').hostReboot.mailEnabled=true,f=>f.history.entries.at(-1).applicationRelease.manifestSha256='bad',f=>f.active.target='9'.repeat(40),f=>f.history.entries.at(-1).rollback.target='9'.repeat(40)]){const f=fixture();mutate(f);assert.throws(()=>assertRebootAwareApplicationWorkerSuccessor({history:f.history,publication:f.publication,actualActive:f.active}));}
});
