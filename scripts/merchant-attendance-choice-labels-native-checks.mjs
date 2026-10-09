import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// A single transaction, always rolled back. Can run against an ownership-checked
// existing synthetic cluster; it creates no new database or persistent fixture.
export function checkAttendanceChoiceLabelsNative({root,query,pass}) {
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990007", foreign="99990008", owner=id(9700), role=id(9701);
  const migration=readFileSync(path.join(root,"scripts/supabase-migrations/202609290067_merchant_attendance_scope_choices.sql"),"utf8")
    .replace(/^begin;$/m,"").replace(/^commit;$/m,"").replace("create function public.faolla_attendance_choices_v1","create or replace function public.faolla_attendance_choices_v1");
  const labels=["exact lookup retains ordinary 25+1 pagination", "exact manager lookup includes selected off-page inactive staff",
    "exact worker lookup retains terminal-only and inactive identities", "exact location lookup hides foreign and unknown IDs identically",
    "exact lookup accepts 25 but not 26 IDs", "exact lookup rejects duplicate, empty, null, malformed and mixed-mode inputs",
    "exact lookup does not let managers enumerate names", "exact lookup remains current-owner checked across tenants",
    "exact lookup remains unavailable to anon and authenticated", "exact lookup returns only permitted metadata"];
  const invoke=(query,auth=owner)=>`public.faolla_attendance_choices_v1('${site}','${auth}','${JSON.stringify(query)}'::jsonb)`;
  const invalid=[{kind:"workers",ids:[]},{kind:"workers",ids:null},{kind:"workers",ids:"*"},{kind:"workers",ids:[null]},
    {kind:"workers",ids:[{}]},{kind:"workers",ids:["*"]},{kind:"workers",ids:[id(9801),id(9801)]},
    {kind:"workers",ids:[id(9801)],search:""},{kind:"workers",ids:[id(9801)],cursor:null},
    {kind:"workers",ids:[id(9801)],isOwner:true},{kind:"all",ids:[id(9801)]},
    {kind:"managers",ids:Array.from({length:26},(_,n)=>id(9710+n))}];
  const output=query(`begin; set local lock_timeout='3s'; set local statement_timeout='10s';
    ${migration}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${id(9709)}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC'),('${foreign}','UTC');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
      values('${role}','${site}','Synthetic labels role',array['enterprise.view','attendance.records.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      select ('00000000-0000-4000-8000-'||lpad((9710+n)::text,12,'0'))::uuid,'${site}',
        ('00000000-0000-4000-8000-'||lpad((9910+n)::text,12,'0'))::uuid,'labels'||n||'@example.test',
        'Synthetic labels '||n,'${role}',case when n=25 then 'disabled' else 'active' end from generate_series(0,25) n;
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
      values('${id(9901)}','${site}','Historical label place','UTC',false),('${id(9902)}','${foreign}','Foreign label place','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name,active)
      values('${id(9801)}','${site}','LABEL-A','Synthetic active',true),('${id(9802)}','${site}','LABEL-B','Synthetic inactive',false),
        ('${id(9803)}','${foreign}','LABEL-C','Synthetic foreign',true);
    set local role service_role;
    do $checks$ declare r jsonb; begin
      r:=${invoke({kind:"managers",search:"",cursor:null})};
      assert jsonb_array_length(r->'items')=25 and r->>'nextCursor'='${id(9734)}','ordinary first page';
      r:=${invoke({kind:"managers",search:"",cursor:id(9734)})};
      assert jsonb_array_length(r->'items')=1 and r->'nextCursor'='null'::jsonb,'ordinary last page';
      r:=${invoke({kind:"managers",ids:[id(9735),id(9710)]})};
      assert jsonb_array_length(r->'items')=2 and r->'items'->0->>'id'='${id(9710)}'
        and r->'items'->1->'eligible'='false'::jsonb and r->'nextCursor'='null'::jsonb,'manager exact lookup';
      r:=${invoke({kind:"workers",ids:[id(9801),id(9802),id(9803)]})};
      assert jsonb_array_length(r->'items')=2 and r->'items'->1->'eligible'='false'::jsonb,'worker exact lookup';
      r:=${invoke({kind:"locations",ids:[id(9901),id(9902),id(9999)]})};
      assert jsonb_array_length(r->'items')=1 and r->'items'->0->>'id'='${id(9901)}','location tenant lookup';
      assert ${invoke({kind:"locations",ids:[id(9902)]})}->'items'='[]'::jsonb
        and ${invoke({kind:"locations",ids:[id(9999)]})}->'items'='[]'::jsonb,'unknown and foreign omission';
      r:=${invoke({kind:"managers",ids:Array.from({length:25},(_,n)=>id(9710+n))})};
      assert jsonb_array_length(r->'items')=25 and r->'nextCursor'='null'::jsonb,'full exact batch';
      ${invalid.map(q=>`begin perform ${invoke(q)}; raise exception 'unexpected exact lookup acceptance';
        exception when sqlstate 'P0001' then if sqlerrm<>'attendance_invalid_request' then raise; end if; end;`).join("\n")}
      ${[id(9910),id(9709)].map(auth=>`begin perform ${invoke({kind:"workers",ids:[id(9801)]},auth)};
        raise exception 'unexpected owner access'; exception when sqlstate 'P0001' then
        if sqlerrm<>'attendance_access_denied' then raise; end if; end;`).join("\n")}
      r:=${invoke({kind:"workers",ids:[id(9801)]})};
      assert (select array_agg(k order by k) from jsonb_object_keys(r->'items'->0) k)=array['detail','eligible','id','label'],'metadata whitelist';
    end $checks$;
    ${["anon","authenticated"].map(dbRole=>`set local role ${dbRole}; do $checks$ begin
      perform ${invoke({kind:"workers",ids:[id(9801)]})}; raise exception 'unexpected RPC execution';
      exception when insufficient_privilege then null; end $checks$;`).join("\n")}
    reset role; select '${JSON.stringify(labels)}'::jsonb; rollback;`);
  assert.deepEqual(JSON.parse(output),labels); labels.forEach(pass);
}
