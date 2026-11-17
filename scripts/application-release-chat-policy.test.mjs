import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {CHAT_TARGET as T,CHAT_BASELINE as B,CHAT_PINS as P,CHAT_CONTINUATION_FILES as FILES,assertChatContinuationDelta,assertChatContinuationInvocation,chatContinuationPhase,assertChatOperationOwner} from './application-release-chat-policy.mjs';
import {ordinaryPublicationSteps} from './application-release-publish.mjs';
import {chatCycleAfter} from './application-release-chat-policy.mjs';
const revision='e'.repeat(40),directory='/var/lib/faolla-online-code/'+revision;
const invoke={argv:['/usr/bin/node',directory+'/scripts/application-release-chat-continuation.mjs','run'],directory,platform:'linux',uid:0,executable:'/usr/bin/node'};
test('only the exact newly reviewed Linux/root entry can select this fixed target',()=>{
 assert.equal(assertChatContinuationInvocation(invoke).target,T);
 for(const patch of [{platform:'win32'},{uid:1},{executable:'/usr/local/bin/node'},{directory:'/tmp/'+revision},{argv:[...invoke.argv,'extra']},{argv:[...invoke.argv.slice(0,2),'activate']}])assert.throws(()=>assertChatContinuationInvocation({...invoke,...patch}));
});
test('the original rolled-back guard is not relaxed by the separate fixed continuation',()=>{
 const state={target:T,baseline:B,status:'rolled-back',lane:'reviewed-application-code-only-v1'};
 assert.throws(()=>ordinaryPublicationSteps(T,B,state),/requires_review/);
 assert.equal(chatContinuationPhase(state,{target:B}),'restored');
 assert.equal(chatContinuationPhase({...state,status:'active'},{target:T}),'active');
 assert.equal(chatContinuationPhase({...state,status:'active',applicationCompletion:{status:'completed'}},{target:T}),'completed');
 for(const patch of [{target:'a'.repeat(40)},{baseline:T},{status:'preparing'},{lane:'booking'}])assert.throws(()=>chatContinuationPhase({...state,...patch},{target:B}));
});
test('every changed tool file is exact and no app/dependency/migration change can hide in source binding',()=>{
 const base=[{file:'src/app/page.tsx',mode:'100644',oid:'a'.repeat(40)},{file:'package.json',mode:'100644',oid:'b'.repeat(40)}];
 const after=[...base,...FILES.map(file=>({file,mode:'100644',oid:'c'.repeat(40)}))];
 assert.equal(assertChatContinuationDelta(base,after).source.domain,'application-source');
 for(const rows of [after.slice(0,-1),[...after,{file:'scripts/other.mjs',mode:'100644',oid:'d'.repeat(40)}],after.map(r=>r.file==='src/app/page.tsx'?{...r,oid:'f'.repeat(40)}:r),after.map(r=>r.file===FILES[0]?{...r,mode:'100755'}:r)])assert.throws(()=>assertChatContinuationDelta(base,rows));
 assert.equal(P.target,T);assert.equal(P.baseline,B);assert.equal(P.candidate.port,3109);assert.equal(P.build.files,2121);
});
test('all new continuation modules remain inert on ordinary developer import',()=>{
 const r=spawnSync(process.execPath,['--input-type=module','-e',"await import('./scripts/application-release-chat-continuation.mjs');"],{encoding:'utf8',timeout:10000,windowsHide:true});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
});
test('new operation ownership cannot accept unknown fields, changed controller birth or foreign source',()=>{
 const operation={dev:1,ino:22,uid:0,mode:0o40700},operationBirth={createdNs:'1',changedNs:'1'},deploy={dev:1,ino:23,uid:0,mode:0o100600};
 const owner={kind:'chat-continuation-operation-owner',target:T,toolRevision:revision,id:'10000000-0000-4000-8000-000000000001',controller:{pid:10,parentPid:9,uid:0,startTicks:'100',executable:'/usr/bin/node',cwd:directory,commandSha256:'a'.repeat(64),environmentSha256:'b'.repeat(64)},operation,operationBirth,deploy,at:'2026-11-15T12:39:07.304Z'};
 const expected={toolRevision:revision,operation,operationBirth,deploy};assert.equal(assertChatOperationOwner(owner,expected),true);
 for(const mutate of [v=>v.extra=true,v=>v.controller.pid=0,v=>v.controller.cwd='/tmp',v=>v.operationBirth={...v.operationBirth,createdNs:'2'},v=>v.toolRevision=T,v=>v.controller.environmentSha256='invalid']){const v=structuredClone(owner);mutate(v);assert.throws(()=>assertChatOperationOwner(v,expected));}
});

test('only natural cycles after the new actual activation can satisfy this retained attempt',()=>{
 const state={target:T,activatedAt:'2026-11-17T18:00:00.000Z'},certificate={active:{target:T},completedAt:'2026-11-17T14:00:00.000Z'};
 assert.equal(chatCycleAfter(state,certificate),Date.parse(state.activatedAt));
 assert.equal(chatCycleAfter(state,{...certificate,completedAt:'2026-11-17T19:00:00.000Z'}),Date.parse('2026-11-17T19:00:00.000Z'));
 for(const patch of [{target:B},{activatedAt:undefined}])assert.throws(()=>chatCycleAfter({...state,...patch},certificate));
 assert.throws(()=>chatCycleAfter(state,{...certificate,active:{target:B}}));
});
