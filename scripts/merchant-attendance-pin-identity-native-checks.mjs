// SQL lease/identity diagnostic only: synthetic credential rows and verified=true
// do NOT test PIN passwords, scrypt, the HTTP executor, pairing UI or a real user.
// The caller supplies its already-owned sandbox. No database startup or artifacts.
import assert from 'node:assert/strict';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';
const secretHash='a'.repeat(64),pairHash='b'.repeat(64),salt='c'.repeat(32),verifier='d'.repeat(64);
const seedTables=['merchants','merchant_attendance_settings','merchant_enterprise_roles','merchant_enterprise_employees',
  'merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_events',
  'merchant_attendance_terminals','merchant_attendance_terminal_audit','merchant_attendance_pin_credentials',
  'merchant_attendance_pin_audit','merchant_attendance_pin_attempts','merchant_attendance_pin_clock_receipts'];

export async function checkAttendancePinIdentityNative({exec,querySteps,pass,mode='legacy',identityError='attendance_access_denied'}){
  assert(['legacy','guarded'].includes(mode),'pin_identity_native_invalid_mode');
  assert(['attendance_access_denied','attendance_worker_changed'].includes(identityError),'pin_identity_native_invalid_identity_error');
  assert.equal(typeof exec,'function');assert.equal(typeof querySteps,'function','pin_identity_native_steps_required');assert.equal(typeof pass,'function');
  const isolation=JSON.parse(exec(`reset role;select jsonb_build_object('schema',n.nspname,'oid',n.oid::bigint,
    'tableOid',c.oid::bigint,'owner',n.nspowner::regrole::text,'marker',obj_description(n.oid,'pg_namespace'))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass;`));
  assert(isolation&&/^attendance_race_[a-f0-9]{32}$/.test(isolation.schema)&&isolation.owner==='postgres'
    &&/^faolla-synthetic-concurrency:[0-9a-f-]{36}$/.test(isolation.marker)
    &&Number.isSafeInteger(isolation.oid)&&isolation.oid>0&&Number.isSafeInteger(isolation.tableOid)&&isolation.tableOid>0,
  'pin_identity_native_owned_schema_required');
  const siteId='99990006',owner=id(980099),role=id(980030),locationId=id(980301);
  assert.equal(exec(`reset role;select count(*) from public.merchants where id='${siteId}';`),'0','pin_identity_native_tenant_exists');
  // Full-row fingerprints include secrets internally, but expose only digests.
  const baselineSql=`reset role;select jsonb_build_object(${seedTables.map(table=>`${literal(table)},(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'[]')) from public.${table} r)`).join(',')});`;
  const baseline=exec(baselineSql);
  const definitions=[
    {name:'other_open_state_and_close',kind:'open',unknown:'other',concern:true},
    {name:'null_open_state_and_close',kind:'open',unknown:'null',concern:true},
    {name:'other_closed_state_and_start',kind:'closed',unknown:'other',concern:true},
    {name:'null_closed_state_and_start',kind:'closed',unknown:'null',concern:true},
    {name:'own_latest_other_old_receipt_conflict',kind:'old_receipt',unknown:'other',concern:false},
    {name:'own_latest_null_old_receipt_conflict',kind:'old_receipt',unknown:'null',concern:false},
    {name:'empty_worker_first_pin_write_and_recovery',kind:'empty',concern:false},
    {name:'own_web_state_pin_close_and_recovery',kind:'web',concern:false},
    {name:'own_real_pin_receipt_under_other_latest',kind:'owned_receipt',unknown:'other',concern:true},
    {name:'own_real_pin_receipt_under_null_latest',kind:'owned_receipt',unknown:'null',concern:true},
  ];
  const cases=definitions.map((item,index)=>{
    const base=981000+index*100;
    return {...item,base,employeeId:id(base+1),otherEmployeeId:id(base+2),authUserId:id(base+3),otherAuthUserId:id(base+4),
      workerId:id(base+5),terminalId:id(base+6),workerNo:`PIN-IDENTITY-${index+1}`,
      eventIds:[id(base+10),id(base+11)],operations:[id(base+20),id(base+21),id(base+22)]};
  });
  const steps=[`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    do $owned$ begin
      if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.oid='public.merchants'::regclass and c.oid=${isolation.tableOid} and n.oid=${isolation.oid}
          and n.nspname=${literal(isolation.schema)} and n.nspowner::regrole::text='postgres'
          and obj_description(n.oid,'pg_namespace')=${literal(isolation.marker)})
        then raise exception 'pin_identity_native_schema_identity_changed';end if;
    end; $owned$;
    insert into public.merchants(id,user_id) values('${siteId}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${siteId}','UTC',true,true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
      values('${role}','${siteId}','Synthetic PIN identity diagnostic',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
      values('${locationId}','${siteId}','Synthetic PIN identity location','UTC',true);`];
  const manifests=[];
  for(const item of cases){
    const guarded=mode==='guarded'&&item.concern,actor=item.unknown==='other'?item.otherEmployeeId:null;
    const command=(action,expectedSequence,operationId=item.operations[2],expectedEmployeeId=item.employeeId)=>
      ({expectedWorkerId:item.workerId,expectedEmployeeId,operationId,locationId,action,expectedSequence});
    const raw=`(select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence),'[]'::jsonb) from public.merchant_attendance_events e where e.merchant_id='${siteId}' and e.worker_id='${item.workerId}')`;
    const receipts=`(select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.merchant_attendance_pin_clock_receipts r where r.merchant_id='${siteId}' and r.worker_id='${item.workerId}')`;
    const seed=[];
    if(['open','closed','old_receipt','web'].includes(item.kind))seed.push({id:item.eventIds[0],operation:item.operations[0],sequence:1,action:'clock_in',
      actor:item.kind==='web'||item.kind==='closed'?item.employeeId:actor,source:item.kind==='old_receipt'?'kiosk':'web'});
    if(['closed','old_receipt'].includes(item.kind))seed.push({id:item.eventIds[1],operation:item.operations[1],sequence:2,action:'clock_out',
      actor:item.kind==='closed'?actor:item.employeeId,source:'web'});
    const insertEvents=rows=>rows.length?`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at,actor_employee_id) values
      ${rows.map(row=>`('${row.id}','${siteId}','${item.workerId}','${locationId}','${row.operation}',${row.sequence},'${row.action}','${row.source}','UTC',${row.current?"date_trunc('milliseconds',clock_timestamp())":`date_trunc('milliseconds',clock_timestamp())-interval '1 hour'+${row.sequence}*interval '1 millisecond'`},clock_timestamp(),${literal(row.actor)})`).join(',')};`:'';
    const saveFacts=`do $before$ begin
      perform set_config('faolla.pin_identity_before',${raw}::text,true);
      perform set_config('faolla.pin_identity_receipts_before',${receipts}::text,true);
    end; $before$;`;
    const counters=count=>`assert (select attempts from public.merchant_attendance_pin_credentials where merchant_id='${siteId}' and worker_id='${item.workerId}')=${count},'credential attempt count retained';
      assert exists(select 1 from public.merchant_attendance_pin_attempts where merchant_id='${siteId}' and terminal_id='${item.terminalId}'
        and attempts=${count} and lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null),'device attempt retained and lease fully consumed';`;
    let beginCalls=0,clockCalls=0,denials=0;
    const request=(c=null,operationId=null,{error=null,assertion='',save=false}={})=>{
      beginCalls++;clockCalls++;if(error){clockCalls++;denials++;}
      const lease=id(item.base+30+beginCalls),body={command:c,operationId};
      const common=`'${siteId}','${item.terminalId}','${secretHash}','${item.workerNo}','${lease}'`;
      const invoke=`public.faolla_attendance_pin_clock_v1(${common},true,${json(body)},true)`;
      const input={siteId,terminalId:item.terminalId,workerNo:item.workerNo,command:c,operationId,allowNew:true};
      return `set local role service_role;
        do $request$ declare b jsonb;r jsonb;begin
          b:=public.faolla_attendance_pin_begin_v1(${common},true);
          assert b->>'workerId'='${item.workerId}' and b->>'employeeId'='${item.employeeId}' and b->>'revision'='1','real begin issued current-member lease';
          r:=${invoke};
          ${error?`assert r=jsonb_build_object('error',${literal(error)}),'exact business denial contains no private projection';`:`assert not(r?'error') and r->>'workerId'='${item.workerId}' and r->>'employeeId'='${item.employeeId}','same current identity projection';${assertion}`}
          ${save?`perform set_config('faolla.pin_identity_saved_receipt',(r->'receipt')::text,true);`:''}
          perform set_config('faolla.pin_identity_requests',(current_setting('faolla.pin_identity_requests')::jsonb||jsonb_build_array(
            jsonb_build_object('input',${json(input)},'result',r,'beginIdentity',jsonb_build_object('workerId',b->'workerId','employeeId',b->'employeeId','revision',b->'revision'),
              'leaseConsumed',true,'credentialAttempts',${beginCalls},'terminalAttempts',${beginCalls},'sameLeaseReplayError',${literal(error?'attendance_pin_denied':null)})))::text,true);
        end; $request$;reset role;
        do $lease$ begin ${counters(beginCalls)} end; $lease$;
        ${error?`set local role service_role;
          do $spent$ declare r jsonb;begin r:=${invoke};assert r='{"error":"attendance_pin_denied"}'::jsonb,'same spent lease cannot reveal state or receipt';end; $spent$;reset role;
          do $attempts$ begin ${counters(beginCalls)} end; $attempts$;`:''}`;
    };
    let sql=`savepoint pin_identity_case;
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
        ('${item.employeeId}','${siteId}','${item.authUserId}','pin-identity-${item.base}@example.test','Synthetic current PIN employee','${role}','active'),
        ('${item.otherEmployeeId}','${siteId}','${item.otherAuthUserId}','pin-identity-former-${item.base}@example.test','Synthetic former PIN employee','${role}','active');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
        values('${item.workerId}','${siteId}','${item.employeeId}','${item.workerNo}','Synthetic bound PIN worker',true,'${locationId}');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${siteId}','${item.workerId}','2000-01-01');
      with stamp as(select clock_timestamp()-interval '1 minute' at_time)
        insert into public.merchant_attendance_terminals(merchant_id,id,location_id,label,time_zone,created_by,created_at,pair_hash,pair_expires_at,paired_at,device_hash,device_expires_at)
        select '${siteId}','${item.terminalId}','${locationId}','Synthetic prepaired SQL fixture','UTC','${owner}',at_time,'${pairHash}',at_time+interval '5 minutes',at_time,'${secretHash}',at_time+interval '720 hours' from stamp;
      with stamp as(select clock_timestamp() at_time)
        insert into public.merchant_attendance_pin_credentials(merchant_id,worker_id,employee_id,revision,enabled,salt,verifier,changed_at,created_by,window_at)
        select '${siteId}','${item.workerId}','${item.employeeId}',1,true,'${salt}','${verifier}',at_time,'${owner}',at_time from stamp;
      ${insertEvents(seed)}
      ${item.kind==='old_receipt'?`insert into public.merchant_attendance_pin_clock_receipts(event_id,merchant_id,terminal_id,worker_id,employee_id,operation_id,command)
        values('${item.eventIds[0]}','${siteId}','${item.terminalId}','${item.workerId}','${actor??item.employeeId}','${item.operations[0]}',${json(command('clock_in',0,item.operations[0],actor??item.employeeId))});`:''}
      do $initialize$ begin perform set_config('faolla.pin_identity_requests','[]',true);end; $initialize$;`;
    if(item.kind==='owned_receipt'){
      // This earlier receipt is produced by the real PIN writer, not fabricated.
      sql+=request(command('clock_in',0),null,{save:true,assertion:`assert r->'state'->>'sequence'='1' and r->>'replayed'='false' and r->'receipt'->>'operationId'='${item.operations[2]}','preparation is one real own PIN write';`});
      sql+=insertEvents([{id:item.eventIds[1],operation:item.operations[1],sequence:2,action:'clock_out',actor,source:'web',current:true}]);
    }
    sql+=saveFacts;
    let actionWrites=0;
    if(['open','closed'].includes(item.kind)){
      const sequence=item.kind==='open'?1:2,status=item.kind==='open'?'working':'off',action=item.kind==='open'?'clock_out':'clock_in';
      sql+=request(null,null,{error:guarded?identityError:null,assertion:`assert r->'state'->>'sequence'='${sequence}' and r->'state'->>'status'='${status}'
        and r->'state'->'lastEvent'->>'id'='${seed.at(-1).id}' and r->'receipt'='null'::jsonb,'legacy unowned latest state exposed';`});
      sql+=request(command(action,sequence),null,{error:guarded?identityError:null,assertion:`assert r->>'replayed'='false' and r->'receipt'->>'operationId'='${item.operations[2]}'
        and r->'receipt'->>'sequence'='${sequence+1}' and r->'receipt'->>'action'='${action}','legacy explicit own action appends after unowned latest';`});
      actionWrites=guarded?0:1;
    }else if(item.kind==='old_receipt'){
      sql+=request(null,null,{assertion:`assert r->'state'->'lastEvent'->>'id'='${item.eventIds[1]}' and r->'state'->>'status'='off','own latest state remains readable';`});
      sql+=request(null,item.operations[0],{error:'attendance_operation_conflict'});
      sql+=request(command('clock_in',0,item.operations[0]),null,{error:'attendance_operation_conflict'});
    }else if(['empty','web'].includes(item.kind)){
      const sequence=item.kind==='empty'?0:1,action=item.kind==='empty'?'clock_in':'clock_out';
      sql+=request(null,null,{assertion:`assert r->'state'->>'sequence'='${sequence}' and r->'state'->>'status'='${sequence===0?'off':'working'}'
        ${sequence===0?"and r->'state'->'lastEvent'='null'::jsonb":`and r->'state'->'lastEvent'->>'id'='${item.eventIds[0]}'`},'empty or own web state remains readable';`});
      sql+=request(command(action,sequence),null,{save:true,assertion:`assert r->>'replayed'='false' and r->'receipt'->>'operationId'='${item.operations[2]}'
        and r->'receipt'->>'sequence'='${sequence+1}' and r->'receipt'->>'action'='${action}','new same-actor PIN action succeeds';`});
      sql+=request(null,item.operations[2],{assertion:`assert r->'receipt'=current_setting('faolla.pin_identity_saved_receipt')::jsonb and r->>'replayed'='false','original own PIN receipt read-only recovery';`});
      sql+=request(command(action,sequence),null,{assertion:`assert r->'receipt'=current_setting('faolla.pin_identity_saved_receipt')::jsonb and r->>'replayed'='true','original own PIN command replay without second write';`});
      actionWrites=1;
    }else{
      const assertion=`assert r->'receipt'=current_setting('faolla.pin_identity_saved_receipt')::jsonb and r->'state'->'lastEvent'->>'id'='${item.eventIds[1]}'
        and r->'state'->>'sequence'='2','legacy own real PIN receipt returned underneath unowned latest';`;
      sql+=request(null,item.operations[2],{error:guarded?identityError:null,assertion:assertion+`assert r->>'replayed'='false','read-only recovery is not replay';`});
      sql+=request(command('clock_in',0),null,{error:guarded?identityError:null,assertion:assertion+`assert r->>'replayed'='true','own original command replay reveals unowned latest';`});
    }
    const preparationPinWrites=item.kind==='owned_receipt'?1:0,syntheticEvents=seed.length+(preparationPinWrites?1:0),pinWrites=preparationPinWrites+actionWrites;
    assert(beginCalls<10,'pin_identity_native_credential_budget');
    const manifest={case:item.name,concern:mode==='legacy'&&item.concern,beginCalls,clockCalls,denials,syntheticEvents,preparationPinWrites,actionPinWrites:actionWrites};
    manifests.push(manifest);
    sql+=`do $facts$ declare before_rows jsonb:=current_setting('faolla.pin_identity_before')::jsonb;
      before_receipts jsonb:=current_setting('faolla.pin_identity_receipts_before')::jsonb;after_rows jsonb;new_rows jsonb;begin
      after_rows:=${raw};
      assert (select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence),'[]'::jsonb) from public.merchant_attendance_events e
        where e.merchant_id='${siteId}' and e.worker_id='${item.workerId}' and e.id in(select (value->>'id')::uuid from jsonb_array_elements(before_rows)))=before_rows,'all previous raw facts unchanged';
      assert (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.merchant_attendance_pin_clock_receipts r
        where r.merchant_id='${siteId}' and r.worker_id='${item.workerId}' and r.event_id in(select (value->>'event_id')::uuid from jsonb_array_elements(before_receipts)))=before_receipts,'all previous PIN receipts unchanged';
      select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence),'[]'::jsonb) into new_rows from public.merchant_attendance_events e
        where e.merchant_id='${siteId}' and e.worker_id='${item.workerId}' and e.id not in(select (value->>'id')::uuid from jsonb_array_elements(before_rows));
      assert jsonb_array_length(after_rows)=${syntheticEvents+pinWrites} and jsonb_array_length(new_rows)=${actionWrites},'exact expected event growth';
      assert (select count(*) from public.merchant_attendance_pin_clock_receipts where merchant_id='${siteId}' and worker_id='${item.workerId}')=${pinWrites+(item.kind==='old_receipt'?1:0)},'exact expected PIN receipt growth';
      ${pinWrites?`assert (select count(*) from public.merchant_attendance_events e join public.merchant_attendance_pin_clock_receipts r on r.event_id=e.id
        where e.merchant_id='${siteId}' and e.worker_id='${item.workerId}' and e.operation_id='${item.operations[2]}'
          and e.actor_employee_id='${item.employeeId}' and e.source='kiosk' and r.employee_id='${item.employeeId}' and r.terminal_id='${item.terminalId}')=1,'real own PIN event and origin receipt exactly once';`:''}
      ${counters(beginCalls)}
      perform set_config('faolla.pin_identity_observation',(${json(manifest)}||jsonb_build_object(
        'requests',current_setting('faolla.pin_identity_requests')::jsonb,'rawBefore',before_rows,'rawAfter',after_rows,'newRows',new_rows))::text,true);
    end; $facts$;
    select current_setting('faolla.pin_identity_observation')::jsonb;
    release savepoint pin_identity_case;`;
    steps.push(sql);
  }
  const expected={cases:cases.length,beginCalls:manifests.reduce((n,row)=>n+row.beginCalls,0),clockCalls:manifests.reduce((n,row)=>n+row.clockCalls,0),
    denials:manifests.reduce((n,row)=>n+row.denials,0),pinWrites:manifests.reduce((n,row)=>n+row.actionPinWrites+row.preparationPinWrites,0),
    syntheticEvents:manifests.reduce((n,row)=>n+row.syntheticEvents,0)};
  steps.push(`do $total$ begin
    assert (select sum(attempts) from public.merchant_attendance_pin_credentials where merchant_id='${siteId}')=${expected.beginCalls},'all credential attempts retained until final rollback';
    assert (select sum(attempts) from public.merchant_attendance_pin_attempts where merchant_id='${siteId}')=${expected.beginCalls},'all device attempts retained until final rollback';
    assert not exists(select 1 from public.merchant_attendance_pin_attempts where merchant_id='${siteId}' and lease_id is not null),'no outstanding lease';
    assert (select count(*) from public.merchant_attendance_events where merchant_id='${siteId}')=${expected.syntheticEvents+expected.pinWrites},'final exact events including explicit synthetic seeds';
  end; $total$;rollback;`);
  assert(steps.length<=100,'pin_identity_native_bounded_steps');
  let output;
  try{output=await querySteps(steps);}
  finally{assert.equal(exec(baselineSql),baseline,'pin_identity_native_baseline_not_restored');}
  const observations=output.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.deepEqual(observations.map(row=>Object.fromEntries(Object.keys(manifests[0]).map(key=>[key,row[key]]))),manifests,'pin_identity_native_observation_manifest');
  const checks=cases.map(item=>`${item.concern?(mode==='legacy'?'CONCERN':'GUARDED'):'BASELINE'}: ${item.name}; SQL lease/identity only, no PIN password verification`);
  checks.forEach(pass);
  return {mode,identityError,siteId,owner,locationId,cases:cases.map(({base,...item})=>{void base;return item;}),
    observations,checks,expected,rolledBack:true,syntheticOnly:true,pinPasswordVerified:false};
}
