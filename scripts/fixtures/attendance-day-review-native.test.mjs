//SOURCE-only finite fixture checks. No cluster, SQL execution, browser or Auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {attendanceNativeConnectionLifetime} from '../merchant-attendance-native-connections.mjs';
import {dayReviewFixtureLimits,dayReviewFixtureGroups,dayReviewFixtureGroupBudgets,dayReviewHistoricalTemplateSql,dayReviewNativeRpcExpression,dayReviewNativeWorkDiagnostic,
 dayReviewNativeCandidateDiagnostic,dayReviewOriginalWorkAnchorSql,dayReviewOriginalWorkContext,dayReviewPosthocReassociationCommand,dayReviewClockCoverageSql} from './attendance-day-review-native.mjs';
const source=readFileSync(new URL('./attendance-day-review-native.mjs',import.meta.url),'utf8');
const args={site:'99990001',worker:id(1),employee:id(2),auth:id(3),owner:id(4),sourceSlot:id(5),sourceStart:id(6),sourceEnd:id(7),workDate:'2026-10-07'};
test('199 SOURCE freezes eight finite groups, exact connection/time/SQL/RPC budgets and actual server projection',()=>{
 assert.equal(dayReviewFixtureGroups.length,8);assert.equal(new Set(dayReviewFixtureGroups).size,8);
 assert.deepEqual(dayReviewFixtureGroupBudgets.map(g=>g.rpcs),[15,13,18,24,4,20,65,2]);
 assert.equal(dayReviewFixtureGroupBudgets.reduce((n,g)=>n+g.rpcs,0),161);assert.equal(dayReviewFixtureGroupBudgets.reduce((n,g)=>n+g.steps,1),201);
 assert.deepEqual(dayReviewFixtureLimits,{groups:8,steps:220,rpcs:180,fixtureMs:180000,statementMs:10000,lockMs:3000,templateRows:110});
 assert.equal(attendanceNativeConnectionLifetime({lifetimeMs:dayReviewFixtureLimits.fixtureMs}),dayReviewFixtureLimits.fixtureMs);
 assert(source.includes('native.connect({lifetimeMs:dayReviewFixtureLimits.fixtureMs})'));
 for(const m of['executeDayReviews','MerchantAttendanceDayReview.server.ts'.replace('Merchant','merchant'),'actual199_','actual123_create','actual111_',
  'actual082_correction_','actual096_owner_approve','actual100_missing_','actual122_','connection.close()','rollback to savepoint','day_review_native_stage:'])assert(source.includes(m),m);
 assert(!source.includes('process.argv'));assert(!/initdb|createdb|browser\.launch|setSystemTime|fakeTimers|session_replication_role|disable trigger/i.test(source));
 assert(source.includes("for(let n=0;n<25;n++)lastSelf=await self"));assert(source.includes('page1.items.length,25'));assert(source.includes('page2.nextRevision,null'));
 assert(source.includes("fresh(h.slot.workDate,h.slot.id)"));assert(source.includes("fresh(emptyDay)"));assert(source.includes('missingPlanView'));
});
test('199 causal setup selects only two real171 available204 refs before calendar, never invents or changes historical facts',()=>{
 const h={workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3),slot:{id:id(5)}},sources=[
  {kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null},
  {kind:'missing',requestId:id(204715),rootRequestId:id(204715),approvalOperationId:id(204716)}];
 const detail={worker:{workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId},slot:{id:h.slot.id},revision:4,
  current:{action:'revoke',revision:4,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId},
  preview:{eligible:true,blockers:[],fingerprint:'a'.repeat(64),candidates:sources.map(reference=>({reference,available:true,blockers:[],claim:null}))}};
 const before=structuredClone(detail),command=dayReviewPosthocReassociationCommand(detail,h,id(90));
 assert.deepEqual(detail,before);assert.deepEqual(command.sources,sources);assert.notEqual(command.sources[0],detail.preview.candidates[0].reference);
 assert.equal(command.expectedRevision,4);assert.equal(command.expectedFingerprint,detail.preview.fingerprint);
 for(const mutate of [v=>{v.worker.workerId=id(99);},v=>{v.worker.employeeId=id(99);},v=>{v.worker.employeeAuthUserId=id(99);},
  v=>{v.slot.id=id(99);},v=>{v.current.action='apply';},v=>{v.current.revision=3;},v=>{v.current.employeeAuthUserId=id(99);},
  v=>{v.preview.eligible=false;},v=>{v.preview.blockers=['calendar_entry'];},v=>{v.preview.candidates.pop();},
  v=>{v.preview.candidates.push(structuredClone(v.preview.candidates[0]));},v=>{v.preview.candidates[0].available=false;},
  v=>{v.preview.candidates[0].reference.lastSequence=5;},v=>{v.preview.candidates[1].reference.approvalOperationId=id(99);},
  v=>{v.preview.candidates[0].blockers=['sealed'];},v=>{v.preview.candidates[0].claim={slotId:id(99)};}]){
  const invalid=structuredClone(detail);mutate(invalid);assert.throws(()=>dayReviewPosthocReassociationCommand(invalid,h,id(90)));
 }
 assert.throws(()=>dayReviewPosthocReassociationCommand(detail,h,'not-uuid'));
 const group=source.slice(source.indexOf('mainHash=await step'),source.indexOf('finishGroup(0)'));
 for(const token of ["negative.candidateState,'blocked'","negative.blockers.includes('unassociated_record')",'projectPlanPosthocResult',
  "'actual171_'",'faolla_attendance_plan_posthoc_adoption_v1','posthocSaved.receipt.command','posthocSaved.current.sources'])assert(source.includes(token),token);
 assert(group.indexOf('const beforeAssociation=await fresh')<group.indexOf('posthocDetail=await posthoc(null)'));
 assert(group.indexOf('posthocSaved=await posthoc(posthocCommand)')<group.indexOf('const rawBefore=await rawFacts()'));
 assert(group.indexOf('const rawBefore=await rawFacts()')<group.indexOf('const closing=await calendar()'));
 assert(source.includes("'merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims'"));
 assert(!group.includes('update public.'));assert(!group.includes('delete from'));assert(!group.includes('set_config('));
});
test('199 bounded synthetic history preserves full original136 command/slot/evidence proof rather than fake RPC',()=>{
 for(const [count,clock,rows]of[[1,false,3],[2,true,7],[101,false,109]]){
  const template=dayReviewHistoricalTemplateSql({...args,count,clock});assert.equal(template.rows,rows);assert.equal(template.slots.length,count);
  assert.equal(template.operations.length,Math.ceil(count/32));assert.equal(template.actualHistoricalPublication,false);assert.equal(template.actualClockRequests,false);
  for(const m of['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_publication_evidence',
   'expectedSettingsVersion','expectedRevision','publication_proof','set constraints all immediate','NOT a past real publication'])assert(template.sql.includes(m),m);
  assert(!/update public\.|delete from|truncate|alter table|disable trigger/i.test(template.sql));
  assert(template.sql.includes('max(command_row.revision)'));assert(!template.sql.includes('max(revision)'));
  if(clock)assert(template.sql.includes('faolla_attendance_self_schedule_receipt_v1(relation_row,e.auth_user_id)'));
 }
 assert.throws(()=>dayReviewHistoricalTemplateSql({...args,count:102}));assert.throws(()=>dayReviewHistoricalTemplateSql({...args,count:101,clock:true,location:id(22)}));
 assert.throws(()=>dayReviewHistoricalTemplateSql({...args,startMinutes:1440}));assert.throws(()=>dayReviewHistoricalTemplateSql({...args,site:'12345678'}));
});
test('199 only the two exact fresh clock calls allow one real197 coverage row, preserving every old field',()=>{
 const input={site:args.site,worker:args.worker,employee:args.employee,command:{operationId:id(91),expectedWorkerId:args.worker,locationId:id(92),action:'clock_in',expectedSequence:4}};
 for(const [action,label,path]of[['clock_in','actual137_clock_in',"value->'clock'"],['break_start','actual111_break_start','value']]){
  const value=structuredClone(input);value.command.action=action;const before=structuredClone(value),sql=dayReviewClockCoverageSql(label,value);
  assert.deepEqual(value,before);assert(sql.includes(path+"->'replayed'='false'::jsonb"));
  for(const token of['coverage_event.merchant_id='+"'"+args.site+"'",'coverage_event.worker_id='+"'"+args.worker+"'",
   'coverage_event.actor_employee_id='+"'"+args.employee+"'",'coverage_event.operation_id='+"'"+id(91)+"'",'coverage_event.sequence=5',
   'coverage_event.action='+"'"+action+"'",'coverage_event.location_id='+"'"+id(92)+"'",'coverage_saved.coverage_version=1',
   'coverage_saved.recorded_at>=coverage_event.received_at','isfinite(coverage_saved.recorded_at)',
   'faolla_attendance_event_receipt_v1(coverage_event)','dr199_coverage_exact_delta','jsonb_array_length(coverage_before)+1',
   'dr199_coverage_old_rows_changed','to_jsonb(coverage_row)','where coverage_row.event_id not in('])assert(sql.includes(token),token);
 }
 for(const mutate of[v=>{v.command.action='clock_out';},v=>{v.command.expectedSequence=-1;},v=>{v.command.expectedSequence=Number.MAX_SAFE_INTEGER;},
  v=>{v.command.expectedWorkerId=id(99);},v=>{v.command.extra=true;},v=>{v.command.operationId='invalid';},v=>{v.site='12345678';}]){
  const bad=structuredClone(input);mutate(bad);assert.throws(()=>dayReviewClockCoverageSql('actual137_clock_in',bad));
 }
 assert.throws(()=>dayReviewClockCoverageSql('actual199_decide',input));
 const writers=source.slice(source.indexOf('const writerTables='),source.indexOf('const outside='));assert(!writers.includes('disposal_event_coverage'));
 assert(source.includes('const callOutside=eventCapture===null||!hasEventCoverage?outside:'));
 assert(source.includes("{write:true,eventCapture:{site:d.site,worker:h.workerId,employee:h.employeeId,command}}"));
 assert(source.includes("if failure is not null or value ? 'error'"));assert(source.includes('dr199_read_rejection_replay_wrote'));
 assert(!/insert into public\.merchant_attendance_disposal_event_coverage|update public\.merchant_attendance_disposal_event_coverage|delete from public\.merchant_attendance_disposal_event_coverage/i.test(source));
});

