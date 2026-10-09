//200 inert, owned-schema acceptance callback. Root exclusively owns runtime
//lifecycle. Two real decisions are committed for cross-connection visibility;
//the root driver restores its existing whole-fixture baseline afterwards.
//No SQL definition, role, trigger, business policy or source fact is rewritten.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json,lifecycleRace} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const original='faolla_attendance_plan_exception_review_v1';
const wrapped='faolla_attendance_plan_exception_review_event_v1';
const expression=(name,query,actor,command=null,allow=true)=>`public.${name}(${json(query)},${quote(actor)},${json(command)},${allow})`;

/** Invoke after the existing200 exception case has at least one real decision.
 * Required ports: {native,scope,d,call,captures,workSubject,exceptionBase,next}.
 * No imports or module evaluation start PostgreSQL or open a connection.
 */
export async function verifyEventNotificationExceptionRaces(p){
  const {native,scope,d,call,captures,workSubject,exceptionBase,next}=p;
  assert.equal(d?.syntheticOnly,true);
  for(const f of [native?.connect,native?.query,d?.exec,d?.inventory,d?.fingerprint,d?.definitions,d?.tableCatalog,scope?.sql,call,captures,next])assert.equal(typeof f,'function');
  assert.equal(typeof d.guard,'string');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(exceptionBase.siteId,d.site);assert.equal(workSubject.site,d.site);
  assert.equal(exceptionBase.access,'owner');assert.equal(exceptionBase.mode,'detail');
  assert.equal(exceptionBase.workerId,workSubject.worker);assert.equal(exceptionBase.operationId,null);
  const operations=[next(),next()];assert.equal(new Set(operations).size,2);
  for(const op of operations)assert.match(op,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const tables=d.inventory(),mutable=['merchant_attendance_plan_exception_entries','merchant_attendance_event_notifications'];
  assert(mutable.every(t=>tables.includes(t)));
  const all=()=>d.fingerprint(tables),protectedFacts=d.fingerprint(tables.filter(t=>!mutable.includes(t))),defs=d.definitions(),catalog=d.tableCatalog();
  // Exclude only the TWO declared new operation rows, not a case, employee,
  // merchant or entire table. All original facts stay in this hash.
  const preservedSql=`select md5(jsonb_object_agg(name,rows order by name)::text) from (${mutable.map(table=>
    `select ${quote(table)} name,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.${table} x
      where not(x.merchant_id=${quote(d.site)} and x.operation_id in(${operations.map(quote).join(',')}))) rows`).join(' union all ')}) preserved;`;
  const preserved=d.exec(preservedSql);
  for(const op of operations){
    assert.equal(d.exec(`select count(*) from public.merchant_attendance_plan_exception_entries where merchant_id=${quote(d.site)} and operation_id=${quote(op)};`),'0');
    assert.equal(captures(workSubject,op).length,0);
  }
  const db={connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql};
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard+'set local role service_role;';
  let phase='old-first';
  const results=[];
  try{
    for(const [index,first] of ['old','new'].entries()){
      phase=first+'-first';const op=operations[index],beforeRead=all();
      const current=call(expression(original,exceptionBase,d.owner));
      const source=call(`public.faolla_attendance_plan_exception_source_v1(${json({siteId:d.site,workerId:workSubject.worker,slotId:exceptionBase.slotId})},${quote(d.owner)})`);
      assert.equal(all(),beforeRead,'exception_race_preparation_reads_write_nothing');
      assert(current.detail?.latestDecision&&Number.isSafeInteger(current.detail.revision)&&current.detail.revision>0,'existing_real_exception_case_required');
      assert.equal(source.worker.workerId,workSubject.worker);assert.equal(source.worker.employeeId,workSubject.employee);
      assert.equal(source.worker.employeeAuthUserId,workSubject.auth);assert.equal(source.slot.id,exceptionBase.slotId);
      assert.match(source.fingerprint,/^[0-9a-f]{64}$/);
      const query={...exceptionBase,mode:'decide',operationId:op},command={operationId:op,expectedRevision:current.detail.revision,
        expectedFingerprint:source.fingerprint,employeeId:workSubject.employee,employeeAuthUserId:workSubject.auth,
        outcome:'follow_up',note:`Synthetic200 exact PID ${first}-first original/wrapper race`};
      const oldStatement=prefix+'select '+expression(original,query,d.owner,command)+';',
        newStatement=prefix+'select '+expression(wrapped,query,d.owner,command)+';';
      const race=await lifecycleRace(db,first==='old'?oldStatement:newStatement,first==='old'?newStatement:oldStatement);
      assert.equal(race.witnessed,true,'exception_exact_holder_pid_required');assert.equal(race.right.error,null);
      const left=JSON.parse(race.left),right=JSON.parse(race.right.output);
      assert.equal(left.receipt.operationId,op);assert.deepEqual(left.receipt.command,command);
      assert.deepEqual(right.receipt,left.receipt,'waiter_must_replay_the_exact_original_receipt');
      assert.equal(left.receipt.item.revision,current.detail.revision+1);
      assert.equal(d.exec(`select count(*) from public.merchant_attendance_plan_exception_entries where merchant_id=${quote(d.site)} and operation_id=${quote(op)};`),'1');
      const notifications=captures(workSubject,op),expectedCaptures=first==='old'?0:1;
      assert.equal(notifications.length,expectedCaptures,'source_probe_must_precede_call_under_original_lock');
      if(expectedCaptures){
        const notice=notifications[0];assert.equal(notice.source_category,'plan_exception');assert.equal(notice.event_type,'follow_up');
        assert.equal(notice.worker_id,workSubject.worker);assert.equal(notice.employee_id,workSubject.employee);
        assert.equal(notice.recipient_auth_user_id,workSubject.auth);assert.equal(notice.actor_auth_user_id,d.owner);
        assert.equal(notice.capture_status,'ready');assert.equal(notice.source_revision,current.detail.revision+1);
      }
      // Both same-command retries and GET recover remain exact readbacks even
      // with allow=false. Missing capture after old-wins is never backfilled.
      for(const name of [original,wrapped])for(const recovery of [false,true]){
        const before=all(),q=recovery?{...query,mode:'recover'}:query;
        const replay=call(expression(name,q,d.owner,recovery?null:command,false));
        assert.deepEqual(replay.receipt,left.receipt);assert.equal(all(),before,'exception_race_replay_must_not_write');
      }
      assert.equal(captures(workSubject,op).length,expectedCaptures);
      assert.equal(d.fingerprint(tables.filter(t=>!mutable.includes(t))),protectedFacts,'races_must_not_ack_or_mutate_other_business');
      assert.equal(d.exec(preservedSql),preserved,'races_changed_original_source_or_notification_rows');
      assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
      native.pass(`200 exact PID159 ${first}-first: one original decision, ${expectedCaptures} fresh capture, both original/wrapper paused retries and GET recover write nothing`);
      results.push({first,exactPidWitnessed:true,sourceEntries:1,captures:expectedCaptures,replayReadbacks:4});
    }
    return {syntheticOnly:true,exactPidRaces:2,scenarios:results,committedSourceDecisions:2,committedCaptures:1,
      originalFactsPreserved:true,otherLedgersUnchanged:true,definitionsPreserved:true,tableCatalogPreserved:true,
      cleanup:'root-owned-baseline-restoration',realAuthentication:false,production:false,deployed:false};
  }catch(error){throw Error('event_notification_exception_race_phase='+phase+': '+String(error),{cause:error});}
}
