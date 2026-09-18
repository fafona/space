import test from 'node:test';
// Included in the existing maintenance contract CI glob.
import assert from 'node:assert/strict';
import {assertUnchangedOldRuntime} from './restore-failed-prepare-20260918.mjs';
const fact={pid:7,startTicks:'81',processIdentity:'1:2:3:4:5:6:7:8',executable:'/node',executableIdentity:'1:2:3:4:5:6:7:8'};
const proof=JSON.parse(JSON.stringify({bootId:'fixed',daemon:fact,worker:{managed:{processes:[fact,fact,fact,fact],nativeProofs:[{process:fact},{process:fact}]}},web:fact,disk:{hash:'fixed'},environment:{hash:'fixed'}}));
test('only explicit historical procfs paths and virtual fields may change',()=>{
 const fresh=structuredClone(proof);fresh.daemon.processIdentity='1:20:3:40:50:6:7:8';fresh.worker.managed.processes[2].processIdentity='1:21:3:41:51:6:7:8';fresh.worker.managed.nativeProofs[0].process.processIdentity='1:22:3:42:52:6:7:8';
 const frozen=JSON.stringify(proof);assert.doesNotThrow(()=>assertUnchangedOldRuntime(proof,fresh));assert.equal(JSON.stringify(proof),frozen);
});
for(const field of ['pid','startTicks','executable','executableIdentity'])test('reject changed '+field,()=>{const fresh=structuredClone(proof);fresh.worker.managed.processes[2][field]='changed';assert.throws(()=>assertUnchangedOldRuntime(proof,fresh));});
for(const index of [0,2,5,6,7])test('reject proc identity stable index '+index,()=>{const fresh=structuredClone(proof),parts=fresh.daemon.processIdentity.split(':');parts[index]='999';fresh.daemon.processIdentity=parts.join(':');assert.throws(()=>assertUnchangedOldRuntime(proof,fresh));});
for(const field of ['bootId','disk','environment','web'])test('reject changed '+field,()=>{const fresh=structuredClone(proof);fresh[field]='changed';assert.throws(()=>assertUnchangedOldRuntime(proof,fresh));});
test('reject extra or missing processes and unapproved parent metadata drift',()=>{for(const change of [p=>p.worker.managed.processes.pop(),p=>p.worker.managed.processes.push(fact),p=>p.worker.managed.processes[0].processIdentity='1:20:3:40:50:6:7:8']){const fresh=structuredClone(proof);change(fresh);assert.throws(()=>assertUnchangedOldRuntime(proof,fresh));}});