test('199 synthetic event pair discloses7 direct rows plus2 trigger rows and proves exact197 delta without adding prerequisites',()=>{
 const pair=dayReviewHistoricalTemplateSql({...args,count:2,clock:true,captureCoverage:true});
 assert.equal(pair.rows,7);assert.equal(pair.derivedCoverageRows,2);assert.equal(pair.totalRows,9);
 for(const token of['dr199_coverage_exact_event','dr199_coverage_exact_capture','dr199_coverage_old_rows_changed',
  'jsonb_array_length(coverage_before)+2','coverage_event.sequence=seq+1','coverage_event.sequence=seq+2',
  "coverage_event.action='clock_in'","coverage_event.action='clock_out'",pair.startEvent,pair.endEvent])assert(pair.sql.includes(token),token);
 const plain=dayReviewHistoricalTemplateSql({...args,count:2,clock:true});assert.equal(plain.derivedCoverageRows,0);assert.equal(plain.totalRows,7);
 assert(!plain.sql.includes('from public.merchant_attendance_disposal_event_coverage'));
 const capacity=dayReviewHistoricalTemplateSql({...args,count:101,captureCoverage:true});assert.equal(capacity.rows,109);assert.equal(capacity.totalRows,109);
 assert(capacity.sql.includes('dr199_template_no_coverage_delta'));assert.throws(()=>dayReviewHistoricalTemplateSql({...args,captureCoverage:'true'}));
 assert(source.includes('hasEventCoverage=names.includes(eventCoverageTable)'));assert(source.includes('captureCoverage:hasEventCoverage'));
 assert(source.includes('eventCoverage:{installed:hasEventCoverage'));
});

