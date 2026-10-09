import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// Synthetic fixtures and the draft migration are rolled back together. This is
// not an online migration and never rewrites existing raw events.
export function checkAttendanceHistoryNative({root,query,pass}) {
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990007",foreign="99990008",employee=id(11001),otherEmployee=id(11002),role=id(11003),foreignRole=id(11004);
  const auth=id(12001),otherAuth=id(12002),worker=id(13001),otherWorker=id(13002),localOtherWorker=id(13003),place=id(13004),foreignPlace=id(13005);
  const base={fromAt:"2026-09-01T00:00:00.000000Z",toAt:"2026-09-02T00:00:00.000000Z",expectedWorkerId:null,asOf:null,cursorAt:null,cursorId:null};
  const call=(q=base,who=auth,tenant=site)=>`public.faolla_attendance_self_history_v1('${tenant}','${who}','${JSON.stringify(q)}'::jsonb)`;
  const reject=(q,code="attendance_invalid_request",who=auth,tenant=site)=>`begin perform ${call(q,who,tenant)};
    raise exception 'unexpected history acceptance'; exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise; end if; end;`;
  const denied=reject(base,"attendance_access_denied");
  const migration=readFileSync(path.join(root,"scripts/supabase-migrations/202609300068_merchant_attendance_self_history.sql"),"utf8")
    .replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const labels=["self history returns only the currently bound worker without manager or clock permission",
    "104 facts page as 50, 50 and 4 with no gaps or duplicates", "microsecond timestamps and equal-time UUID ties survive pagination",
    "history retains disabled worker and location, with new punches paused", "from is inclusive and to is exclusive",
    "exact 31-day boundary passes and longer or invalid timestamps fail", "forged worker, employee and role overrides cannot change the target",
    "cursor continuation requires the current worker pin and bounded asOf", "other tenant, stranger and owner without employee binding are denied",
    "employee and role revocation are rechecked on reads", "changed worker binding refuses an old cursor instead of switching people",
    "response metadata excludes auth identity, operation IDs and evidence", "anon and authenticated cannot invoke the self-history RPC"];
  const invalid=[{...base,workerId:otherWorker},{...base,employeeId:otherEmployee},{...base,access:"owner"},{...base,limit:1000},
    {...base,expectedWorkerId:"*"},{...base,toAt:"2026-10-02T00:00:00.000001Z"},{...base,fromAt:"2026-02-30T00:00:00.000000Z"},
    {...base,toAt:base.fromAt},{...base,asOf:"2099-09-01T00:00:00.000000Z"},
    {...base,cursorAt:"2026-09-01T12:00:00.000001Z",cursorId:id(14001)},
    {...base,expectedWorkerId:worker,cursorAt:"2026-09-01T12:00:00.000001Z",cursorId:id(14001)},
    {...base,expectedWorkerId:worker,asOf:"2026-09-02T00:00:00.000000Z",cursorAt:"2026-09-02T00:00:00.000000Z",cursorId:id(14001)}];
  const output=query(`begin; set local lock_timeout='3s'; set local statement_timeout='10s';
    ${migration}
    insert into public.merchants(id,user_id) values('${site}','${id(12009)}'),('${foreign}','${id(12010)}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled) values('${site}','UTC',false),('${foreign}','UTC',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
      ('${role}','${site}','History self view',array['enterprise.view','attendance.self.view']),
      ('${foreignRole}','${foreign}','History foreign view',array['enterprise.view','attendance.self.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${employee}','${site}','${auth}','history-a@example.test','History A','${role}','active'),
      ('${otherEmployee}','${foreign}','${otherAuth}','history-b@example.test','History B','${foreignRole}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
      ('${place}','${site}','Historical disabled location','UTC',false),('${foreignPlace}','${foreign}','Foreign location','UTC',false);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active) values
      ('${worker}','${site}','${employee}','H-A','History A',false),('${otherWorker}','${foreign}','${otherEmployee}','H-B','History B',false),
      ('${localOtherWorker}','${site}',null,'H-C','History terminal colleague',false);
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at)
      select ('00000000-0000-4000-8000-'||lpad((14000+n)::text,12,'0'))::uuid,'${site}','${worker}','${place}',
        ('00000000-0000-4000-8000-'||lpad((15000+n)::text,12,'0'))::uuid,n,
        case when n%2=1 then 'clock_in' else 'clock_out' end,case when n%2=1 then 'web' else 'kiosk' end,'UTC',
        '2026-09-01T12:00:00Z'::timestamptz+(n/2)*interval '1 microsecond' from generate_series(1,104)n;
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at) values
      ('${id(14105)}','${site}','${localOtherWorker}','${place}','${id(15105)}',1,'clock_in','web','UTC','2026-09-01T12:00:00Z'),
      ('${id(14106)}','${foreign}','${otherWorker}','${foreignPlace}','${id(15106)}',1,'clock_in','web','UTC','2026-09-01T12:00:00Z');
    set local role service_role;
    do $checks$ declare r jsonb; q jsonb:='${JSON.stringify(base)}'; all_rows jsonb:='[]'; pages integer:=0; begin
      loop
        r:=public.faolla_attendance_self_history_v1('${site}','${auth}',q); pages:=pages+1;
        assert r->>'workerId'='${worker}' and r->>'employeeId'='${employee}' and r->>'siteId'='${site}','bound identity';
        assert jsonb_array_length(r->'items')=case when pages<3 then 50 else 4 end,'page size';
        all_rows:=all_rows||(r->'items');
        exit when r->'nextCursor'='null'::jsonb;
        assert pages<3,'bounded pagination';
        q:=q||jsonb_build_object('asOf',r->>'asOf','expectedWorkerId','${worker}','cursorAt',r->'nextCursor'->>'occurredAt','cursorId',r->'nextCursor'->>'id');
      end loop;
      assert pages=3 and jsonb_array_length(all_rows)=104,'all three pages';
      assert (select count(distinct j->>'id') from jsonb_array_elements(all_rows)j)=104,'unique facts';
      assert not exists(select 1 from jsonb_array_elements(all_rows)j where j->>'workerId'<>'${worker}'),'self isolation';
      assert all_rows->0->>'occurredAt'='2026-09-01T12:00:00.000052Z','microsecond preserved';
      assert all_rows->1->>'id'='${id(14103)}' and all_rows->2->>'id'='${id(14102)}','UUID time tie';
      assert (select array_agg(k order by k) from jsonb_object_keys(all_rows->0)k)=
        array['action','breakPaid','id','locationId','locationName','occurredAt','sequence','source','timeZone','workerId','workerName','workerNo'],'event whitelist';
      assert (select array_agg(k order by k) from jsonb_object_keys(r)k)=array['asOf','employeeId','items','nextCursor','siteId','workerId'],'envelope whitelist';
      r:=${call({...base,fromAt:"2026-09-01T12:00:00.000000Z",toAt:"2026-09-01T12:00:00.000001Z"})};
      assert jsonb_array_length(r->'items')=1 and r->'items'->0->>'id'='${id(14001)}','half-open range';
      perform ${call({...base,toAt:"2026-10-02T00:00:00.000000Z"})};
      ${invalid.map(q=>reject(q)).join("\n")}
      ${[otherWorker,localOtherWorker].map(w=>reject({...base,expectedWorkerId:w},"attendance_worker_changed")).join("\n")}
      ${[otherAuth,id(12009),id(19999)].map(who=>reject(base,"attendance_access_denied",who)).join("\n")}
      ${reject(base,"attendance_access_denied",auth,foreign)}
    end $checks$;
    reset role;
    update public.merchant_enterprise_employees set status='disabled' where id='${employee}';
    set local role service_role; do $checks$ begin ${denied} end $checks$; reset role;
    update public.merchant_enterprise_employees set status='active' where id='${employee}';
    update public.merchant_enterprise_roles set status='archived' where id='${role}';
    set local role service_role; do $checks$ begin ${denied} end $checks$; reset role;
    update public.merchant_enterprise_roles set status='active',permissions=array['enterprise.view','attendance.records.view'] where id='${role}';
    set local role service_role; do $checks$ begin ${denied} end $checks$; reset role;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    update public.merchant_attendance_workers set employee_id=null where id='${worker}';
    set local role service_role; do $checks$ begin ${denied} end $checks$; reset role;
    update public.merchant_attendance_workers set employee_id='${employee}' where id='${localOtherWorker}';
    set local role service_role; do $checks$ declare r jsonb; begin
      ${reject({...base,expectedWorkerId:worker,asOf:"2026-09-02T00:00:00.000000Z",cursorAt:"2026-09-01T12:00:00.000020Z",cursorId:id(14040)},"attendance_worker_changed")}
      r:=${call()}; assert r->>'workerId'='${localOtherWorker}' and jsonb_array_length(r->'items')=1,'explicit fresh query reads new current binding';
    end $checks$; reset role;
    ${["anon","authenticated"].map(dbRole=>`set local role ${dbRole}; do $checks$ begin perform ${call()};
      raise exception 'unexpected history RPC execution'; exception when insufficient_privilege then null; end $checks$; reset role;`).join("\n")}
    select '${JSON.stringify(labels)}'::jsonb; rollback;`);
  assert.deepEqual(JSON.parse(output),labels); labels.forEach(pass);
}
