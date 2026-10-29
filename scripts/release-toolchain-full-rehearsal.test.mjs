import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {FULL_REHEARSAL_SOURCES,bookingNativeConfigText,cleanupBookingNativeFixtures} from './release-toolchain-full-rehearsal.mjs';
test('the reusable full runner uses owned new PG, exact shared sequences and never writes the old admission receipt',()=>{
 const source=readFileSync(new URL('./release-toolchain-full-rehearsal.mjs',import.meta.url),'utf8');
 for(const name of ['executeBookingHandoffHost','executeBookingIngressDrain','runBookingWatchdogSequence','executeBookingFailureRecoverySequence','createOwnedIsolation','stopOwnedIsolation','rehearseIsolatedBackup','inspectPinnedExecutionSource'])assert.ok(source.includes(name),name);
 assert.doesNotMatch(source,/PILOT=|\.pilot-owner|write\(ROOT\+|verifyOnlineReleaseTool\(/);
 assert.match(source,/publicationAuthority:false/);assert.match(source,/finally\{try\{if\(isolation\)stopOwnedIsolation\(isolation\);/);assert.match(source,/process\.on\('SIGTERM',interrupt\)/);
 assert.equal(new Set(FULL_REHEARSAL_SOURCES).size,FULL_REHEARSAL_SOURCES.length);
 for(const name of FULL_REHEARSAL_SOURCES)assert.ok(readFileSync(new URL('./'+name,import.meta.url)).length>0);
});
test('full runner exposes only loopback ingress and retains all-group cleanup on failure',async()=>{
 const c={directory:'/var/lib/faolla-booking-full-rehearsal-abc/runtime-normal',ports:{baseline:32001,primary:32002,rollback:32003,ingress:32004},lua:[],window:{id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-28T10:00:00.000Z',deadlineAt:'2026-10-28T10:10:00.000Z'}};
 assert.match(bookingNativeConfigText(c,'primary',true),/listen 127\.0\.0\.1:32004/);assert.throws(()=>bookingNativeConfigText(c,'arbitrary',true));
 const calls=[];await assert.rejects(cleanupBookingNativeFixtures(Object.fromEntries(['controllers','nginx','legacy','children'].map(key=>[key,async()=>{calls.push(key);throw Error(key);}]))),AggregateError);assert.equal(calls.length,4);
});
test('only active-profile owner IPC is atomically visible; old inactive publication stays on its original path and malformed JSON is not ignored',()=>{const source=readFileSync(new URL('./release-toolchain-full-rehearsal.mjs',import.meta.url),'utf8'),reader=readFileSync(new URL('./release-toolchain-full-interrupt.mjs',import.meta.url),'utf8');assert.ok(source.includes('const publishOwner=activeProfile?publishOnceVisible:write;'));assert.ok(source.includes("publishOwner(root+'/owner.json'"));assert.ok(source.includes("publishOwner(runtime+'/owner.json'"));assert.ok(reader.includes("if(e.code!=='ENOENT')throw e;"));assert.doesNotMatch(reader,/instanceof SyntaxError\)return|catch\{return undefined/);});
