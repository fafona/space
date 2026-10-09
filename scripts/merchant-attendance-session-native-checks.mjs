import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
export async function checkAttendanceSessionNative({root,querySteps,pass}){
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990007",foreign="99990008",owner=id(30001),auth=id(30002),foreignAuth=id(30003),bulkAuth=id(30004);
  const role=id(30101),foreignRole=id(30102),employee=id(30201),foreignEmployee=id(30202),bulkEmployee=id(30203);
  const worker=id(30301),foreignWorker=id(30302),bulkWorker=id(30303),unboundWorker=id(30304),place=id(30401),foreignPlace=id(30402);
  const call=(start=id(31001),who=auth,tenant=site)=>`public.faolla_attendance_self_session_v1('${tenant}','${who}','${start}')`;
  const reject=(start,code="attendance_session_not_found",who=auth,tenant=site)=>`begin perform ${call(start,who,tenant)};
    raise exception 'unexpected session acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const denied=reject(id(31001),"attendance_access_denied");
  const migration=readFileSync(path.join(root,"scripts/supabase-migrations/202609300070_merchant_attendance_self_session.sql"),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const labels=["self-owned clock-in reads exactly one segment, not later shifts",
    "open shift returns only recorded facts with no synthetic clock-out",
    "same-instant sequence order and microseconds are preserved",
    "response field whitelist excludes auth, operation and evidence data",
    "disabled punching, worker and location still allow authorized historical reading",
    "foreign, other-worker, non-clock-in and missing IDs all return not-found",
    "owner without employee identity and cross-tenant callers are denied",
    "employee, role and permission revocation are rechecked on every read",
    "worker rebinding cannot continue an old worker session",
    "2002-fact 1000-break segment is accepted; 2003-fact segment fails instead of truncating",
    "anon and authenticated database roles cannot invoke session RPC",
    "session reads leave original events unchanged"];
  // Keep each synthetic setup statement bounded; retain the actual zone checks.
  const bulkInsert=Array.from({length:41},(_,batch)=>{
    const from=batch*50+1,to=Math.min(2001,(batch+1)*50);
    return `insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,break_paid,occurred_at)
      select ('00000000-0000-4000-8000-'||lpad((35000+n)::text,12,'0'))::uuid,'${site}','${bulkWorker}','${place}',
        ('00000000-0000-4000-8000-'||lpad((45000+n)::text,12,'0'))::uuid,n,
        case when n=1 then 'clock_in' when n%2=0 then 'break_start' else 'break_end' end,
        'web','UTC',case when n%2=0 then false else null end,'2026-09-01T08:00:00Z' from generate_series(${from},${to})n;`;
  }).join("\n-- attendance_step --\n");
  const script=`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${migration}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${id(30005)}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled) values('${site}','UTC',false),('${foreign}','UTC',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
      ('${role}','${site}','Synthetic session reader',array['enterprise.view','attendance.self.view']),
      ('${foreignRole}','${foreign}','Synthetic foreign reader',array['enterprise.view','attendance.self.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${employee}','${site}','${auth}','session@example.test','Synthetic self','${role}','active'),
      ('${foreignEmployee}','${foreign}','${foreignAuth}','session-foreign@example.test','Synthetic foreign','${foreignRole}','active'),
      ('${bulkEmployee}','${site}','${bulkAuth}','session-limit@example.test','Synthetic limit','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${place}','${site}','Synthetic location','UTC',false),('${foreignPlace}','${foreign}','Foreign location','UTC',false);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active) values
      ('${worker}','${site}','${employee}','SS-A','Synthetic self',false),('${foreignWorker}','${foreign}','${foreignEmployee}','SS-B','Synthetic foreign',false),
      ('${bulkWorker}','${site}','${bulkEmployee}','SS-C','Synthetic limit',false),('${unboundWorker}','${site}',null,'SS-D','Synthetic unbound',false);
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,break_paid,occurred_at) values
      ('${id(31001)}','${site}','${worker}','${place}','${id(32001)}',1,'clock_in','web','UTC',null,'2026-09-01T08:00:00.000001Z'),
      ('${id(31002)}','${site}','${worker}','${place}','${id(32002)}',2,'break_start','web','UTC',true,'2026-09-01T08:00:00.000001Z'),
      ('${id(31003)}','${site}','${worker}','${place}','${id(32003)}',3,'break_end','web','UTC',null,'2026-09-01T08:30:00.000002Z'),
      ('${id(31004)}','${site}','${worker}','${place}','${id(32004)}',4,'clock_out','kiosk','UTC',null,'2026-09-01T16:00:00.000003Z'),
      ('${id(31005)}','${site}','${worker}','${place}','${id(32005)}',5,'clock_in','web','UTC',null,'2026-09-02T08:00:00.000000Z'),
      ('${id(31006)}','${site}','${worker}','${place}','${id(32006)}',6,'break_start','web','UTC',false,'2026-09-02T08:30:00.000000Z'),
      ('${id(31007)}','${site}','${unboundWorker}','${place}','${id(32007)}',1,'clock_in','web','UTC',null,'2026-09-01T08:00:00.000000Z'),
      ('${id(31008)}','${foreign}','${foreignWorker}','${foreignPlace}','${id(32008)}',1,'clock_in','web','UTC',null,'2026-09-01T08:00:00.000000Z');
    -- attendance_step --
    ${bulkInsert}
    -- attendance_step --
    create temporary table session_fingerprint as select md5(jsonb_agg(to_jsonb(t) order by id)::text) value from public.merchant_attendance_events t;
    set local role service_role;do $checks$ declare r jsonb;begin
      r:=${call()};assert jsonb_array_length(r->'events')=4,'one closed segment';
      assert r->>'workerId'='${worker}' and r->>'employeeId'='${employee}' and r->>'siteId'='${site}','self identity';
      assert r->'events'->0->>'id'='${id(31001)}' and r->'events'->1->>'id'='${id(31002)}','same-time sequence';
      assert r->'events'->0->>'occurredAt'='2026-09-01T08:00:00.000001Z' and r->'events'->3->>'occurredAt'='2026-09-01T16:00:00.000003Z','microseconds';
      assert (select array_agg(k order by k) from jsonb_object_keys(r->'events'->0)k)=array['action','breakPaid','id','locationId','occurredAt','sequence','source','timeZone'],'whitelisted event';
      assert (select array_agg(k order by k) from jsonb_object_keys(r)k)=array['asOf','employeeId','events','siteId','workerId'],'whitelisted envelope';
      r:=${call(id(31005))};assert jsonb_array_length(r->'events')=2 and r->'events'->1->>'action'='break_start','open rest not fabricated';
      ${[id(31002),id(31007),id(31008),id(39999)].map(start=>reject(start)).join("\n")}
      ${[owner,foreignAuth,id(39998)].map(who=>reject(id(31001),"attendance_access_denied",who)).join("\n")}
      ${reject(id(31008),"attendance_access_denied",auth,foreign)}
    end $checks$;reset role;
    savepoint bulk_boundary;
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,break_paid,occurred_at)
      values('${id(37002)}','${site}','${bulkWorker}','${place}','${id(47002)}',2002,'clock_out','web','UTC',null,'2026-09-01T08:00:00Z');
    set local role service_role;do $checks$ declare r jsonb;begin
      r:=${call(id(35001),bulkAuth)};assert jsonb_array_length(r->'events')=2002 and r->'events'->2001->>'action'='clock_out','maximum bounded shift';
      assert octet_length(r::text)<1048576,'response maximum within client cap';
    end $checks$;reset role;
    rollback to savepoint bulk_boundary;
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,break_paid,occurred_at) values
      ('${id(37002)}','${site}','${bulkWorker}','${place}','${id(47002)}',2002,'break_start','web','UTC',false,'2026-09-01T08:00:00Z'),
      ('${id(37003)}','${site}','${bulkWorker}','${place}','${id(47003)}',2003,'break_end','web','UTC',null,'2026-09-01T08:00:00Z');
    set local role service_role;do $checks$ begin ${reject(id(35001),"attendance_session_too_large",bulkAuth)} end $checks$;reset role;
    rollback to savepoint bulk_boundary;release savepoint bulk_boundary;
    update public.merchant_enterprise_employees set status='disabled' where id='${employee}';
    set local role service_role;do $checks$ begin ${denied} end $checks$;reset role;
    update public.merchant_enterprise_employees set status='active' where id='${employee}';
    update public.merchant_enterprise_roles set status='archived' where id='${role}';
    set local role service_role;do $checks$ begin ${denied} end $checks$;reset role;
    update public.merchant_enterprise_roles set status='active',permissions=array['enterprise.view','attendance.records.view'] where id='${role}';
    set local role service_role;do $checks$ begin ${denied} end $checks$;reset role;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    update public.merchant_attendance_workers set employee_id=null where id='${worker}';
    update public.merchant_attendance_workers set employee_id='${employee}' where id='${unboundWorker}';
    set local role service_role;do $checks$ begin ${reject(id(31001))} perform ${call(id(31007))};end $checks$;reset role;
    ${["anon","authenticated"].map(dbRole=>`set local role ${dbRole};do $checks$ begin perform ${call(id(31007))};
      raise exception 'unexpected session execution';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    do $checks$ begin assert (select value from session_fingerprint)=(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.merchant_attendance_events t),'original events unchanged';end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`;
  // Only the explicit reuse runner supports this large, rollback-only fixture.
  assert.equal(typeof querySteps,"function","attendance_session_requires_transaction_steps");
  const output=await querySteps(script.split(/\s*-- attendance_step --\s*/));
  assert.deepEqual(JSON.parse(output),labels);labels.forEach(pass);
}
