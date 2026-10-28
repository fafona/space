import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIVE_INCIDENT_FILES,ACTIVE_INCIDENT_STATIC_NAMES,assertPinnedActiveIncidentBytes,assertActiveIncidentHostDelta,inspectActiveBookingIncident} from './release-toolchain-active-generation-incident.mjs';
test('the incident archive inventory is closed, fixed and disjoint from retained resources',()=>{
 assert.equal(ACTIVE_INCIDENT_FILES.length,20);const names=ACTIVE_INCIDENT_FILES.map(p=>p[0]);
 assert.equal(new Set([...names,...ACTIVE_INCIDENT_STATIC_NAMES]).size,names.length+ACTIVE_INCIDENT_STATIC_NAMES.length);
 for(const [name,length,digest]of ACTIVE_INCIDENT_FILES){assert.match(name,/^[a-z0-9-]+\.(?:json|log)$/);assert.ok(Number.isSafeInteger(length)&&length>0&&length<1024**2);assert.match(digest,/^[a-f0-9]{64}$/);}
 assert.ok(Object.isFrozen(ACTIVE_INCIDENT_FILES)&&ACTIVE_INCIDENT_FILES.every(Object.isFrozen));
});
for(const pin of ACTIVE_INCIDENT_FILES)test('a foreign byte sequence or caller-replaced '+pin[0]+' pin cannot attest this incident',()=>{
 const bytes=Buffer.alloc(pin[1]);assert.throws(()=>assertPinnedActiveIncidentBytes(pin,bytes));
 assert.throws(()=>assertPinnedActiveIncidentBytes([pin[0],bytes.length,'a'.repeat(64)],bytes));
});
test('historical observation preserves all unrelated processes, OS environments and daemon identity',()=>{
 const before={framework:{fixed:'source'},daemonPeer:{pid:10,startTicks:'20'},processes:[{name:'merchant-space',pid:1},{name:'enterprise-outbox',pid:2,status:'online'}],identityProofs:[{name:'merchant-space',environmentSha256:'a'},{name:'enterprise-outbox',startTicks:'3',environmentSha256:'b'}]},after=structuredClone(before);
 after.processes[0].pid=4;after.identityProofs[0].environmentSha256='c';assert.equal(assertActiveIncidentHostDelta(before,after),true);
 for(const mutate of [v=>v.daemonPeer.pid++,v=>v.framework.fixed='changed',v=>v.processes[1].pid++,v=>v.processes[1].status='stopped',v=>v.identityProofs[1].environmentSha256='changed',v=>v.identityProofs.pop(),v=>v.processes.push({name:'unexpected'})]){const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertActiveIncidentHostDelta(before,changed));}
});
test('the production observer cannot run on an unsupported local platform',async()=>{
 if(process.platform!=='linux'||process.getuid?.()!==0){const start=Date.now();await assert.rejects(inspectActiveBookingIncident({window:{id:'10000000-0000-4000-8000-000000000001',startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()}}));}
});
