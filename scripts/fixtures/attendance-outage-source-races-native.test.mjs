//Pure fixture contracts only. No database or browser is started by these tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageSourceRacePlan,outageSourceRaceGroups,outageSourceRaceProtectedSql,outageSourceRaceAllowances} from './attendance-outage-source-races-native.mjs';
const source=readFileSync(new URL('./attendance-outage-source-races-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',worker:id(202),employee:id(102),auth:id(2),location:id(4),workerVersion:7,employeeVersion:3,generation:2,
 startAt:'2026-10-05T09:40:00.000000Z',endAt:'2026-10-05T09:45:00.000000Z',now:'2026-10-07T11:00:00.000000Z',
 sealedStart:'2026-10-04T00:00:00.000000Z',sealedEnd:'2026-10-05T00:00:00.000000Z'};

test('two disjoint219 plans retain real204 identity and reference, never extend the existing sealed period',()=>{
 assert.deepEqual(outageSourceRaceGroups,['submit_first','resolve_first']);
 const plans=outageSourceRaceGroups.map(group=>createOutageSourceRacePlan(input,group));
 assert.equal(new Set(plans.flatMap(p=>[...p.outageOperationIds,...p.correctionOperationIds])).size,16);
 for(const p of plans){
  assert.equal(p.incident.interval.startAt,input.startAt);assert.equal(p.incident.interval.endAt,input.endAt);
  assert.deepEqual(p.declaration.interval,p.incident.interval);assert.equal(p.declaration.expectedWorkerVersion,7);
  assert.equal(p.declaration.expectedEmployeeVersion,3);assert.equal(p.declaration.expectedGeneration,2);
  assert.equal(p.declaration.workerId,input.worker);assert.equal(p.declaration.employeeId,input.employee);assert.equal(p.declaration.employeeAuthUserId,input.auth);
  assert.equal(p.declaration.originalOperationId,null);assert.equal(p.declaration.originalChannel,null);
  assert.deepEqual(p.reference,{kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null});
  assert.deepEqual(p.proposal,{startAt:'2026-10-05T09:41:00.000000Z',endAt:'2026-10-05T09:46:00.000000Z',breaks:[]});
  assert.equal(Date.parse(p.proposal.endAt)-Date.parse(p.proposal.startAt),Date.parse(input.endAt)-Date.parse(input.startAt));
  assert.deepEqual(p.q('recover','self',p.fresh(11)),{siteId:input.site,access:'self',mode:'recover',declarationId:p.declaration.declarationId,operationId:p.fresh(11)});
 }
});
test('invalid, future, overlapping and cross-group construction cannot silently generate a test subject',()=>{
 for(const patch of [{workerVersion:0},{employeeVersion:1.5},{generation:-1},{startAt:input.endAt},{now:input.endAt},
  {sealedStart:input.startAt,sealedEnd:input.endAt},{sealedStart:'2026-10-05T09:45:30Z',sealedEnd:'2026-10-05T12:00:00Z'}])
  assert.throws(()=>createOutageSourceRacePlan({...input,...patch},'submit_first'));
 assert.throws(()=>createOutageSourceRacePlan(input,'approve_first'));
});
test('protected facts exclude exact operation IDs and binding request IDs only in their matching tables',()=>{
 const p=createOutageSourceRacePlan(input,'submit_first'),names=['merchants','merchant_attendance_events','merchant_attendance_correction_effects',
  'merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings','merchant_attendance_outage_review_operations'];
 const sql=outageSourceRaceProtectedSql(names,input.site,{outage:[p.fresh(12)],correction:p.correctionOperationIds,requests:[p.requestId]});
 assert(sql.includes("source_row.merchant_id='99990001'"));
 assert(sql.includes(`source_row.request_id=any(array['${p.requestId}'::uuid]`));
 assert(sql.includes(`source_row.operation_id=any(array['${p.fresh(30)}'::uuid,'${p.fresh(31)}'::uuid]`));
 for(const table of ['merchant_attendance_events','merchant_attendance_correction_effects'])assert(sql.includes(`from public.${table} source_row) source_rows`));
 assert(!outageSourceRaceProtectedSql(names,input.site).includes(' where not'));
 assert.throws(()=>outageSourceRaceProtectedSql(names,input.site,{correction:[id(204710)]}));
 assert.throws(()=>outageSourceRaceProtectedSql(names,input.site,{requests:[p.requestId,p.requestId]}));
 assert.throws(()=>outageSourceRaceProtectedSql(['bad;table'],input.site));
 assert.throws(()=>outageSourceRaceProtectedSql(names,'invalid'));
});
test('waiter hashes allow both exact commits becoming visible, without weakening standalone writes or unrelated rows',()=>{
 const p=createOutageSourceRacePlan(input,'resolve_first');
 const resolve={kind:'review',c:{action:'resolve',operationId:p.fresh(12)}},submit={kind:'correction',c:{action:'submit',operationId:p.fresh(30)}},
  withdraw={kind:'correction',c:{action:'withdraw',operationId:p.fresh(31)}};
 const wanted={outage:[p.fresh(12)],correction:[p.fresh(30)],requests:[p.fresh(30)]};
 assert.deepEqual(outageSourceRaceAllowances(resolve,submit),wanted);
 assert.deepEqual(outageSourceRaceAllowances(submit,resolve),wanted);
 assert.deepEqual(outageSourceRaceAllowances(submit),{outage:[],correction:[p.fresh(30)],requests:[p.fresh(30)]});
 assert.deepEqual(outageSourceRaceAllowances(withdraw),{outage:[],correction:[p.fresh(31)],requests:[]});
 assert.deepEqual(outageSourceRaceAllowances(resolve),{outage:[p.fresh(12)],correction:[],requests:[]});
 //Model visibility across the lock wait: old rows are stable, both concurrent
 //appends are expected, but any third operation MUST still change the hash input.
 const old={kind:'outage',operationId:id(214000012)},holder={kind:'outage',operationId:p.fresh(12)},
  waiter={kind:'correction',operationId:p.fresh(30)},binding={kind:'requests',operationId:p.fresh(30)};
 const protect=rows=>rows.filter(row=>!wanted[row.kind].includes(row.operationId));
 assert.deepEqual(protect([old,holder,waiter,binding]),protect([old]));
 assert.notDeepEqual(protect([old,holder,waiter,binding,{kind:'outage',operationId:p.fresh(13)}]),protect([old]));
 assert.notDeepEqual(protect([{...old,changed:true},holder,waiter,binding]),protect([old]));
 assert.throws(()=>outageSourceRaceAllowances());assert.throws(()=>outageSourceRaceAllowances(resolve,submit,withdraw));
 assert.throws(()=>outageSourceRaceAllowances(resolve,resolve));
 assert.throws(()=>outageSourceRaceAllowances({kind:'correction',c:{action:'approve',operationId:p.fresh(30)}}));
 assert(source.includes('const raceAllowed=outageSourceRaceAllowances(holder,waiter)'));
 assert(source.includes('statement(holder,raceAllowed,true),statement(waiter,raceAllowed)'));
 assert(source.includes('s.c&&!replay?outageSourceRaceAllowances(s):{}'));
 assert(!source.includes('statement(waiter,allowance(waiter))'));
});
test('actual148 proof and current unsealed range are prerequisites, not forged history or a new runtime',()=>{
 for(const token of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
  'd.guard',"t.tgenabled<>'O'",'public.faolla_attendance_period_session_v1(',"[[startId,3,'clock_in'],[endId,4,'clock_out']]",
  'profile.session.item.effect,null','profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId',
  'JSON.parse(savedArchive.artifactText).period','outage_source_unsealed_raw_and_proposed_range'])assert(source.includes(token),token);
 for(const token of ['spawn(','listen(','process.argv','pg_ctl','initdb','create database','disable trigger','session_replication_role',
  'set lock_timeout','set statement_timeout','insert into public.merchant_','update public.merchant_','delete from'])assert(!source.includes(token),token);
});
test('real176177178 and old correction v3 results use existing strict projectors including policy and receipt checks',()=>{
 for(const token of ['faolla_attendance_outage_v1','faolla_attendance_outage_links_v1','faolla_attendance_outage_review_v1',
  'faolla_attendance_correction_self_v3','projectOutageResult','projectOutageLinksResult','projectOutageReviewResult',
  'parseCorrectionResult(raw,q,true,true)','value.receipt.revision,s.c.expectedRevision+1',
  'value.rules.policy.revision,s.c.expectedPolicyRevision','value.withdrawal.reason,s.c.reason',
  'expectedRevision:prepared.revision','expectedPolicyRevision:prepared.rules.policy.revision',
  'set constraints all immediate;set constraints all deferred;reset role'])assert(source.includes(token),token);
 for(const token of ['correction_decide','revision_decide','effect_versions'])assert(!source.includes(token),token);
});
test('actual correction submission and resolve are prepared before both exact-PID orientations',()=>{
 for(const token of ['confirmed.status.canResolve,true','prepared.pendingRequestId,null','prepared.rules.issues,[]',
  "const first=p.group==='submit_first',holder=first?submit:resolve,waiter=first?resolve:submit",
  'lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql}',
  'statement(holder,raceAllowed,true),statement(waiter,raceAllowed)','assert.equal(raced.witnessed,true,p.group)',
  'attendance_outage_review_blocked','outage_source_failed_waiter_zero_writes','record(waiter,parse(waiter,raced.right.output))',
  "['pending_source','source_changed','result_changed']",'pending.current.action,first?\'confirm\':\'resolve\'',
  'sourceNow.preview.observations[0].current.pending,true','sourceNow.preview.observations[0].current.reference,p.reference'])assert(source.includes(token),token);
 assert(!source.includes('rollback:true'));assert(!source.includes('setTimeout('));
});
test('real withdrawals free the same stream between groups and receipt recovery does not resolve implicitly',()=>{
 for(const token of ['prepared.revision,index*2','operationId:p.fresh(31),requestId:p.requestId',
  'expectedRevision:correction.item.revision',"withdrawn.item.status,'withdrawn'",'withdrawn.item.revision,prepared.revision+2',
  'restored.status.basisFingerprint,confirmed.status.basisFingerprint','restored.status.resolved,!first','restored.status.canResolve,first',
  "p.q('recover',original.q.access,original.c.operationId),null,false",'call({...original,allow:false},true).receipt,original.receipt',
  'operationId:p.requestId},null,false)).receipt,submitted.receipt','after.pendingRequestId,null','after.revision,4',
  'pendingObservedBeforeWithdrawals:true','approvalOrEffectRace:false'])assert(source.includes(token),token);
});
test('original events/effects and archives stay protected while exact append-only additions commit for outer cleanup',()=>{
 for(const token of ['outage_source_old_rows_changed','outage_source_protected_call_changed',
  'd.definitions(),defs','d.tableCatalog(),catalog','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,savedArchive.artifactText','periodArchive().artifactSha256,savedArchive.artifactSha256',
  'assert.deepEqual(periodAfter.period,periodBefore.period)','periodAfter.sourceChanged,false','assert.equal(submissions,15)','assert.equal(rejections,1)',
  'correctionEntries:4,ruleBindings:2','committedOnlyInCallerOwnedSchema:true,allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true',
  'originalEventsAndEffectsUnchanged:true','finally{preserve();}'])assert(source.includes(token),token);
});
