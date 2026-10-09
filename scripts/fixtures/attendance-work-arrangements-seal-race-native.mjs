//187 Inert callback: root supplies its existing owned sandbox after the actual
//send/self-confirm, before the main-flow seal. No environment lifecycle here.
//The winning real seal adds one period entry and changes only that period head.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

function protectedSql(names,site,periodId,operationId){
  assert(names.length>0&&new Set(names).size===names.length);
  const allowed=['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at'];
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const row=name==='merchant_attendance_period_closures'
      ?`case when r.merchant_id=${quote(site)} and r.period_id=${quote(periodId)} then to_jsonb(r)-array[${allowed.map(quote).join(',')}] else to_jsonb(r) end`:'to_jsonb(r)';
    const where=name==='merchant_attendance_period_entries'
      ?` where not(r.merchant_id=${quote(site)} and r.period_id=${quote(periodId)} and r.operation_id=${quote(operationId)})`:'';
    return `select ${quote(name)} name,(select coalesce(jsonb_agg(body order by body::text),'[]') from (select ${row} body from public.${name} r${where}) selected_rows) rows`;
  }).join(' union all ')+') seal_protected_rows)';
}

export async function verifyWorkArrangementSealRaceNative({d,native,scope,h,current,period,pq,pc,submit,wq}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  for(const value of [native?.query,native?.connect,d?.exec,d?.fingerprint,d?.definitions,d?.tableCatalog,period,pq,pc,submit,wq])assert.equal(typeof value,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  const q=pq('detail'),writeQuery=wq('self'),head=current?.period;
  assert(q.access==='owner'&&q.siteId===d.site&&q.workerId===h.workerId&&q.periodId&&q.operationId===null&&q.version===null);
  assert.equal(head?.periodId,q.periodId);assert.equal(head.sealed,false);assert.equal(head.state,'confirmed');
  assert.equal(head.confirmedVersion,head.currentVersion);assert(current.artifact&&current.artifact.sourceFingerprint);
  assert.equal(current.artifact.worker.employeeId,h.employeeId);assert.equal(current.artifact.worker.employeeAuthUserId,h.employeeAuthUserId);
  assert(writeQuery.siteId===d.site&&writeQuery.access==='self'&&writeQuery.requestId===null&&writeQuery.operationId===null&&writeQuery.preview===null);
  const seal=pc('seal',current),attempt=submit('remote'),site=quote(d.site),pid=quote(q.periodId);
  assert(seal.action==='seal'&&seal.periodId===q.periodId&&seal.expectedRevision===head.revision&&seal.expectedVersion===head.currentVersion);
  assert.equal(seal.expectedFingerprint,current.artifact.sourceFingerprint);
  assert.equal(attempt.action,'submit');assert.equal(attempt.expectedWorkerId,h.workerId);assert.equal(attempt.startAt,h.slot.startAt);assert.equal(attempt.endAt,h.slot.endAt);
  assert.notEqual(attempt.operationId,seal.operationId);
  const names=d.inventory(),defs=d.definitions(),catalog=d.tableCatalog();
  const countsSql=`select jsonb_build_object('periodEntries',(select count(*) from public.merchant_attendance_period_entries where merchant_id=${site} and period_id=${pid}),
    'periodVersions',(select count(*) from public.merchant_attendance_period_versions where merchant_id=${site} and period_id=${pid}),
    'periodArtifacts',(select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${pid}),
    'sealEntries',(select count(*) from public.merchant_attendance_period_entries where merchant_id=${site} and operation_id=${quote(seal.operationId)}),
    'submitRequests',(select count(*) from public.merchant_attendance_work_arrangement_requests where merchant_id=${site} and request_id=${quote(attempt.operationId)}),
    'submitEntries',(select count(*) from public.merchant_attendance_work_arrangement_entries where merchant_id=${site} and operation_id=${quote(attempt.operationId)}));`;
  const beforeCounts=JSON.parse(d.exec(countsSql));
  assert.equal(beforeCounts.sealEntries,0);assert.equal(beforeCounts.submitRequests,0);assert.equal(beforeCounts.submitEntries,0);
  const guardHash=protectedSql(names,d.site,q.periodId,seal.operationId),beforeProtected=d.exec('select '+guardHash+';');
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
  // Seal does not take p_artifact: the real149/155 flow re-reads the stored
  // artifact/source under settings UPDATE. Only send accepts an artifact body.
  const holder=prefix+`select public.faolla_attendance_period_closure_v1(${json(q)},${quote(d.owner)},${json(seal)},null,true);`;
  const waiter=prefix+`select public.faolla_attendance_work_arrangement_v1(${json(writeQuery)},${quote(h.employeeAuthUserId)},${json(attempt)},true);`;
  const race=await lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql},holder,waiter);
  assert.equal(race.witnessed,true,'seal_submit_exact_pid_required');assert(race.right.error,'sealed_submit_must_reject');
  assert.match(String(race.right.error),/ERROR:\s+attendance_period_sealed(?:\s|$)/);
  const winner=JSON.parse(race.left);assert.equal(winner.period.sealed,true);assert.equal(winner.operation.operationId,seal.operationId);
  assert.equal(winner.operation.command.action,'seal');
  const afterCounts=JSON.parse(d.exec(countsSql));assert.deepEqual(afterCounts,{...beforeCounts,periodEntries:beforeCounts.periodEntries+1,sealEntries:1});
  assert.equal(d.exec('select '+guardHash+';'),beforeProtected,'seal_race_changed_unapproved_facts_or_old_archives');
  assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  const beforeRead=d.fingerprint(),settled=await period(q);
  assert.equal(d.fingerprint(),beforeRead,'seal_result_read_wrote');
  assert.equal(settled.period.periodId,q.periodId);assert.equal(settled.period.sealed,true);
  assert.equal(settled.period.revision,head.revision+1);assert.equal(settled.period.currentVersion,head.currentVersion);
  assert.equal(settled.period.confirmedVersion,head.currentVersion);assert.equal(settled.artifact.sourceFingerprint,current.artifact.sourceFingerprint);
  native.pass('actual seal holds exact PID lock; concurrent work-arrangement submit rejects sealed with zero rows and all archive bytes unchanged');
  return {current:settled,result:{actualRaceConnections:2,exactPidLockWitness:true,sealWon:true,rejectedCode:'attendance_period_sealed',
    periodEntriesAdded:1,periodVersionsAdded:0,periodArtifactsAdded:0,workArrangementRequestsAdded:0,workArrangementEntriesAdded:0,
    oldArchivesAndOtherFactsPreserved:true,definitionsPreserved:true,tableCatalogPreserved:true,reverseRace:false,productionAccess:false}};
}
