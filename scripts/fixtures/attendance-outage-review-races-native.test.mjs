//Pure construction and bounded source assertions, not native acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageReviewRacePlan,outageReviewRaceGroups,outageReviewRaceProtectedSql} from './attendance-outage-review-races-native.mjs';
const source=readFileSync(new URL('./attendance-outage-review-races-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',employee:id(102),auth:id(2),worker:id(202),location:id(4),workerVersion:7,employeeVersion:3,generation:2,
 startAt:'2026-10-05T09:40:00.000000Z',endAt:'2026-10-05T09:45:00.000000Z',now:'2026-10-07T11:00:00.000000Z',
 sealedStart:'2026-10-04T00:00:00.000000Z',sealedEnd:'2026-10-05T00:00:00.000000Z'};
test('four plans use disjoint218 IDs and only proved session range, not the existing sealed day',()=>{
 assert.deepEqual(outageReviewRaceGroups,['confirm_first','propose_first','revoke_first','resolve_first']);
 const plans=outageReviewRaceGroups.map(g=>createOutageReviewRacePlan(input,g));
 assert.equal(new Set(plans.flatMap(p=>p.operationIds)).size,32);
 for(const p of plans){
  assert.equal(p.incident.interval.startAt,input.startAt);assert.equal(p.incident.interval.endAt,input.endAt);
  assert.deepEqual(p.declaration.interval,p.incident.interval);assert.equal(p.declaration.expectedWorkerVersion,7);
  assert.equal(p.declaration.expectedEmployeeVersion,3);assert.equal(p.declaration.expectedGeneration,2);
  assert.equal(p.declaration.workerId,input.worker);assert.equal(p.declaration.employeeId,input.employee);assert.equal(p.declaration.employeeAuthUserId,input.auth);
  assert.equal(p.declaration.originalOperationId,null);assert.equal(p.declaration.originalChannel,null);
  assert.deepEqual(p.reference,{kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null});
  assert.deepEqual(p.q('recover','self',p.fresh(11)),{siteId:input.site,access:'self',mode:'recover',declarationId:p.declaration.declarationId,operationId:p.fresh(11)});
 }
 assert.throws(()=>createOutageReviewRacePlan(input,'other'));
 assert.throws(()=>createOutageReviewRacePlan({...input,sealedEnd:'2026-10-05T10:00:00.000Z'},'confirm_first'));
 assert.throws(()=>createOutageReviewRacePlan({...input,now:input.startAt},'confirm_first'));
 assert.throws(()=>createOutageReviewRacePlan({...input,workerVersion:0},'confirm_first'));
});
test('protection excludes exact new operations only within allowed tables and the owned merchant',()=>{
 const p=createOutageReviewRacePlan(input,'confirm_first'),names=['merchants','merchant_attendance_events','merchant_attendance_outage_operations','merchant_attendance_outage_review_operations'];
 const sql=outageReviewRaceProtectedSql(names,input.site,[p.fresh(10)]);
 assert(sql.includes("race_row.merchant_id='99990001'"));assert(sql.includes("'"+p.fresh(10)+"'::uuid"));
 assert(sql.includes('from public.merchant_attendance_events race_row) race_rows'));
 assert(sql.includes('from public.merchant_attendance_outage_review_operations race_row where not'));
 assert(!outageReviewRaceProtectedSql(names,input.site).includes(' where not'));
 assert.throws(()=>outageReviewRaceProtectedSql(names,input.site,[id(204710)]));
 assert.throws(()=>outageReviewRaceProtectedSql(names,input.site,[p.fresh(10),p.fresh(10)]));
 assert.throws(()=>outageReviewRaceProtectedSql(['unsafe;drop'],input.site));
 assert.throws(()=>outageReviewRaceProtectedSql(names,'production'));
});
test('inert fixture only uses caller-owned ports, untouched constraints and actual148 identity proof',()=>{
 for(const token of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
  'd.guard',"t.tgenabled<>'O'",'not c.convalidated','c.relrowsecurity','public.faolla_attendance_period_session_v1(',
  "[[startId,3,'clock_in'],[endId,4,'clock_out']]",'profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId',
  'JSON.parse(savedArchive.artifactText).period'])assert(source.includes(token),token);
 for(const forbidden of ['spawn(','listen(','process.argv','pg_ctl','initdb','create database','disable trigger','session_replication_role',
  'set lock_timeout','set statement_timeout','insert into public.merchant_attendance_events','update public.merchant_','delete from'])assert(!source.includes(forbidden),forbidden);
});
test('every real command and returned result use existing176177178 RPCs and strict projectors',()=>{
 for(const token of ['faolla_attendance_outage_v1','faolla_attendance_outage_links_v1','faolla_attendance_outage_review_v1',
  'projectOutageResult','projectOutageLinksResult','projectOutageReviewResult','expectedRevision:view.revision','expectedResultVersion:view.resultVersion',
  'view.status.basisFingerprint','view.proposal.resultFingerprint','set constraints all immediate;set constraints all deferred;reset role',
  "call(spec('outage'","call(spec('links'","call(spec('review'"])assert(source.includes(token),token);
});
test('two opposite CAS orientations prepare both commands before exact-PID witnessed holder commit',()=>{
 for(const token of ['lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql}',
  "const first=p.group==='confirm_first'",'first?confirm:propose,first?propose:confirm',"'attendance_outage_review_changed'",
  'assert.equal(confirm.c.expectedRevision,propose.c.expectedRevision)','assert.equal(confirm.c.expectedResultVersion,propose.c.expectedResultVersion)',
  'assert.equal(result.witnessed,true,label)','assert.equal(all(),holderHash,label+\':failed_waiter_zero_residue\')'])assert(source.includes(token),token);
 assert(!source.includes('rollback:true'));assert(!source.includes('setTimeout('));
});
test('link revoke and resolve test both blocked loser and valid two-commit ordering without pretending source clocks changed',()=>{
 for(const token of ["const first=p.group==='revoke_first'",'first?revoke:resolve,first?resolve:revoke',
  "first?'attendance_outage_review_blocked':null","current.current.action,first?'confirm':'resolve'",
  "['link_revoked','link_changed','result_changed']",'current.status.resolved,false','assert.deepEqual(current.proposal,proposal.proposal)',
  'assert.equal(result.right.error,null,label)','right=record(waiter,parse(waiter,result.right.output))'])assert(source.includes(token),token);
 for(const forbidden of ['correction_self','correction_decide','missing_v1'])assert(!source.includes(forbidden),forbidden);
});
test('fresh eligibility, saved recovery and exact retries retain actual actors and never refresh a waiting command',()=>{
 for(const token of ['preview.preview.eligible,true','selfView.status.canConfirm,true','ownerView.status.canPropose,true',
  'confirmed.status.canResolve,true',"p.q('recover',original.q.access,original.c.operationId),null,false",'recovered.receipt,original.receipt',
  'call({...original,allow:false},true).receipt,original.receipt','current.response.actorId,h.employeeAuthUserId',
  'current.response,null','history.historyTruncated,false'])assert(source.includes(token),token);
});
test('all old rows and archives remain protected while new rows commit for outer namespace cleanup',()=>{
 for(const token of ["'outage_review_race_protected_rows_changed'","'outage_review_race_preexisting_facts_changed'",
  'd.definitions(),defs','d.tableCatalog(),catalog','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,savedArchive.artifactText','periodArchive().artifactSha256,savedArchive.artifactSha256',
  'periodAfter.sourceChanged,periodBefore.sourceChanged','assert.deepEqual(periodAfter.period,periodBefore.period)',
  'assert.equal(committedIds.length,23)','assert.equal(rejections,3)',
  'merchant_attendance_outage_review_operations:9','merchant_attendance_outage_link_operations:6',
  'committedOnlyInCallerOwnedSchema:true,allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true','finally{preserve();}'])assert(source.includes(token),token);
});
