import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export async function checkAttendanceAdminNative({ root, query, sql, pass, connection }) {
  query(readFileSync(path.join(root,"scripts/supabase-migrations/202609290064_merchant_attendance_owner_configuration.sql"),"utf8"));
  query(`insert into public.merchants(id,user_id) values('99990003','${id(500)}');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(501)}','99990003','Synthetic attendance',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
    values('${id(502)}','99990003','${id(503)}','attendance-config@example.test','Synthetic config','${id(501)}','active');`);
  const snapshot = () => query(`select jsonb_build_object('settings',(select jsonb_agg(s) from public.merchant_attendance_settings s),
    'locations',(select jsonb_agg(l) from public.merchant_attendance_locations l),'workers',(select jsonb_agg(w) from public.merchant_attendance_workers w),
    'periods',(select jsonb_agg(p) from public.merchant_attendance_employment_periods p),'events',(select jsonb_agg(e) from public.merchant_attendance_events e),
    'operations',(select jsonb_agg(o) from public.merchant_attendance_config_operations o));`);
  const json = (v) => v === null ? "null" : `'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
  const call = (command = null, { auth = id(500), site = "99990003", view = "settings", cursor = null, search = "", receipt = null, role = "service_role" } = {}) =>
    `set role ${role}; select public.faolla_attendance_admin_v1('${site}','${auth}',${json({view,cursor,search})},${json(command)},${receipt ? `'${receipt}'::uuid` : "null"});`;
  const result = (command, options) => JSON.parse(query(call(command, options)));
  let op = 1000;
  const cmd = (kind, values, expectedVersion = result(null).version) => ({ kind, values, operationId: id(++op), expectedVersion });
  function rejects(label, statement, error) {
    const before = snapshot(); const response = sql(statement);
    assert.notEqual(response.status,0,label); assert.match(response.error,new RegExp(error),label); assert.equal(snapshot(),before,label); pass(label);
  }
  const settings = { timeZone:"Europe/Madrid",enabled:false,webClockEnabled:false,webBreakPaid:false };
  const location = { id:id(510),name:"Synthetic main",timeZone:"Europe/Madrid",active:true };
  const worker = { id:id(520),employeeId:id(502),workerNo:"CFG1",displayName:"Synthetic config",locationId:id(510),active:true,startsOn:"2000-01-01" };
  assert.equal(result(null).version,0); assert.equal(result(null).settings,null);
  assert.equal(query("select count(*) from public.merchant_attendance_settings where merchant_id='99990003';"),"0");
  pass("owner config GET never bootstraps or writes");
  for (const role of ["anon","authenticated"]) rejects(`${role} cannot invoke owner config`,call(null,{role}),"42501");
  rejects("employee permission cannot become attendance owner",call(null,{auth:id(503)}),"attendance_access_denied");
  rejects("different merchant owner cannot configure tenant",call(null,{site:"99990001"}),"attendance_access_denied");
  rejects("uninitialized location denied",call(cmd("location",location)),"attendance_settings_required");
  const first = cmd("settings",settings,0); const initialized = result(first);
  assert.equal(initialized.version,1); assert.equal(initialized.receipt.version,1); assert.deepEqual(initialized.settings,settings);
  pass("explicit owner init defaults off and records immutable receipt");
  assert.deepEqual(result(first).receipt,initialized.receipt);
  assert.equal(query("select count(*) from public.merchant_attendance_config_operations;"),"1");
  pass("same operation replay does not create duplicate audit or version");
  rejects("changed intent with same operation denied",call({...first,values:{...settings,enabled:true}}),"attendance_operation_conflict");
  rejects("second initialization cannot overwrite settings",call(cmd("settings",settings,0)),"attendance_version_conflict");
  rejects("extra config fields denied",call({...cmd("settings",settings),actorId:id(500)}),"attendance_invalid_request");
  for (const values of [{...settings,enabled:"true"},{...settings,timeZone:"Europe/Fake"},{...settings,webClockEnabled:null}])
    rejects("invalid settings do not write",call(cmd("settings",values)),"attendance_invalid");
  result(cmd("location",location));
  result(cmd("worker",worker));
  assert.equal(result(null,{view:"workers"}).items[0].employeeId,worker.employeeId);
  assert.equal(result(null,{view:"employees"}).items.length,0);
  pass("explicit worker enrollment binds existing employee with one employment interval");
  rejects("cannot rebind worker identity",call(cmd("worker",{...worker,employeeId:id(1)})),"attendance_employee_invalid");
  rejects("cannot silently change employment date",call(cmd("worker",{...worker,startsOn:"2001-01-01"})),"attendance_history_protected");
  rejects("cannot attach other tenant location",call(cmd("worker",{...worker,locationId:id(12)})),"attendance_location_denied");
  rejects("cannot duplicate employee assignment",call(cmd("worker",{...worker,id:id(521),workerNo:"CFG2"})),"attendance_duplicate_worker");
  rejects("cannot deactivate assigned location",call(cmd("location",{...location,active:false})),"attendance_location_in_use");
  const enabled = {...settings,enabled:true,webClockEnabled:true}; result(cmd("settings",enabled));
  const punch = (operationId,action,expectedSequence) => `set role service_role; select public.faolla_attendance_self_v1('99990003','${id(503)}',${json({expectedWorkerId:worker.id,operationId,locationId:location.id,action,expectedSequence})});`;
  query(punch(id(600),"clock_in",0));
  rejects("cannot disable attendance during open work",call(cmd("settings",{...enabled,enabled:false})),"attendance_open_sessions");
  rejects("cannot disable web during open work",call(cmd("settings",{...enabled,webClockEnabled:false})),"attendance_open_sessions");
  rejects("cannot change break policy during open work",call(cmd("settings",{...enabled,webBreakPaid:true})),"attendance_open_sessions");
  rejects("cannot disable worker during open work",call(cmd("worker",{...worker,active:false})),"attendance_open_sessions");
  rejects("cannot alter historical enterprise zone",call(cmd("settings",{...enabled,timeZone:"UTC"})),"attendance_history_protected");
  rejects("cannot alter historical location zone",call(cmd("location",{...location,timeZone:"UTC"})),"attendance_history_protected");
  result(cmd("worker",{...worker,displayName:"Renamed synthetic"}));
  assert.equal(query(`select count(*) from public.merchant_attendance_events where worker_id='${worker.id}';`),"1");
  pass("metadata edit does not alter immutable punch facts");
  query(punch(id(601),"clock_out",1));
  const stale = cmd("worker",worker); result(cmd("location",{...location,name:"Updated main"}));
  rejects("stale form cannot overwrite newer configuration",call(stale),"attendance_version_conflict");
  assert.deepEqual(result(null,{receipt:first.operationId}).receipt,initialized.receipt);
  assert.equal(result(null,{receipt:id(9999)}).receipt,null);
  pass("historical config receipt returned separately from current version");
  rejects("service role cannot edit config tables directly","set role service_role; update public.merchant_attendance_settings set enabled=false;","42501");
  rejects("service role cannot insert fake audit","set role service_role; insert into public.merchant_attendance_config_operations select * from public.merchant_attendance_config_operations;","42501");
  rejects("config audit immutable even for table owner","update public.merchant_attendance_config_operations set after_value='{}';","42501");
  rejects("config audit cannot truncate","truncate public.merchant_attendance_config_operations;","42501");
  rejects("config audit anonymous read denied","set role anon; select * from public.merchant_attendance_config_operations;","42501");
  assert.equal(query("begin; grant select on public.merchant_attendance_config_operations to authenticated; set role authenticated; select count(*) from public.merchant_attendance_config_operations; rollback;"),"0");
  pass("config audit RLS remains deny after accidental read grant");
  // No production employee import: synthetic records only, to exercise keyset pages.
  query(`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,role_id,email,display_name,status)
    select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'99990003',
      ('00000000-0000-4000-8000-'||lpad((n+10000)::text,12,'0'))::uuid,'${id(501)}',
      'choice-'||n||'@example.test','Choice '||n,'active' from generate_series(700,727) n;`);
  const page1 = result(null,{view:"employees"}); const page2 = result(null,{view:"employees",cursor:page1.nextCursor});
  assert.equal(page1.items.length,25); assert.equal(page2.items.length,3); assert.equal(page2.nextCursor,null);
  assert.equal(new Set([...page1.items,...page2.items].map(i=>i.id)).size,28);
  assert.equal(result(null,{view:"employees",search:"%"}).items.length,0);
  assert.ok(page1.items.every(i=>Object.keys(i).sort().join() === "displayName,id"));
  pass("bounded keyset employee choices omit emails/auth IDs and treat search literally");
  const active = [];
  async function locked(name) { const deadline=Date.now()+4000; while(Date.now()<deadline) {
    if(query(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`)==="1")return;
    await new Promise(resolve=>setTimeout(resolve,20));
  } throw Error(`lock not witnessed ${name}`); }
  const start=(name,source,hold=false)=>{const c=connection(name,source,hold);active.push(c);return c;};
  try {
    const mutation=cmd("location",{...location,name:"Concurrent main"});
    const a=start("attendance_config_a",`begin; ${call(mutation)}`,true); await a.ready;
    const b=start("attendance_config_b",call(mutation)); await locked("attendance_config_b"); a.finish("commit;");
    const [ra,rb]=await Promise.all([a.completed,b.completed]); assert.equal(ra.status,0,ra.error); assert.equal(rb.status,0,rb.error);
    assert.equal(query(`select count(*) from public.merchant_attendance_config_operations where operation_id='${mutation.operationId}';`),"1");
    pass("witnessed concurrent configuration retry writes one audit receipt");
    const disable=cmd("settings",{...enabled,enabled:false});
    const p=start("attendance_config_punch",`begin; ${punch(id(602),"clock_in",2)}`,true); await p.ready;
    const s=start("attendance_config_disable",call(disable)); await locked("attendance_config_disable"); p.finish("commit;");
    assert.equal((await p.completed).status,0); const denied=await s.completed; assert.notEqual(denied.status,0); assert.match(denied.error,/attendance_open_sessions/);
    pass("configuration waits for in-flight punch then refuses unsafe disable");
    query(punch(id(603),"clock_out",3));
    const stop=start("attendance_config_stop",`begin; ${call(cmd("settings",{...enabled,enabled:false}))}`,true); await stop.ready;
    const next=start("attendance_config_next",punch(id(604),"clock_in",4)); await locked("attendance_config_next"); stop.finish("commit;");
    assert.equal((await stop.completed).status,0); const blocked=await next.completed; assert.notEqual(blocked.status,0); assert.match(blocked.error,/attendance_disabled/);
    pass("committed disable prevents pending new punch without lock inversion");
    const transfer=start("attendance_owner_transfer",`begin; update public.merchants set user_id='${id(999)}' where id='99990003';`,true);await transfer.ready;
    const old=start("attendance_owner_stale",call(null));await locked("attendance_owner_stale");transfer.finish("commit;");
    assert.equal((await transfer.completed).status,0);const noOwner=await old.completed;assert.notEqual(noOwner.status,0);assert.match(noOwner.error,/attendance_access_denied/);
    pass("witnessed owner transfer revokes stale config access before read");
  } finally { for(const c of active)c.finish("rollback;");await Promise.all(active.map(c=>c.completed)); }
}
