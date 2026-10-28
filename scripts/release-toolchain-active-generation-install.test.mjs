import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {activeToolInstallGitPlan,assertActiveBootstrapBytes,installReviewedActiveBookingTool} from './release-toolchain-active-generation-install.mjs';
test('active source bootstrap has a fixed complete sparse checkout without moving formal refs',()=>{
 const revision='a'.repeat(40),plan=activeToolInstallGitPlan(revision);assert.equal(plan.length,5);assert.deepEqual(plan[0],{cwd:'/www/wwwroot/merchant-space',args:['worktree','add','--detach','--no-checkout','/var/lib/faolla-online-code/'+revision,revision]});assert.deepEqual(plan.at(-1).args,['read-tree','-mu','HEAD']);
 assert.equal(plan[1].input,'/*\n!/public/downloads/\n');assert.ok(plan.every(c=>!c.args.some(v=>['reset','update-ref','merge','push','branch'].includes(v))));
 for(const value of ['main','../path','A'.repeat(40),'a'.repeat(40)+'\n',null])assert.throws(()=>activeToolInstallGitPlan(value));
});
test('bootstrap must be byte-for-byte the independently reviewed Git blob',()=>{
 const bytes=Buffer.from('committed bootstrap');assert.equal(assertActiveBootstrapBytes(bytes,Buffer.from(bytes)),true);
 for(const pair of [[bytes,Buffer.from('changed')],[Buffer.alloc(0),Buffer.alloc(0)],[Buffer.alloc(128*1024+1),Buffer.alloc(128*1024+1)],['green',bytes]])assert.throws(()=>assertActiveBootstrapBytes(...pair));
});
test('an ordinary local invocation cannot install or select another bootstrap path',async()=>{await assert.rejects(installReviewedActiveBookingTool());});
test('the new bootstrap preserves old operation state and proves installed source and host unchanged',()=>{
 const source=readFileSync(new URL('./release-toolchain-active-generation-install.mjs',import.meta.url),'utf8');
 for(const token of ['collectRemoteReleaseReview(revision)','assertActiveBootstrapBytes','inspectPinnedExecutionSource','assertUnchangedApplicationSource','inspectActiveBookingIncident({window})','assertActiveBookingObservedHostProgress(before,after)','same(after.activeMetadataSha256,before.activeMetadataSha256)','same(after.metadataCorrected,before.metadataCorrected)','--nonblock','fs.closeSync(fd)','originalOperationRetained:true','applicationPublished:false'])assert.ok(source.includes(token),token);
 assert.doesNotMatch(source,/rmdirSync|unlinkSync|rmSync|renameSync|bookingHostSql|process\.kill|\.deployFd/);
 const original=readFileSync(new URL('./release-toolchain-install.mjs',import.meta.url),'utf8');assert.ok(original.includes('fs.mkdirSync(operation,{mode:0o700})'));assert.ok(original.includes("phase==='ended'"));
});
