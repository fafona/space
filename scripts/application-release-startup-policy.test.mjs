import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {STARTUP_TARGET as T,STARTUP_BASELINE as B,STARTUP_PINS as P,STARTUP_CONTINUATION_FILES as FILES,assertStartupContinuationDelta,assertStartupContinuationInvocation,startupContinuationPhase,assertStartupOperationOwner} from './application-release-startup-policy.mjs';
import {ordinaryPublicationSteps} from './application-release-publish.mjs';
import {startupHeadBindingText,startupRollbackHeadBinding,assertStartupMaintenanceSuffix} from './application-release-startup-policy.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const revision='e'.repeat(40),directory='/var/lib/faolla-online-code/'+revision;
const invoke={argv:['/usr/bin/node',directory+'/scripts/application-release-startup-continuation.mjs','run'],directory,platform:'linux',uid:0,executable:'/usr/bin/node'};
test('only the exact newly reviewed Linux/root entry can select this fixed target',()=>{
 assert.equal(assertStartupContinuationInvocation(invoke).target,T);
 for(const patch of [{platform:'win32'},{uid:1},{executable:'/usr/local/bin/node'},{directory:'/tmp/'+revision},{argv:[...invoke.argv,'extra']},{argv:[...invoke.argv.slice(0,2),'activate']}])assert.throws(()=>assertStartupContinuationInvocation({...invoke,...patch}));
});
test('the original rolled-back guard is not relaxed by the separate fixed continuation',()=>{
 const state={target:T,baseline:B,status:'rolled-back',lane:'reviewed-application-code-only-v1'};
 assert.throws(()=>ordinaryPublicationSteps(T,B,state),/requires_review/);
 assert.equal(startupContinuationPhase(state,{target:B}),'restored');
 assert.equal(startupContinuationPhase({...state,status:'active'},{target:T}),'active');
 assert.equal(startupContinuationPhase({...state,status:'active',applicationCompletion:{status:'completed'}},{target:T}),'completed');
 for(const patch of [{target:'a'.repeat(40)},{baseline:T},{status:'preparing'},{lane:'booking'}])assert.throws(()=>startupContinuationPhase({...state,...patch},{target:B}));
});
test('every changed tool file is exact and no app/dependency/migration change can hide in source binding',()=>{
 const base=[{file:'src/app/page.tsx',mode:'100644',oid:'a'.repeat(40)},{file:'package.json',mode:'100644',oid:'b'.repeat(40)}];
 const after=[...base,...FILES.map(file=>({file,mode:'100644',oid:'c'.repeat(40)}))];
 assert.equal(assertStartupContinuationDelta(base,after).source.domain,'application-source');
 for(const rows of [after.slice(0,-1),[...after,{file:'scripts/other.mjs',mode:'100644',oid:'d'.repeat(40)}],after.map(r=>r.file==='src/app/page.tsx'?{...r,oid:'f'.repeat(40)}:r),after.map(r=>r.file===FILES[0]?{...r,mode:'100755'}:r)])assert.throws(()=>assertStartupContinuationDelta(base,rows));
 assert.equal(P.target,T);assert.equal(P.baseline,B);assert.equal(P.originalRollbackHead,'16f2864ac509dcd56652e4ea0e0c294621cac13e00d03016eb2cd1c4f27c41fb');assert.equal(P.build.files,2107);
});
test('all new continuation modules remain inert on ordinary developer import',()=>{
 const r=spawnSync(process.execPath,['--input-type=module','-e',"await import('./scripts/application-release-startup-continuation.mjs');"],{encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
});
test('new operation ownership cannot accept unknown fields, changed controller birth or foreign source',()=>{
 const operation={dev:1,ino:22,uid:0,mode:0o40700},operationBirth={createdNs:'1',changedNs:'1'},deploy={dev:1,ino:23,uid:0,mode:0o100600};
 const owner={kind:'startup-continuation-operation-owner',target:T,toolRevision:revision,id:'10000000-0000-4000-8000-000000000001',controller:{pid:10,parentPid:9,uid:0,startTicks:'100',executable:'/usr/bin/node',cwd:directory,commandSha256:'a'.repeat(64),environmentSha256:'b'.repeat(64)},operation,operationBirth,deploy,at:'2026-11-15T12:39:07.304Z'};
 const expected={toolRevision:revision,operation,operationBirth,deploy};assert.equal(assertStartupOperationOwner(owner,expected),true);
 for(const mutate of [v=>v.extra=true,v=>v.controller.pid=0,v=>v.controller.cwd='/tmp',v=>v.operationBirth={...v.operationBirth,createdNs:'2'},v=>v.toolRevision=T,v=>v.controller.environmentSha256='invalid']){const v=structuredClone(owner);mutate(v);assert.throws(()=>assertStartupOperationOwner(v,expected));}
});

test('maintenance head binding changes exactly one field and cannot authorize foreign or already active state',()=>{
 const state={target:T,baseline:B,status:'rolled-back',retentionRollbackHeadSha256:P.originalRollbackHead,untouched:{nonce:'preserve'},rolledBackAt:'2026-11-17T00:00:00Z'};
 const original=JSON.stringify(state),after=JSON.parse(startupHeadBindingText(original));
 assert.deepEqual(after,{...state,retentionRollbackHeadSha256:P.head.headSha256});
 assert.throws(()=>startupRollbackHeadBinding(original,{}),/original_state_changed/);
 for(const patch of [{target:B},{baseline:T},{status:'active'},{retentionRollbackHeadSha256:P.head.headSha256},{applicationCompletion:{status:'completed'}}])assert.throws(()=>startupHeadBindingText(JSON.stringify({...state,...patch})));
 const history={headSha256:P.head.headSha256,entries:[...Array.from({length:64},()=>({})),{sequence:65,kind:'converge',active:{target:T},rollback:{target:B}},{sequence:66,kind:P.history[1].kind,previousSha256:P.originalRollbackHead,active:{target:T},rollback:{target:B},processes:[structuredClone(P.history[1].worker)]}]};
 assert.equal(assertStartupMaintenanceSuffix(history),true);
 for(const alter of [v=>v.headSha256='a'.repeat(64),v=>v.entries.pop(),v=>v.entries[65].kind='retire',v=>v.entries[65].previousSha256='a'.repeat(64),v=>v.entries[65].processes[0].pid++,v=>v.entries[64].rollback.target=T]){const v=structuredClone(history);alter(v);assert.throws(()=>assertStartupMaintenanceSuffix(v));}
});

test('the entire old ordinary selector and navigation authorities remain byte-exact',()=>{
 const pins={'application-release-publish.mjs':'0b8b0693249b1d078779ee0e5c7b0d637363d49cebb4d69e86fbbfe59a5c56db',
  'application-release-navigation-policy.mjs':'3d39c96c07b177d05be0e3d43c34e9917c92280efb50cef549d92b1aeb45cc9e',
  'application-release-navigation-source.mjs':'be856391389cb1d3e35a3e55f9610f3edfe42d148eb5b04e77b935d976692b4f',
  'application-release-navigation-continuation.mjs':'466070f3ac4b036f7bbb4692fec21d00bb8c26eb5141246a7be80669ab6542ac'};
 for(const [file,hash]of Object.entries(pins)){
  assert.equal(createHash('sha256').update(readFileSync(new URL('./'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n')).digest('hex'),hash);
 }
});
