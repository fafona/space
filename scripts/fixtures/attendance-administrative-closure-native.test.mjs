import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {administrativeClosureHistoricalTemplate,administrativeClosureHistoricalSeed,administrativeClosureNativeSite,administrativeClosureNativeRpcExpression,
 administrativeClosureNativeTables,verifyAdministrativeClosureNative} from './attendance-administrative-closure-native.mjs';
const source=readFileSync(new URL('./attendance-administrative-closure-native.mjs',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
//These small objects exercise template serialization only, not SQL legitimacy.
function template(){
 const result=Object.fromEntries(administrativeClosureNativeTables.map(n=>[n,[]])),row={merchant_id:administrativeClosureNativeSite};
 result.merchant_enterprise_employees=[{...row,id:id(1),auth_user_id:id(2),email:'synthetic@example.test',created_at:'2026-10-08T10:00:00.123456+00:00'}];
 result.merchant_attendance_workers=[{...row,id:id(3),employee_id:id(1),worker_no:'SYNTHETIC-A'}];
 result.merchant_attendance_employment_periods=[{...row,id:id(4),worker_id:id(3),starts_on:'2000-01-01',ends_on:'2026-10-08'}];
 result.merchant_attendance_events=[{...row,id:id(5),operation_id:id(6),worker_id:id(3),actor_employee_id:id(1),action:'clock_in',occurred_at:'2026-10-08T10:00:00.123456+00:00'}];
 result.merchant_attendance_account_suspensions=[{...row,suspension_id:id(7),worker_id:id(3),employee_id:id(1),employee_auth_user_id:id(2)}];
 result.merchant_attendance_administrative_closures=[{...row,worker_id:id(3),employee_id:id(1),employee_auth_user_id:id(2),start_event_id:id(5),revision:1,closed_operation_id:id(8)}];
 result.merchant_attendance_administrative_closure_entries=[{...row,operation_id:id(8),start_event_id:id(5),revision:1,action:'close',actor_auth_user_id:id(9),
  source_text:JSON.stringify({frame:{workerId:id(3),employeeId:id(1),employeeAuthUserId:id(2),startEventId:id(5),startAt:'2026-10-08T10:00:00.123456Z'},employment:{startsOn:'2000-01-01',endsOn:null}})}];
 result.merchant_attendance_shift_schedule_relations=[{...row,start_event_id:id(5),operation_id:id(6),worker_id:id(3),employee_id:id(1),employee_auth_user_id:id(2),recorded_at:'2026-10-08T10:00:00.123456+00:00',selection:null,slot_id:null}];
 result.merchant_attendance_shift_plan_adoptions=[{...row,start_event_id:id(5),operation_id:id(6),worker_id:id(3),employee_id:id(1),employee_auth_user_id:id(2),recorded_at:'2026-10-08T10:00:00.123456+00:00',adoption:{startEventId:id(5),employeeAuthUserId:id(2)},approval_operation_id:null}];
 return result;
}
test('inert bounded exports cannot accept a non-owned context',async()=>{
 assert.equal(administrativeClosureNativeSite,'99990195');await assert.rejects(()=>verifyAdministrativeClosureNative({d:{syntheticOnly:false},h:{syntheticOnly:true}}));
 assert(!/process\.argv|listen\(|spawn\(|execSync\(/.test(source));
});
test('two explicit historical copies remap exact identities without mutating the real template',()=>{
 const original=template(),bytes=JSON.stringify(original),b=administrativeClosureHistoricalTemplate(original,1);
 assert.equal(JSON.stringify(original),bytes);assert.equal(b.days,-3);assert.notEqual(b.identity.worker,id(3));assert.notEqual(b.identity.auth,id(2));
 assert.equal(b.rows.merchant_attendance_workers[0].employee_id,b.identity.employee);
 const e=b.rows.merchant_attendance_administrative_closure_entries[0];assert.equal(e.source_text.frame.workerId,b.identity.worker);
 assert.equal(e.source_text.frame.startAt,'2026-10-05T10:00:00.123456Z');assert.equal(e.actor_auth_user_id,id(9));
 assert.equal(b.rows.merchant_enterprise_employees[0].created_at,'2026-10-05T10:00:00.123456+00:00');
 assert.equal(b.rows.merchant_attendance_employment_periods[0].starts_on,'2000-01-01');
 for(const n of ['merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions']){
  const proof=b.rows[n][0];assert.equal(proof.start_event_id,b.rows.merchant_attendance_events[0].id);assert.equal(proof.operation_id,b.rows.merchant_attendance_events[0].operation_id);
  assert.equal(proof.employee_id,b.identity.employee);assert.equal(proof.employee_auth_user_id,b.identity.auth);assert.equal(proof.recorded_at,'2026-10-05T10:00:00.123456+00:00');
 }
 assert.equal(b.rows.merchant_attendance_shift_plan_adoptions[0].adoption.startEventId,b.rows.merchant_attendance_events[0].id);
 const cInput=structuredClone(b.rows);for(const x of cInput.merchant_attendance_administrative_closure_entries)x.source_text=JSON.stringify(x.source_text);
 const c=administrativeClosureHistoricalTemplate(cInput,2);assert.equal(c.days,-2);assert.notEqual(c.identity.worker,b.identity.worker);
 assert.equal(c.rows.merchant_attendance_administrative_closure_entries[0].source_text.frame.startAt,'2026-10-03T10:00:00.123456Z');
});
test('historical template is exact-table, exact-site and small, never arbitrary import',()=>{
 for(const copy of [0,3,-1,'1'])assert.throws(()=>administrativeClosureHistoricalTemplate(template(),copy));
 const extra=template();extra.extra=[];assert.throws(()=>administrativeClosureHistoricalTemplate(extra,1));
 const wrong=template();wrong.merchant_attendance_workers[0].merchant_id='12345678';assert.throws(()=>administrativeClosureHistoricalTemplate(wrong,1));
 const tooMany=template();tooMany.merchant_attendance_events=Array(13).fill(tooMany.merchant_attendance_events[0]);assert.throws(()=>administrativeClosureHistoricalTemplate(tooMany,1));
 const tooLarge=template();tooLarge.merchant_enterprise_employees[0].data='x'.repeat(262144);assert.throws(()=>administrativeClosureHistoricalTemplate(tooLarge,1));
});
test('seed preserves normal guards and rebuilds source and command hashes in SQL',()=>{
 const sql=administrativeClosureHistoricalSeed(administrativeClosureHistoricalTemplate(template(),1));
 assert.match(sql,/source_text:=\(v->'source_text'\)::text/);assert.match(sql,/sha256\(convert_to\(r.source_text,'UTF8'\)\)/);
 assert.match(sql,/administrative_hash_v1\(r.merchant_id,r.actor_auth_user_id,r.actor_access,r.command\)/);
 assert.match(sql,/employment_hash_v1\(r.merchant_id,r.command\)/);
 assert.match(sql,/head_value.revision:=1/);assert.match(sql,/revision=r.revision-1/);
 assert.match(sql,/set constraints all immediate/);assert.match(sql,/administrative_entry_v1\(e\)/);assert.match(sql,/employment_chain_v1/);
 assert.match(sql,/ac195_seed_actual_adoption_checker/);assert.match(sql,/sidecar\.adoption is distinct from public.faolla_attendance_shift_plan_adoption_v1/);
 assert(!/disable trigger|session_replication_role|drop |truncate /i.test(sql));
});
test('location dispatcher ABI preserves query/command/assertion and both independent gates in exact order',()=>{
 const args={p_site:administrativeClosureNativeSite,p_auth:id(1),p_expected_worker:id(2),p_query:{mode:'prepare'},p_command:null,p_assertion:null,
  p_allow_new_sessions:true,p_require_clock:false,p_allow_operational_start:true,p_allow_schedule:false,p_bind_rules:false};
 const sql=administrativeClosureNativeRpcExpression('faolla_attendance_operational_punch_location_v1',args);
 assert.match(sql,/,'\{"mode":"prepare"\}'::jsonb,null,null,true,false,true,false,false\)$/);
 assert.throws(()=>administrativeClosureNativeRpcExpression('faolla_attendance_operational_punch_location_v1',{...args,p_site:'12345678'}));
 assert.throws(()=>administrativeClosureNativeRpcExpression('faolla_attendance_operational_punch_location_v1',{...args,extra:null}));
 assert.throws(()=>administrativeClosureNativeRpcExpression('anything_else',{p_site:administrativeClosureNativeSite}));
});
test('A remains real current RPC and explicitly tests same-day/timezone refusal',()=>{
 for(const name of ['faolla_update_merchant_enterprise_employee_v1','faolla_attendance_self_v1','faolla_attendance_administrative_closures_v1','faolla_attendance_employment_lifecycle_v1','faolla_attendance_account_suspensions_v1'])assert(source.includes(name));
 assert(source.includes("assert.deepEqual(originalRaw,['clock_in','break_start','break_end'])"));
 assert(source.includes("'same_day_rejoin'"));assert(source.includes("'attendance_history_protected'"));
 assert(!/update public\.merchant_attendance_events|delete from|set time zone '[^U]/i.test(source));
});
test('B uses fresh historical identity and real four-channel services, not fake success DTOs',()=>{
 assert(source.includes('administrativeClosureHistoricalTemplate(templateA,1)'));
 assert(source.includes('employmentLifecycleCommandFromDetail(ready.detail,\'rejoin\''));
 assert(source.includes("['pin','onsite','location','self']"));assert(source.includes('executeOperationalPunch(input,service)'));
 assert(source.includes('operationalPunchNativeFinishCommand(channel,working,next())'));
 assert(source.includes("before.clock.state.administrativeBoundary"));
 assert(source.includes("choice:{kind:'finish'}"));assert(source.includes("error.code==='attendance_not_clocked_in'"));
});
test('C keeps employment-aligned past template and actual period writer/strict projection',()=>{
 assert(source.includes('administrativeClosureHistoricalTemplate(await capture(b),2)'));
 assert(source.includes('assert(dates.oldDay<dates.newDay)'));
 assert(source.includes('executePeriodClosuresV2({query,command'));
 for(const key of ['administrative_hours_unassessed','totalsComplete','attendance-period-source-v5','attendance_period_blocked'])assert(source.includes(key));
 assert(source.includes("pc('confirm',newPid,savedPeriod)"));assert(source.includes("pc('seal',newPid,savedPeriod)"));
 assert(source.includes("pc('dispute',oldPid,oldConfirmed)"));assert(source.includes('oldDisputed.period.unresolvedDispute'));
});
test('one connection, fixed deadlines, full rollback, original archives and no nested external fingerprint',()=>{
 assert.equal((source.match(/native\.connect\(/g)??[]).length,1);assert(source.includes('native.connect({lifetimeMs:90000})'));
 assert(source.includes("statement_timeout='10s'"));assert(source.includes("lock_timeout='3s'"));assert(source.includes('++steps<=120'));
 assert(source.includes("assert current_user=${quote(role)}"));assert(source.includes("await connection.step('rollback;')"));assert(source.includes('await connection.close()'));
 assert(source.includes("assert.equal(d.fingerprint(),baseline,'ac195_full_rollback')"));
 assert(source.includes('periodContinuationArchiveBytes(await archive()),oldArchive'));assert(source.includes('periodContinuationArchiveBytes(await periodArchive()),oldPeriod'));
 assert(source.includes("assert.deepEqual(eventScoped,['merchant_attendance_location_results']"));
 assert(source.includes('original_event.id=x.event_id and original_event.merchant_id<>${site}'));
 const body=source.slice(source.indexOf('try{\n  await step(\'begin\''),source.indexOf('finally{try{if(!rolledBack)'));assert(!body.includes('d.fingerprint('));
});
