// Synthetic input data ONLY, inside withAttendanceConcurrencySandbox's owned
// schema. These raw rows are not evidence of a clock UI/business write. Scope
// grants/removals, and the caller's subsequent reads, use the real migration RPCs.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const site='99990001',foreign='99990002';
const id=n=>{
  assert(Number.isSafeInteger(n)&&n>0&&n<1000000000000,'records_paging_invalid_id');
  return `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
};
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>value===null?'null':literal(JSON.stringify(value))+'::jsonb';
const freeze=value=>{
  if(value&&typeof value==='object'){
    Object.values(value).forEach(freeze);Object.freeze(value);
  }
  return value;
};

/** exec must synchronously qualify public.* into the already-owned sandbox. */
export function prepareAttendanceRecordsPagingData({exec}){
  assert.equal(typeof exec,'function','records_paging_exec_required');
  const isolation=JSON.parse(exec(`reset role;select jsonb_build_object('schema',n.nspname,'owner',n.nspowner::regrole::text,
    'marker',obj_description(n.oid,'pg_namespace')) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass;`));
  assert(isolation&&/^attendance_race_[a-f0-9]{32}$/.test(isolation.schema)
    &&isolation.owner==='postgres'&&/^faolla-synthetic-concurrency:[0-9a-f-]{36}$/.test(isolation.marker),
  'records_paging_owned_sandbox_required');
  assert.equal(exec(`reset role;select count(*) from public.merchants where id in ('${site}','${foreign}');`),'0',
    'records_paging_tenants_must_be_absent');
  const date=exec("reset role;select to_char((clock_timestamp() at time zone 'UTC')::date-1,'YYYY-MM-DD');");
  assert(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)
    &&date>='2000-01-01'&&date<='2100-12-31'&&new Date(date+'T00:00:00.000Z').toISOString()===date+'T00:00:00.000Z',
  'records_paging_invalid_database_date');

  const owner=id(99),managerAuth=id(1),managerEmployee=id(101),managerRole=id(30);
  const actors=freeze([{id:owner,email:'owner-entry@example.test'},{id:managerAuth,email:'employee-a@example.test'}]);
  const workers=freeze(Array.from({length:28},(_,index)=>id(201+index)));
  const hiddenWorker=id(299),foreignWorker=id(298);
  const locations=freeze({x:id(301),y:id(302),foreign:id(398)});
  const grants=freeze({primary:id(401),secondary:id(402),overlap:id(403)});
  const workerRows=[...workers.map((worker,index)=>[worker,site,`PAGE-${String(index+1).padStart(2,'0')}`,
    `分页人员 ${String(index+1).padStart(2,'0')}`,index===27?locations.y:locations.x]),
  [hiddenWorker,site,'HIDDEN-99','未授权人员',locations.x],
  [foreignWorker,foreign,'FOREIGN-98','外企业人员',locations.foreign]];
  const events=[];
  const append=(merchant,worker,location,sequence)=>{
    const index=events.length;
    events.push({id:id(10001+index),merchant,worker,location,operation:id(20001+index),sequence,
      // Offset the tie groups so both 50-row boundaries split equal timestamps.
      // Pagination must retain the UUID tie-break, not just a time predicate.
      action:sequence%2===1?'clock_in':'clock_out',at:`${date}T12:00:00.${String(Math.floor((index+1)/2)).padStart(6,'0')}Z`});
  };
  for(let sequence=1;sequence<=52;sequence++){
    append(site,workers[0],locations.x,sequence);append(site,workers[27],locations.y,sequence);
  }
  for(let sequence=53;sequence<=56;sequence++){
    append(site,workers[0],locations.y,sequence);append(site,workers[27],locations.x,sequence);
  }
  for(let sequence=1;sequence<=2;sequence++){
    append(site,hiddenWorker,locations.x,sequence);append(foreign,foreignWorker,locations.foreign,sequence);
  }
  exec(`reset role;set standard_conforming_strings=on;begin;
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled)
      values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
      values('${managerRole}','${site}','合成分页主管',array['enterprise.view','attendance.records.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${managerEmployee}','${site}','${managerAuth}','${actors[1].email}','合成分页主管','${managerRole}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${locations.x}','${site}','分页地点 X','UTC',true),('${locations.y}','${site}','分页地点 Y','UTC',true),
      ('${locations.foreign}','${foreign}','外企业地点','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name,default_location_id,active) values
      ${workerRows.map(row=>'('+row.map(literal).join(',')+',true)').join(',\n      ')};
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at) values
      ${events.map(event=>`('${event.id}','${event.merchant}','${event.worker}','${event.location}','${event.operation}',${event.sequence},'${event.action}','web','UTC','${event.at}','${event.at}')`).join(',\n      ')};
    grant select on public.merchants,public.merchant_enterprise_roles,public.merchant_enterprise_employees to service_role;
    commit;`);

  let scopeRevision=0;
  const scope=command=>{
    const reply=JSON.parse(exec(`set standard_conforming_strings=on;set role service_role;
      select jsonb_build_object('role',current_user,'data',public.faolla_attendance_scopes_v1('${site}','${owner}','${managerEmployee}',${json(command)},null));`));
    assert.equal(reply.role,'service_role','records_paging_scope_role');
    const result=reply.data;
    assert(result?.scope?.siteId===site&&result.scope.employeeId===managerEmployee
      &&Number.isSafeInteger(result.scope.revision)&&result.scope.revision>=0&&Array.isArray(result.scope.grants),
    'records_paging_scope_result');
    if(command){
      assert.equal(result.scope.revision,command.expectedRevision+1,'records_paging_scope_revision');
      assert.deepEqual(result.receipt,{operationId:command.operationId,revision:result.scope.revision,grantId:command.grantId,action:command.action},
        'records_paging_scope_receipt');
    }
    scopeRevision=result.scope.revision;return result;
  };
  for(const [index,[grantId,workerIds,locationIds]] of [
    [grants.primary,workers.slice(0,27),[locations.x]],
    [grants.secondary,[workers[27]],[locations.y]],
    [grants.overlap,[workers[0]],[locations.x]],
  ].entries()){
    scope({action:'put',grantId,grant:{workerIds,locationIds,validFrom:'2000-01-01T00:00:00.000Z',validUntil:null},
      operationId:id(501+index),expectedRevision:scopeRevision});
  }
  assert.equal(scopeRevision,3);
  const pair=`e.merchant_id='${site}' and ((e.worker_id='${workers[0]}' and e.location_id='${locations.x}')
    or (e.worker_id='${workers[27]}' and e.location_id='${locations.y}'))`;
  const ordered=JSON.parse(exec(`reset role;select jsonb_build_object(
    'allowedIds',(select coalesce(jsonb_agg(e.id order by e.occurred_at desc,e.id desc),'[]'::jsonb) from public.merchant_attendance_events e where ${pair}),
    'forbiddenIds',(select coalesce(jsonb_agg(e.id order by e.occurred_at desc,e.id desc),'[]'::jsonb) from public.merchant_attendance_events e
      where e.merchant_id in ('${site}','${foreign}') and not (${pair})));`));
  // The DB order is the comparison oracle used by the browser. Also reject an
  // unexpected/missing fixture row rather than silently weakening its baseline.
  assert.deepEqual(ordered.allowedIds,events.slice(0,104).map(event=>event.id).reverse(),'records_paging_allowed_order');
  assert.deepEqual(ordered.forbiddenIds,events.slice(104).map(event=>event.id).reverse(),'records_paging_forbidden_order');
  const snapshot=()=>JSON.parse(exec(`reset role;select jsonb_build_object(
    'events',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_attendance_events r),
    'workers',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_attendance_workers r),
    'locations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_attendance_locations r),
    'settings',(select coalesce(jsonb_agg(to_jsonb(r) order by r.merchant_id),'[]'::jsonb) from public.merchant_attendance_settings r),
    'employees',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_enterprise_employees r),
    'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchant_enterprise_roles r),
    'merchants',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.merchants r));`));
  const baseline=freeze(snapshot());
  assert.equal(baseline.events.length,116,'records_paging_event_count');
  const assertFactsUnchanged=()=>assert.deepEqual(snapshot(),baseline,'records_paging_protected_facts_changed');
  const revoke=grantId=>{
    assert(Object.values(grants).includes(grantId),'records_paging_unknown_grant');
    const current=scope(null);
    assert(current.scope.grants.some(grant=>grant.id===grantId),'records_paging_grant_already_removed');
    const result=scope({action:'remove',grantId,grant:null,operationId:randomUUID(),expectedRevision:scopeRevision});
    assert(!result.scope.grants.some(grant=>grant.id===grantId),'records_paging_revoke_not_applied');
    return result;
  };
  return Object.freeze({site,foreign,id,actors,owner,managerAuth,managerEmployee,managerRole,workers,hiddenWorker,foreignWorker,
    locations:freeze(Object.values(locations)),grants:freeze(Object.values(grants)),date,
    allowedIds:freeze(ordered.allowedIds),forbiddenIds:freeze(ordered.forbiddenIds),
    eventsBaseline:baseline.events,assertFactsUnchanged,revoke,get scopeRevision(){return scopeRevision;}});
}
