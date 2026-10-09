// SQL authorization/lease lifecycle only. p_verified=true is an explicit native
// boundary input, NOT scrypt verification, pairing UI, HTTP or real-device proof.
// The caller owns the disposable namespace and database startup/cleanup.
import assert from 'node:assert/strict';
import {lifecycleId as id,lifecycleJson as json,assertLifecycleSandbox,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

const site='99990004',owner=id(1021099),location=id(1021301),secretHash='c'.repeat(64);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cases=['member','role'].map((kind,n)=>({kind,worker:id(1021101+n),employee:id(1021201+n),auth:id(1021401+n),
  role:id(1021501+n),terminal:id(1021601+n),no:`PIN-LIFECYCLE-${n+1}`,startOperation:id(1021701+n),closeOperation:id(1021801+n)}));
const command=(item,action)=>({expectedWorkerId:item.worker,expectedEmployeeId:item.employee,locationId:location,action,
  expectedSequence:action==='clock_in'?0:1,operationId:action==='clock_in'?item.startOperation:item.closeOperation});
export function pinLifecyclePlan(){return structuredClone(cases.map(item=>({...item,start:command(item,'clock_in'),close:command(item,'clock_out')})));}
export function pinLifecycleRequestSql(index,lease,body=null,operation=null){
  assert(Number.isInteger(index)&&index>=0&&index<cases.length,'pin_lifecycle_case');
  assert(typeof lease==='string'&&uuid.test(lease),'pin_lifecycle_lease');
  const item=cases[index];
  if(body!==null){
    assert(operation===null,'pin_lifecycle_operation_mode');
    assert(body&&typeof body==='object'&&!Array.isArray(body),'pin_lifecycle_command');
    const expected=command(item,body.action);
    assert(['clock_in','clock_out'].includes(body.action)&&Object.keys(body).sort().join()===Object.keys(expected).sort().join()
      &&Object.entries(expected).every(([key,value])=>body[key]===value),'pin_lifecycle_command');
  }else assert(operation===null||operation===item.startOperation||operation===item.closeOperation,'pin_lifecycle_operation');
  const common=`'${site}','${item.terminal}','${secretHash}','${item.no}','${lease}'`;
  return {begin:`set local role service_role;select public.faolla_attendance_pin_begin_v1(${common},true);`,
    clock:`set local role service_role;select public.faolla_attendance_pin_clock_v1(${common},true,${json({command:body,operationId:operation})},true);`};
}

export async function checkAttendancePinLifecycle(native,{sql}){
  const {pass,connect,query}=native,exec=source=>query(sql(source));
  assert(typeof pass==='function'&&typeof connect==='function'&&typeof query==='function'&&typeof sql==='function','pin_lifecycle_caller');
  assertLifecycleSandbox(exec);
  assert.equal(exec(`reset role;select count(*) from public.merchants where id='${site}';`),'0','pin_lifecycle_fresh_tenant');
  exec(`reset role;begin;set local lock_timeout='3s';set local statement_timeout='10s';
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',true,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','Synthetic PIN lifecycle location','UTC',true);
    ${cases.map(item=>`
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${item.role}','${site}','Synthetic ${item.kind} lifecycle',array['enterprise.view','attendance.self.view','attendance.self.clock']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
        values('${item.employee}','${site}','${item.auth}','pin-lifecycle-${item.kind}@example.test','Synthetic PIN lifecycle','${item.role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
        values('${item.worker}','${site}','${item.employee}','${item.no}','Synthetic PIN lifecycle','${location}',true);
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${item.worker}','2000-01-01');
      with stamp as(select clock_timestamp()-interval '1 minute' at_time)
        insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at,paired_at,device_hash,device_expires_at)
        select '${site}','${item.terminal}','${location}','Synthetic prepaired SQL lifecycle','UTC','${owner}',at_time,'${'d'.repeat(64)}',at_time+interval '5 minutes',at_time,'${secretHash}',at_time+interval '720 hours' from stamp;
      with stamp as(select clock_timestamp() at_time)
        insert into public.merchant_attendance_pin_credentials(merchant_id,worker_id,employee_id,revision,enabled,salt,verifier,changed_at,created_by,window_at)
        select '${site}','${item.worker}','${item.employee}',1,true,'${'a'.repeat(32)}','${'b'.repeat(64)}',at_time,'${owner}',at_time from stamp;`).join('')}
    commit;`);
  const run=statement=>JSON.parse(exec(`begin;${statement}commit;`));
  const fingerprint=(table,where)=>exec(`reset role;select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'[]')) from public.${table} r where ${where};`);
  const facts=()=>({events:fingerprint('merchant_attendance_events',`merchant_id='${site}'`),receipts:fingerprint('merchant_attendance_pin_clock_receipts',`merchant_id='${site}'`)});
  const immutableStart=item=>({event:fingerprint('merchant_attendance_events',`merchant_id='${site}' and worker_id='${item.worker}' and operation_id='${item.startOperation}'`),
    receipt:fingerprint('merchant_attendance_pin_clock_receipts',`merchant_id='${site}' and worker_id='${item.worker}' and operation_id='${item.startOperation}'`)});
  const counters=item=>JSON.parse(exec(`reset role;select jsonb_build_object('credential',(select attempts from public.merchant_attendance_pin_credentials where merchant_id='${site}' and worker_id='${item.worker}'),
    'device',(select attempts from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${item.terminal}'),
    'consumed',(select lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${item.terminal}'));`));
  const checkCounters=(item,count)=>assert.deepEqual(counters(item),{credential:count,device:count,consumed:true},'pin_lifecycle_attempts_retained_and_lease_consumed');
  const protectedTables=['merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_terminals'];
  const protectedBefore=protectedTables.map(table=>fingerprint(table,`merchant_id='${site}'`));
  const checks=[],observations=[];
  for(const [index,item] of cases.entries()){
    let number=0;
    const reserve=(body=null,operation=null)=>{
      const lease=id(1021900+index*10+(++number)),request=pinLifecycleRequestSql(index,lease,body,operation),result=run(request.begin);
      assert(result.workerId===item.worker&&result.employeeId===item.employee&&result.revision===1,'pin_lifecycle_current_member_lease');
      return request;
    };
    const initial=run(reserve(command(item,'clock_in')).clock);
    assert(initial.receipt?.operationId===item.startOperation&&initial.state.sequence===1&&!initial.replayed,'pin_lifecycle_initial_pin_fact');
    checkCounters(item,1);
    const oldFacts=immutableStart(item),beforeDenial=facts(),pending=reserve(command(item,'clock_out'));
    const holder=item.kind==='member'
      ?`update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${item.employee}';`
      :`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where merchant_id='${site}' and id='${item.role}';`;
    const raced=await lifecycleRace({connect,query,sql},holder,pending.clock);
    assert.equal(raced.witnessed,true,'pin_lifecycle_exact_lock_witness');assert.equal(raced.right.error,null);
    assert.deepEqual(JSON.parse(raced.right.output),{error:'attendance_pin_denied'},'pin_lifecycle_revocation_denied');
    checkCounters(item,2);assert.deepEqual(facts(),beforeDenial,'pin_lifecycle_denial_writes_nothing');
    assert.deepEqual(immutableStart(item),oldFacts,'pin_lifecycle_old_facts_unchanged');
    const deniedLabel=`PIN SQL lifecycle ${item.kind}: exact lock witness precedes committed revocation; final verification refuses, consumes the lease and retains both attempt counters; no scrypt/browser claim`;
    checks.push(deniedLabel);pass(deniedLabel);

    exec(item.kind==='member'
      ?`reset role;update public.merchant_enterprise_employees set status='active' where merchant_id='${site}' and id='${item.employee}';`
      :`reset role;update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'] where merchant_id='${site}' and id='${item.role}';`);
    assert.deepEqual(run(pending.clock),{error:'attendance_pin_denied'},'pin_lifecycle_restore_cannot_revive_consumed_lease');
    checkCounters(item,2);assert.deepEqual(facts(),beforeDenial);
    const saved=run(reserve(command(item,'clock_out')).clock);
    assert(saved.receipt?.operationId===item.closeOperation&&saved.receipt.sequence===2&&saved.state.status==='off'&&!saved.replayed,'pin_lifecycle_same_operation_succeeds_after_restore');
    const savedFacts=facts();
    const recovered=run(reserve(null,item.closeOperation).clock),replayed=run(reserve(command(item,'clock_out')).clock);
    assert.deepEqual(recovered.receipt,saved.receipt);assert.equal(recovered.replayed,false);
    assert.deepEqual(replayed.receipt,saved.receipt);assert.equal(replayed.replayed,true);
    assert.deepEqual(facts(),savedFacts,'pin_lifecycle_read_and_replay_preserve_complete_facts');
    checkCounters(item,5);assert.deepEqual(immutableStart(item),oldFacts,'pin_lifecycle_restore_preserves_old_fact_and_receipt');
    const count=JSON.parse(exec(`reset role;select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events where merchant_id='${site}' and worker_id='${item.worker}'),
      'receipts',(select count(*) from public.merchant_attendance_pin_clock_receipts where merchant_id='${site}' and worker_id='${item.worker}'),
      'bound',(select count(*) from public.merchant_attendance_events e join public.merchant_attendance_pin_clock_receipts r on r.event_id=e.id and r.merchant_id=e.merchant_id and r.worker_id=e.worker_id and r.operation_id=e.operation_id
        where e.merchant_id='${site}' and e.worker_id='${item.worker}' and e.actor_employee_id='${item.employee}' and e.source='kiosk' and r.employee_id=e.actor_employee_id and r.terminal_id='${item.terminal}'));`));
    assert.deepEqual(count,{events:2,receipts:2,bound:2});
    const restoredLabel=`PIN SQL lifecycle ${item.kind}: restoring the same identity requires a new lease; original operation writes once, read/replay recover exactly, old facts remain immutable and all five attempts are retained`;
    checks.push(restoredLabel);pass(restoredLabel);observations.push({kind:item.kind,lockWitnessed:true,denied:'attendance_pin_denied',attempts:5,...count});
  }
  assert.deepEqual(protectedTables.map(table=>fingerprint(table,`merchant_id='${site}'`)),protectedBefore,'pin_lifecycle_protected_facts_unchanged');
  assert.equal(exec(`reset role;select count(*) from public.merchant_enterprise_employees where merchant_id='${site}' and status='active';`),'2');
  assert.equal(exec(`reset role;select count(*) from public.merchant_enterprise_roles where merchant_id='${site}' and permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'];`),'2');
  return {siteId:site,syntheticOnly:true,pinPasswordVerified:false,realBrowser:false,checks,observations,events:4,pinReceipts:4,verificationAttempts:10,attemptCountersReset:false};
}
