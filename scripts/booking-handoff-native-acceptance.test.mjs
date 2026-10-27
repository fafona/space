import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingNativeConfigText,bookingNativeNginxReady,startBookingNativeNginx,cleanupBookingNativeFixtures} from './booking-handoff-native-acceptance.mjs';
import {bookingIngressSnippet} from './booking-handoff-ingress.mjs';
import {parseNginx} from './production-maintenance-nginx-profile.mjs';
import {BOOKING_HANDOFF_NATIVE_SOURCES} from './booking-handoff-policy.mjs';
const config={directory:'/var/lib/faolla-booking-full-rehearsal-ABC123/runtime-normal',ports:{baseline:32001,primary:32002,rollback:32003,ingress:32004},lua:[],
 window:{id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'}};
const nginx={pid:4321,startTicks:'12345',state:'R',executable:'/www/server/nginx/sbin/nginx',cwd:config.directory,commandSha256:'old-title'};
test('nginx PID acknowledgement rejects empty config-test files, malformed or stale PIDs and never chooses a foreign signal target',()=>{
 const input={expected:nginx,actual:nginx,directory:config.directory};
 for(const pidText of ['', '0', '\n','4320\n','4321garbage',' 4321','4321\n4321','-4321','4.321e3'])assert.equal(bookingNativeNginxReady({...input,pidText}),false,pidText);
 for(const pidText of ['4321','4321\n'])assert.equal(bookingNativeNginxReady({...input,pidText}),true);
 assert.equal(bookingNativeNginxReady({...input,actual:{...nginx,commandSha256:'new-master-title'},pidText:'4321'}),true);
 for(const patch of [{pid:4320},{startTicks:'999'},{state:'Z'},{executable:'/bin/sh'},{cwd:'/production'}])
  assert.throws(()=>bookingNativeNginxReady({...input,actual:{...nginx,...patch},pidText:'4321'}),/child_changed/);
 for(const patch of [{pid:0},{executable:'/bin/sh'},{cwd:'/production'}])
  assert.throws(()=>bookingNativeNginxReady({...input,expected:{...nginx,...patch},pidText:'4321'}),/nginx_spawn/);
});
test('actual startup registers the direct child before any PID read; empty/stale files wait within the original timeout',async()=>{
 const calls=[],texts=['','4320\n','4321\n'];let registered;
 const result=await startBookingNativeNginx({directory:config.directory,spawned:async()=>{calls.push('spawned');return nginx;},
  register:f=>{calls.push('register');registered=f;},actual:pid=>{assert.equal(pid,4321);assert.equal(registered,nginx);return nginx;},
  pidText:()=>{calls.push('pid');return texts.shift();},until:async predicate=>{for(let i=0;i<3;i++)if(await predicate())return;throw Error('timeout');}});
 assert.equal(result,nginx);assert.deepEqual(calls,['spawned','register','pid','pid','pid']);
 for(const failure of ['timeout','read','child-exited']){let owned;
  await assert.rejects(startBookingNativeNginx({directory:config.directory,spawned:async()=>nginx,register:f=>{owned=f;},
   actual:()=>{if(failure==='child-exited')throw Error(failure);return nginx;},pidText:()=>{if(failure==='read')throw Error(failure);return '';},
   until:async p=>{await p();throw Error('timeout');}}));assert.equal(owned,nginx,failure);
 }
});
test('failure cleanup attempts every owned group even if a controller, nginx or legacy cleanup fails',async()=>{
 for(const failure of [null,'controllers','nginx','legacy','children']){
  const seen=[],ops=Object.fromEntries(['controllers','nginx','legacy','children'].map(k=>[k,async()=>{seen.push(k);if(k===failure)throw Error(k);} ]));
  if(failure)await assert.rejects(cleanupBookingNativeFixtures(ops),AggregateError);else await cleanupBookingNativeFixtures(ops);
  assert.deepEqual(seen,['controllers','nginx','legacy','children']);
 }
 const source=readFileSync(new URL('./booking-handoff-native-acceptance.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/fact\(Number\(fs.readFileSync\(runtime\+'\/nginx.pid'/);
 assert.match(source,/finally\s*\{[\s\S]*await cleanupBookingNativeFixtures/);
});
test('native gate uses the exact production rewrite snippet and actual isolated listener/upstream',()=>{
 for(const phase of ['baseline','armed','primary','rollback'])for(const gated of [true,false]){
  const text=bookingNativeConfigText(config,phase,gated);parseNginx(text,'/www/server/nginx/conf/nginx.conf');assert.ok(text.includes('listen 127.0.0.1:32004;'));
  assert.equal(text.includes(bookingIngressSnippet(config.window)),gated);assert.ok(text.includes('proxy_pass http://127.0.0.1:'+({baseline:32001,armed:32001,primary:32002,rollback:32003}[phase])+';'));
  assert.doesNotMatch(text,/0\.0\.0\.0|error_page|api_key|smtp|mail_/i);
 }assert.throws(()=>bookingNativeConfigText(config,'unknown',true),/routing_phase/);
});
test('native fixture targets only the fixed owned network-none PG15 pilot and new unique databases',()=>{
 const source=readFileSync(new URL('./booking-handoff-native-acceptance.mjs',import.meta.url),'utf8');
 assert.match(source,/PILOT='0d0a85a8ff50b585/);assert.match(source,/p\.network==='none'/);assert.match(source,/p\.privileged===false/);
 assert.match(source,/create database.*template template0 owner supabase_admin/);assert.match(source,/faolla_booking_activation_\[a-f0-9\]/);
 assert.doesNotMatch(source,/drop database|docker.*(?:'start'|'stop'|'restart')|pm2.*(?:'restart'|'stop'|'kill')|session_replication_role|disable trigger|--force|--skip/);
});
test('real parent death is observed around actual PG lock/commit outcomes and inherited kernel flock',()=>{
 const source=readFileSync(new URL('./booking-handoff-native-acceptance.mjs',import.meta.url),'utf8');
 for(const required of ['runBookingWatchdogSequence','executeBookingFailureRecoverySequence','executeBookingHandoffHost','executeBookingIngressDrain','BOOKING_RECOVERY_BARRIER_SQL',
  "wait_event='PgSleep'","process.kill(process.pid,'SIGKILL')",'actual_kernel_lock','lock_not_inherited_after_death','kernel_lock_not_released','production_changed'])assert.ok(source.includes(required),required);
 assert.ok(source.includes("statement.replace(/commit;$/,'select pg_sleep(2);rollback;')"));assert.ok(source.includes("window.startedAt)+600000"));
 assert.doesNotMatch(source,/inheritedKernelLock:\s*(?:false|!!)|fake.*systemIdentifier|systemIdentifier:'761204/);
});
test('native evidence binds its runner, shared sequences and fixed production attesters without treating fixture journal as production authority',()=>{
 const source=readFileSync(new URL('./booking-handoff-native-acceptance.mjs',import.meta.url),'utf8');
 assert.equal(new Set(BOOKING_HANDOFF_NATIVE_SOURCES).size,BOOKING_HANDOFF_NATIVE_SOURCES.length);
 for(const name of ['booking-handoff-native-acceptance.mjs','booking-handoff-host.mjs','booking-handoff-watchdog.mjs','booking-handoff-recovery.mjs','booking-handoff-journal.mjs'])assert.ok(BOOKING_HANDOFF_NATIVE_SOURCES.includes(name));
 assert.match(source,/NOT a fabricated production retention certificate/);assert.match(source,/allFixturesStopped:true/);assert.match(source,/rowsPreserved:true/);
 assert.match(source,/source_changed/);assert.match(source,/executeBookingIngressDrain/);
});
