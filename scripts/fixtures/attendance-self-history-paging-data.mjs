// Synthetic raw inputs ONLY in the already-owned concurrency sandbox. These
// INSERTs and controlled binding swaps are not claims of real clock/admin UI
// writes. The caller exercises the actual read handlers and migration RPCs.
import assert from 'node:assert/strict';

const site='99990001',foreign='99990002';
const id=n=>{
  assert(Number.isSafeInteger(n)&&n>0&&n<1000000000000,'self_history_paging_invalid_id');
  return `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
};
const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';
const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};

/** exec is synchronous and must qualify public.* into its owned sandbox. */
export function prepareAttendanceSelfHistoryPagingData({exec}){
  assert.equal(typeof exec,'function','self_history_paging_exec_required');
  const isolationSql=`reset role;select jsonb_build_object('schema',n.nspname,'oid',n.oid::bigint,
    'tableOid',c.oid::bigint,'owner',n.nspowner::regrole::text,'marker',obj_description(n.oid,'pg_namespace'))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass;`;
  const isolation=JSON.parse(exec(isolationSql));
  assert(isolation&&/^attendance_race_[a-f0-9]{32}$/.test(isolation.schema)
    &&isolation.owner==='postgres'&&/^faolla-synthetic-concurrency:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(isolation.marker)
    &&Number.isSafeInteger(isolation.oid)&&isolation.oid>0&&Number.isSafeInteger(isolation.tableOid)&&isolation.tableOid>0,
  'self_history_paging_owned_sandbox_required');
  const assertOwned=()=>assert.deepEqual(JSON.parse(exec(isolationSql)),isolation,'self_history_paging_sandbox_identity_changed');
  assert.equal(exec(`reset role;select count(*) from public.merchants where id in ('${site}','${foreign}');`),'0',
    'self_history_paging_tenants_must_be_absent');
  const date=exec("reset role;select to_char((clock_timestamp() at time zone 'UTC')::date-1,'YYYY-MM-DD');");
  assert(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>='2000-01-01'&&date<='2100-12-31'
    &&Number.isFinite(Date.parse(date+'T00:00:00.000Z'))&&new Date(date+'T00:00:00.000Z').toISOString()===date+'T00:00:00.000Z',
  'self_history_paging_invalid_database_date');
  const owner=id(99),employeeAuth=id(1),otherAuth=id(2),employeeId=id(101),otherEmployeeId=id(102),role=id(30);
  const worker=id(201),otherWorker=id(202),hiddenWorker=id(299),foreignWorker=id(298),location=id(301),foreignLocation=id(398);
  const actors=freeze([{id:owner,email:'owner-entry@example.test'},
    {id:employeeAuth,email:'employee-a@example.test'},{id:otherAuth,email:'employee-b@example.test'}]);
  const events=[],sessions=[];
  const makeSession=(merchant,workerId,locationId,actorEmployee,number,offsetSeconds,paid)=>{
    const actions=['clock_in','break_start','break_end','clock_out'],offsets=[0,60,90,180];
    const records=actions.map((action,index)=>{
      const ordinal=events.length,occurredAt=new Date(Date.parse(date+'T12:00:00.000Z')+(offsetSeconds+offsets[index])*1000)
        .toISOString().replace('.000Z','.000123Z');
      const event={id:id(10001+ordinal),locationId,sequence:number*4+index+1,action,occurredAt,timeZone:'UTC',
        breakPaid:action==='break_start'?paid:null,source:'web'};
      events.push({...event,merchant,workerId,actorEmployee,operationId:id(20001+ordinal)});return event;
    });
    return {startEventId:records[0].id,eventIds:records.map(event=>event.id),events:records,paid,
      startAt:records[0].occurredAt,endAt:records[3].occurredAt,
      totals:{elapsedUs:180000000,breakUs:30000000,paidBreakUs:paid?30000000:0,workedUs:150000000}};
  };
  // Each segment has positive work/rest, including paid and unpaid rests. A
  // segment's end equals the next start; UUID ordering also disambiguates ties.
  for(let number=0;number<26;number++)sessions.push(makeSession(site,worker,location,employeeId,number,number*180,number%2===1));
  const otherSession=makeSession(site,otherWorker,location,otherEmployeeId,0,7200,true);
  makeSession(site,hiddenWorker,location,null,0,10800,false);
  makeSession(foreign,foreignWorker,foreignLocation,null,0,14400,false);
  exec(`reset role;set standard_conforming_strings=on;begin;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled)
      values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
      values('${role}','${site}','仅查看本人历史',array['enterprise.view','attendance.self.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${employeeId}','${site}','${employeeAuth}','${actors[1].email}','本人历史员工','${role}','active'),
      ('${otherEmployeeId}','${site}','${otherAuth}','${actors[2].email}','另一历史员工','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${location}','${site}','本人历史地点','UTC',true),('${foreignLocation}','${foreign}','外企业历史地点','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values
      ('${worker}','${site}','${employeeId}','HISTORY-01','本人历史档案','${location}',true),
      ('${otherWorker}','${site}','${otherEmployeeId}','HISTORY-02','另一历史档案','${location}',true),
      ('${hiddenWorker}','${site}',null,'HIDDEN-99','未绑定历史档案','${location}',true),
      ('${foreignWorker}','${foreign}',null,'FOREIGN-98','外企业历史档案','${foreignLocation}',true);
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at,break_paid,actor_employee_id) values
      ${events.map(event=>`('${event.id}','${event.merchant}','${event.workerId}','${event.locationId}','${event.operationId}',${event.sequence},'${event.action}','web','UTC','${event.occurredAt}','${event.occurredAt}',${event.breakPaid===null?'null':event.breakPaid},${literal(event.actorEmployee)})`).join(',\n      ')};
    grant select on public.merchants,public.merchant_enterprise_roles,public.merchant_enterprise_employees to service_role;
    commit;`);
  const ordered=JSON.parse(exec(`reset role;select jsonb_build_object(
    'oldIds',(select jsonb_agg(e.id order by e.occurred_at desc,e.id desc) from public.merchant_attendance_events e where e.merchant_id='${site}' and e.worker_id='${worker}'),
    'otherIds',(select jsonb_agg(e.id order by e.occurred_at desc,e.id desc) from public.merchant_attendance_events e where e.merchant_id='${site}' and e.worker_id='${otherWorker}'),
    'forbiddenIds',(select jsonb_agg(e.id order by e.occurred_at desc,e.id desc) from public.merchant_attendance_events e where e.merchant_id in ('${site}','${foreign}') and not(e.merchant_id='${site}' and e.worker_id='${worker}')));`));
  assert.deepEqual(ordered.oldIds,events.slice(0,104).map(event=>event.id).reverse(),'self_history_paging_old_order');
  assert.deepEqual(ordered.otherIds,events.slice(104,108).map(event=>event.id).reverse(),'self_history_paging_other_order');
  assert.deepEqual(ordered.forbiddenIds,events.slice(104).map(event=>event.id).reverse(),'self_history_paging_forbidden_order');
  const snapshot=()=>JSON.parse(exec(`reset role;select jsonb_build_object(
    'events',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_attendance_events r),
    'workers',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_attendance_workers r),
    'locations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_attendance_locations r),
    'settings',(select coalesce(jsonb_agg(to_jsonb(r) order by r.merchant_id),'[]'::jsonb) from public.merchant_attendance_settings r),
    'employees',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_enterprise_employees r),
    'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_enterprise_roles r),
    'merchants',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchants r));`));
  const baseline=freeze(snapshot());assert.equal(baseline.events.length,116,'self_history_paging_event_count');
  const bindingRows=rows=>rows.filter(row=>row.merchant_id===site&&[worker,otherWorker].includes(row.id))
    .map(row=>({id:row.id,employeeId:row.employee_id}));
  const original=freeze([{id:worker,employeeId},{id:otherWorker,employeeId:otherEmployeeId}]);
  const swapped=freeze([{id:worker,employeeId:otherEmployeeId},{id:otherWorker,employeeId}]);
  assert.deepEqual(bindingRows(baseline.workers),original,'self_history_paging_original_bindings');
  const protectedFacts=facts=>({...facts,workers:facts.workers.map(row=>{
    if(row.merchant_id!==site||![worker,otherWorker].includes(row.id))return row;
    const copy={...row};delete copy.employee_id;return copy;
  })});
  const protectedBaseline=protectedFacts(baseline);
  const verifyFacts=current=>{
    assert.deepEqual(protectedFacts(current),protectedBaseline,'self_history_paging_protected_facts_changed');
    const bindings=bindingRows(current.workers);
    assert(JSON.stringify(bindings)===JSON.stringify(original)||JSON.stringify(bindings)===JSON.stringify(swapped),
      'self_history_paging_unexpected_bindings');
    return bindings;
  };
  const assertFactsUnchanged=()=>{assertOwned();verifyFacts(snapshot());};
  const setBindings=target=>{
    assertOwned();const current=verifyFacts(snapshot());
    if(JSON.stringify(current)===JSON.stringify(target))return freeze(current);
    // Recheck the exact captured schema/table identity INSIDE the transaction,
    // then lock and compare the two rows before clearing the unique FK binding.
    exec(`reset role;set standard_conforming_strings=on;begin;set local lock_timeout='3s';
      do $self_history_bindings$ declare actual jsonb; affected integer;begin
        if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where c.oid='public.merchants'::regclass and c.oid=${isolation.tableOid} and n.oid=${isolation.oid}
            and n.nspname=${literal(isolation.schema)} and n.nspowner::regrole::text='postgres'
            and obj_description(n.oid,'pg_namespace')=${literal(isolation.marker)})
          then raise exception 'self_history_paging_sandbox_identity_changed';end if;
        perform 1 from public.merchant_attendance_workers where merchant_id='${site}' and id in ('${worker}','${otherWorker}') order by id for update;
        select jsonb_agg(jsonb_build_object('id',id,'employeeId',employee_id) order by id) into actual
          from public.merchant_attendance_workers where merchant_id='${site}' and id in ('${worker}','${otherWorker}');
        if actual is distinct from ${json(current)} then raise exception 'self_history_paging_binding_changed';end if;
        update public.merchant_attendance_workers set employee_id=null where merchant_id='${site}' and id in ('${worker}','${otherWorker}');
        get diagnostics affected=row_count;if affected<>2 then raise exception 'self_history_paging_binding_count';end if;
        update public.merchant_attendance_workers set employee_id=case id when '${worker}'::uuid then '${target[0].employeeId}'::uuid else '${target[1].employeeId}'::uuid end
          where merchant_id='${site}' and id in ('${worker}','${otherWorker}');
        get diagnostics affected=row_count;if affected<>2 then raise exception 'self_history_paging_binding_count';end if;
      end; $self_history_bindings$;commit;`);
    const after=verifyFacts(snapshot());assert.deepEqual(after,target,'self_history_paging_binding_not_applied');return freeze(after);
  };
  return Object.freeze({site,foreign,id,actors,owner,employeeAuth,otherAuth,employeeId,otherEmployeeId,role,worker,otherWorker,hiddenWorker,foreignWorker,
    location,foreignLocation,date,oldIds:freeze(ordered.oldIds),otherIds:freeze(ordered.otherIds),forbiddenIds:freeze(ordered.forbiddenIds),
    sessions:freeze(sessions),otherSession:freeze(otherSession),rawBaseline:baseline.events,bindingsBaseline:original,
    assertFactsUnchanged,swapBindings:()=>setBindings(swapped),restoreBindings:()=>setBindings(original)});
}
