import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runAttendanceLabelsReuse } from './merchant-attendance-choice-labels-reuse-native.mjs';
import { withAttendanceConcurrencySandbox } from './merchant-attendance-concurrency-sandbox.mjs';
const require = createRequire(import.meta.url);
const { parseScheduleResult } = require('../src/lib/merchantAttendanceSchedule.ts');
export const scheduleId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
export async function checkAttendanceSchedule(native, browserCheck = null) {
  const { root, query, pass, connect } = native, id = scheduleId, site = '99990001', owner = id(99), employee = id(1), worker = id(201), location = id(301);
  await withAttendanceConcurrencySandbox(native, async ({ sql }) => {
    const exec = source => query(sql(source));
    exec(readFileSync(path.join(root, 'scripts/supabase-migrations/202610010099_merchant_attendance_schedule.sql'), 'utf8'));
    const today = exec("select (clock_timestamp() at time zone 'UTC')::date + 2;");
    const next = days => new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    exec(`begin;
      insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990002','${id(98)}');
      insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(30)}','${site}','Synthetic',array['enterprise.view','attendance.self.view']);
      insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${id(101)}','${site}','${employee}','attendance-a@example.invalid','测试员工甲','${id(30)}','active'),
      ('${id(102)}','${site}','${id(2)}','attendance-b@example.invalid','测试员工乙','${id(30)}','active');
      insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','Europe/Madrid');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${location}','${site}','测试门店','Europe/Madrid',true);
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id) values
      ('${worker}','${site}','${id(101)}','A01','测试员工甲',true,'${location}'),('${id(202)}','${site}','${id(102)}','B01','测试员工乙',true,'${location}');
      insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01'),('${site}','${id(202)}','2000-01-01');commit;`);
    const baseline = exec(`select jsonb_build_array((select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.merchant_attendance_events t),
      (select jsonb_agg(to_jsonb(t)) from public.merchant_attendance_settings t));`);
    const q = { siteId: site, access: 'owner', workerId: worker, fromDate: today, throughDate: next(6), operationId: null };
    const command = { operationId: id(401), expectedRevision: 0, expectedSettingsVersion: 1, reason: '合成排班测试', action: 'publish', locationId: location,
      timeZone: 'Europe/Madrid', slots: [[`${today}T08:00:00.000Z`, `${today}T12:00:00.000Z`], [`${today}T15:00:00.000Z`, `${today}T19:00:00.000Z`]] };
    const call = (queryArg = q, commandArg = null, who = owner, allow = true) => `public.faolla_attendance_schedule_v1(${json(queryArg)},'${who}',${commandArg ? json(commandArg) : 'null'},${allow})`;
    const run = (queryArg = q, c = null, who = owner, allow = true) => {
      const out = JSON.parse(exec(`begin;set local role service_role;select ${call(queryArg,c,who,allow)};commit;`));
      return parseScheduleResult({ ...out, moduleEnabled: allow }, { ...queryArg, operationId: c?.operationId ?? queryArg.operationId });
    };
    const reject = (queryArg, c, code, who = owner, allow = true) => exec(`begin;set local role service_role;do $check$ begin
      begin perform ${call(queryArg,c,who,allow)};raise exception 'unexpected acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;end $check$;rollback;`);
    assert.equal(run().revision, 0); assert.equal(exec('select count(*) from public.merchant_attendance_schedule_commands;'), '0');
    reject(q, null, 'attendance_access_denied', employee); reject({ ...q, siteId: '99990002' }, null, 'attendance_access_denied');
    reject({ ...q, access: 'self' }, null, 'attendance_invalid_request', employee);
    reject(q, command, 'attendance_platform_paused', owner, false);
    pass('schedule GET is read-only; owner/self tenant identity and platform write gate');
    const published = run(q, command); assert.equal(published.entries.length, 2); assert.equal(published.revision, 1);
    assert.deepEqual(run(q, command, owner, false).entries, published.entries);
    assert.equal(run({ ...q, operationId: command.operationId }, null, owner, false).receipt.operationId, command.operationId);
    reject(q, { ...command, reason: 'same-id-different-body' }, 'attendance_operation_conflict');
    reject(q, { ...command, operationId: id(402) }, 'attendance_version_conflict');
    reject(q, { ...command, operationId: id(402), expectedRevision: 1 }, 'attendance_schedule_overlap');
    assert.equal(exec('select count(*) from public.merchant_attendance_schedule_slots;'), '2');
    pass('atomic multi-segment publish; same ID replay and receipt recovery; conflicts reject without duplicates');
    const self = { ...q, access: 'self', workerId: null };
    assert.equal(run(self, null, employee).entries.length, 2); assert.equal(run(self, null, id(2)).entries.length, 0);
    reject({ ...self, operationId: command.operationId }, null, 'attendance_invalid_request', employee);
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${id(30)}';`);
    reject(self, null, 'attendance_access_denied', employee);
    exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${id(30)}';`);
    pass('employee sees only own plans; caller cannot supply another worker or operation; revocation rechecked');
    const fresh = { ...command, operationId: id(403), expectedRevision: 1 };
    reject(q, { ...fresh, timeZone: 'UTC' }, 'attendance_schedule_location_changed');
    reject(q, { ...fresh, slots: [[`${today}T05:00:00.000Z`, `${today}T04:00:00.000Z`]] }, 'attendance_invalid_request');
    reject(q, { ...fresh, slots: [[`${today}T04:00:00.000Z`, `${today}T07:00:00.000Z`], command.slots[0]] }, 'attendance_schedule_overlap');
    reject(q, { ...fresh, slots: [[`${today}T04:00:00.000Z`, `${today}T07:00:00.000Z`], [`${today}T06:00:00.000Z`, `${today}T07:00:00.000Z`]] }, 'attendance_invalid_request');
    exec(`update public.merchant_attendance_employment_periods set ends_on='${today}' where worker_id='${worker}';`);
    reject(q, { ...fresh, slots: [[`${today}T21:00:00.000Z`, `${next(1)}T06:00:00.000Z`]] }, 'attendance_schedule_outside_employment');
    exec(`update public.merchant_attendance_employment_periods set ends_on=null where worker_id='${worker}';`);
    const historical = { ...q, fromDate: '2001-01-01', throughDate: '2001-01-01' };
    reject(historical, { ...fresh, slots: [['2001-01-01T09:00:00.000Z', '2001-01-01T10:00:00.000Z']] }, 'attendance_schedule_past');
    pass('location snapshots, overlap rollback, chronology, future-only and cross-midnight employment checks');
    const cancel = { operationId: id(404), expectedRevision: 1, expectedSettingsVersion: 1, reason: '合成取消理由', action: 'cancel', slotId: published.entries[0].id };
    const cancelled = run(q, cancel); assert.equal(cancelled.entries[0].cancelled, true); assert.equal(cancelled.entries[0].reason, command.reason);
    assert.equal(cancelled.entries[0].cancelReason, cancel.reason); assert.equal(run(q, cancel).revision, 2);
    reject(q, { ...cancel, operationId: id(405), expectedRevision: 2 }, 'attendance_schedule_not_active');
    run(q, { ...fresh, operationId: id(406), expectedRevision: 2, slots: [command.slots[0]] });
    for (const table of ['commands','slots','cancellations']) {
      assert.equal(exec(`select has_table_privilege('service_role','public.merchant_attendance_schedule_${table}','SELECT');`), 'f');
      assert.equal(exec(`select has_table_privilege('service_role','public.merchant_attendance_schedule_${table}','INSERT');`), 'f');
      exec(`do $guard$ begin begin execute 'truncate public.merchant_attendance_schedule_${table} cascade';raise exception 'unexpected rewrite';exception when sqlstate '42501' then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end $guard$;`);
    }
    assert.equal(exec("select has_function_privilege('authenticated','public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean)','EXECUTE');"), 'f');
    pass('cancellation appends without erasing original; free time can be replanned; direct writes and truncate denied');
    // Separate connections: settings-row serialization must reject a stale second writer.
    const a = connect(), b = connect();
    try {
      await a.step(sql(`begin;set local role service_role;select ${call(q, { ...fresh, operationId: id(407), expectedRevision: 3, slots: [[`${next(1)}T08:00:00.000Z`, `${next(1)}T12:00:00.000Z`]] })};`));
      const waiting = b.step(sql(`begin;set local role service_role;do $check$ begin begin perform ${call(q, { ...fresh, operationId: id(408), expectedRevision: 3, slots: [[`${next(1)}T08:00:00.000Z`, `${next(1)}T12:00:00.000Z`]] })};raise exception 'unexpected acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'attendance_version_conflict' then raise;end if;end;end $check$;commit;`));
      await a.step('commit;'); await waiting;
    } finally { await a.close(); await b.close(); }
    assert.equal(run().revision, 4); pass('two actual database connections serialize schedule publication; stale writer rejected');
    // Rebinding a worker profile must not give the new employee old personal plans.
    exec(`begin;update public.merchant_attendance_workers set employee_id=null where id='${id(202)}';
      update public.merchant_attendance_workers set employee_id='${id(102)}',display_name='重新关联的乙' where id='${worker}';commit;`);
    assert.equal(run(self, null, id(2)).entries.length, 0);
    assert.equal(run().entries[0].workerName, '测试员工甲');
    exec(`begin;update public.merchant_attendance_workers set employee_id='${id(101)}',display_name='测试员工甲' where id='${worker}';
      update public.merchant_attendance_workers set employee_id='${id(102)}' where id='${id(202)}';commit;`);
    pass('employee binding and name snapshots prevent another employee inheriting old personal schedules');
    if (browserCheck) await browserCheck({ ...native, exec, run, q, owner, employee, worker, location, today, next, id });
    const denseQuery = { ...q, fromDate: next(10), throughDate: next(10) }; let denseResult = run(denseQuery), denseCommand;
    for (let batch = 0; batch < 4; batch++) {
      const base = Date.parse(next(10) + 'T00:00:00.000Z');
      denseCommand = { ...command, expectedRevision: denseResult.revision, operationId: id(700 + batch), slots: Array.from({ length: 32 }, (_, n) => {
        const start = base + (batch * 32 + n) * 120000; return [new Date(start).toISOString(), new Date(start + 60000).toISOString()];
      }) };
      denseResult = run(denseQuery, denseCommand);
    }
    assert.equal(denseResult.rangeLimited, true); assert.deepEqual(denseResult.entries, []); assert.equal(denseResult.receipt.operationId, denseCommand.operationId);
    const denseReceipt = run({ ...denseQuery, operationId: denseCommand.operationId }); assert.equal(denseReceipt.receipt.operationId, denseCommand.operationId);
    assert.equal(denseReceipt.rangeLimited, true); pass('bounded oversized list never returns partial totals or loses receipt recovery');
    assert.equal(exec(`select jsonb_build_array((select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.merchant_attendance_events t),
      (select jsonb_agg(to_jsonb(t)) from public.merchant_attendance_settings t));`), baseline);
    pass('all schedule work leaves original punch facts and attendance settings unchanged');
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAttendanceLabelsReuse(process.argv.slice(2), checkAttendanceSchedule).catch(error => { console.error(error); process.exitCode = 1; });
}
