// Native legacy-concern / guarded-contract comparison, not a real-user punch test.
// The caller supplies the existing owned sandbox and transaction-step executor.
// No migration changes, database startup, network or persistent fixture writes.
import assert from 'node:assert/strict';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
const json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';

export async function checkAttendanceSelfIdentityNative({exec,querySteps,pass,mode='legacy'}){
  assert(['legacy','guarded'].includes(mode),'self_actor_native_invalid_mode');
  assert.equal(typeof exec,'function');assert.equal(typeof querySteps,'function','self_actor_native_steps_required');assert.equal(typeof pass,'function');
  const isolation=JSON.parse(exec(`reset role;select jsonb_build_object('schema',n.nspname,'oid',n.oid::bigint,
    'tableOid',c.oid::bigint,'owner',n.nspowner::regrole::text,'marker',obj_description(n.oid,'pg_namespace'))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass;`));
  assert(isolation&&/^attendance_race_[a-f0-9]{32}$/.test(isolation.schema)&&isolation.owner==='postgres'
    &&/^faolla-synthetic-concurrency:[0-9a-f-]{36}$/.test(isolation.marker)
    &&Number.isSafeInteger(isolation.oid)&&isolation.oid>0&&Number.isSafeInteger(isolation.tableOid)&&isolation.tableOid>0,
  'self_actor_native_owned_schema_required');
  const siteId='99990006',owner=id(970099),authUserId=id(970001),otherAuth=id(970002),employeeId=id(970101),otherEmployeeId=id(970102);
  const role=id(970030),workerId=id(970201),otherWorkerId=id(970202),locationId=id(970301);
  const actors=[{id:owner,email:'self-identity-owner@example.test'},{id:authUserId,email:'self-identity-a@example.test'},{id:otherAuth,email:'self-identity-b@example.test'}];
  assert.equal(exec(`reset role;select count(*) from public.merchants where id='${siteId}';`),'0','self_actor_native_tenant_exists');
  const baselineSql=`reset role;select jsonb_build_object(
    'events',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_attendance_events r),
    'workers',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_attendance_workers r),
    'locations',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_attendance_locations r),
    'settings',(select jsonb_agg(to_jsonb(r) order by merchant_id) from public.merchant_attendance_settings r),
    'employees',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_enterprise_employees r),
    'roles',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_enterprise_roles r),
    'employment',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_attendance_employment_periods r),
    'merchants',(select jsonb_agg(to_jsonb(r) order by id) from public.merchants r));`;
  const baseline=exec(baselineSql);
  const eventIds=[id(971001),id(971002)],operations=[id(972001),id(972002)],newOperation=id(972003);
  const input=(command=null,operationId=null)=>({siteId,authUserId,command,operationId});
  const command=(operationId=operations[0],action='clock_in',expectedSequence=0,expectedWorkerId=workerId)=>
    ({expectedWorkerId,operationId,locationId,action,expectedSequence});
  const invoke=request=>`public.faolla_attendance_self_v1('${siteId}','${authUserId}',${json(request.command)},${literal(request.operationId)})`;
  const raw=`(select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence),'[]'::jsonb) from public.merchant_attendance_events e where e.merchant_id='${siteId}' and e.worker_id='${workerId}')`;
  const cases=[
    {name:'same_actor_recovery',concern:false,label:'BASELINE: same-actor status, original GET receipt and exact POST replay preserve the original two raw facts',kind:'replay',actor:employeeId},
    {name:'other_last_status',concern:true,label:'CONCERN: current self GET exposes the currently bound worker last event attributed to OTHER',kind:'last',actor:otherEmployeeId},
    {name:'null_last_status',concern:true,label:'CONCERN: current self GET exposes the currently bound worker last event with null actor identity',kind:'last',actor:null},
    {name:'own_last_other_receipt',concern:true,label:'CONCERN: with own current last event, an OTHER historical operation is returned by GET and accepted as POST replay',kind:'replay',actor:otherEmployeeId},
    {name:'own_last_null_receipt',concern:true,label:'CONCERN: with own current last event, a null-actor historical operation is returned by GET and accepted as POST replay',kind:'replay',actor:null},
    {name:'close_other_open',concern:true,label:'CONCERN: explicit own clock_out appends to an OTHER open shift; original raw fact is unchanged and only one own event is added',kind:'close',actor:otherEmployeeId},
    {name:'close_null_open',concern:true,label:'CONCERN: explicit own clock_out appends to a null-actor open shift; original raw fact is unchanged and only one own event is added',kind:'close',actor:null},
    {name:'worker_pin_rejected',concern:false,label:'BASELINE: wrong expectedWorkerId is rejected before a matching old-operation replay and writes nothing',kind:'pin',actor:employeeId},
    {name:'same_actor_new_close',concern:false,label:'BASELINE: same-actor web state permits one real SQL clock_out, original GET recovery and duplicate-free retry',kind:'close',actor:employeeId},
    {name:'same_actor_kiosk_new_close',concern:false,label:'BASELINE: attributable kiosk raw input remains readable and permits one web clock_out with recovery; this does not exercise PIN authentication',kind:'close',actor:employeeId,source:'kiosk'},
    {name:'restart_after_other_closed',concern:true,label:'CONCERN: OTHER closed latest state exposes an earlier own receipt and permits a new own clock_in',kind:'restart',actor:otherEmployeeId},
    {name:'restart_after_null_closed',concern:true,label:'CONCERN: null-actor closed latest state exposes an earlier own receipt and permits a new own clock_in',kind:'restart',actor:null},
    {name:'empty_worker_new_clock_in',concern:false,label:'BASELINE: no event is distinct from a null actor; empty current worker permits one real SQL clock_in with GET recovery and unique replay',kind:'empty',actor:employeeId},
  ];
  const steps=[`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    do $owned$ begin
      if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.oid='public.merchants'::regclass and c.oid=${isolation.tableOid} and n.oid=${isolation.oid}
          and n.nspname=${literal(isolation.schema)} and n.nspowner::regrole::text='postgres'
          and obj_description(n.oid,'pg_namespace')=${literal(isolation.marker)})
        then raise exception 'self_actor_native_schema_identity_changed';end if;
    end; $owned$;
    insert into public.merchants(id,user_id) values('${siteId}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${siteId}','UTC',true,true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
      values('${role}','${siteId}','Synthetic self identity diagnostic',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${employeeId}','${siteId}','${authUserId}','${actors[1].email}','Synthetic current employee','${role}','active'),
      ('${otherEmployeeId}','${siteId}','${otherAuth}','${actors[2].email}','Synthetic former employee','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
      values('${locationId}','${siteId}','Synthetic unverified web location','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      ('${workerId}','${siteId}','${employeeId}','SELF-ACTOR-A','Synthetic current bound worker',true,'${locationId}'),
      ('${otherWorkerId}','${siteId}',null,'SELF-ACTOR-B','Synthetic unbound pin target',true,'${locationId}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${siteId}','${workerId}','2000-01-01');`];
  for(const item of cases){
    const guarded=mode==='guarded'&&item.concern,appends=['close','restart','empty'].includes(item.kind)&&!guarded;
    const hasEnd=['replay','pin','restart'].includes(item.kind),source=item.source??'web';
    const nextAction=['restart','empty'].includes(item.kind)?'clock_in':'clock_out',nextSequence=item.kind==='empty'?1:item.kind==='restart'?3:2,nextStatus=nextAction==='clock_in'?'working':'off';
    const seed=item.kind==='empty'?[]:[{id:eventIds[0],operation:operations[0],sequence:1,action:'clock_in',actor:item.kind==='restart'?employeeId:item.actor},
      ...(hasEnd?[{id:eventIds[1],operation:operations[1],sequence:2,action:'clock_out',actor:item.kind==='restart'?item.actor:employeeId}]:[])];
    const record=(request,result='r')=>`requests:=requests||jsonb_build_array(jsonb_build_object('input',${json(request)},'result',${result}));`;
    const deny=request=>`begin perform ${invoke(request)};raise exception 'unexpected guarded identity acceptance';exception when sqlstate 'P0001' then
      if sqlerrm<>'attendance_access_denied' then raise;end if;end;
      requests:=requests||jsonb_build_array(jsonb_build_object('input',${json(request)},'error','attendance_access_denied'));`;
    let assertions='';
    if(guarded&&item.kind==='replay'){
      assertions=`r:=${invoke(input())};assert r->'state'->'lastEvent'->>'id'='${eventIds[1]}' and r->'receipt'='null'::jsonb,'own current last remains readable';${record(input())}
        ${deny(input(null,operations[0]))}${deny(input(command()))}`;
    }else if(guarded&&item.kind==='last'){
      assertions=deny(input());
    }else if(guarded&&['close','restart'].includes(item.kind)){
      const request=input(command(newOperation,nextAction,nextSequence-1));
      assertions=`${deny(input())}${item.kind==='restart'?deny(input(null,operations[0])):''}
        ${deny(request)}${deny(input(null,newOperation))}${deny(request)}`;
    }else if(item.kind==='replay'){
      assertions=`r:=${invoke(input())};assert r->'state'->'lastEvent'->>'id'='${eventIds[1]}' and r->'receipt'='null'::jsonb,'own current last event';${record(input())}
        r:=${invoke(input(null,operations[0]))};assert r->'receipt'->>'id'='${eventIds[0]}' and r->'receipt'->>'operationId'='${operations[0]}','historical receipt still returned';
        assert r->'state'->'lastEvent'->>'id'='${eventIds[1]}' and r->>'replayed'='false','receipt distinct from current state';saved:=r->'receipt';${record(input(null,operations[0]))}
        r:=${invoke(input(command()))};assert r->>'replayed'='true' and r->'receipt'=saved and r->'state'->>'sequence'='2','existing operation replay ignores historical actor';${record(input(command()))}`;
    }else if(item.kind==='last'){
      assertions=`r:=${invoke(input())};assert r->'state'->'lastEvent'->>'id'='${eventIds[0]}' and r->'state'->'lastEvent'->>'operationId'='${operations[0]}','unattributable last event returned';
        assert r->'state'->>'status'='working' and r->'state'->>'sequence'='1' and r->'receipt'='null'::jsonb,'unattributable open state exposed';${record(input())}`;
    }else if(['close','restart','empty'].includes(item.kind)){
      const request=input(command(newOperation,nextAction,nextSequence-1));
      assertions=`r:=${invoke(input())};
        ${item.kind==='empty'?`assert r->'state'->'lastEvent'='null'::jsonb and r->'state'->>'sequence'='0' and r->'state'->>'status'='off','empty worker is not an unattributable prior event';`
          :`assert r->'state'->'lastEvent'->>'id'='${seed.at(-1).id}' and r->'state'->>'status'='${item.kind==='restart'?'off':'working'}','original source state readable';`}${record(input())}
        ${item.kind==='restart'?`r:=${invoke(input(null,operations[0]))};assert r->'receipt'->>'id'='${eventIds[0]}' and r->'state'->'lastEvent'->>'id'='${eventIds[1]}','own older receipt exposed beneath unowned latest';${record(input(null,operations[0]))}`:''}
        r:=${invoke(request)};assert r->>'replayed'='false' and r->'receipt'->>'operationId'='${newOperation}'
          and r->'receipt'->>'sequence'='${nextSequence}' and r->'receipt'->>'action'='${nextAction}' and r->'state'->>'status'='${nextStatus}','explicit next action accepted';
        saved:=r->'receipt';${record(request)}
        r:=${invoke(input(null,newOperation))};assert r->'receipt'=saved and r->>'replayed'='false','own append recoverable by original GET';${record(input(null,newOperation))}
        r:=${invoke(request)};assert r->'receipt'=saved and r->>'replayed'='true','own append exact replay does not duplicate';${record(request)}`;
    }else{
      const request=input(command(operations[0],'clock_in',0,otherWorkerId));
      assertions=`begin perform ${invoke(request)};raise exception 'unexpected worker pin acceptance';exception when sqlstate 'P0001' then
          if sqlerrm<>'attendance_worker_changed' then raise;end if;end;
        requests:=requests||jsonb_build_array(jsonb_build_object('input',${json(request)},'error','attendance_worker_changed'));
        r:=${invoke(input())};assert r->'state'->>'sequence'='2' and r->'state'->'lastEvent'->>'id'='${eventIds[1]}','worker pin rejection did not change state';${record(input())}`;
    }
    steps.push(`savepoint self_actor_case;
      ${seed.length?`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at,actor_employee_id) values
        ${seed.map(row=>`('${row.id}','${siteId}','${workerId}','${locationId}','${row.operation}',${row.sequence},'${row.action}','${source}','UTC',date_trunc('milliseconds',clock_timestamp())-interval '1 hour'+${row.sequence}*interval '1 millisecond',clock_timestamp(),${literal(row.actor)})`).join(',')};`:''}
      do $before$ begin perform set_config('faolla.self_actor_before',${raw}::text,true);end; $before$;
      set local role service_role;
      do $probe$ declare r jsonb;saved jsonb;requests jsonb:='[]';begin
        ${assertions}
        perform set_config('faolla.self_actor_requests',requests::text,true);
      end; $probe$;reset role;
      do $facts$ declare before_rows jsonb:=current_setting('faolla.self_actor_before')::jsonb;after_rows jsonb;new_rows jsonb;begin
        after_rows:=${raw};
        ${seed.length?`assert before_rows->0->>'source'='${source}','seed source preserved';`:`assert before_rows='[]'::jsonb,'empty worker has no preseeded punch';`}
        assert (select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence),'[]'::jsonb) from public.merchant_attendance_events e
          where e.merchant_id='${siteId}' and e.worker_id='${workerId}' and e.id=any(array[${seed.map(row=>literal(row.id)).join(',')}]::uuid[]))=before_rows,'original raw facts unchanged';
        select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence),'[]'::jsonb) into new_rows from public.merchant_attendance_events e
          where e.merchant_id='${siteId}' and e.worker_id='${workerId}' and not(e.id=any(array[${seed.map(row=>literal(row.id)).join(',')}]::uuid[]));
        assert jsonb_array_length(new_rows)=${appends?1:0} and jsonb_array_length(after_rows)=${seed.length+(appends?1:0)},'exact expected raw growth';
        ${appends?`assert new_rows->0->>'actor_employee_id'='${employeeId}' and new_rows->0->>'operation_id'='${newOperation}'
          and new_rows->0->>'action'='${nextAction}' and new_rows->0->>'sequence'='${nextSequence}' and new_rows->0->>'source'='web','only explicit current-actor append';`:''}
        perform set_config('faolla.self_actor_observation',jsonb_build_object('case',${literal(item.name)},'concern',${mode==='legacy'&&item.concern},
          'requests',current_setting('faolla.self_actor_requests')::jsonb,'rawBefore',before_rows,'rawAfter',after_rows,'newRows',new_rows)::text,true);
      end; $facts$;
      select current_setting('faolla.self_actor_observation')::jsonb;
      rollback to savepoint self_actor_case;release savepoint self_actor_case;`);
  }
  steps.push(`do $empty$ begin assert not exists(select 1 from public.merchant_attendance_events where merchant_id='${siteId}'),
    'all per-case writes rolled back';end; $empty$;rollback;`);
  assert(steps.length<=100,'self_actor_native_bounded_steps');
  let output;
  try{output=await querySteps(steps);}
  finally{assert.equal(exec(baselineSql),baseline,'self_actor_native_baseline_not_restored');}
  const observations=output.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.deepEqual(observations.map(row=>({name:row.case,concern:row.concern})),cases.map(row=>({name:row.name,concern:mode==='legacy'&&row.concern})),
    'self_actor_native_observation_manifest');
  const guardedLabels={
    other_last_status:'GUARDED: current self GET rejects OTHER last-event identity without returning worker state',
    null_last_status:'GUARDED: current self GET rejects null last-event identity without returning worker state',
    own_last_other_receipt:'GUARDED: own current state remains readable while OTHER historical receipt GET and POST replay are denied',
    own_last_null_receipt:'GUARDED: own current state remains readable while null-actor historical receipt GET and POST replay are denied',
    close_other_open:'GUARDED: explicit close, receipt lookup and original retry on OTHER open state are denied without any new fact',
    close_null_open:'GUARDED: explicit close, receipt lookup and original retry on null-actor open state are denied without any new fact',
    restart_after_other_closed:'GUARDED: OTHER closed latest state cannot be read as off, reveal an older own receipt or authorize a new clock_in',
    restart_after_null_closed:'GUARDED: null-actor closed latest state cannot be read as off, reveal an older own receipt or authorize a new clock_in',
  };
  const checks=cases.map(row=>mode==='guarded'&&row.concern?guardedLabels[row.name]:row.label);checks.forEach(pass);
  return {mode,siteId,owner,authUserId,employeeId,otherEmployeeId,workerId,otherWorkerId,locationId,actors,observations,checks,rolledBack:true,syntheticOnly:true};
}
