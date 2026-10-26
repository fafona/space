import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bookingNativeConfigText} from './booking-handoff-native-acceptance.mjs';
import {bookingIngressSnippet} from './booking-handoff-ingress.mjs';
import {parseNginx} from './production-maintenance-nginx-profile.mjs';
import {BOOKING_HANDOFF_NATIVE_SOURCES} from './booking-handoff-policy.mjs';
const config={directory:'/var/lib/faolla-booking-full-rehearsal-ABC123/runtime-normal',ports:{baseline:32001,primary:32002,rollback:32003,ingress:32004},lua:[],
 window:{id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'}};
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
