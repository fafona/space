// Called only by the fixed loopback, fresh synthetic PG15 harness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function checkAttendanceSelfNative({ root, query, sql, pass, connection }) {
  const read = (name) => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8");
  const previous = read("202608280041_merchant_staff_business_permissions.sql").match(/create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]*?\n\$\$;/)?.[0];
  assert.ok(previous);
  query(previous);
  query(`insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
    values ('${id(101)}','99990001','Existing no auto grant',array['enterprise.view']);`);
  const before = query("select row_to_json(r) from public.merchant_enterprise_roles r order by id;");
  query(read("202609290062_merchant_attendance_permissions.sql"));
  query(read("202609290063_merchant_attendance_self_clock.sql"));
  assert.equal(query("select row_to_json(r) from public.merchant_enterprise_roles r order by id;"), before);
  pass("attendance permissions do not auto-grant or rewrite existing role rows");
  assert.equal(query("select public.faolla_valid_merchant_enterprise_permissions_v1(array['attendance.self.clock']);"), "f");
  pass("attendance permission dependencies enforced in PostgreSQL");
  query(`insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
    values ('${id(102)}','99990001','Synthetic attendance',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
    values ('${id(111)}','99990001','${id(121)}','attendance@example.test','Synthetic attendance','${id(102)}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
    values ('${id(131)}','99990001','${id(111)}','SELF','Synthetic self',true,'${id(11)}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on)
    values ('99990001','${id(131)}','2000-01-01');`);
  const command = (op, action = "clock_in", sequence = 0, location = id(11)) => ({ expectedWorkerId: id(131), operationId: id(op), locationId: location, action, expectedSequence: sequence });
  const call = (body = null, { auth = id(121), site = "99990001", receipt = null, role = "service_role" } = {}) =>
    `set role ${role}; select public.faolla_attendance_self_v1('${site}','${auth}',${body ? `'${JSON.stringify(body)}'::jsonb` : "null"},${receipt ? `'${receipt}'::uuid` : "null"});`;
  const result = (body, options) => JSON.parse(query(call(body, options)));
  function rejects(label, statement, error) {
    const checked = sql(statement);
    assert.notEqual(checked.status, 0, label);
    assert.match(checked.error, new RegExp(error), label);
    pass(label);
  }
  rejects("clock defaults off", call(command(201)), "attendance_disabled");
  query("update public.merchant_attendance_settings set enabled=true where merchant_id='99990001';");
  rejects("web channel separately defaults off", call(command(201)), "attendance_web_disabled");
  query("update public.merchant_attendance_settings set web_clock_enabled=true where merchant_id='99990001'; update public.merchant_attendance_locations set active=true where merchant_id='99990001';");
  rejects("anonymous RPC execution denied", call(command(201), { role: "anon" }), "42501");
  rejects("authenticated RPC cannot forge server auth identity", call(command(201), { role: "authenticated" }), "42501");
  rejects("different auth principal cannot punch employee", call(command(201), { auth: id(999) }), "attendance_access_denied");
  rejects("tenant isolation at atomic authorization", call(command(201), { site: "99990002" }), "attendance_disabled");
  query("update public.merchant_attendance_settings set enabled=true where merchant_id='99990002';");
  rejects("enabled other tenant still requires its own employee binding", call(command(201), { site: "99990002" }), "attendance_access_denied");
  rejects("different tenant location denied", call(command(201, "clock_in", 0, id(12))), "attendance_location_denied");
  rejects("stale or forged worker precondition cannot select another worker", call({ ...command(201), expectedWorkerId: id(22) }), "attendance_worker_changed");
  rejects("client server-time override denied", call({ ...command(201), occurredAt: "2000-01-01" }), "attendance_invalid_request");
  rejects("missing expected sequence denied", call({ operationId: id(201), locationId: id(11), action: "clock_in" }), "attendance_invalid_request");
  query(`update public.merchant_attendance_locations set latitude=37,longitude=-5,radius_meters=50 where id='${id(11)}';`);
  rejects("geofenced location cannot bypass verification", call(command(201)), "attendance_location_verification_required");
  query(`update public.merchant_attendance_locations set latitude=null,longitude=null,radius_meters=null where id='${id(11)}';`);
  const first = result(command(201));
  assert.equal(first.state.sequence, 1); assert.equal(first.state.status, "working");
  assert.equal(first.receipt.operationId, id(201)); assert.equal(first.receipt.breakPaid, null);
  assert.equal(first.replayed, false);
  assert.ok(Math.abs(Date.now() - Date.parse(first.receipt.occurredAt)) < 30000);
  pass("atomic self punch returns server-time immutable receipt");
  const replay = result(command(201));
  assert.deepEqual(replay.receipt, first.receipt); assert.equal(replay.replayed, true);
  pass("lost-response retry returns exact original receipt before revision checks");
  rejects("same operation changed intent denied", call(command(201, "clock_out")), "attendance_operation_conflict");
  rejects("stale different operation cannot invert state", call(command(202, "clock_out")), "attendance_sequence_conflict");
  rejects("double clock in cannot silently clock out", call(command(202, "clock_in", 1)), "attendance_already_clocked_in");
  const rest = result(command(202, "break_start", 1));
  assert.equal(rest.receipt.breakPaid, false); assert.equal(rest.state.status, "break");
  pass("break pay is server policy, not employee-supplied data");
  rejects("checkout during break requires explicit break end", call(command(203, "clock_out", 2)), "attendance_break_must_end");
  result(command(203, "break_end", 2));
  result(command(204, "clock_out", 3));
  const status = result(null, { receipt: id(201) });
  assert.equal(status.state.sequence, 4); assert.equal(status.state.status, "off");
  assert.deepEqual(status.receipt, first.receipt);
  assert.equal(result(null, { receipt: id(999) }).receipt, null);
  pass("receipt lookup is separate from current status and unknown receipt is null");
  query(`insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
    values ('${id(103)}','99990002','Other tenant attendance',array['enterprise.view','attendance.self.view']);
    update public.merchant_enterprise_employees set auth_user_id='${id(121)}',role_id='${id(103)}',status='active' where id='${id(2)}';
    update public.merchant_attendance_workers set active=true where id='${id(22)}';`);
  const other = result(null, { site: "99990002", receipt: id(201) });
  assert.equal(other.workerId, id(22)); assert.equal(other.receipt, null); assert.equal(other.state.sequence, 0);
  pass("same auth user in two tenants never shares punch state or receipts");
  rejects("overlapping employment denied", `insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on,ends_on)
    values ('99990001','${id(131)}','2020-01-01','2020-01-05');`, "attendance_employment_overlap");
  query(`update public.merchant_attendance_employment_periods set ends_on='2001-01-01' where worker_id='${id(131)}';`);
  rejects("outside employment dates denied", call(command(205, "clock_in", 4)), "attendance_not_employed");
  query(`update public.merchant_attendance_employment_periods set ends_on=null where worker_id='${id(131)}';`);

  // Real independent PostgreSQL sessions. Wait for a witnessed lock, not a sleep
  // that assumes the competing request reached the critical section.
  const connections = [];
  const start = (name, source, hold = false) => { const c = connection(name, source, hold); connections.push(c); return c; };
  async function locked(name) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (query(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`) === "1") return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`attendance_lock_not_witnessed:${name}`);
  }
  const jsonOutput = (response) => {
    assert.equal(response.status, 0, response.error);
    return JSON.parse(response.output.split(/\r?\n/).find((line) => line.startsWith("{")));
  };
  try {
    const a = start("attendance_duplicate_a", `begin; ${call(command(205, "clock_in", 4))}`, true);
    await a.ready;
    const b = start("attendance_duplicate_b", call(command(205, "clock_in", 4)));
    await locked("attendance_duplicate_b"); a.finish("commit;");
    const [left, right] = (await Promise.all([a.completed, b.completed])).map(jsonOutput);
    assert.deepEqual(left.receipt, right.receipt); assert.equal(right.replayed, true);
    assert.equal(query(`select count(*) from public.merchant_attendance_events where worker_id='${id(131)}' and operation_id='${id(205)}';`), "1");
    pass("witnessed concurrent identical submissions create exactly one event");

    const c = start("attendance_version_a", `begin; ${call(command(206, "clock_out", 5))}`, true);
    await c.ready;
    const d = start("attendance_version_b", call(command(207, "clock_out", 5)));
    await locked("attendance_version_b"); c.finish("commit;");
    jsonOutput(await c.completed);
    const conflict = await d.completed;
    assert.notEqual(conflict.status, 0); assert.match(conflict.error, /attendance_sequence_conflict/);
    pass("witnessed concurrent different commands reject stale sequence");

    for (const [name, mutation, restore] of [
      ["employee", `update public.merchant_enterprise_employees set status='disabled' where id='${id(111)}';`, `update public.merchant_enterprise_employees set status='active' where id='${id(111)}';`],
      ["role", `update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(102)}';`, `update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'] where id='${id(102)}';`],
      ["worker", `update public.merchant_attendance_workers set active=false where id='${id(131)}';`, `update public.merchant_attendance_workers set active=true where id='${id(131)}';`],
    ]) {
      const revoke = start(`attendance_revoke_${name}`, `begin; ${mutation}`, true);
      await revoke.ready;
      const pending = start(`attendance_pending_${name}`, call(command(208, "clock_in", 6)));
      await locked(`attendance_pending_${name}`); revoke.finish("commit;");
      assert.equal((await revoke.completed).status, 0);
      const denied = await pending.completed;
      assert.notEqual(denied.status, 0); assert.match(denied.error, /attendance_access_denied/);
      query(restore);
      pass(`witnessed ${name} revocation blocks pending punch without stale authorization`);
    }
    // Reverse ordering: authorized punch commits first, revocation waits, then
    // every subsequent command is refused. There is one explicit linearization.
    const inFlight = start("attendance_authorized_first", `begin; ${call(command(208, "clock_in", 6))}`, true);
    await inFlight.ready;
    const revokeAfter = start("attendance_revoke_after", `update public.merchant_enterprise_employees set status='disabled' where id='${id(111)}';`);
    await locked("attendance_revoke_after"); inFlight.finish("commit;");
    jsonOutput(await inFlight.completed); assert.equal((await revokeAfter.completed).status, 0);
    rejects("revoked employee cannot replay a prior receipt", call(command(208, "clock_in", 6)), "attendance_access_denied");
    pass("punch-before-revoke order completes once then revokes subsequent access");
  } finally {
    for (const c of connections) c.finish("rollback;");
    await Promise.all(connections.map((c) => c.completed));
  }
  assert.equal(query(`select count(*) from public.merchant_attendance_events where worker_id='${id(131)}';`), "7");
  assert.equal(query(`select bool_and(actor_employee_id='${id(111)}') from public.merchant_attendance_events where worker_id='${id(131)}';`), "t");
  pass("rejected operations persist no events; successful events retain employee actor");
  rejects("service role still has no direct attendance event write privilege", "set role service_role; update public.merchant_attendance_events set action='clock_out';", "42501");
  query(`update public.merchant_enterprise_employees set status='active' where id='${id(111)}';`);
  for (const [state, prepare, sequence, permitted] of [
    ["working", "", 7, ["break_start", "clock_out"]],
    ["off", call(command(300, "clock_out", 7)), 8, ["clock_in"]],
    ["break", call(command(300, "break_start", 7)), 8, ["break_end"]],
  ]) {
    for (const action of ["clock_in", "break_start", "break_end", "clock_out"]) {
      const checked = sql(`begin; ${prepare} ${call(command(301, action, sequence))} rollback;`);
      assert.equal(checked.status === 0, permitted.includes(action), `${state} -> ${action}: ${checked.error}`);
    }
  }
  pass("complete 3-state x 4-action SQL transition matrix with rollback isolation");
  const tenure = start("attendance_employment_change", `begin; update public.merchant_attendance_employment_periods set ends_on='2001-01-01' where worker_id='${id(131)}';`, true);
  try {
    await tenure.ready;
    const waiting = start("attendance_pending_employment", call(command(302, "clock_out", 7)));
    await locked("attendance_pending_employment"); tenure.finish("commit;");
    assert.equal((await tenure.completed).status, 0);
    const denied = await waiting.completed;
    assert.notEqual(denied.status, 0); assert.match(denied.error, /attendance_not_employed/);
    pass("employment change shares worker lock and blocks a pending out-of-tenure punch");
  } finally {
    for (const c of connections) c.finish("rollback;");
    await Promise.all(connections.map((c) => c.completed));
  }
  assert.equal(query(`select count(*) from public.merchant_attendance_events where worker_id='${id(131)}';`), "7");
}
