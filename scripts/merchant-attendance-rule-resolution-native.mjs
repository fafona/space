// Additive read-only check inside the caller's already owned sources fixture.
// No startup, SQL seed, migration, listener, browser or configured-app access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
function objects(value,found=new Set()){
  if(!value||typeof value!=='object'||found.has(value))return found;
  found.add(value);for(const child of Object.values(value))objects(child,found);return found;
}
function detachedFrozen(source,result){
  const input=objects(source);for(const object of objects(result)){
    assert(Object.isFrozen(object),'candidate_resolution_not_deeply_frozen');assert(!input.has(object),'candidate_resolution_aliases_source');
  }
}
function expectedProvenance(stream,item){
  return {layer:stream.groupId===null?'enterprise':'group',groupId:stream.groupId,ledgerRevision:stream.revision,publishRevision:item.revision,
    operationId:item.operationId,actorId:item.actorId,settingsVersion:item.settingsVersion,groupRevision:item.groupRevision,timeZone:item.timeZone,
    effectiveAt:item.effectiveAt,recordedAt:item.recordedAt};
}
function envelope(result,source){
  assert.equal(result.protocol,'candidate-rule-resolution-v1');assert.equal(result.formalReady,false);assert.equal(result.applied,false);
  for(const key of ['siteId','actorId','fromDate','throughDate','timeZone','readAt'])assert.equal(result[key],source[key]);
  assert.equal(result.workerId,source.worker.workerId);
  assert.deepEqual([...result.limitations].sort(),['personal_exceptions_not_supported','historical_context_not_pinned','candidate_rules_not_applied'].sort());
  assert.equal(result.segments.length,1);const segment=result.segments[0];
  assert.equal(segment.fromAt,source.fromAt);assert.equal(segment.toAt,source.toAt);assert.equal(segment.status,'candidate');assert.deepEqual(segment.blockers,[]);
  assert.equal(segment.assignmentId,id(7103));assert.equal(segment.assignmentRevision,1);assert.equal(segment.groupId,id(7001));return segment;
}

