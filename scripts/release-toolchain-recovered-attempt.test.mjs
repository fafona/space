import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {RECOVERED_BOOKING_ATTEMPT as P,RECOVERED_BOOKING_STATIC_NAMES} from './release-toolchain-recovered-contract.mjs';
import {assertRecoveredBookingProof,executeRecoveredBookingArchive,archiveRecoveredBookingAttempt} from './release-toolchain-recovered-attempt.mjs';
import {bookingWatchdogLeaseDigest} from './booking-handoff-watchdog.mjs';
import {sha256} from './release-toolchain-contracts.mjs';
const C='f274ad615550c83717aa7af2ad32339608e6f8aa',B='52f602c0734284d81a19f4cdf9cdbf3766aa1834';
function proof(){const window={id:P.operationId,startedAt:'2026-10-28T15:10:59.000Z',deadlineAt:'2026-10-28T15:20:59.000Z'},h='a'.repeat(64),
 lease={schemaVersion:1,kind:'booking-handoff-independent-watchdog',candidate:C,toolRevision:P.priorTool,window,
 parent:{pid:1234,uid:0,startTicks:'100',executable:'/usr/bin/node',cwd:'/var/lib/faolla-online-code/'+P.priorTool,commandSha256:h},
 deploy:{file:'/www/wwwroot/merchant-space.deploy.lock',identity:{dev:1,ino:2,uid:0,mode:0o100600,nlink:1}},operation:{directory:'/var/lib/faolla-maintenance/merchant-space/operation.lock',identity:{dev:1,ino:3,uid:0,mode:0o40700,nlink:2}},routingPlanSha256:h,gatePlanSha256:h},
 recovery={operationId:P.operationId,phase:'baseline',target:B,gateClosed:true,normalHandoffCompleted:false,withinAuthorizedWindow:true,database:{activationAttempted:false,activationCommitted:false,active:false},legacyPause:{attempted:false}};
 return {lease,armed:{schemaVersion:1,leaseSha256:bookingWatchdogLeaseDigest(lease),process:{pid:5678},at:'2026-10-28T15:11:03.000Z'},failure:{operationId:P.operationId,errorSha256:sha256('booking_host_watchdog_not_armed')},finished:{operationId:P.operationId,outcome:'recovered-failure',recovery:structuredClone(recovery)},recovery,gate:{window}};
}
test('archive profile is one exact incident and contains no directory, traversal, credential or arbitrary move input',()=>{
 assert.equal(P.files.length,17);assert.equal(new Set(P.files.map(v=>v[0])).size,17);assert.equal(Object.isFrozen(P),true);
 for(const [name,size,hash]of P.files){assert.match(name,/^[a-z0-9-]+\.(?:json|log)$/);assert.equal(Number.isSafeInteger(size)&&size>=0&&size<=1024**2,true);assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(RECOVERED_BOOKING_STATIC_NAMES.includes(name),false);}
 assert.equal(P.files.some(p=>p[0]==='worker-runtime.json'||p[0]==='runtime-ready.json'),false);
});
test('only the proven inactive, never-restarted baseline recovery and exact corrected arming receipt qualify',()=>{assert.equal(assertRecoveredBookingProof(proof()),true);});
for(const change of [p=>p.lease.toolRevision='f'.repeat(40),p=>p.failure.operationId='other',p=>p.failure.errorSha256='a'.repeat(64),p=>p.gate.window={...p.gate.window,id:'other'},
 p=>p.finished.outcome='committed',p=>p.recovery.phase='rollback',p=>p.recovery.target=C,p=>p.recovery.gateClosed=false,p=>p.recovery.withinAuthorizedWindow=false,
 p=>p.recovery.database.active=true,p=>p.recovery.database.activationAttempted=true,p=>p.recovery.database.activationCommitted=true,p=>p.recovery.legacyPause.attempted=true,
 p=>p.armed.leaseSha256='a'.repeat(64),p=>p.armed.at='2026-10-28T16:11:03.000Z'])test('archive refuses changed operation, active/unknown SQL, process restart, bad arming or unsafe recovery',()=>{const p=proof();change(p);assert.throws(()=>assertRecoveredBookingProof(p));});
function fixture(failure){const events=[],ops={inspect:async()=>{events.push('inspect');if(failure==='inspect')throw Error('unknown');return {fixed:true};},
 begin:async()=>{events.push('begin');if(failure==='begin')throw Error('unknown');},move:async i=>{events.push('move-'+i);if(failure==='move-'+i)throw Error('unknown');},
 verify:async()=>{events.push('verify');if(failure==='verify')throw Error('unknown');},complete:async()=>{events.push('complete');if(failure==='complete')throw Error('unknown');return {sealed:true};}};return {events,ops};}
test('all 17 exact evidence moves are observed before a final seal, without replaying the old application attempt',async()=>{const f=fixture();assert.deepEqual(await executeRecoveredBookingArchive(f.ops),{sealed:true});assert.deepEqual(f.events,['inspect','begin',...P.files.map((_,i)=>'move-'+i),'verify','complete']);});
for(const stage of ['inspect','begin',...P.files.map((_,i)=>'move-'+i),'verify','complete'])test('unknown archive '+stage+' stops terminally without retry or success',async()=>{const f=fixture(stage);await assert.rejects(executeRecoveredBookingArchive(f.ops),/unknown/);assert.equal(f.events.at(-1),stage);assert.equal(f.events.filter(v=>v===stage).length,1);});
test('production archiver requires actual reviewed authority and held locks, never caller green JSON',async()=>{await assert.rejects(archiveRecoveredBookingAttempt({lock:{verified:true},toolRevision:'a'.repeat(40),qualificationSha256:'b'.repeat(64)}));});
test('actual archiver is fixed-path, exclusive, ownership/byte checked and durable; normal admission mandates a completed archive',()=>{
 const src=readFileSync(new URL('./release-toolchain-recovered-attempt.mjs',import.meta.url),'utf8'),profile=readFileSync(new URL('./release-toolchain-booking-profile.mjs',import.meta.url),'utf8');
 for(const v of ['ownedReleasePath','O_NOFOLLOW','fs.renameSync(source,destination)','bookingHostSync(ROOT)','assertOnlineRetentionHeldLocks(lock)','inspectPinnedExecutionSource','unchangedFormalHost()','noLiveProcess(proof.lease.parent)','noLiveProcess(proof.armed.process)'])assert.ok(src.includes(v),v);
 assert.doesNotMatch(src,/rmSync|unlink|rmdir|copyFile|set active|UPDATE |INSERT |DELETE |process\.kill|restartProcessId/);
 assert.match(profile,/const prepared=retainedPreparation\(revision\);assertArchivedRecoveredBookingAttempt\(\)/);
 assert.match(profile,/verifyRecoveredBookingPreparation/);assert.match(profile,/worker-enabled\.json.*watchdog-lease\.json.*preflight\.json/);
});
