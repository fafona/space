import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export function checkAttendanceChoicesNative({root,query,sql,pass,applyMigration=true,site="99990005"}) {
  assert.match(site,/^9999000[56]$/);
  const before=query("select count(*) from public.merchant_enterprise_employees;");
  if(applyMigration) query(readFileSync(path.join(root,"scripts/supabase-migrations/202609290067_merchant_attendance_scope_choices.sql"),"utf8"));
  assert.equal(query("select count(*) from public.merchant_enterprise_employees;"),before);
  pass("choices migration performs no employee or attendance writes");
  const owner=id(9500),role=id(9501);
  query(`insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic choices role',array['enterprise.view','attendance.records.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      select ('00000000-0000-4000-8000-'||lpad((9100+n)::text,12,'0'))::uuid,'${site}',
        ('00000000-0000-4000-8000-'||lpad((9200+n)::text,12,'0'))::uuid,
        'choice'||n||'@example.test','Candidate '||n,'${role}',case when n=26 then 'disabled' else 'active' end from generate_series(1,26) n;
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${id(9300)}','${site}','Historical place','UTC',false);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      ('${id(9400)}','${site}','${id(9101)}','C1','Enrolled manager',true,'${id(9300)}'),
      ('${id(9401)}','${site}',null,'C2','Inactive terminal only',false,'${id(9300)}');`);
  const call=(patch={},auth=owner,dbRole="service_role")=>`set role ${dbRole}; select public.faolla_attendance_choices_v1('${site}','${auth}','${JSON.stringify({kind:"managers",search:"",cursor:null,...patch}).replaceAll("'","''")}'::jsonb);`;
  const get=patch=>JSON.parse(query(call(patch)));
  const first=get(),second=get({cursor:first.nextCursor});
  assert.equal(first.items.length,25);assert.equal(second.items.length,1);assert.equal(first.nextCursor,id(9125));assert.equal(second.nextCursor,null);
  assert.ok(first.items.some(x=>x.id===id(9101)));assert.equal(second.items[0].eligible,false);
  assert.equal(get({cursor:id(9101)}).nextCursor,null);
  pass("owner manager selectors include enrolled and inactive staff, keyset 25+1 and exact-25 end");
  assert.equal(get({search:"Candidate 26"}).items[0].id,id(9126));assert.equal(get({search:"%"}).items.length,0);
  assert.ok(get({kind:"workers"}).items.some(x=>x.id===id(9401)&&x.eligible===false));
  assert.equal(get({kind:"locations"}).items[0].eligible,false);
  assert.ok(first.items.every(x=>Object.keys(x).sort().join() === "detail,eligible,id,label"));
  pass("candidate search literal, historical targets included, no email or auth fields");
  for(const roleName of ["anon","authenticated"]) {assert.match(sql(call({},owner,roleName)).error,/42501/);pass(`${roleName} cannot invoke owner candidate RPC`);}
  assert.match(sql(call({},id(2001))).error,/attendance_access_denied/);pass("manager cannot enumerate global candidates");
  for(const patch of [{kind:"all"},{cursor:"*"},{search:"x".repeat(81)},{isOwner:true}]) assert.match(sql(call(patch)).error,/attendance_invalid_request/);
  pass("candidate SQL rejects broadening flags, malformed cursors and unbounded search");
  query(`update public.merchant_enterprise_roles set status='archived' where id='${role}';`);
  assert.ok(get().items.every(x=>x.eligible===false));pass("candidate eligibility reflects role withdrawal without hiding revocable employees");
}