test('199 SOURCE anchors original closed work to actual137/144/148 proof, not inherited full-leave slot or cached source',()=>{
 const inherited={workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3),startEventId:id(6),lastEventId:id(7),operationId:id(8),syntheticOnly:true,
  slot:{id:id(99),workDate:'2026-10-05'},query:{siteId:'99990001',workerId:id(1),slotId:id(99)},sourceRaw:{cached:'not a source authority'}};
 const anchor={workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3),startEventId:id(6),lastEventId:id(7),operationId:id(8),
  slot:{id:id(5),revision:1,workDate:'2026-10-06',locationId:id(9),timeZone:'UTC',startAt:'2026-10-06T08:00:00.000Z',endAt:'2026-10-06T10:00:00.000Z',hasPublicationEvidence:true,cancelled:false}};
 const before=structuredClone(inherited),sql=dayReviewOriginalWorkAnchorSql('99990001',inherited),local=dayReviewOriginalWorkContext('99990001',inherited,anchor);
 assert.deepEqual(inherited,before);assert.notEqual(local,inherited);assert.notEqual(local.slot,anchor.slot);
 assert.equal(local.slot.id,id(5));assert.equal(local.slot.workDate,'2026-10-06');assert.deepEqual(local.query,{siteId:'99990001',workerId:id(1),slotId:id(5)});
 for(const key of['workerId','employeeId','employeeAuthUserId','startEventId','lastEventId','operationId']){
  assert.equal(local[key],inherited[key]);assert.throws(()=>dayReviewOriginalWorkContext('99990001',inherited,{...anchor,[key]:id(88)}));
 }
 for(const token of['original_start.id is not null',"original_end.action='clock_out'",'dr199_anchor_current_dual_identity','dr199_anchor_saved_dual_identity',
  'id=original_relation.slot_id','original_slot.revision=original_relation.slot_revision','faolla_attendance_self_schedule_receipt_v1(original_relation,current_employee.auth_user_id)',
  'faolla_attendance_period_session_v1(','dr199_anchor_actual_closed_session','faolla_attendance_self_schedule_slot_v1(original_slot)',"slot_proof->'hasPublicationEvidence'='true'"])
  assert(sql.includes(token),token);
 assert(sql.includes("id='"+id(6)+"'"));assert(sql.includes("id='"+id(7)+"'"));assert(!sql.includes(id(99)));assert(!sql.includes('sourceRaw'));
 assert(!/insert into|update |delete from|truncate|alter table|disable trigger/i.test(sql));
 assert.throws(()=>dayReviewOriginalWorkContext('99990001',inherited,{...anchor,slot:{...anchor.slot,hasPublicationEvidence:false}}));
 assert.throws(()=>dayReviewOriginalWorkContext('99990001',inherited,{...anchor,slot:{...anchor.slot,endAt:anchor.slot.startAt}}));
 assert.throws(()=>dayReviewOriginalWorkAnchorSql('12345678',inherited));
 assert(source.includes("step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';${dayReviewOriginalWorkAnchorSql(d.site,inheritedH)}"));
 const race=source.slice(source.indexOf('export async function verifyDayReviewNativeRace'));
 assert(race.includes('read(dayReviewOriginalWorkAnchorSql(d.site,inheritedH)+'));assert(race.includes('h=dayReviewOriginalWorkContext(d.site,inheritedH,baseline.workAnchor)'));
 assert(race.includes('workDate:day(h.slot.workDate,1)'));assert(race.includes('assert.equal(view.input.source.records.length,0)'));
 assert(race.includes('connect:()=>native.connect()'));assert(!race.includes('lifetimeMs:20000'));
});

