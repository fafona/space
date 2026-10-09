// Callable only from an existing ownership-checked schema runner. No standalone
// database, environment secret, network or service startup. Fixtures roll back.
import assert from 'node:assert/strict';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';

// Caller applies 068 and 110 before this check (070 is in the base sandbox).
// querySteps must qualify every supplied statement using the SAME sandbox as
// exec and keep all steps on one transaction/connection; existing deadlines stay.
export async function checkAttendanceSelfHistoryIdentityNative({exec,querySteps,pass}){
  assert.equal(typeof exec,'function');assert.equal(typeof querySteps,'function','self_identity_native_steps_required');assert.equal(typeof pass,'function');
  const isolation=JSON.parse(exec(`reset role;select jsonb_build_object('schema',n.nspname,'owner',n.nspowner::regrole::text,
    'marker',obj_description(n.oid,'pg_namespace')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchants'::regclass;`));
  assert(/^attendance_race_[a-f0-9]{32}$/.test(isolation.schema)&&isolation.owner==='postgres'
    &&/^faolla-synthetic-concurrency:[0-9a-f-]{36}$/.test(isolation.marker),'self_identity_native_owned_schema_required');
  const site='99990006',foreign='99990007',owner=id(900099),auth=id(900001),otherAuth=id(900002);
  const employee=id(900101),otherEmployee=id(900102),role=id(900030),worker=id(900201),otherWorker=id(900202),bulkWorker=id(900203),location=id(900401);
  assert.equal(exec(`reset role;select count(*) from public.merchants where id in ('${site}','${foreign}');`),'0','self_identity_native_tenants_exist');
  const baselineSql=`reset role;select jsonb_build_object(
    'events',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_attendance_events r),
    'workers',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_attendance_workers r),
    'locations',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_attendance_locations r),
    'settings',(select jsonb_agg(to_jsonb(r) order by merchant_id) from public.merchant_attendance_settings r),
    'employees',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_enterprise_employees r),
    'roles',(select jsonb_agg(to_jsonb(r) order by id) from public.merchant_enterprise_roles r),
    'merchants',(select jsonb_agg(to_jsonb(r) order by id) from public.merchants r));`;
  const baseline=exec(baselineSql);
  const rows=[];
  const add=(workerId,sequence,action,actor,source='web',offset=sequence)=>{
    const ordinal=rows.length,eventId=id(910001+ordinal);
    rows.push({id:eventId,worker:workerId,sequence,action,actor,source,offset,operation:id(930001+ordinal)});return eventId;
  };
  const ownIds=[];
  for(let n=1;n<=104;n++)ownIds.push(add(worker,n,n%2?'clock_in':'clock_out',employee,n%2?'web':'kiosk',Math.floor(n/2)));
  // Enough more-recent unowned rows to occupy >one page if identity is applied
  // after the 51-row window. They must never consume the caller's page budget.
  for(let n=1;n<=104;n++)add(worker,104+n,n%2?'clock_in':'clock_out',n%2?null:otherEmployee,'web',3600000000+n);
  const otherStart=add(otherWorker,1,'clock_in',otherEmployee);add(otherWorker,2,'clock_out',otherEmployee);
  const cases=[];
  const segment=(name,actors,actions=['clock_in','break_start','break_end','clock_out'],source='web',startIndex=0)=>{
    const workerId=id(900301+cases.length),eventIds=actions.map((action,index)=>add(workerId,index+1,action,actors[index],source,index*1000000+123));
    const value={name,worker:workerId,eventIds,start:eventIds[startIndex]};cases.push(value);return value;
  };
  const web=segment('own-web',Array(4).fill(employee)),kiosk=segment('own-kiosk',Array(4).fill(employee),undefined,'kiosk');
  // Source is independent of ownership; terminal PIN/phone writers both record
  // the accountable employee, unlike null legacy rows.
  const none=segment('null-start',Array(4).fill(null)),other=segment('other-start',Array(4).fill(otherEmployee));
  const mixed=segment('mixed-middle',[employee,otherEmployee,employee,employee]);
  const nullEnd=segment('null-end',[employee,employee,employee,null]);
  const ownOpen=segment('own-open',[employee,employee],['clock_in','break_start']);
  const mixedOpen=segment('mixed-open',[employee,null],['clock_in','break_start']);
  const badActions=['break_start','clock_in','break_start','break_end','clock_out'];
  const mixedInvalid=segment('mixed-invalid-predecessor',[employee,employee,otherEmployee,employee,employee],badActions,'web',1);
  const ownInvalid=segment('own-invalid-predecessor',Array(5).fill(employee),badActions,'web',1);
  const afterEnd=segment('foreign-after-owned-end',[employee,employee,employee,employee,otherEmployee,null],
    ['clock_in','break_start','break_end','clock_out','clock_in','clock_out']);
  const query={fromAt:'2026-09-01T00:00:00.000000Z',toAt:'2026-09-02T00:00:00.000000Z',expectedWorkerId:null,asOf:null,cursorAt:null,cursorId:null};
  const history=(q=query,who=auth,tenant=site)=>`public.faolla_attendance_self_history_v1('${tenant}','${who}',${json(q)})`;
  const session=(start,who=auth,tenant=site)=>`public.faolla_attendance_self_session_v1('${tenant}','${who}','${start}')`;
  const reject=(expression,code='attendance_session_not_found')=>`begin perform ${expression};raise exception 'unexpected identity acceptance';
    exception when sqlstate 'P0001' then if sqlerrm<>${literal(code)} then raise;end if;end;`;
  const bind=workerId=>`reset role;update public.merchant_attendance_workers set employee_id=null where merchant_id='${site}' and employee_id='${employee}';
    update public.merchant_attendance_workers set employee_id='${employee}' where merchant_id='${site}' and id='${workerId}';set local role service_role;`;
  const labels=[
    'identity history filters before 50/50/4 pages and preserves microsecond plus equal-time UUID continuity',
    'self history and session preserve exact public field whitelists and remain readable while punching/profiles are paused',
    'own web and kiosk segments plus short open segments are allowed; later unrelated actors do not poison a closed segment',
    'null, other, mixed middle/end/open and mixed invalid-predecessor segments uniformly return session_not_found',
    '2002 own facts succeed while own 2003 and unowned tails beyond the bounded prefix uniformly return session_not_found',
    'old worker cursor is rejected after rebind; fresh current-worker history is empty and both old/new unattributable sessions are concealed',
    'current employee/role permission and database service-only execution remain enforced',
    'read checks leave raw facts unchanged and all independent synthetic setup rolls back to the caller baseline',
  ];
  const steps=[`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',false,false),('${foreign}','UTC',false,false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic identity reader',array['enterprise.view','attendance.self.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${employee}','${site}','${auth}','identity-a@example.test','Synthetic identity A','${role}','active'),
      ('${otherEmployee}','${site}','${otherAuth}','identity-b@example.test','Synthetic identity B','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','Synthetic inactive historical location','UTC',false);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active) values
      ${[worker,otherWorker,bulkWorker,...cases.map(item=>item.worker)].map((key,index)=>`('${key}','${site}',${key===worker?literal(employee):'null'},'IDENTITY-${index}','Synthetic identity ${index}',false)`).join(',')};`];
  const insert=items=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,break_paid,occurred_at,actor_employee_id) values
    ${items.map(row=>`('${row.id}','${site}','${row.worker}','${location}','${row.operation}',${row.sequence},'${row.action}','${row.source}','UTC',${row.action==='break_start'?'false':'null'},'2026-09-01T12:00:00Z'::timestamptz+${row.offset}*interval '1 microsecond',${literal(row.actor)})`).join(',')};`;
  for(let index=0;index<rows.length;index+=50)steps.push(insert(rows.slice(index,index+50)));
  for(let from=1;from<=2001;from+=50){
    const to=Math.min(from+49,2001);
    steps.push(`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,break_paid,occurred_at,actor_employee_id)
      select ('00000000-0000-4000-8000-'||lpad((950000+n)::text,12,'0'))::uuid,'${site}','${bulkWorker}','${location}',
        ('00000000-0000-4000-8000-'||lpad((960000+n)::text,12,'0'))::uuid,n,
        case when n=1 then 'clock_in' when n%2=0 then 'break_start' else 'break_end' end,'web','UTC',case when n%2=0 then false else null end,
        '2026-09-01T12:00:00Z'::timestamptz+n*interval '1 microsecond','${employee}' from generate_series(${from},${to}) n;`);
  }
  steps.push(`do $fingerprint$ begin perform set_config('faolla.self_identity_events_before',
      (select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e),true);end; $fingerprint$;
    set local role service_role;do $checks$ declare q jsonb:=${json(query)};r jsonb;all_rows jsonb:='[]';pages integer:=0;begin
      loop r:=public.faolla_attendance_self_history_v1('${site}','${auth}',q);pages:=pages+1;
        assert jsonb_array_length(r->'items')=case when pages<3 then 50 else 4 end,'identity page length';
        assert r->>'workerId'='${worker}' and r->>'employeeId'='${employee}','current identity';
        all_rows:=all_rows||(r->'items');exit when r->'nextCursor'='null'::jsonb;assert pages<3,'bounded page count';
        q:=q||jsonb_build_object('asOf',r->>'asOf','expectedWorkerId','${worker}','cursorAt',r->'nextCursor'->>'occurredAt','cursorId',r->'nextCursor'->>'id');
      end loop;
      assert pages=3 and (select jsonb_agg(item->>'id' order by ordinal) from jsonb_array_elements(all_rows) with ordinality x(item,ordinal))=${json([...ownIds].reverse())},'exact identity order';
      assert all_rows->49->>'occurredAt'=all_rows->50->>'occurredAt' and all_rows->49->>'id'>all_rows->50->>'id','first microsecond boundary';
      assert all_rows->99->>'occurredAt'=all_rows->100->>'occurredAt' and all_rows->99->>'id'>all_rows->100->>'id','second microsecond boundary';
      assert (select array_agg(k order by k) from jsonb_object_keys(all_rows->0)k)=array['action','breakPaid','id','locationId','locationName','occurredAt','sequence','source','timeZone','workerId','workerName','workerNo'],'history whitelist';
      assert (select array_agg(k order by k) from jsonb_object_keys(r)k)=array['asOf','employeeId','items','nextCursor','siteId','workerId'],'history envelope';
      ${reject(history(query,owner),'attendance_access_denied')}${reject(history(query,auth,foreign),'attendance_access_denied')}
    end; $checks$;reset role;`);
  for(const item of [web,kiosk,ownOpen,afterEnd])steps.push(`${bind(item.worker)}do $checks$ declare r jsonb;begin r:=${session(item.start)};
      assert jsonb_array_length(r->'events')=${item===ownOpen?2:4},'attributable segment length';
      assert r->'events'->0->>'id'='${item.start}','correct start';
      assert r->'events'->0->>'occurredAt'='2026-09-01T12:00:00.000123Z','microseconds unchanged';
      assert (select array_agg(k order by k) from jsonb_object_keys(r->'events'->0)k)=array['action','breakPaid','id','locationId','occurredAt','sequence','source','timeZone'],'session whitelist';
      assert (select array_agg(k order by k) from jsonb_object_keys(r)k)=array['asOf','employeeId','events','siteId','workerId'],'session envelope';
      assert r->'events'->0->>'source'='${item===kiosk?'kiosk':'web'}','source preserved';
    end; $checks$;reset role;`);
  for(const item of [none,other,mixed,nullEnd,mixedOpen,mixedInvalid])steps.push(`${bind(item.worker)}do $checks$ begin ${reject(session(item.start))}
    ${reject(session(id(999999)))}end; $checks$;reset role;`);
  steps.push(`${bind(ownInvalid.worker)}do $checks$ begin ${reject(session(ownInvalid.start),'attendance_session_invalid_records')}end; $checks$;reset role;
    ${bind(bulkWorker)}reset role;savepoint identity_bulk;
    ${insert([{id:id(959002),worker:bulkWorker,operation:id(969002),sequence:2002,action:'clock_out',source:'web',actor:employee,offset:2002}])}
    set local role service_role;do $checks$ declare r jsonb;begin r:=${session(id(950001))};assert jsonb_array_length(r->'events')=2002,'full supported segment';
      assert r->'events'->2001->>'action'='clock_out','no truncation';assert octet_length(r::text)<1048576,'existing client byte cap';end; $checks$;reset role;
    rollback to savepoint identity_bulk;`);
  steps.push(insert([{id:id(959002),worker:bulkWorker,operation:id(969002),sequence:2002,action:'break_start',source:'web',actor:employee,offset:2002},
    {id:id(959003),worker:bulkWorker,operation:id(969003),sequence:2003,action:'break_end',source:'web',actor:employee,offset:2003}])+
    `set local role service_role;do $checks$ begin ${reject(session(id(950001)))}end; $checks$;reset role;savepoint identity_owned_prefix;`);
  for(const actor of [otherEmployee,null])steps.push(insert([{id:id(959004),worker:bulkWorker,operation:id(969004),sequence:2004,action:'clock_out',source:'web',actor,offset:2004}])+
    `set local role service_role;do $checks$ begin ${reject(session(id(950001)))}end; $checks$;reset role;rollback to savepoint identity_owned_prefix;`);
  steps.push(`rollback to savepoint identity_bulk;release savepoint identity_bulk;
    ${bind(otherWorker)}do $checks$ declare r jsonb;begin
      ${reject(history({...query,expectedWorkerId:worker,asOf:'2026-09-02T00:00:00.000000Z',cursorAt:'2026-09-01T12:00:00.000030Z',cursorId:ownIds[60]}),'attendance_worker_changed')}
      r:=${history()};assert r->>'workerId'='${otherWorker}' and r->'items'='[]'::jsonb and r->'nextCursor'='null'::jsonb,'new binding never inherits former actor';
      ${reject(session(ownIds[0]))}${reject(session(otherStart))}
    end; $checks$;reset role;
    update public.merchant_enterprise_employees set status='disabled' where id='${employee}';set local role service_role;
    do $checks$ begin ${reject(history(),'attendance_access_denied')}${reject(session(otherStart),'attendance_access_denied')}end; $checks$;reset role;
    update public.merchant_enterprise_employees set status='active' where id='${employee}';
    update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';set local role service_role;
    do $checks$ begin ${reject(history(),'attendance_access_denied')}${reject(session(otherStart),'attendance_access_denied')}end; $checks$;reset role;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    ${['anon','authenticated'].map(dbRole=>`set local role ${dbRole};do $checks$ begin
      begin perform ${history()};raise exception 'unexpected history ACL';exception when insufficient_privilege then null;end;
      begin perform ${session(otherStart)};raise exception 'unexpected session ACL';exception when insufficient_privilege then null;end;
    end; $checks$;reset role;`).join('\n')}
    do $fingerprint$ begin assert current_setting('faolla.self_identity_events_before')=
      (select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e),'identity checks did not rewrite raw facts';end; $fingerprint$;
    select ${json(labels)};rollback;`);
  assert(steps.length<=100,'self_identity_native_bounded_steps');
  const output=await querySteps(steps);assert.deepEqual(JSON.parse(output),labels);
  assert.equal(exec(baselineSql),baseline,'self_identity_native_restores_baseline');labels.forEach(pass);return labels;
}
