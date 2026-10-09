import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./supabase-migrations/202610010108_merchant_attendance_onsite_qr.sql", import.meta.url), "utf8");
const issue = sql.slice(sql.indexOf("create function public.faolla_attendance_onsite_issue_v1"), sql.indexOf("create function public.faolla_attendance_onsite_clock_v1"));
const clock = sql.slice(sql.indexOf("create function public.faolla_attendance_onsite_clock_v1"));

test("onsite QR is additive, private, append-only, and leaves proven writers/source contracts unchanged", () => {
  assert.doesNotMatch(sql, /create or replace|drop (?:table|function)|alter table public\.merchant_attendance_(?:settings|events|workers|terminals)\b/i);
  assert.match(sql, /alter table public\.merchant_attendance_onsite_receipts enable row level security/);
  assert.match(sql, /revoke all on public\.merchant_attendance_onsite_receipts from public,anon,authenticated,service_role/);
  assert.match(sql, /before update or delete/);
  assert.match(sql, /before truncate/);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete|truncate)/i);
  for (const signature of ["faolla_attendance_onsite_issue_v1(text,uuid,text)", "faolla_attendance_onsite_clock_v1(text,uuid,jsonb,jsonb,uuid,boolean)"]) {
    assert.ok(sql.includes(`revoke all on function public.${signature} from public,anon,authenticated,service_role`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role`));
  }
  assert.match(clock, /values\(p_site,w\.id,loc_now,op,seq\+1,action_now,'web'/);
});

test("issuance authenticates paired terminal, rechecks after locks and returns only bounded metadata", () => {
  assert.match(issue, /faolla_attendance_terminal_device_v1\(p_site,p_terminal,p_secret_hash,null,false\)/);
  assert.match(issue, /attendanceEnabled' is distinct from 'true'/);
  assert.ok(issue.indexOf("now_at:=date_trunc") > issue.indexOf("id=t.location_id for share"));
  assert.match(issue, /faolla_attendance_terminal_snapshot_v1\(p_site,p_terminal,now_at\)->>'state' is distinct from 'active'/);
  assert.match(issue, /l.radius_meters is not null/);
  assert.match(issue, /now_at\+interval '45 seconds'>t.device_expires_at/);
  const returned = issue.slice(issue.indexOf("return jsonb_build_object("), issue.indexOf("end; $$;"));
  for (const key of ["siteId", "terminalId", "locationId", "pairedAtMs", "issuedAtMs", "expiresAtMs"]) assert.ok(returned.includes(`'${key}'`));
  assert.doesNotMatch(returned, /device_hash|pair_hash|secret|employee|worker/i);
  assert.doesNotMatch(issue, /\b(?:insert into|update public|delete from)\b/i);
});

test("claims and commands are exact shapes; current authenticated identity is never a client-selected target", () => {
  assert.match(clock, /jsonb_object_keys\(p_command\)\)<>6/);
  assert.match(clock, /jsonb_object_keys\(p_claims\)\)<>9/);
  assert.match(clock, /faolla\.attendance\.onsite/);
  assert.match(clock, /expires_ms-issued_ms<>45000 or issued_ms<paired_ms/);
  const locks = ["where id=p_site for share", "merchant_id=p_site for share", "auth_user_id=p_auth for share", "id=e.role_id for share", "employee_id=e.id for update"];
  let previous = -1;
  for (const lock of locks) { const at = clock.indexOf(lock); assert.ok(at > previous, lock); previous = at; }
  assert.match(clock, /attendance\.self\.view/);
  assert.match(clock, /p_command is not null and not\('attendance.self.clock'=any\(r.permissions\)\)/);
  assert.match(clock, /last_row.actor_employee_id is distinct from e.id/);
  assert.match(clock, /e.id<>\(p_command->>'expectedEmployeeId'\)::uuid/);
});

test("original actor-bound receipts are recoverable before new-write policy and freshness checks", () => {
  assert.match(clock, /binding.employee_id<>e.id/);
  assert.match(clock, /receipt.actor_employee_id is distinct from e.id/);
  assert.match(clock, /binding.command<>p_command/);
  assert.ok(clock.indexOf("replayed:=p_command is not null") < clock.indexOf("if not s.enabled"));
  assert.ok(clock.indexOf("replayed:=p_command is not null") < clock.indexOf("if now_ms>=expires_ms"));
  assert.match(clock, /if p_command is not null and not replayed then/);
  assert.match(clock, /if p_claims is not null then raise exception 'attendance_invalid_request'/);
});

test("new events re-date after terminal locks and enforce terminal, location, employment, nonce and pause fences", () => {
  assert.ok(clock.indexOf("now_at:=date_trunc") > clock.indexOf("id=terminal_now for share"));
  assert.match(clock, /now_ms<issued_ms/);
  assert.match(clock, /now_ms>=expires_ms/);
  assert.match(clock, /t.location_id<>\(p_claims->>'locationId'\)::uuid/);
  assert.match(clock, /extract\(epoch from t.paired_at\)\*1000\)::bigint<>paired_ms/);
  assert.match(clock, /expires_ms>floor\(extract\(epoch from t.device_expires_at\)\*1000\)::bigint/);
  assert.match(clock, /w.default_location_id is distinct from loc_now/);
  assert.match(clock, /l.radius_meters is not null/);
  assert.match(clock, /today:=\(now_at at time zone s.time_zone\)::date/);
  assert.match(clock, /starts_on<=today and \(ends_on is null or ends_on>=today\)/);
  assert.match(clock, /not p_allow_new and action_now in \('clock_in','break_start'\)/);
  assert.match(sql, /unique\(merchant_id,worker_id,nonce\)/);
  assert.doesNotMatch(sql, /unique\(nonce\)|unique\(merchant_id,nonce\)/);
  assert.match(clock, /worker_id=w.id and nonce=nonce_now/);
  assert.match(clock, /attendance_qr_used/);
});

test("the explicit state machine and both immutable inserts share one atomic worker-locked transaction", () => {
  for (const code of ["attendance_sequence_conflict", "attendance_time_reversed", "attendance_already_clocked_in", "attendance_not_working", "attendance_not_on_break", "attendance_break_must_end", "attendance_not_clocked_in"]) assert.ok(clock.includes(code));
  assert.ok(clock.indexOf("insert into public.merchant_attendance_events") < clock.indexOf("insert into public.merchant_attendance_onsite_receipts"));
  assert.match(sql, /unique\(merchant_id,worker_id,operation_id\)/);
  assert.doesNotMatch(clock, /exception when others|update public.merchant_attendance_events|delete from public.merchant_attendance_events/i);
  assert.equal((sql.match(/^commit;/gm) ?? []).length, 1);
});
