//209 inert fixture contract checks only. These do not claim PostgreSQL or
//browser acceptance; the root-owned runner executes those separate checks.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPosthocFullLeaveNative} from './attendance-plan-posthoc-full-leave-native.mjs';

const source=readFileSync(new URL('./attendance-plan-posthoc-full-leave-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>parts.forEach(part=>assert(source.includes(part),part));
const ordered=(...parts)=>{let previous=-1;for(const part of parts){const index=source.indexOf(part,previous+1);assert(index>previous,part);previous=index;}};

test('209 callback is optional in its second argument and malformed callbacks fail before any runtime access',async()=>{
  assert.equal(typeof verifyPosthocFullLeaveNative,'function');
  await assert.rejects(verifyPosthocFullLeaveNative({}, {onPrepared:true}),/full_leave_onPrepared_must_be_a_function/);
  has('verifyPosthocFullLeaveNative({d,h,native,scope,next},{onPrepared=null}={})',
    'assertLifecycleSandbox(sql=>native.query(scope.sql(sql)))');
  assert.doesNotMatch(source,/initdb|CREATE DATABASE|pg_dump|child_process|process\.env|process\.argv|disable trigger|delete from|drop (?:table|trigger|function)/i);
});

test('the callback receives only the actual approved full-leave, empty-adoption target, never a fabricated decision',()=>{
  ordered("await leave('self',{operationId:requestId,action:'submit'", "await leave('owner',{operationId:next(),action:'approve'",
    "adopt({action:'apply'",'sources:[]', "assert.equal(full.detail.current.state,'not_applicable')",'await onPrepared(');
  has('h:{...h,slot,query:{siteId:d.site,workerId:h.workerId,slotId}}',
    'selected:[],rq,review,read,make:decision,all,period,pq,periodId,requestId,seal,reopen,cancel,periodArchive');
  assert.deepEqual([...source.matchAll(/insert into public\.([a-z_]+)/g)].map(match=>match[1]),[
    'merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_publication_evidence']);
  has('syntheticScheduleRows:3,actualPastPublication:false','set constraints all immediate');
});

test('sealing is once-only and uses real preview, send, self-confirm and owner seal, with a separate fixed archive',()=>{
  ordered("assert.equal(sealStarted,false,'full_leave_seal_once')",'sealStarted=true',
    'const current=read()',"assert.equal(current.detail.latestDecision.outcome,'not_applicable')",'const preview=await period(pq())',
    "pc('send',null,preview.preview.artifact.sourceFingerprint)","pq('detail','self',periodId),pc('confirm',closed)",
    "pq('detail','owner',periodId),pc('seal',closed)",'sealedArchive=periodArchive();return closed');
  has("...pq('export','owner',periodId),version:1",'full_leave_archive_zero_writes','full_leave_read_zero_writes');
  assert.doesNotMatch(source,/update public\.merchant_attendance_period_closures|sealed\s*=\s*(?:true|false)/i);
});

test('callback-reported IDs are verified by real GET receipt and exact prior basis, not browser self-report',()=>{
  ordered('const completed=await onPrepared(',"read(rq('recover','owner',completed.operationId))",
    "assert(recovered.receipt,'full_leave_callback_operation_must_exist')",'final=recovered.receipt.command',
    'assert.equal(final.expectedRevision,full.detail.revision)',
    'assert.equal(final.expectedFingerprint,full.detail.current.fingerprint)',
    'assert.equal(recovered.detail.revision,recovered.receipt.item.revision)',
    'assert.equal(recovered.detail.latestDecision.readAt,null)',
    "assert.equal(sealStarted,true,'full_leave_callback_must_seal')",
    "assert.equal(stillApproved.detail.status,'approved')",'assert.equal(stillSealed.sourceChanged,false)',
    'browserResult=completed.browserResult');
  has('assert.equal(reopenStarted,false);assert.equal(cancelStarted,false)',
    'assert.equal(notification.length,1)',".detail.type,'not_applicable'");
});

test('default207 path remains real decision, self history, one notification, then first seal without a callback',()=>{
  ordered('if(onPrepared===null){',"final=decision(full,'not_applicable');review(rq('decide','owner',final.operationId),final)",
    "assert.equal(read(rq('detail','self')).detail.latestDecision.evidence.evaluation.state,'not_applicable')",
    'assert.equal(notification.length,1)',".detail.type,'not_applicable'",'if(onPrepared===null)await seal();','await cancel();');
  has('...(onPrepared===null?{}:{browserResult})');
});

test('both paths preserve approved-then-cancel semantics, frozen bytes, sealed refusal and same-number retry only after reopen',()=>{
  ordered('await cancel();','const changed=review();assert(changed.detail.stale)',
    'assert.equal(changedPeriod.sourceChanged,true)',
    'assert.equal(periodArchive().artifactText,sealedArchive.artifactText)',
    'assert.equal(periodArchive().artifactSha256,sealedArchive.artifactSha256)',
    'const follow=decision(changed,', '/attendance_period_sealed/',
    'assert.equal(d.fingerprint(d.inventory()),beforeDenied)','await reopen();',
    "review(rq('decide','owner',follow.operationId),follow).detail.latestDecision.outcome,'follow_up'",
    "review(rq('recover','owner',final.operationId)).receipt.item.outcome,'not_applicable'");
  has("action:'cancel',requestId,expectedRevision:2",'full_leave_reopen_once','full_leave_cancel_once');
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:leave|plan_exception|period)_[a-z_]+/i);
});
