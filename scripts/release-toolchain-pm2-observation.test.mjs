import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {collectActiveBookingLegacyHost,collectOwnedCiPm2Registry} from './release-toolchain-pm2-observation.mjs';
test('new full-registry observation is connect-only and has no process-control method or CLI fallback',()=>{
 const source=readFileSync(new URL('./release-toolchain-pm2-observation.mjs',import.meta.url),'utf8');
 for(const token of ["session.call('getVersion',{})","session.call('getMonitorData',{})",'session.verify()','captureTrustedPython()','verifyTrustedPython(python)','pm2_read_only_observation_unconfirmed','same(peer(pid),expected)','sourceProof(source)','rawEnvironment'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/bin\/pm2|\['jlist'\]|restartProcessId|stopProcessId|deleteProcessId|\.call\('prepare'|process\.kill|\.writeFile|console\./);
});
test('normal local callers cannot select formal or CI paths or weaken the peer binding',()=>{
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>collectActiveBookingLegacyHost());
 for(const root of ['/root/.pm2','/var/lib/faolla-eq-../escape','/tmp/caller',{verified:true},null])assert.throws(()=>collectOwnedCiPm2Registry(root));
});
test('pinned read-only transport sources are unchanged and actual Next acceptance exercises it',()=>{
 const source=readFileSync(new URL('./release-toolchain-pm2-observation.mjs',import.meta.url),'utf8');for(const file of ['production-maintenance-pm2-control.py','production-maintenance-pm2-connection.py'])assert.ok(source.includes(createHash('sha256').update(readFileSync(new URL('./'+file,import.meta.url))).digest('hex')));
 const fixture=readFileSync(new URL('./release-toolchain-pm2-real-acceptance.mjs',import.meta.url),'utf8');for(const token of ['const readOnlyFull=collectOwnedCiPm2Registry(root)','fullRegistryMatchesExistingTransport:true','assert.throws(()=>collectOwnedCiPm2Registry(root))'])assert.ok(fixture.includes(token),token);
 const incident=readFileSync(new URL('./release-toolchain-active-generation-incident.mjs',import.meta.url),'utf8');assert.ok(incident.includes('collectActiveBookingLegacyHost as collectBookingLegacyHost'));assert.ok(!incident.includes("from './booking-handoff-legacy.mjs'"));
});
