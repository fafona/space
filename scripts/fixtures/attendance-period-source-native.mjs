//176 inert acceptance helper. The caller alone owns the existing local PG,
//schema and cleanup. h is the explicitly SYNTHETIC historical174 seed, not an
//actual past employee clock/publication/approval. No environment is started here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const require=createRequire(import.meta.url);
const rpc='faolla_attendance_period_source_v1';
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const plusDays=(date,n)=>new Date(Date.parse(date+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
const call=(query,actor)=>`public.${rpc}(${json(query)},${quote(actor)})`;
const expectedError=(expression,code)=>`do $period_source_negative$ begin
  begin perform ${expression};raise exception 'period_source_negative_unexpected_success';
  exception when raise_exception then if sqlerrm<>${quote(code)} then raise;end if;end;
end;$period_source_negative$;`;

export async function verifyPeriodSourceNative({d,native,scope,h}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert(typeof d.exec==='function'&&typeof d.fingerprint==='function'&&typeof d.definitions==='function');
  assert(typeof native?.query==='function'&&typeof scope?.sql==='function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  assert.equal(h.slot.timeZone,'UTC');assert.match(h.slot.workDate,/^\d{4}-\d{2}-\d{2}$/);
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=typeof d.tableCatalog==='function'?d.tableCatalog():null;
  const q={siteId:d.site,access:'owner',workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate};
  const selfQ={...q,access:'self'},checks=[];
  let sourceReads=0,negativeChecks=0;
  const restored=label=>{
    assert.equal(d.fingerprint(),baseline,label+':facts_changed');
    assert.equal(d.definitions(),definitions,label+':definitions_changed');
    if(catalog!==null)assert.equal(d.tableCatalog(),catalog,label+':catalog_changed');
  };
  const read=(query,actor)=>{
    const before=d.fingerprint();
    const raw=JSON.parse(d.exec("set local time zone 'UTC';set local role service_role;select "+call(query,actor)+';'));
    assert.equal(d.fingerprint(),before,'period_source_read_wrote_facts');sourceReads++;
    assert.equal(raw.sourceVersion,'attendance-period-source-v1');assert.equal(raw.complete,true);
    assert.equal(raw.siteId,d.site);assert.equal(raw.workerId,h.workerId);
    assert.equal(raw.employeeId,h.employeeId);assert.equal(raw.employeeAuthUserId,h.employeeAuthUserId);
    assert.equal(hash(raw.sourceText),raw.sourceFingerprint);
    assert.deepEqual(JSON.parse(raw.sourceText),raw.sourceCanonical);
    assert(Buffer.byteLength(raw.sourceText,'utf8')<=1048576);assert(Buffer.byteLength(JSON.stringify(raw),'utf8')<=4194304);
    return raw;
  };
  const negative=(label,query,actor,code,setup='')=>{
    try{
      d.exec("begin;reset role;set local time zone 'UTC';"+setup+'set local role service_role;'+expectedError(call(query,actor),code)+'rollback;');
      negativeChecks++;
    }catch(error){throw new Error('period_source_negative_failed:'+label+':'+String(error?.message??error),{cause:error});}
    finally{restored(label);}
  };
  try{
    const ownerRaw=read(q,d.owner),selfRaw=read(selfQ,h.employeeAuthUserId);
    assert.equal(ownerRaw.validation,'owner_checked');assert.equal(selfRaw.validation,'self_not_checked');
    assert.equal(ownerRaw.report.access,'owner');assert.equal(selfRaw.report.access,'self');
    assert.equal(ownerRaw.sourceFingerprint,selfRaw.sourceFingerprint,'period_source_owner_self_hash_differs');
    assert.deepEqual(ownerRaw.sourceCanonical,selfRaw.sourceCanonical,'period_source_owner_self_content_differs');
    assert.deepEqual(ownerRaw.blockers,[]);assert.deepEqual(selfRaw.blockers,[]);
    assert.equal(ownerRaw.report.base.items.length,1);assert.equal(ownerRaw.report.base.items[0].startEventId,h.startEventId);
    assert.equal(ownerRaw.context.plans.items.length,1);assert.equal(ownerRaw.context.plans.items[0].slot.id,h.slot.id);
    assert.equal(ownerRaw.context.plans.sessions.length,1);
    const saved=ownerRaw.context.plans.sessions[0];
    assert.equal(saved.item.startEventId,h.startEventId);assert.equal(saved.relation.status,'linked');assert.equal(saved.adoption.status,'adopted');
    assert.equal(saved.adoption.approval.operationId,h.approvalOperationId);
    assert.equal(saved.planRuleApproval.operationId,h.approvalOperationId);
    assert.equal(saved.planRuleApproval.sourceSha256,h.sourceSha256);
    assert.equal(saved.planRuleApproval.source.fields.lateGraceMinutes.minutes,0);
    assert.equal(saved.planRuleApproval.source.fields.earlyGraceMinutes.minutes,10);
    assert.deepEqual(ownerRaw.context.plans.items[0].currentApproval,saved.planRuleApproval);
    checks.push('owner_self_same_complete_canonical_and_fixed_rule_body');

    const repeated=read(q,d.owner);
    assert(repeated.readAt>=ownerRaw.readAt);assert(repeated.report.base.asOf>=ownerRaw.report.base.asOf);
    assert.equal(repeated.sourceFingerprint,ownerRaw.sourceFingerprint,'observation_time_changed_semantic_hash');
    assert.deepEqual(repeated.sourceCanonical,ownerRaw.sourceCanonical);
    checks.push('repeated_real_read_retains_content_hash');

    const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
    const periodQuery=access=>({...q,access,mode:'preview',periodId:null,operationId:null,version:null});
    const ownerProjection=projectPeriodClosureSource(ownerRaw,periodQuery('owner'));
    const selfProjection=projectPeriodClosureSource(selfRaw,periodQuery('self'));
    assert.equal(ownerProjection.artifact.sourceFingerprint,ownerRaw.sourceFingerprint);
    assert.equal(selfProjection.artifact.sourceFingerprint,ownerRaw.sourceFingerprint);
    assert.deepEqual(ownerProjection.artifact.source,selfProjection.artifact.source);
    assert.deepEqual(ownerProjection.artifact.report.totals,selfProjection.artifact.report.totals);
    assert.equal(ownerProjection.artifact.calculationVersion,'timesheet-v2-unified-v1');
    assert.equal(ownerProjection.artifact.dayBoundaries.length,1);
    assert.equal(ownerProjection.artifact.dayBoundaries[0].skipped,false);
    checks.push('actual_raw_through_server_artifact_projection');

    negative('wrong_owner',q,id(176981),'attendance_access_denied');
    negative('wrong_self',{...selfQ,workerId:d.worker},h.employeeAuthUserId,'attendance_access_denied');
    negative('extra_key',{...q,limit:1},d.owner,'attendance_invalid_request');
    negative('invalid_access',{...q,access:'manager'},d.owner,'attendance_invalid_request');
    negative('invalid_uuid',{...q,workerId:'not-a-uuid'},d.owner,'attendance_invalid_request');
    negative('range_32_dates',{...q,throughDate:plusDays(q.fromDate,31)},d.owner,'attendance_invalid_request');
    checks.push('authorization_exact_query_and_31_date_boundary_reject');

    negative('rebound_employee_auth',q,d.owner,'attendance_period_source_identity_changed',
      `update public.merchant_enterprise_employees set auth_user_id=${quote(id(176982))} where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)};`);
    checks.push('current_same_employee_new_auth_does_not_inherit_history');

    // Two additional original rows are deliberately synthetic and have NO133 or
    //137 identity receipt. All old constraints remain enabled. They are rolled
    //back; this is not a real current/past clock request and not a cap fixture.
    const unproven=`do $period_history_guard$ begin
      assert (select count(*) from public.merchant_attendance_events where merchant_id=${quote(d.site)} and worker_id=${quote(h.workerId)})=2,'period_history_expected_two_seed_events';
      assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'period_history_guards_required';
    end;$period_history_guard$;
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
    select ${quote(id(176983))},merchant_id,worker_id,location_id,${quote(id(176985))},3,'clock_in','web',null,
      ${quote(h.slot.endAt)}::timestamptz+interval '1 hour',${quote(h.slot.endAt)}::timestamptz+interval '1 hour',time_zone,actor_employee_id
      from public.merchant_attendance_events where merchant_id=${quote(d.site)} and id=${quote(h.startEventId)};
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
    select ${quote(id(176984))},merchant_id,worker_id,location_id,${quote(id(176986))},4,'clock_out','web',null,
      ${quote(h.slot.endAt)}::timestamptz+interval '2 hours',${quote(h.slot.endAt)}::timestamptz+interval '2 hours',time_zone,actor_employee_id
      from public.merchant_attendance_events where merchant_id=${quote(d.site)} and id=${quote(h.lastEventId)};`;
    negative('unproven_old_session',q,d.owner,'attendance_period_source_identity_unproven',unproven);
    checks.push('missing_historical_auth_evidence_fails_closed');
    restored('complete');
    return {q,selfQuery:selfQ,ownerRaw,selfRaw,ownerProjection,selfProjection,checks,sourceReads,negativeChecks,
      actualSourceReads:sourceReads,canonicalFingerprint:ownerRaw.sourceFingerprint,
      rangeLimitChecks:1,denseSourceCapMeasured:false,syntheticHistoricalRows:h.syntheticHistoricalRows,
      rollbackOnlyAdditionalHistoricalRows:2,syntheticAuth:true,syntheticOnly:true,
      fixtureDisclosure:'Real148 and server projection on the explicitly synthetic174 historical seed; two additional unproven-event rows exist only in a guarded rollback probe. No live Auth or past real publication is claimed.',
      factsUnchanged:true,definitionsUnchanged:true,callerOwnsRuntimeAndCleanup:true};
  }finally{restored('finally');}
}