test('199 caller cannot inject private source/frame or unexpected RPC arguments',()=>{
 const query={siteId:'99990001',access:'owner',mode:'preview',workerId:id(1),workDate:'2026-10-07',slotId:null,caseId:null};
 const body={p_query:query,p_auth_user_id:id(4),p_command:null,p_allow_write:false};
 assert.match(dayReviewNativeRpcExpression('faolla_attendance_day_review_v1',body),/^public\.faolla_attendance_day_review_v1\(/);
 assert.throws(()=>dayReviewNativeRpcExpression('faolla_attendance_period_closure_v1',body));
 assert.throws(()=>dayReviewNativeRpcExpression('faolla_attendance_day_review_v1',{...body,p_artifact:{}}));
 assert.throws(()=>dayReviewNativeRpcExpression('faolla_attendance_day_review_v1',{...body,p_allow_write:'true'}));
});

test('199 every supported saved-location history template uses SQL text concatenation, never JavaScript plus',()=>{
 for(const count of[1,2,101])for(const zone of['UTC','Europe/Madrid'])for(const location of[null,id(9)]){
  const template=dayReviewHistoricalTemplateSql({...args,count,zone,location,clock:count===2});
  assert(!/'(?:[^']|'')*'\s*\+|\+\s*'(?:[^']|'')*'/.test(template.sql));
  if(location!==null)assert(template.sql.includes("l.name:='Synthetic199 saved '||'"+zone+"'||' location'"));
 }
});

test('199 actual leave home is an explicit null-command read under the existing production Node contract',()=>{
 assert(source.includes('executeLeave({query:leaveQ(),command:null,authUserId:h.employeeAuthUserId,allowWrite:true},leaveService)'));
 assert(!source.includes('executeLeave({query:leaveQ(),authUserId:'));
 const server=readFileSync(new URL('../../src/lib/merchantAttendanceLeave.server.ts',import.meta.url),'utf8');
 assert(server.includes('input.command === null ? null : parseLeaveBody'));
 assert(source.includes("startAt:h.slot.workDate+'T08:00:00.000Z'"));assert(source.includes("endAt:h.slot.workDate+'T09:00:00.000Z'"));
});
test('199 closed-work failure diagnostic keeps only bounded counts/status/tags, never source bodies or identifiers',()=>{
 const value={input:{source:{coverage:'complete',current:true,records:[{sourceId:id(8),original:{endAt:'2026-10-07T09:35:00Z'},selected:{endAt:'2026-10-07T09:35:00Z'},administrativeBoundary:null}]}},
  source:{raw:{protocol:'plan-exception-source-v3',source:{evaluation:{basis:{sessions:[{reason:'private'}],context:{unassociated:{items:[]}}},observations:[{}]}}},text:'private canonical'},
  head:{latestDecision:{observations:['recorded_work','not-a-valid-tag'],reason:'private explanation'}},pin:'12345678'};
 assert.deepEqual(dayReviewNativeWorkDiagnostic(value),{protocol:'plan-exception-source-v3',sourceCurrent:true,coverage:'complete',recordCount:1,
  closedSelected:1,closedOriginal:1,administrative:0,basisSessions:1,basisUnassociated:0,currentObservations:1,savedObservations:['recorded_work']});
 const text=JSON.stringify(dayReviewNativeWorkDiagnostic(value));for(const privateValue of[id(8),'private','12345678','2026-10-07'])assert(!text.includes(privateValue));
 assert.equal(dayReviewNativeWorkDiagnostic({input:{source:{records:[]}}}).recordCount,0);
 assert.equal(dayReviewNativeWorkDiagnostic({input:{source:{coverage:'forged',current:'true'}}}).coverage,null);
 assert.equal(dayReviewNativeWorkDiagnostic({input:{source:{records:Array.from({length:4100},()=>({}))}}}).recordCount,4001);
 assert(source.includes('dr199_closed_work_expectation:'));assert(source.includes('pureObservations:observations(plan)'));
});
test('199 blocked candidate diagnostic uses only existing plan metadata and bounded whitelisted tags/counts',()=>{
 const value={input:{target:{kind:'plan',slotId:id(5)},source:{coverage:'complete',identity:'matching',current:true,
  plans:[{slotId:id(5),locationId:id(9),cancelled:false,hasPublicationEvidence:true,startAt:'2026-10-06T08:00Z',endAt:'2026-10-06T10:00Z'}],
  records:[{kind:'session',sourceId:id(6),original:{endAt:'2026-10-06T09:35Z'},selected:{endAt:'2026-10-06T09:35Z'},association:{slotId:id(5)}},
   {kind:'session',sourceId:id(7),selected:{endAt:'2026-10-06T09:45Z'},association:null},{kind:'missing',sourceId:id(8),selected:{endAt:'2026-10-06T09:55Z'},association:null}],
  pending:[{kind:'correction',reason:'private'}],conflicts:[{kind:'work_leave',sourceIds:[id(6),id(8)]}],
  calendar:[{entryId:id(10),kind:'closure',status:'created',locationId:null,fromAt:'2026-10-06T00:00Z',toAt:'2026-10-07T00:00Z'}]}},
  source:{raw:{protocol:'plan-exception-source-v3',source:{evaluation:{basis:{sessions:[{}],context:{unassociated:{items:[{}]}}},observations:[],
   resolutionBlockers:['posthoc_inactive','private'],posthoc:{current:{action:'revoke',reason:'private'}}}}}},private:'do not output'};
 const preview={candidates:[{outcome:'calendar_exempt',candidateState:'blocked',blockers:['unassociated_record','private']}],observations:['unassociated_record','recorded_work','private']};
 const result=dayReviewNativeCandidateDiagnostic(value,preview);
 assert.equal(result.candidateState,'blocked');assert.deepEqual(result.blockers,['unassociated_record']);assert.deepEqual(result.observations,['unassociated_record','recorded_work']);
 assert.equal(result.unassociatedCount,2);assert.equal(result.openCount,0);assert.equal(result.pendingKinds.correction,1);assert.equal(result.conflictKinds.work_leave,1);
 assert.equal(result.identity,'matching');assert.deepEqual(result.plan,{present:true,cancelled:false,hasPublicationEvidence:true});
 assert.equal(result.calendarCount,1);assert.equal(result.coveringClosureCount,1);assert.deepEqual(result.resolutionBlockers,['posthoc_inactive']);assert.equal(result.currentPosthocAction,'revoke');
 const text=JSON.stringify(result);assert(text.length<2000);for(const secret of[id(5),id(6),id(8),id(10),'private','2026-10-06','do not output'])assert(!text.includes(secret));
 assert.equal(dayReviewNativeCandidateDiagnostic({},{}).candidateState,null);
 assert.equal(dayReviewNativeCandidateDiagnostic({input:{source:{records:Array.from({length:4100},()=>({association:null}))}}},{}).unassociatedCount,4001);
 assert(source.includes("'dr199_calendar_candidate_expectation:'+JSON.stringify(dayReviewNativeCandidateDiagnostic(plan,evaluateDayClassification(plan.input)))"));
 assert(source.includes("candidate(plan,'calendar_exempt').candidateState,'candidate'"));
});
test('199 all old facts, row-prefix, definitions/catalog and archive bytes remain guarded in SOURCE',()=>{
 for(const m of['dr199_read_rejection_replay_wrote','dr199_unrelated_table_changed','dr199_existing_row_changed:',
  'dr199_probe_not_restored','periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())',
  'source_fingerprint<>encode(sha256','noNewPeriods','dr199_race_old_facts','cleanupOwnedByParent:true'])assert(source.includes(m),m);
 assert(source.includes('dr199_full_main_rollback_not_restored'));
 assert(source.includes('trustedProofBoundary'));assert(source.includes('compact missing fields remain SQL-proven'));
 for(const m of['dr199_lost_self_binding','synthetic_self_binding_handoff','lastSelf.command.operationId','lastSelf.receipt','attendance_operation_not_found'])assert(source.includes(m),m);
 assert(source.includes('sourceChanged,true'));assert(source.includes('attendance_day_review_source_changed'));assert(source.includes('attendance_day_review_head_changed'));
 assert(source.includes("lastRpc={error:"));assert(source.includes("r.context?.slice(0,6000)"));assert(!source.includes('JSON.stringify(r.value)'));
});
test('199 settings race only after main caller guard: one case+entry, exact PID witness, no append-only deletion',()=>{
 const race=source.slice(source.indexOf('export async function verifyDayReviewNativeRace'));
 for(const m of['lifecycleRace','race.witnessed','committedOwnRows:2','connections:2','sqlStepsUpperBound:12',
  'attendance_day_review_head_changed','oldTablesUnchanged:true','rollbackOnly:false'])assert(race.includes(m),m);
 assert(!/insert into|update public\.|delete from|truncate|alter table/i.test(race));
 assert(race.includes("own=['merchant_attendance_day_review_cases','merchant_attendance_day_review_entries']"));
});
