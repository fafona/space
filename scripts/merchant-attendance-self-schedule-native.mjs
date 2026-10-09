// Import is inert. Only the explicit root-owned reuse runner starts PG. This is
// ordinary self-clock selection, NOT a four-channel or production Auth test.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {lifecycleId as id,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {prepareSelfScheduleNativeFixture,selfScheduleExpression,selfScheduleMigration,selfScheduleRpc} from './fixtures/attendance-self-schedule-native.mjs';
export {prepareSelfScheduleNativeFixture} from './fixtures/attendance-self-schedule-native.mjs';

export const selfScheduleNativeLabels=Object.freeze([
  '137 additive install and reapply retain111134136 definitions and existing tables; actual handler service returns bounded self choices',
  'actual clock-in stores explicit selected unselected missing-publication and cancelled results; a later cancellation preserves original linked snapshot',
  'same-slot multiple sessions and exact replay preserve original start anchors; changed selection conflicts and old operations never gain relations',
  'foreign missing wrong-revision and rebound identities fail without events; outside-window location-change and crossnight evidence stay explicit',
  'independent rule-binding flag remains intact; required relation failure rolls back event optional binding and relation before outer cleanup',
  'four exact-PID two-connection races prove cancel-before clock-before duplicate-operation and stale-sequence behavior',
  'feature rollback paused module and total self switch retain their distinct gates; current-authorized original-ID reads do not mutate facts',
  '101 index candidates fail closed as a limited empty choice list while known operation recovery preserves its association',
  'private ACL and append-only relations are enforced; reapply and every read preserve original business definitions and non-target facts',
]);
const relationTable='merchant_attendance_shift_schedule_relations';
const flags=['FAOLLA_ATTENDANCE_SELF_ENABLED','FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED','FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS',
  'FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED','FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS'];
let phase='entry';
export function selfScheduleNativeFailure(error){
  const code=(error instanceof Error?error.message:'').match(/(?:ERROR:\s+|^)((?:attendance|merchant_attendance)_[a-z_]+)(?=\r?\n|$)/)?.[1];
  return {error:'self_schedule_native_failed',phase,code:code??'local_check_failed'};
}
const deny=(expression,code)=>`begin perform ${expression};raise exception 'self_schedule_unexpected_acceptance';exception when sqlstate 'P0001' then if sqlerrm<>${quote(code)} then raise;end if;end;`;

