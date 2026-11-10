import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {FULL_REHEARSAL_SOURCES,bookingNativeConfigText,cleanupBookingNativeFixtures,bookingNativeNodeSpawnReady,stopBookingNativeStartingNode,bookingNativeProcessAlive} from './release-toolchain-full-rehearsal.mjs';
import {createHash} from 'node:crypto';
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

test('empty Linux startup argv cannot become the saved process identity; readiness requires the exact launched command and birth',()=>{
 const digest=value=>createHash('sha256').update(value).digest('hex'),commandSha256=digest('/usr/bin/node\0/owned/source.mjs\0worker\0/owned/runtime\0');
 const expected={pid:18590,startTicks:'19689',state:'R',executable:'/usr/bin/node',cwd:'/var/lib/faolla-booking-full-rehearsal-PBWqhV/runtime-normal',commandSha256:digest('')};
 assert.equal(bookingNativeNodeSpawnReady({expected,actual:expected,commandSha256}),false);
 assert.equal(bookingNativeNodeSpawnReady({expected,actual:{...expected,commandSha256},commandSha256}),true);
 for(const patch of [{pid:18591},{startTicks:'19690'},{executable:'/bin/sh'},{cwd:'/production'},{state:'Z'},{commandSha256:digest('foreign')}])assert.throws(()=>bookingNativeNodeSpawnReady({expected,actual:{...expected,...patch},commandSha256}));
 for(const patch of [{pid:0},{executable:'/bin/sh'},{cwd:'/production'}])assert.throws(()=>bookingNativeNodeSpawnReady({expected:{...expected,...patch},actual:expected,commandSha256}));
 const source=readFileSync(new URL('./release-toolchain-full-rehearsal.mjs',import.meta.url),'utf8');
 assert.match(source,/const expected=fact\(child.pid\)/);assert.match(source,/child.spawnargs\[1\]===FILE/);assert.match(source,/actual=inspect\(\);return actual.commandSha256===commandSha256/);
 assert.match(source,/isDeepStrictEqual\(actualBirth,expectedBirth\)&&\[emptyCommandSha256,expectedCommand\].includes\(actualCommand\)/);
});

test('cleared argv during exit is still live until disappearance, not an identity failure or a stopped-process certificate',()=>{
 const digest=value=>createHash('sha256').update(value).digest('hex'),expected={pid:18590,startTicks:'19689',state:'R',executable:'/usr/bin/node',cwd:'/owned',commandSha256:digest('actual-command')};
 assert.equal(bookingNativeProcessAlive(expected,{...expected,state:'S'}),true);
 assert.equal(bookingNativeProcessAlive(expected,{...expected,commandSha256:digest('')}),true);
 assert.equal(bookingNativeProcessAlive(expected,{...expected,state:'Z',commandSha256:digest('')}),false);
 for(const patch of [{pid:18591},{startTicks:'19690'},{executable:'/bin/sh'},{cwd:'/production'},{commandSha256:digest('foreign')}])assert.throws(()=>bookingNativeProcessAlive(expected,{...expected,...patch}));
 for(const patch of [{pid:18591},{startTicks:'19690'},{executable:'/bin/sh'},{cwd:'/production'}])assert.throws(()=>bookingNativeProcessAlive(expected,{...expected,...patch,commandSha256:digest('')}));
});

test('startup failure reaps only the owned child and never calls a foreign or unconfirmed birth stopped',async()=>{
 const expected={pid:18590};for(const mode of ['gone','term','kill','stuck','foreign']){
  let running=mode!=='gone';const signals=[];
  const operations={ownedNow:value=>{assert.equal(value,expected);if(mode==='foreign')throw Error('foreign');return running?{}:null;},signal:(pid,signal)=>{assert.equal(pid,expected.pid);signals.push(signal);if(mode==='term'||mode==='kill'&&signal==='SIGKILL')running=false;},wait:async value=>assert.equal(value,20)};
  if(['foreign','stuck'].includes(mode))await assert.rejects(stopBookingNativeStartingNode(operations,expected));else await stopBookingNativeStartingNode(operations,expected);
  assert.deepEqual(signals,['gone','foreign'].includes(mode)?[]:mode==='term'?['SIGTERM']:['SIGTERM','SIGKILL']);
 }
});