export async function checkCandidateRulesNative(native,scope,data){
  assert.equal(data.syntheticOnly,true,'synthetic_fixture_required');assert.equal(data.sql,scope.sql,'caller_owned_scope_required');
  assert.equal(data.site,'99990001');assert.equal(data.owner,id(99));assert.equal(data.worker,id(201));
  const {resolveCandidateAttendanceRules}=require('../src/lib/merchantAttendanceRuleResolution.ts');
  const {RULE_KEYS}=require('../src/lib/merchantAttendanceRuleDraft.ts');
  const baseline=data.protectedFingerprint(),countBefore=data.readCount();
  // Exactly two genuine128 reads. They already pass the shared sources parser
  // and carry their own all-table fingerprint assertion.
  const past=data.read(),future=data.read(data.futureQuery);
  assert.equal(data.readCount()-countBefore,2,'candidate_resolution_unexpected_SQL_reads');
  const pastBefore=JSON.stringify(past),futureBefore=JSON.stringify(future);
  const pastResolved=resolveCandidateAttendanceRules(past),futureResolved=resolveCandidateAttendanceRules(future);
  assert.equal(JSON.stringify(past),pastBefore,'candidate_resolution_mutated_past_input');assert.equal(JSON.stringify(future),futureBefore,'candidate_resolution_mutated_future_input');
  detachedFrozen(past,pastResolved);detachedFrozen(future,futureResolved);
  const pastSegment=envelope(pastResolved,past),futureSegment=envelope(futureResolved,future);
  for(const key of RULE_KEYS){
    assert.deepEqual(pastSegment.fields[key],{state:'unconfigured',minutes:null,source:null,trace:[
      {layer:'group',groupId:id(7001),mode:'missing_publication',minutes:null,source:null},
      {layer:'enterprise',groupId:null,mode:'missing_publication',minutes:null,source:null},
    ]});
  }
  const group=future.rules.items.find(row=>row.groupId===id(7001)),enterprise=future.rules.items.find(row=>row.groupId===null);
  assert(group&&enterprise);assert.equal(group.revision,2);assert.equal(enterprise.revision,35);
  assert.deepEqual(group.publications.map(row=>row.operationId),[id(7702)]);assert.deepEqual(enterprise.publications.map(row=>row.operationId),[id(7502)]);
  const groupSource=expectedProvenance(group,group.publications[0]),enterpriseSource=expectedProvenance(enterprise,enterprise.publications[0]);
  const expected={lateGraceMinutes:['value',0],earlyGraceMinutes:['disabled',null],openSpanWarningMinutes:['unconfigured',null],completedBreakMinimumMinutes:['value',1]};
  for(const key of RULE_KEYS){
    const field=futureSegment.fields[key],[state,minutes]=expected[key];assert.equal(field.state,state);assert.equal(field.minutes,minutes);
    assert.deepEqual(field.source,state==='unconfigured'?null:groupSource);
    assert.deepEqual(field.trace,[
      {layer:'group',groupId:id(7001),mode:state==='unconfigured'?'inherit':state,minutes,source:groupSource},
      {layer:'enterprise',groupId:null,mode:state==='unconfigured'?'inherit':state,minutes,source:enterpriseSource},
    ]);
  }
  assert(!JSON.stringify(futureResolved).includes(id(7101)),'cancelled_assignment_selected');
  assert(!JSON.stringify(futureResolved).includes(id(7504)),'withdrawn_publication_selected');
  assert(!JSON.stringify(pastResolved).includes(id(7502))&&!JSON.stringify(pastResolved).includes(id(7702)),'future_publication_leaked_into_past');

  // Explicitly PURE COUNTERFACTUAL: no such publication is written to SQL.
  // A later group publication resets an earlier value to inherit. The resolver
  // must then choose enterprise7502, never reuse the older group7702 value.
  const hypothetical=structuredClone(future),hypotheticalGroup=hypothetical.rules.items.find(row=>row.groupId===id(7001));
  const newer={...structuredClone(hypotheticalGroup.publications[0]),revision:4,operationId:id(7999),reason:'Synthetic in-memory fallback probe',
    recordedAt:future.readAt,effectiveOn:data.day(4),effectiveAt:data.at(4,'00:00')};
  newer.rules.lateGraceMinutes={mode:'inherit'};hypotheticalGroup.revision=4;hypotheticalGroup.publications.push(newer);
  const hypotheticalBefore=JSON.stringify(hypothetical),fallback=resolveCandidateAttendanceRules(hypothetical);
  assert.equal(JSON.stringify(hypothetical),hypotheticalBefore);detachedFrozen(hypothetical,fallback);assert.equal(fallback.segments.length,2);
  assert.equal(fallback.segments[0].toAt,newer.effectiveAt);assert.equal(fallback.segments[1].fromAt,newer.effectiveAt);
  assert.equal(fallback.segments[0].fields.lateGraceMinutes.source.operationId,id(7702));
  const inherited=fallback.segments[1].fields.lateGraceMinutes;assert.equal(inherited.state,'value');assert.equal(inherited.minutes,0);
  assert.deepEqual(inherited.source,enterpriseSource);assert.equal(inherited.trace[0].mode,'inherit');assert.equal(inherited.trace[0].source.operationId,id(7999));
  assert.equal(inherited.trace[1].source.operationId,id(7502));assert(!JSON.stringify(inherited).includes(id(7702)));
  const retained=JSON.stringify(futureResolved);future.rules.items[0].publications[0].rules.lateGraceMinutes={mode:'value',minutes:123};
  future.assignments.items[0].currentGroup.name='Changed only in detached test input';assert.equal(JSON.stringify(futureResolved),retained,'resolution_changed_after_input_edit');
  assert.equal(data.readCount()-countBefore,2);assert.equal(data.protectedFingerprint(),baseline,'candidate_resolution_changed_SQL_facts');
  native.pass('candidate rules actual128 past/future sources resolve four fields with original publication/assignment provenance, without writes');
  native.pass('candidate rules detached immutable resolution and explicitly in-memory newer-inherit fallback leave all SQL facts unchanged');
  return {checks:2,sourceReads:2,businessWrites:0,actualSourcesSql:true,actualPublishedRuleSelection:true,
    newerPublicationFallback:'pure-in-memory-counterfactual',candidateRulesApplied:false,formalAssessmentPerformed:false,allTableFingerprintsUnchanged:true,syntheticOnly:true};
}