export async function checkAttendanceSelfSchedule(native,browserCheck=null){
  assert(browserCheck===null||typeof browserCheck==='function');let summary;
  const previous=flags.map(key=>[key,process.env[key]]);
  try{
    await withAttendanceConcurrencySandbox(native,async scope=>{
      phase='minimal-preparation';const d=await prepareSelfScheduleNativeFixture(native,scope);
      const {exec,site,owner,auth,employee,worker,secondLocation,slots,selected,command,input,request,oldClock,counts,fingerprint}=d;
      process.env.FAOLLA_ATTENDANCE_SELF_ENABLED='1';process.env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED='1';process.env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS=site;
      process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='0';process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS=site;
      const targetTables=['merchant_attendance_events',relationTable,'merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources',
        'merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations','merchant_attendance_schedule_publication_evidence'];
      const protectedTables=d.inventory().filter(t=>!targetTables.includes(t)),protectedBefore=fingerprint(protectedTables);
      const stored=eventId=>JSON.parse(exec(`select to_jsonb(r) from public.${relationTable} r where start_event_id='${eventId}';`));
      const unchanged=async run=>{const before=fingerprint();try{return await run();}finally{assert.equal(fingerprint(),before,'self_schedule_read_or_rejection_wrote_facts');}};
      const good=async(c=null,selection=null,op=null,overrides={})=>{const r=await request(c,selection,op,overrides);assert.equal(r.status,200,`self_schedule_http_${r.status}:${r.body.error}`);return r.body;};
      const bad=async(c,selection,status,code,overrides={})=>unchanged(async()=>{const r=await request(c,selection,null,overrides);assert.equal(r.status,status);assert.deepEqual(r.body,{ok:false,error:code});});
      const fresh=async(slot,status='linked',reason=null)=>{const c=command(),r=await good(c,slot?selected(slot):null);assert.equal(r.association.status,status);assert.equal(r.association.reason,reason);
        assert.equal(r.association.startEventId,r.clock.receipt.id);assert.equal(r.association.operationId,c.operationId);assert.equal(r.clock.state.status,'working');
        const row=stored(r.clock.receipt.id);assert.equal(row.employee_id,employee);assert.equal(row.employee_auth_user_id,auth);assert.equal(row.binding_policy,'employee-explicit-clock-in-v1');
        assert.deepEqual(row.selection,slot?selected(slot):null);return {command:c,result:r,stored:row};};
      const finish=()=>oldClock('clock_out');
      const expr=(c=null,selection=null,op=null,patch={})=>selfScheduleExpression(input(c,selection,op,patch));
      const probe=(setup,sql)=>{const before=fingerprint();try{return exec(`begin;${setup}${sql}rollback;`);}finally{assert.equal(fingerprint(),before,'self_schedule_rollback_probe_changed_facts');}};
      const initial=await unchanged(()=>good());assert.equal(initial.clock.state.sequence,0);assert.equal(initial.choices.entries.length,10);
      assert.equal(initial.choices.timeZone,'UTC');assert.equal(initial.choices.fromDate,d.day(-1));assert.equal(initial.choices.throughDate,d.day(1));
      assert(initial.choices.entries.some(s=>s.id===slots.overnight.id));assert(!initial.choices.entries.some(s=>[slots.other.id,slots.foreign.id].includes(s.id)));
      assert.equal(initial.choices.entries.find(s=>s.id===slots.legacy.id).hasPublicationEvidence,false);
      assert.deepEqual(counts(),{events:0,relations:0,bindings:0,sources:0});native.pass(selfScheduleNativeLabels[0]);

      phase='actual-selection-outcomes';const linked=await fresh(slots.main);await finish();
      const unselected=await fresh(null,'unselected');assert.equal(unselected.result.association.slot,null);await finish();
      const missing=await fresh(slots.legacy,'unverified','publication_missing');assert.equal(missing.result.association.slot.hasPublicationEvidence,false);await finish();
      d.cancel(slots.cancelBefore);const cancelled=await fresh(slots.cancelBefore,'unverified','cancelled');assert.equal(cancelled.result.association.slot.cancelled,true);await finish();
      const after=await fresh(slots.cancelAfter);d.cancel(slots.cancelAfter);
      const later=await unchanged(()=>good(null,null,after.command.operationId));assert.equal(later.association.status,'linked');assert.equal(later.association.currentCancelled,true);
      assert.equal(later.association.slot.cancelled,false);assert.deepEqual(stored(after.result.clock.receipt.id),after.stored);await finish();
      assert.deepEqual(counts(),{events:10,relations:5,bindings:0,sources:0});native.pass(selfScheduleNativeLabels[1]);

      phase='replay-and-multiple-sessions';const second=await fresh(slots.main);await finish();
      assert.notEqual(second.result.clock.receipt.id,linked.result.clock.receipt.id);
      assert.equal(exec(`select count(*) from public.${relationTable} where slot_id='${slots.main.id}' and status='linked';`),'2');
      const replay=await unchanged(()=>good(linked.command,selected(slots.main)));assert.equal(replay.clock.replayed,true);assert.deepEqual(replay.association,linked.result.association);
      await bad(linked.command,null,409,'attendance_operation_conflict');await bad(linked.command,selected(slots.alternate),409,'attendance_operation_conflict');
      const oldCommand=command();const legacyClock=await oldClock('clock_in',oldCommand);await finish();
      const original=await unchanged(()=>good(oldCommand,selected(slots.main)));assert.equal(original.clock.replayed,true);assert.equal(original.association,null);
      const legacyRead=await unchanged(()=>good(null,null,legacyClock.receipt.operationId));assert.equal(legacyRead.association,null);
      assert.deepEqual(counts(),{events:14,relations:6,bindings:0,sources:0});native.pass(selfScheduleNativeLabels[2]);

      phase='authorization-and-local-interval-probes';
      for(const slot of [slots.other,slots.foreign,{id:id(999991),revision:1}])await bad(command(),selected(slot),403,'attendance_access_denied');
      await bad(command(),{...selected(slots.main),revision:slots.main.revision+1},400,'attendance_invalid_request');
      const rebound=command();probe(`update public.merchant_enterprise_employees set auth_user_id='${id(3)}' where id='${employee}';`,
        `set local role service_role;do $rebound$ begin ${deny(expr(rebound,selected(slots.main),null,{p_auth_user_id:id(3)}),'attendance_access_denied')}end;$rebound$;`);
      probe(`update public.merchant_attendance_workers set employee_id=null where id='${d.otherWorker}';update public.merchant_attendance_workers set employee_id='${d.otherEmployee}' where id='${worker}';`,
        `set local role service_role;do $rebound$ begin ${[slots.main,slots.legacy].map(slot=>deny(expr(command(),selected(slot),null,{p_auth_user_id:d.otherAuth}),'attendance_access_denied')).join('\n')}end;$rebound$;`);
      const outside=d.publication([[`${d.day(3)}T09:00:00.000Z`,`${d.day(3)}T09:30:00.000Z`]]).slots[0];
      for(const [slot,setup,patch,status,reason]of [[outside,'',{},'unverified','outside_window'],
        [slots.main,`update public.merchant_attendance_workers set default_location_id='${secondLocation}',version=2 where id='${worker}';`,{locationId:secondLocation},'unverified','location_changed'],
        [slots.overnight,'',{},'linked',null]]){
        const value=JSON.parse(probe(setup,`set local role service_role;select ${expr(command('clock_in',patch),selected(slot))};`));
        assert.equal(value.association.status,status);assert.equal(value.association.reason,reason);assert.equal(value.association.slot.startAt,slot.startAt);assert.equal(value.association.slot.endAt,slot.endAt);
      }
      // The real now clock and tomorrow's explicitly selected UTC plan do NOT
      // overlap. This proves explicit association, not punctuality or presence.
      assert(Date.parse(linked.result.clock.receipt.occurredAt)<Date.parse(slots.main.startAt));
      native.pass(selfScheduleNativeLabels[3]);

      phase='independent-rule-flag-and-atomic-fault';process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='1';
      const bound=await fresh(slots.main);await finish();assert.deepEqual(counts(),{events:16,relations:7,bindings:1,sources:1});
      const binding=JSON.parse(exec(`select to_jsonb(b) from public.merchant_attendance_shift_rule_bindings b where start_event_id='${bound.result.clock.receipt.id}';`));
      assert.equal(binding.status,'verified');assert.equal(binding.channel,'self');
      assert.equal(exec(`select bool_and(value->>'state'='unconfigured') from public.merchant_attendance_shift_rule_sources s,jsonb_each(s.source_text::jsonb->'fields') where s.source_id='${binding.source_id}';`),'t');
      process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED='0';await fresh(null,'unselected');await finish();assert.deepEqual(counts(),{events:18,relations:8,bindings:1,sources:1});
      const failed=command(),beforeFailure=counts();probe(`alter table public.${relationTable} add constraint qa_self_schedule_required_failure check(false) not valid;`,
        `set local role service_role;do $failure$ begin begin perform ${expr(failed,selected(slots.main),null,{p_bind_rules:true})};raise exception 'relation_failure_not_observed';
          exception when check_violation then if sqlerrm not like '%qa_self_schedule_required_failure%' then raise;end if;end;end;$failure$;reset role;
        do $atomic$ begin assert not exists(select 1 from public.merchant_attendance_events where operation_id='${failed.operationId}'),'relation_failure_left_clock';
          assert (select count(*) from public.merchant_attendance_events)=${beforeFailure.events},'relation_failure_event_count';
          assert (select count(*) from public.${relationTable})=${beforeFailure.relations},'relation_failure_left_relation';
          assert (select count(*) from public.merchant_attendance_shift_rule_bindings)=${beforeFailure.bindings},'relation_failure_left_binding';
          assert (select count(*) from public.merchant_attendance_shift_rule_sources)=${beforeFailure.sources},'relation_failure_left_source';end;$atomic$;`);
      native.pass(selfScheduleNativeLabels[4]);

      phase='two-connection-ordering';
      const race=async(holder,waiter)=>{const r=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},`reset role;${d.guard}${holder}`,`reset role;${d.guard}${waiter}`);assert(r.witnessed);assert.equal(r.right.error,null);return r;};
      const beforeCancel=command(),cancelFirst=d.cancelCommand(slots.cancelRaceBefore);
      const cancelRace=await race(`set local role service_role;select ${d.cancelExpression(cancelFirst)};`,`set local role service_role;select ${expr(beforeCancel,selected(slots.cancelRaceBefore))};`);
      const cancelledRace=JSON.parse(cancelRace.right.output);assert.equal(cancelledRace.association.status,'unverified');assert.equal(cancelledRace.association.reason,'cancelled');await finish();
      const clockFirst=command(),cancelSecond=d.cancelCommand(slots.cancelRaceAfter);
      const clockRace=await race(`set local role service_role;select ${expr(clockFirst,selected(slots.cancelRaceAfter))};`,`set local role service_role;select ${d.cancelExpression(cancelSecond)};`);
      const firstClock=JSON.parse(clockRace.left);assert.equal(firstClock.association.status,'linked');assert.equal(firstClock.association.slot.cancelled,false);
      const afterRace=await unchanged(()=>good(null,null,clockFirst.operationId));assert.equal(afterRace.association.status,'linked');assert.equal(afterRace.association.currentCancelled,true);await finish();
      const duplicate=command(),beforeDuplicate=counts();const duplicated=await race(`set local role service_role;select ${expr(duplicate,selected(slots.race))};`,`set local role service_role;select ${expr(duplicate,selected(slots.race))};`);
      const left=JSON.parse(duplicated.left),right=JSON.parse(duplicated.right.output);assert.equal(right.clock.replayed,true);assert.deepEqual(right.association,left.association);
      assert.equal(counts().events,beforeDuplicate.events+1);assert.equal(counts().relations,beforeDuplicate.relations+1);await finish();
      const seqFirst=command(),seqStale=command();await race(`set local role service_role;select ${expr(seqFirst,selected(slots.main))};`,
        `set local role service_role;do $sequence$ begin ${deny(expr(seqStale,null),'attendance_sequence_conflict')}end;$sequence$;`);
      assert.equal(exec(`select count(*) from public.merchant_attendance_events where operation_id='${seqStale.operationId}';`),'0');await finish();
      assert.deepEqual(counts(),{events:26,relations:12,bindings:1,sources:1});native.pass(selfScheduleNativeLabels[5]);

      phase='authorization-and-gate-recovery';
      process.env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED='0';
      const flagRead=await unchanged(()=>good(null,null,linked.command.operationId));assert.equal(flagRead.selectionEnabled,false);assert.deepEqual(flagRead.choices.entries,[]);assert.deepEqual(flagRead.association,linked.result.association);
      await bad(command(),null,403,'attendance_self_schedule_disabled');process.env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED='1';
      process.env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS='99990002';await bad(command(),null,403,'attendance_self_schedule_disabled');process.env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS=site;
      const paused={entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})};
      const pausedRead=await unchanged(()=>good(null,null,linked.command.operationId,paused));assert.equal(pausedRead.moduleEnabled,false);assert.deepEqual(pausedRead.association,linked.result.association);
      await bad(command(),null,403,'attendance_platform_paused',paused);
      const require=createRequire(import.meta.url),{MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
      for(const [override,status,code]of [[{baseEnabled:()=>false},404,'attendance_not_available'],
        [{authenticate:async()=>{throw new MerchantEnterpriseAccessError('unauthorized',401);}},401,'unauthorized']]){
        const called=d.calls.length;await unchanged(async()=>{const r=await request(null,null,linked.command.operationId,override);assert.equal(r.status,status);assert.equal(r.body.error,code);});assert.equal(d.calls.length,called);
      }
      await unchanged(async()=>{const r=await request(null,null,linked.command.operationId,{authenticate:async()=>({user:{id:owner},authenticationMethods:['password']})});assert.equal(r.status,403);assert.equal(r.body.error,'attendance_access_denied');});
      native.pass(selfScheduleNativeLabels[6]);

      // Optional ROOT browser callback uses these SAME actual SQL rows and no
      // live native session is held across it. Choices are not dense yet.
      const nativeCounts=counts();let browser=null;
      if(browserCheck){phase='root-browser-callback';browser=await browserCheck(native,scope,d);assert.equal((await good()).clock.state.status,'off','browser_must_finish_owned_clock');}
      const afterBrowser=counts();assert.equal(fingerprint(protectedTables),protectedBefore,'browser_changed_non_target_fixture_facts');

      phase='bounded-101-choice-list';
      const existing=Number(exec(`select count(*) from public.merchant_attendance_schedule_slots where merchant_id='${site}' and worker_id='${worker}' and work_date between '${d.day(-1)}' and '${d.day(1)}';`));
      assert(existing>=10&&existing<=32,'self_schedule_bounded_fixture_changed');let needed=101-existing,offset=0;
      while(needed>0){const batch=Math.min(32,needed),base=Date.parse(d.day(1)+'T12:00:00.000Z');
        d.publication(Array.from({length:batch},(_,n)=>[new Date(base+(offset+n)*120000).toISOString(),new Date(base+(offset+n)*120000+60000).toISOString()]));needed-=batch;offset+=batch;
      }
      assert.equal(exec(`select count(*) from public.merchant_attendance_schedule_slots where merchant_id='${site}' and worker_id='${worker}' and work_date between '${d.day(-1)}' and '${d.day(1)}';`),'101');
      const limited=await unchanged(()=>good());assert.equal(limited.choices.limited,true);assert.deepEqual(limited.choices.entries,[]);
      const stillKnown=await unchanged(()=>good(null,null,linked.command.operationId));assert.equal(stillKnown.choices.limited,true);assert.deepEqual(stillKnown.association,linked.result.association);
      assert.deepEqual(counts(),afterBrowser);native.pass(selfScheduleNativeLabels[7]);

      phase='append-only-acl-reapply';const baseline=fingerprint();
      for(const role of ['anon','authenticated','service_role']){
        assert.equal(exec(`select has_table_privilege('${role}','public.${relationTable}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');`),'f');
        exec(`set local role ${role};do $private$ begin begin insert into public.${relationTable} default values;raise exception 'relation_direct_insert_accepted';exception when insufficient_privilege then null;end;
          begin perform public.faolla_attendance_self_schedule_slot_v1(null::public.merchant_attendance_schedule_slots);raise exception 'private_slot_helper_accepted';exception when insufficient_privilege then null;end;end;$private$;`);
        for(const signature of ['faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)','faolla_attendance_self_schedule_guard_v1()'])assert.equal(exec(`select has_function_privilege('${role}','public.${signature}','EXECUTE');`),'f');
        assert.equal(exec(`select has_function_privilege('${role}','public.${selfScheduleRpc}(text,uuid,jsonb,jsonb,uuid,boolean,boolean)','EXECUTE');`),role==='service_role'?'t':'f');
      }
      for(const statement of [`update public.${relationTable} set merchant_id=merchant_id`,`delete from public.${relationTable}`,`truncate public.${relationTable}`])exec(`do $immutable$ begin begin execute ${quote(statement)};raise exception 'relation_rewrite_accepted';exception when insufficient_privilege then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end;$immutable$;`);
      assert.equal(fingerprint(),baseline);exec(boundClockMigrationBody(native.root,selfScheduleMigration));assert.equal(fingerprint(),baseline,'137_reapply_changed_relations');
      assert.equal(d.definitions(true),d.oldDefinitions);assert.equal(d.definitions(),d.installedDefinitions);assert.equal(d.tableCatalog(),d.installedCatalog);
      assert.equal(fingerprint(protectedTables),protectedBefore);assert.deepEqual(stored(linked.result.clock.receipt.id),linked.stored);
      assert.deepEqual(JSON.parse(exec(`select to_jsonb(b) from public.merchant_attendance_shift_rule_bindings b where start_event_id='${bound.result.clock.receipt.id}';`)),binding);
      native.pass(selfScheduleNativeLabels[8]);
      summary={groups:selfScheduleNativeLabels.length,actualConnectionRaces:4,nativeCounts,finalCounts:counts(),serviceCalls:d.calls.length,browser,
        actualHandlerServiceSql:true,syntheticAuthAndEntitlement:true,actualSelf111:true,actualBound134:true,new137:true,ruleDefaultsInvented:false,
        actualCrossMidnightWait:false,savedOvernightPlanTested:true,automaticMatchingClaimed:false,otherClockChannelsRetested:false,
        newCluster:false,productionAccess:false,ownedNamespaceCleanup:true};
    });
    return summary;
  }finally{for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceSelfSchedule).catch(error=>{console.error(selfScheduleNativeFailure(error));process.exitCode=1;});
}
