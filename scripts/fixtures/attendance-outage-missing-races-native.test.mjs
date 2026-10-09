//Pure fixture contracts, not a claim that PostgreSQL concurrency has run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageMissingRacePlan,outageMissingRaceGroups,outageMissingRaceWriteTables,outageMissingRaceProtectedSql,outageMissingRaceAllowances} from './attendance-outage-missing-races-native.mjs';
const source=readFileSync(new URL('./attendance-outage-missing-races-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',worker:id(202),employee:id(102),auth:id(2),location:id(4),workerVersion:7,employeeVersion:3,generation:2,
 startAt:'2026-10-05T09:50:00.000000Z',endAt:'2026-10-05T09:55:00.000000Z',now:'2026-10-07T11:00:00.000000Z',
 sealedStart:'2026-10-04T00:00:00.000000Z',sealedEnd:'2026-10-05T00:00:00.000000Z'};

test('two221 plans share the real approved root and reserve a six-minute declaration for the same-five-minute replacement',()=>{
 assert.deepEqual(outageMissingRaceGroups,['submit_first','resolve_first']);
 const plans=outageMissingRaceGroups.map(group=>createOutageMissingRacePlan(input,group));
 assert.equal(new Set(plans.flatMap(p=>[...p.outageOperationIds,...p.missingOperationIds])).size,20);
 for(const p of plans){
  assert.equal(p.declaration.interval.startAt,input.startAt);assert.equal(p.declaration.interval.endAt,'2026-10-05T09:56:00.000000Z');
  assert.deepEqual(p.declaration.interval,p.incident.interval);assert.equal(p.declaration.workerId,input.worker);
  assert.equal(p.declaration.employeeId,input.employee);assert.equal(p.declaration.employeeAuthUserId,input.auth);
  assert.deepEqual([p.declaration.expectedWorkerVersion,p.declaration.expectedEmployeeVersion,p.declaration.expectedGeneration],[7,3,2]);
  assert.equal(p.declaration.originalOperationId,null);assert.equal(p.declaration.originalChannel,null);
  assert.deepEqual(p.reference,{kind:'missing',requestId:id(204715),rootRequestId:id(204715),approvalOperationId:id(204716)});
  assert.deepEqual(p.proposal,{startAt:'2026-10-05T09:51:00.000000Z',endAt:'2026-10-05T09:56:00.000000Z',breaks:[]});
  assert.equal(Date.parse(p.proposal.endAt)-Date.parse(p.proposal.startAt),300000);
  assert.deepEqual(p.q('recover','self',p.fresh(11)),{siteId:input.site,access:'self',mode:'recover',declarationId:p.declaration.declarationId,operationId:p.fresh(11)});
 }
 assert(!plans[0].outageOperationIds.includes(plans[0].fresh(12)),'failed resolve is not globally exempted');
 assert(!plans[1].outageOperationIds.includes(plans[1].fresh(18)),'rejected stale apply is not globally exempted');
});
test('bad identity versions, changed duration, future intervals and any overlap with the sealed frame fail preparation',()=>{
 for(const patch of [{workerVersion:0},{employeeVersion:1.5},{generation:-1},{startAt:input.endAt},{endAt:'2026-10-05T09:56:00Z'},
  {now:input.endAt},{now:'invalid'},{sealedStart:'invalid'},{sealedStart:input.startAt,sealedEnd:input.endAt},
  {sealedStart:'2026-10-05T09:55:30Z',sealedEnd:'2026-10-05T12:00:00Z'}])assert.throws(()=>createOutageMissingRacePlan({...input,...patch},'submit_first'));
 assert.throws(()=>createOutageMissingRacePlan(input,'approval_first'));
});
test('the write set is exactly five outage ledgers and the two old missing append tables',()=>{
 assert.equal(outageMissingRaceWriteTables.length,7);assert.equal(new Set(outageMissingRaceWriteTables).size,7);
 assert.deepEqual(outageMissingRaceWriteTables,['merchant_attendance_outage_incidents','merchant_attendance_outage_declarations',
  'merchant_attendance_outage_operations','merchant_attendance_outage_link_operations','merchant_attendance_outage_review_operations',
  'merchant_attendance_missing_requests','merchant_attendance_missing_entries']);
 const p=createOutageMissingRacePlan(input,'submit_first'),names=[...outageMissingRaceWriteTables,'merchant_attendance_events','merchant_attendance_correction_effects'];
 const sql=outageMissingRaceProtectedSql(names,input.site,{outage:[p.fresh(1)],missing:p.missingOperationIds,requests:[p.requestId]});
 assert(sql.includes(`source` )===false); // This helper has its own non-conflicting SQL aliases.
 assert(sql.includes(`missing_row.request_id=any(array['${p.requestId}'::uuid]`));
 assert(sql.includes(`missing_row.operation_id=any(array['${p.fresh(30)}'::uuid,'${p.fresh(31)}'::uuid]`));
 assert(sql.includes("missing_row.merchant_id='99990001'"));
 for(const table of ['merchant_attendance_events','merchant_attendance_correction_effects'])assert(sql.includes(`from public.${table} missing_row) missing_rows`));
 assert(!outageMissingRaceProtectedSql(names,input.site).includes(' where not'));
 for(const allowed of [{missing:[id(204716)]},{requests:[p.requestId,p.requestId]},{outage:[id(219200012)]}])assert.throws(()=>outageMissingRaceProtectedSql(names,input.site,allowed));
 assert.throws(()=>outageMissingRaceProtectedSql(['bad;table'],input.site));
});
test('both visible race commits are allowed in their own exact tables while ordinary calls allow only one intent',()=>{
 const p=createOutageMissingRacePlan(input,'resolve_first'),resolve={kind:'review',c:{action:'resolve',operationId:p.fresh(12)}},
  revise={kind:'missing',c:{action:'revise',operationId:p.requestId}},withdraw={kind:'missing',c:{action:'withdraw',operationId:p.fresh(31)}},
  approve={kind:'missing',c:{action:'approve',operationId:p.fresh(31)}};
 const both={outage:[p.fresh(12)],missing:[p.requestId],requests:[p.requestId]};
 assert.deepEqual(outageMissingRaceAllowances(resolve,revise),both);assert.deepEqual(outageMissingRaceAllowances(revise,resolve),both);
 assert.deepEqual(outageMissingRaceAllowances(revise),{outage:[],missing:[p.requestId],requests:[p.requestId]});
 for(const terminal of [withdraw,approve])assert.deepEqual(outageMissingRaceAllowances(terminal),{outage:[],missing:[p.fresh(31)],requests:[]});
 const old={kind:'missing',operationId:id(204716)},holder={kind:'outage',operationId:p.fresh(12)},waiter={kind:'missing',operationId:p.requestId},request={kind:'requests',operationId:p.requestId};
 const protect=rows=>rows.filter(row=>!both[row.kind].includes(row.operationId));
 assert.deepEqual(protect([old,holder,waiter,request]),[old]);
 assert.notDeepEqual(protect([{...old,changed:true},holder,waiter,request]),[old]);
 assert.notDeepEqual(protect([old,holder,waiter,request,{kind:'missing',operationId:p.fresh(31)}]),[old]);
 assert.throws(()=>outageMissingRaceAllowances(resolve,resolve));assert.throws(()=>outageMissingRaceAllowances(resolve,revise,withdraw));
 assert.throws(()=>outageMissingRaceAllowances({kind:'missing',c:{action:'cancel',operationId:p.fresh(31)}}));
 assert(source.includes('const raceAllowed=outageMissingRaceAllowances(holder,waiter)'));
 assert(source.includes('statement(holder,raceAllowed,true),statement(waiter,raceAllowed)'));
 assert(source.includes('s.c&&!replay?outageMissingRaceAllowances(s):{}'));
});
test('existing219 context and actual103/171 proof are prerequisites, with no fabricated rows, policy changes or runtime',()=>{
 for(const token of ['outageContinuityFoundation?.phase,219','outageContinuityFoundation.sourceRaces.finalPendingRequestId,null',
  'assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
  'public.merchant_attendance_missing_current_v1','public.faolla_attendance_plan_posthoc_missing_v1(',
  'coalesce(m.root_request_id,m.request_id)','profile.location,d.location','profile.proof.pending,false',
  'JSON.parse(savedArchive.artifactText).period','outage_missing_unsealed_original_and_proposed_range',"t.tgenabled<>'O'"])
  assert(source.includes(token),token);
 for(const token of ['spawn(','listen(','process.argv','pg_ctl','initdb','create database','disable trigger','session_replication_role',
  'insert into public.merchant_','update public.merchant_','delete from','set lock_timeout','set statement_timeout','correction_controls_v2('])assert(!source.includes(token),token);
});
test('SQL outputs pass the real saved projectors and missing parser with request-local revisions and exact command recovery',()=>{
 for(const token of ['projectOutageResult','projectOutageLinksResult','projectOutageReviewResult','faolla_attendance_missing_v1',
  'parseMissingResult(raw,{...s.q,operationId:s.c?.operationId??s.q.operationId},false)',
  'assert.deepEqual(value.receipt.command,parseMissingBody({query:s.q,command:s.c}).command)',
  "value.receipt.revision,s.c.action==='revise'?1:2",'expectedRevision:1',
  'expectedSettingsVersion:home.settingsVersion','expectedPolicyRevision:home.policyRevision',
  'supersedesRequestId:home.detail.lineage.currentRequestId','expectedApprovalOperationId:home.detail.lineage.currentApprovalOperationId',
  'set constraints all immediate;set constraints all deferred;reset role'])assert(source.includes(token),token);
 assert(!source.includes('expectedRevision:index*2'));assert(!source.includes('expectedRevision:prepared.revision'));
});
test('both actual revise/resolve orders start from confirmed eligible basis and witness the exact blocking PID',()=>{
 for(const token of ['confirmed.status.canResolve,true','home.detail.lineage.canRevise',
  "const first=p.group==='submit_first',holder=first?submit:resolve,waiter=first?resolve:submit",
  'lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql}',
  'assert.equal(raced.witnessed,true,p.group)','outage_missing_failed_waiter_zero_writes',
  'record(waiter,parse(waiter,raced.right.output))',"['pending_source','source_changed','result_changed']",
  'assert.deepEqual(pending.proposal,proposal)','assert.deepEqual(pendingLink.current,savedLink)',
  'observation.current.reference,p.reference','observation.current.selected,{startAt:input.startAt,endAt:input.endAt}'])assert(source.includes(token),token);
 assert(!source.includes('setTimeout('));assert(!source.includes('rollback:true'));
});
test('withdrawal really clears group1 pending; replacement requires current head, explicit reopen, new link and both-party version2',()=>{
 for(const token of ["action:'withdraw',operationId:p.fresh(31)","withdrawn.detail.status,'withdrawn'",
  'restored.status.basisFingerprint,confirmed.status.basisFingerprint','restored.status.canResolve,true',
  "action:'approve',operationId:p.fresh(31)",'evidenceToken:review.detail.evidenceToken',
  'changedLink.preview.observations[0].current.reference,newRef','stale.preview.eligible,false','attendance_outage_links_blocked',
  "reviewCommand(p,13,'reopen',changed)","sources:[newRef]",'linked.revision,2',
  "reviewCommand(p,15,'propose',reproposable)","reviewCommand(p,16,'confirm',reconfirmable)","reviewCommand(p,17,'resolve',resolvable)",
  'final.revision,7','final.resultVersion,2','final.status.resolved,true','firstGroupStaleAfterLaterRootReplacement:true',
  'approvalRace:false,approvedMissingCancellation:false'])assert(source.includes(token),token);
 assert(source.indexOf("action:'withdraw',operationId:p.fresh(31)")<source.indexOf("action:'approve',operationId:p.fresh(31)"));
});
test('every committed receipt and original root command survives GET/replay while old facts and both archives remain exact',()=>{
 for(const token of ['call(spec(original.kind,q,null,false)).receipt,original.receipt','call({...original,allow:false},true).receipt,original.receipt',
  "mq('self',rootId,rootId)","mq('owner',rootId,rootApproval)",'for(const item of rootReceipts)assert.deepEqual(call(item.s).receipt,item.receipt)',
  'for(const original of committed.values())recover(original)','outage_missing_preexisting_rows_changed','outage_missing_protected_call_changed',
  'd.definitions(),defs','d.tableCatalog(),catalog','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,savedArchive.artifactText','periodArchive().artifactSha256,savedArchive.artifactSha256',
  'assert.deepEqual(periodAfter.period,periodBefore.period)','periodAfter.sourceChanged,false','assert.equal(submissions,20)','assert.equal(rejections,2)',
  'requests:2,entries:4,links:3,reviews:9','allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true','finally{preserve();}'])assert(source.includes(token),token);
});
