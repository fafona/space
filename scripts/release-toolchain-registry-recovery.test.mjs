import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {REGISTRY_RECOVERY as P,registryAdapterContext,assertRegistryAdapterContext,assertRegistryRecoveryHistory,assertRegistryRecoverySourceDelta,REGISTRY_RECOVERY_FILES} from './release-toolchain-registry-recovery-policy.mjs';
import {assertBookingWorkerReleaseContext,assertBookingWorkerOnlyDelta} from './release-toolchain-worker-release-contract.mjs';
import {inspectRegistryRecovery,publishRegistryRecovery,auditRegistryRecovery} from './release-toolchain-registry-recovery.mjs';
const name='merchant-space-booking-atomic-f274ad615550';
function context(){return{version:2,kind:'booking-worker-source-only',candidate:'f274ad615550c83717aa7af2ad32339608e6f8aa',toolRevision:'b'.repeat(40),priorToolRevision:P.priorToolRevision,
 priorWorker:{name,pmId:24,pid:685108,status:'online',cwd:'/www/wwwroot/merchant-space.web-releases/f274ad615550-online',port:null,executable:'/var/lib/faolla-online-code/'+P.priorToolRevision+'/scripts/booking-atomic-worker.mjs',interpreter:'/usr/bin/node',args:[],nodeArgs:[],execMode:'fork_mode',autorestart:true,watch:false,cronRestart:null,backgroundPaused:'0',automationEnabled:'0',invitationEnabled:'0',killTimeout:null,shutdownWithMessage:false,restartCount:1,createdAt:1794287111984,environmentSha256:'a'.repeat(64)},
 gateSha256:P.gateSha256,publicationCertificateSha256:'c'.repeat(64),inventorySha256:'d'.repeat(64),nativeEvidenceSha256:'e'.repeat(64),protectedHostSha256:'f'.repeat(64),window:{id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-11-17T00:00:00.000Z',deadlineAt:'2026-11-17T00:10:00.000Z'},mailEnabled:false,registryAdapter:registryAdapterContext()};}
test('version 2 binds only the observed paused verifier and the fixed 4 MiB adapter',()=>{
 const r=context();assert.equal(assertBookingWorkerReleaseContext(r),true);
 for(const change of [v=>v.registryAdapter.maximumFrameBytes++,v=>v.registryAdapter.historyHeadSha256='a'.repeat(64),v=>v.priorWorker.pmId=27,v=>v.priorWorker.pid++,v=>v.priorWorker.restartCount++,v=>v.gateSha256='a'.repeat(64),v=>v.mailEnabled=true,v=>v.window.deadlineAt='2026-11-17T00:11:00.000Z',v=>v.extra=true]){const bad=structuredClone(r);change(bad);assert.throws(()=>assertBookingWorkerReleaseContext(bad));}
 const old=structuredClone(r);old.version=1;delete old.registryAdapter;assert.throws(()=>assertBookingWorkerReleaseContext(old),'the historical PMID-27 contract is not relaxed');
});
test('source-only transition cannot change another row, environment, gate or restart count',()=>{
 const r=context(),other={name:'protected',pid:123},before=[r.priorWorker,other],after=[{...r.priorWorker,pid:900001,restartCount:2,executable:'/var/lib/faolla-online-code/'+r.toolRevision+'/scripts/booking-atomic-worker.mjs'},other];
 assert.equal(assertBookingWorkerOnlyDelta(before,after,r),true);
 for(const change of [v=>v[0].environmentSha256='b'.repeat(64),v=>v[0].restartCount=3,v=>v[1].pid++,v=>v.pop(),v=>v[0].pmId=27]){const bad=structuredClone(after);change(bad);assert.throws(()=>assertBookingWorkerOnlyDelta(before,bad,r));}
 assert.throws(()=>assertRegistryRecoveryHistory({headSha256:'a'.repeat(64),entries:[]},r));
 assert.equal(assertRegistryAdapterContext(r),true);
});
test('exact source allowlist rejects application/dependency/SQL and unrecognized tool mutations',()=>{
 const before=[{file:'src/app/admin/AdminClient.tsx',mode:'100644',oid:'a'}],after=[...before,...REGISTRY_RECOVERY_FILES.map(file=>({file,mode:'100644',oid:'b'}))];
 assert.equal(assertRegistryRecoverySourceDelta(before,after).applicationChanged,false);
 for(const file of ['src/app/admin/AdminClient.tsx','package-lock.json','scripts/other-tool.mjs','scripts/supabase-migrations/new.sql']){const bad=after.filter(v=>v.file!==file).concat({file,mode:'100644',oid:'c'});assert.throws(()=>assertRegistryRecoverySourceDelta(before,bad));}
 assert.throws(()=>assertRegistryRecoverySourceDelta(before,after.filter(v=>v.file!=='scripts/release-toolchain-registry-capacity.py')));
});
test('local imports and unreviewed calls cannot acquire formal-host execution authority',async()=>{
 await assert.rejects(inspectRegistryRecovery());await assert.rejects(publishRegistryRecovery());await assert.rejects(auditRegistryRecovery());await assert.rejects(auditRegistryRecovery('finish'));
 const source=readFileSync(new URL('./release-toolchain-registry-recovery.mjs',import.meta.url),'utf8');
 for(const token of ['withPinnedFormalPm2Process','withRetainedApplicationAttestation','withOnlineRetentionLocks','collectRemoteReleaseReview','assertRegistryRecoverySourceDelta','verifyWorkerEntryCiArtifact','captureFileContinuity','assertBookingReadyWorkerRawTransition','assertCompletePm2DumpSet','readNaturalWorkerCycle','automaticRetryAllowed:false','attempt_replay_forbidden'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/runMerchantBookingAutomationForAllSites|\.tick\(|process\.kill|\['restart'|\['delete'|RESEND_API_KEY\s*=/);
});
test('mandatory bounded Python transport and real Linux peer regressions',()=>{
 const python=process.platform==='win32'?'python':'python3';
 for(const file of ['release-toolchain-registry-capacity.test.py','release-toolchain-registry-capacity-native.test.py']){
  const r=spawnSync(python,['-B',fileURLToPath(new URL('./'+file,import.meta.url))],{encoding:'utf8',timeout:20000});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,(r.stdout??'')+(r.stderr??''));
 }
});
