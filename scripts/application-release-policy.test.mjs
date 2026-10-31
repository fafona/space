import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationRetentionFixture} from './test-support/application-release-retention-fixture.mjs';
import {APPLICATION_RELEASE_MANIFEST, applicationReleaseChanges, applicationReleaseRole,
  assertApplicationReleasePackage, createApplicationReleaseManifest, assertApplicationReleaseManifest,
  assertApplicationWorkerSuccessor} from './application-release-policy.mjs';
import {onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed} from './online-traffic-release-policy.mjs';
import {buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {retentionHash,assertOnlineRetentionHistory} from './online-release-retention-policy.mjs';
import {assertBookingAtomicWorkerGate} from './booking-atomic-worker.mjs';
const base='a'.repeat(40), oid='b'.repeat(40), next='c'.repeat(40);
const row=(file,hash=oid)=>({file,mode:'100644',oid:hash});
const before=[row('src/example.ts'),row('src/example.test.ts')];
const after=[row('src/example.ts',next),row('src/example.test.ts',next),row(APPLICATION_RELEASE_MANIFEST)];
const input=()=>({baseline:base,baselineRows:before,targetRows:after,focusedTests:['src/example.test.ts'],purpose:'Reviewed ordinary application correction'});
test('ordinary releases bind exact application, operational and verification blobs without a fixed target',()=>{
 const manifest=createApplicationReleaseManifest(input());
 assert.equal(assertApplicationReleaseManifest(manifest,input()).applicationPaths[0],'src/example.ts');
 assert.equal(manifest.changes.length,2);
 assert.throws(()=>assertApplicationReleaseManifest(manifest,{...input(),targetRows:[...after,row('src/extra.ts')]}),/scope_changed/);
 for(const mutation of [{...manifest,baseline:next},{...manifest,mail:'on'},{...manifest,extra:true},{...manifest,changes:manifest.changes.slice(1)}])
  assert.throws(()=>assertApplicationReleaseManifest(mutation,input()));
});
test('no role can launder migrations, dependencies, unknown scripts, unsafe paths or symlinks',()=>{
 for(const file of ['scripts/supabase-migrations/999.sql','supabase/migrations/foo.ts','package-lock.json','.env.local','src/../secret.ts','src/a b.ts','scripts/arbitrary-runtime.mjs'])
  assert.throws(()=>applicationReleaseRole(file),file);
 assert.throws(()=>applicationReleaseChanges(before,[{...row('src/a.ts'),mode:'120000'}]));
 assert.equal(applicationReleaseRole('scripts/application-release-policy.mjs'),'release-tool');
 assert.equal(applicationReleaseRole('scripts/booking-atomic-worker.mjs'),'release-tool');
});
test('package permits reviewed test-script changes, never dependency, build or lifecycle changes',()=>{
 const original={scripts:{build:'next build',test:'node --test'},dependencies:{next:'16.3.4'}};
 assert.equal(assertApplicationReleasePackage(original,{...original,scripts:{...original.scripts,'test:browser':'node browser.mjs'}}),true);
 for(const changed of [{...original,dependencies:{next:'17'}},{...original,scripts:{...original.scripts,build:'true'}},
  {...original,scripts:{...original.scripts,postinstall:'node mutate.mjs'}},{...original,overrides:{next:'17'}}])
  assert.throws(()=>assertApplicationReleasePackage(original,changed));
});
test('missing, non-test, duplicate and untracked focused tests fail closed',()=>{
 for(const focusedTests of [[],['src/example.ts'],['missing.test.ts'],['src/example.test.ts','src/example.test.ts']])
  assert.throws(()=>createApplicationReleaseManifest({...input(),focusedTests}));
});
test('worker follows only explicitly attested consecutive code-only web successors',()=>{
 const publication={kind:'booking-handoff',active:{target:base},rollback:{target:oid}};
 const worker={kind:'booking-worker',active:{target:base},rollback:{target:oid}};
 const successor={kind:'converge',active:{target:next},rollback:{target:base},victim:null,
  applicationRelease:{kind:'reviewed-application-code-only-v1',baseline:base,manifestSha256:'d'.repeat(64)}};
 const check=(entries,target=next)=>assertApplicationWorkerSuccessor({history:{entries},publication,actualActive:{target}});
 assert.equal(check([publication,worker,successor]),true);
 assert.equal(check([publication,worker,successor],base),true);
 for(const change of [{...successor,applicationRelease:undefined},{...successor,rollback:{target:oid}},
  {...successor,rollbackProof:{}},{...successor,applicationRelease:{...successor.applicationRelease,baseline:oid}}])
  assert.throws(()=>check([publication,worker,change]));
 assert.throws(()=>check([publication,worker,successor],oid));
});
test('the normal application lane never enters any database phase',()=>{
 assert.equal(onlineReleaseStageStatus('reviewed-application-code-only-v1'),'ready-no-database');
 assert.equal(onlineReleaseActivationStatus('reviewed-application-code-only-v1'),'ready-no-database');
 assert.throws(()=>assertOnlineReleaseDatabaseAllowed('reviewed-application-code-only-v1'),/database_forbidden/);
});

test('a full retained successor receipt keeps the real worker gate valid on the new web and retained rollback',()=>{
 const {fixture,recovery,history,before,old}=applicationRetentionFixture();
 const receipt=buildOnlineRetentionReceipt(before,structuredClone(before),recovery,history,
  {preparedAt:'2026-10-26T10:02:00.000Z',completedAt:'2026-10-26T10:02:00.000Z'});
 const final={...history,entries:[...history.entries,receipt.certificate],headSha256:retentionHash(receipt.certificate)};
 assertOnlineRetentionHistory(final);
 const gate={schemaVersion:1,kind:'booking-atomic-worker-gate',candidate:old.target,toolRevision:fixture.before.toolRevision,
  certificateSha256:history.headSha256,generation:fixture.handoff.databaseAfter.generation,enabled:true};
 const verify=actualActive=>assertBookingAtomicWorkerGate({gate,history:final,actualActive,current:before.processes,toolRevision:gate.toolRevision});
 assert.equal(verify(before.activeFile).generation,gate.generation);
 assert.equal(verify(Object.fromEntries(['target','name','directory','port'].map(key=>[key,old[key]]))).generation,gate.generation);
 const invalid=structuredClone(receipt.certificate);invalid.applicationRelease.baseline='0'.repeat(40);
 assert.throws(()=>assertOnlineRetentionHistory({...final,entries:[...history.entries,invalid],headSha256:retentionHash(invalid)}),/certificate_binding/);
});
