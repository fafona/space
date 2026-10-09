// Real local SQL lock ordering with synthetic actors and explicit no-position
// punches. Not a browser, authentication or device-location acceptance test.
import assert from 'node:assert/strict';
import {lifecycleId as id,lifecycleJson as json,assertLifecycleSandbox,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';

export async function checkAttendanceLocationLifecycle(native,{sql}){
  const exec=source=>native.query(sql(source));assertLifecycleSandbox(exec);
  const site='99990007',owner=id(1023000),fullPermissions="array['enterprise.view','attendance.self.view','attendance.self.clock']";
  assert.equal(exec(`select count(*) from public.merchants where id='${site}';`),'0','location_lifecycle_tenant_exists');
  exec(`begin;insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled,location_clock_enabled)
      values('${site}','UTC',true,true,true);commit;`);
  let cases=0,witnesses=0;
  const service=expression=>`set local role service_role;select ${expression};`;
  const race=async(first,second,options)=>{const r=await lifecycleRace({...native,sql},first,second,options);witnesses++;return r;};
  function fixture(){
    const base=1023000+(++cases)*100,auth=id(base),employee=id(base+1),role=id(base+2),worker=id(base+3),place=id(base+4);
    const startOperation=id(base+10),finishOperation=id(base+11);
    const command={operationId:finishOperation,locationId:place,action:'clock_out',expectedSequence:1,
      settingsVersion:1,workerVersion:1,locationVersion:1,noticeRevision:null,safeFinish:true};
    const call=(c=null,op=null,assertion=null)=>`public.faolla_attendance_location_clock_v2('${site}','${auth}','${worker}',${json(c)},${op?`'${op}'`:'null'},${json(assertion)},true,false)`;
    const read=(c=null,op=null,a=null)=>JSON.parse(exec(`begin;${service(call(c,op,a))}commit;`));
    const values={purpose:'Synthetic lifecycle check',notice:'Explicit no-position fixture',contact:'Synthetic owner',alternative:'Manual review',
      retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
    const notice=(access,c)=>`public.faolla_attendance_location_notice_v1('${site}','${access==='self'?auth:owner}',
      ${json({access,locationId:place,expectedWorkerId:access==='self'?worker:null,operationId:null})},${json(c)},true)`;
    exec(`begin;
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Location lifecycle ${cases}',${fullPermissions});
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
        values('${employee}','${site}','${auth}','location-lifecycle-${cases}@example.test','Synthetic lifecycle','${role}','active');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active,latitude,longitude,radius_meters)
        values('${place}','${site}','Location lifecycle ${cases}','Europe/Madrid',true,37.3,-5.9,100);
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
        values('${worker}','${site}','${employee}','LOCATION-LIFECYCLE-${cases}','Synthetic lifecycle','${place}',true);
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
      set local role service_role;do $setup$ begin
        perform public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${place}',
          ${json({operationId:id(base+20),expectedRevision:0,expectedSettingsVersion:1,expectedLocationVersion:1,values})},null,true);
        perform ${notice('owner',{action:'publish',operationId:id(base+21),expectedRevision:0,draftRevision:1,expectedSettingsVersion:1,expectedLocationVersion:1,reason:'Synthetic publication'})};
        perform ${notice('self',{action:'acknowledge',operationId:id(base+22),expectedRevision:1})};
      end;$setup$;commit;`);
    const ready=read();assert.equal(ready.noticeGate.ready,true);
    const started=read({...command,operationId:startOperation,action:'clock_in',expectedSequence:0,noticeRevision:1,safeFinish:false},null,
      {policyFingerprint:ready.internalPolicyFingerprint,algorithmVersion:1,reason:'not_provided',capturedAt:null,accuracyMeters:null,distanceMeters:null});
    assert.equal(started.receipt.operationId,startOperation);assert.equal(started.locationResult.needsReview,true);
    const facts=()=>JSON.parse(exec(`select jsonb_build_object(
      'events',(select jsonb_agg(to_jsonb(e) order by e.sequence) from public.merchant_attendance_events e where e.merchant_id='${site}' and e.worker_id='${worker}'),
      'results',(select jsonb_agg(to_jsonb(r) order by e.sequence) from public.merchant_attendance_location_results r join public.merchant_attendance_events e on e.id=r.event_id where e.merchant_id='${site}' and e.worker_id='${worker}'),
      'links',(select jsonb_agg(to_jsonb(r) order by e.sequence) from public.merchant_attendance_location_clock_notices r join public.merchant_attendance_events e on e.id=r.event_id where e.merchant_id='${site}' and e.worker_id='${worker}'));`));
    const config=()=>exec(`select jsonb_build_object('employee',(select to_jsonb(r) from public.merchant_enterprise_employees r where id='${employee}'),
      'role',(select to_jsonb(r) from public.merchant_enterprise_roles r where id='${role}'),
      'worker',(select to_jsonb(r) from public.merchant_attendance_workers r where id='${worker}'),
      'location',(select to_jsonb(r) from public.merchant_attendance_locations r where id='${place}'),
      'settings',(select to_jsonb(r) from public.merchant_attendance_settings r where merchant_id='${site}'));`);
    return {command,call,read,facts,config,startOperation,finishOperation,employee,role,
      deactivate:`update public.merchant_enterprise_employees set status='disabled' where id='${employee}';`,
      activate:`update public.merchant_enterprise_employees set status='active' where id='${employee}';`,
      removeClock:`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';`,
      restoreClock:`update public.merchant_enterprise_roles set permissions=${fullPermissions} where id='${role}';`};
  }
  const denied=r=>{assert.equal(r.output,null);assert.match(r.error?.message??'',/attendance_access_denied/);};
  const rejectsRead=(f,op)=>assert.throws(()=>f.read(null,op),/attendance_access_denied/);
  function unchangedStart(f,before,count){
    const after=f.facts();
    for(const key of ['events','results','links']){assert.equal(after[key].length,count);assert.deepEqual(after[key][0],before[key][0]);}
    return after;
  }
  function originalFinishRecovery(f,before){
    assert.equal(f.read(null,f.startOperation).receipt.operationId,f.startOperation);
    const saved=f.read(f.command);assert.equal(saved.receipt.operationId,f.finishOperation);
    assert.equal(saved.locationResult.reason,'not_provided');assert.equal(saved.receiptGate.safeFinish,true);
    assert.equal(saved.receipt.timeZone,'Europe/Madrid');assert.equal(saved.state.sequence,2);
    const after=unchangedStart(f,before,2);
    assert.deepEqual(f.read(null,f.finishOperation).receipt,saved.receipt);
    const replay=f.read(f.command);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,saved.receipt);
    assert.deepEqual(f.facts(),after,'location_lifecycle_recovery_mutated_facts');
  }
  for(const roleOnly of [false,true]){
    const f=fixture(),before=f.facts(),config=f.config();
    const result=await race(roleOnly?f.removeClock:f.deactivate,service(f.call(f.command)));
    denied(result.right);assert.deepEqual(f.facts(),before,'revocation-first must not append');
    if(roleOnly){assert.equal(f.read(null,f.startOperation).receipt.operationId,f.startOperation);assert.equal(f.read().finish,null);}
    else rejectsRead(f,f.startOperation);
    exec(roleOnly?f.restoreClock:f.activate);assert.equal(f.config(),config);
    originalFinishRecovery(f,before);assert.equal(f.config(),config);
    native.pass(`location lifecycle ${roleOnly?'clock permission':'employee'} revocation-first: exact blocked request denied; same-member restore recovers and explicitly closes once`);
  }
  {
    const f=fixture(),before=f.facts(),config=f.config();
    const result=await race(f.deactivate,service(f.call(f.command)),{rollback:true});
    assert.equal(result.right.error,null);assert.equal(JSON.parse(result.right.output).receipt.operationId,f.finishOperation);
    assert.equal(f.config(),config);originalFinishRecovery(f,before);
    native.pass('location lifecycle rolled-back deactivation does not revoke access: waiting finish succeeds exactly once, with original facts unchanged');
  }
  {
    const f=fixture(),before=f.facts(),config=f.config();
    const result=await race(service(f.call(f.command)),f.deactivate);
    assert.equal(result.right.error,null);assert.equal(JSON.parse(result.left).receipt.operationId,f.finishOperation);
    const committed=unchangedStart(f,before,2);rejectsRead(f,f.finishOperation);
    assert.throws(()=>f.read(f.command),/attendance_access_denied/);assert.deepEqual(f.facts(),committed);
    exec(f.activate);assert.equal(f.config(),config);originalFinishRecovery(f,before);assert.deepEqual(f.facts(),committed);
    native.pass('location lifecycle finish-first: deactivation waits, committed fact remains, later reads/replay deny until same-member restore');
  }
  assert.equal(witnesses,4);assert.equal(cases,4);
  return {channel:'location',cases,witnessedLocks:witnesses,syntheticOnly:true,explicitNoPosition:true,realGps:false};
}
