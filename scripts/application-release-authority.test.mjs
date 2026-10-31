import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertApplicationPriorStates,reviewedApplicationExecution,withReviewedApplicationExecution} from './application-release-authority.mjs';
import {applicationReleaseInstallGitPlan} from './application-release-install.mjs';
import {readReviewedApplicationFixture} from './test-support/reviewed-application-fixture.mjs';
import {BOOKING_SCOPE} from './booking-publication-policy.mjs';
import {assertApplicationOperationOwner} from './online-release-retention-writer.mjs';
test('historical state bytes and original inodes are bound, never marked completed or silently discarded',()=>{
 const row={target:'a'.repeat(40),sha256:'b'.repeat(64),device:1,inode:22,mode:0o100600,uid:0,links:1};
 const digest=assertApplicationPriorStates([row]);assert.match(digest,/^[a-f0-9]{64}$/);
 assert.notEqual(assertApplicationPriorStates([{...row,inode:23}]),digest);
 assert.notEqual(assertApplicationPriorStates([{...row,sha256:'c'.repeat(64)}]),digest);
 for(const value of [[],[row,row],[{...row,mode:0o100644}],[{...row,uid:1}],[{...row,links:2}],[{...row,target:'../x'}]])
  assert.throws(()=>assertApplicationPriorStates(value));
});
test('serialized green records and arbitrary lock objects cannot mint the application capability',async()=>{
 assert.equal(reviewedApplicationExecution('a'.repeat(40),'a'.repeat(40)),null);
 await assert.rejects(withReviewedApplicationExecution({target:'a'.repeat(40),baseline:'b'.repeat(40),lock:{verified:true}},()=>assert.fail('must not enter')));
});
test('standard source installation always checks out a complete independent exact revision, with no caller paths or forced source reset',()=>{
 const revision='a'.repeat(40),plan=applicationReleaseInstallGitPlan(revision);
 assert.deepEqual(plan.at(-1).args,['read-tree','-mu','HEAD']);assert.equal(plan.length,5);
 assert.deepEqual(plan[0].args,['worktree','add','--detach','--no-checkout','/var/lib/faolla-online-code/'+revision,revision]);
 assert.equal(plan[1].input,'/*\n!/public/downloads/\n');
 assert.ok(!JSON.stringify(plan).includes('--force'));
 for(const value of ['../x',revision+'\n',null])assert.throws(()=>applicationReleaseInstallGitPlan(value));
});
test('historical application fixtures retain the original immutable production pins rather than admitting the new fixes to old lanes',()=>{
 const hash=file=>createHash('sha256').update(readReviewedApplicationFixture(file)).digest('hex');
 assert.equal(hash('src/components/admin/MerchantEnterpriseManager.tsx'),'282a63075363611b6e59d52e831b45836b653e77b749c511ffd41603845c50fe');
 assert.equal(hash('package.json'),BOOKING_SCOPE.pins['package.json']);
});
test('orphan ownership binds the exact controller and original directory birth, not a reused inode or caller-provided path',()=>{
 const target='a'.repeat(40),id='10000000-0000-4000-8000-000000000001',operation={dev:1,ino:22,mode:0o40700,uid:0},operationBirth={createdNs:'1000000000000',changedNs:'1000000000000'},deploy={dev:1,ino:23,mode:0o100600,uid:0};
 const owner={kind:'ordinary-application-operation-owner',target,action:'activate',id,operation,operationBirth,deploy,
  controller:{pid:900,uid:0,parentPid:800,startTicks:'123',executable:'/usr/bin/node',cwd:'/var/lib/faolla-online-code/'+target,commandSha256:'b'.repeat(64),environmentSha256:'c'.repeat(64)},
  activeSha256:'d'.repeat(64),retentionHeadSha256:'e'.repeat(64),at:'2026-10-31T22:00:00.000Z'};
 const expected={target,operation,operationBirth,deploy,file:id+'.owner.json'};assert.equal(assertApplicationOperationOwner(owner,expected),true);
 for(const mutate of [value=>value.id='../../escape',value=>value.controller.uid=1,value=>value.controller.pid=0,value=>value.controller.cwd='/tmp',
  value=>value.operationBirth.createdNs='1000000000001',value=>value.operation.ino++,value=>value.target='f'.repeat(40),value=>value.extra=true]){
  const changed=structuredClone(owner);mutate(changed);assert.throws(()=>assertApplicationOperationOwner(changed,expected));
 }
});
