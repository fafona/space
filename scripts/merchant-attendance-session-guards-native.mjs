import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";

// Focused recheck after predecessor hardening; does not repeat the large fixture.
async function check({root,query,querySteps,pass}){
  await assert.rejects(querySteps([]),/attendance_reuse_bounded_steps_required/);
  await assert.rejects(querySteps(["begin;insert into public.merchants(id) values('99990007');","select 1/0;"]),/attendance_reuse_step_closed/);
  assert.equal(query("select count(*) from public.merchants where id='99990007';"),"0");
  pass("segmented local fixture failures disconnect and roll back; empty step lists are rejected");
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const migration=readFileSync(path.join(root,"scripts/supabase-migrations/202609300070_merchant_attendance_self_session.sql"),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const call=n=>`public.faolla_attendance_self_session_v1('99990007','${id(51001)}','${id(52000+n)}')`;
  const reject=n=>`begin perform ${call(n)};raise exception 'unexpected predecessor acceptance';exception when sqlstate 'P0001' then
    if sqlerrm<>'attendance_session_invalid_records' then raise;end if;end;`;
  const output=await querySteps([`begin;${migration}
    insert into public.merchants(id) values('99990007');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled) values('99990007','UTC',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(51002)}','99990007','Synthetic predecessor view',array['enterprise.view','attendance.self.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${id(51003)}','99990007','${id(51001)}','predecessor@example.test','Synthetic predecessor','${id(51002)}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active)
      values('${id(51004)}','99990007','${id(51003)}','PRE-A','Synthetic predecessor',false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${id(51005)}','99990007','Synthetic predecessor location','UTC',false);
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at)
      select ('00000000-0000-4000-8000-'||lpad((52000+n)::text,12,'0'))::uuid,'99990007','${id(51004)}','${id(51005)}',
        ('00000000-0000-4000-8000-'||lpad((53000+n)::text,12,'0'))::uuid,n,
        case when n in (2,5) then 'clock_out' else 'clock_in' end,'web','UTC','2026-09-01T00:00:00Z'
      from unnest(array[1,2,3,4,5,7])n;
    set local role service_role;`,
    `do $checks$ declare r jsonb;begin
      r:=${call(1)};assert jsonb_array_length(r->'events')=2,'sequence one';
      perform ${call(3)};${reject(4)}${reject(7)}
    end $checks$;reset role;select 'predecessor checks passed';rollback;`]);
  assert.equal(output,"predecessor checks passed");
  pass("first clock-in and immediately previous clock-out allow segment lookup");
  pass("repeated clock-in without prior clock-out refuses a fabricated clean session");
  pass("missing previous sequence refuses a fabricated clean session");
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(error=>{console.error(error);process.exitCode=1;});
