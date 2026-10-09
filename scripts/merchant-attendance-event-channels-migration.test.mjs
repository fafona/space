import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./supabase-migrations/202610020109_merchant_attendance_event_channels.sql", import.meta.url), "utf8");
const body = sql.slice(sql.indexOf("declare"), sql.indexOf("end; $$;"));
const signature = "public.faolla_attendance_event_channels_v1(text,uuid,jsonb)";
const at = (value) => {
  const index = body.indexOf(value);
  assert.notEqual(index, -1, `missing contract fragment: ${value}`);
  return index;
};
const ordered = (...fragments) => {
  let previous = -1;
  for (const fragment of fragments) {
    const current = at(fragment);
    assert.ok(current > previous, `out-of-order contract fragment: ${fragment}`);
    previous = current;
  }
};

test("event-channel migration is additive and read-only with service-only execution", () => {
  assert.match(sql, /create function public\.faolla_attendance_event_channels_v1\(\s*p_site_id text,p_auth_user_id uuid,p_query jsonb/);
  assert.match(sql, /returns jsonb language plpgsql security definer set search_path=pg_catalog/);
  assert.ok(sql.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role;`));
  assert.ok(sql.includes(`grant execute on function ${signature} to service_role;`));
  assert.doesNotMatch(sql, /create or replace|\b(?:alter|drop|truncate)\s+(?:table|function)|\bcreate table\b/i);
  assert.doesNotMatch(body, /\b(?:insert into|update public\.|delete from|execute\s+)/i);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete|truncate)|grant execute[^;]+to (?:public|anon|authenticated)/i);
  assert.deepEqual([...sql.matchAll(/insert into ([\w.]+)/g)].map(match => match[1]), ["public.faolla_schema_migrations"]);
  assert.match(sql, /values\(202610020109,'merchant_attendance_event_channels'\)/);
  assert.equal((sql.match(/^commit;/gm) ?? []).length, 1);
});

test("input is exact, bounded, null-safe, canonical and validated before casts", () => {
  ordered("jsonb_typeof(p_query) is distinct from 'object'", "jsonb_object_keys(p_query)", "jsonb_array_length(p_query->'eventIds')");
  assert.match(body, /octet_length\(p_query::text\)>16384/);
  assert.match(body, /jsonb_object_keys\(p_query\)\)<>4/);
  assert.match(body, /p_query \?& array\['access','workerId','locationId','eventIds'\]/);
  assert.match(body, /coalesce\(p_query->>'access',''\) not in \('self','manager','owner'\)/);
  assert.match(body, /jsonb_typeof\(p_query->'workerId'\) is distinct from 'string'/);
  assert.match(body, /jsonb_typeof\(p_query->'locationId'\) is distinct from 'string'/);
  assert.match(body, /p_query->'locationId' is distinct from 'null'::jsonb/);
  assert.match(body, /requested_count<1 or requested_count>202/);
  assert.match(body, /jsonb_typeof\(entry.value\) is distinct from 'string'/);
  assert.match(body, /coalesce\(entry.value #>> '\{\}',''\) !~ uuid_pattern/);
  assert.match(body, /count\(distinct entry.value\)/);
  assert.ok(body.includes("uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'"));
  ordered("requested_count<1 or requested_count>202", "jsonb_typeof(entry.value)", "count(distinct entry.value)", "worker:=(p_query->>'workerId')::uuid", "entry.value::uuid");
});

test("current identity and permissions are locked before any caller-selected records", () => {
  ordered("perform 1 from public.merchants", "select * into s", "select * into viewer from", "select * into viewer_role", "select * into w");
  assert.match(body, /id=p_site_id and \(access_mode<>'owner' or user_id=p_auth_user_id\) for share/);
  assert.doesNotMatch(body, /owner_id|owner_user_id/);
  assert.match(body, /merchant_id=p_site_id and auth_user_id=p_auth_user_id for share/);
  assert.match(body, /viewer.status is distinct from 'active'/);
  assert.match(body, /merchant_id=p_site_id and id=viewer.role_id for share/);
  assert.match(body, /viewer_role.status is distinct from 'active'/);
  assert.match(body, /faolla_valid_merchant_enterprise_permissions_v1\(viewer_role.permissions\) is distinct from true/);
  assert.match(body, /'enterprise.view'=any\(viewer_role.permissions\)/);
  assert.match(body, /case when access_mode='self' then 'attendance.self.view' else 'attendance.records.view' end/);
  ordered("faolla_valid_merchant_enterprise_permissions_v1", "if s.merchant_id is null then raise exception 'attendance_settings_required'");
});

test("self access fences both the current worker binding and every historical event actor", () => {
  assert.match(body, /where merchant_id=p_site_id and employee_id=viewer.id for share;\s*if not found or w.id is distinct from worker then raise exception 'attendance_access_denied'/);
  assert.match(body, /access_mode<>'self' or e.actor_employee_id is not distinct from viewer.id/);
  assert.doesNotMatch(body, /attendance_worker_changed|attendance_worker_not_found|attendance_event_not_found/);
});

test("manager scope is held before the selected worker and cannot cross-product separate grants", () => {
  ordered("select * into viewer_scope", "if not exists(select 1 from public.merchant_attendance_scope_grants g", "where merchant_id=p_site_id and id=worker for share", "now_at:=clock_timestamp()");
  assert.match(body, /select \* into viewer_scope from public.merchant_attendance_scopes\s*where merchant_id=p_site_id and employee_id=viewer.id for share/);
  for (const alias of ["sw", "sl"]) {
    const join = new RegExp(`${alias}\\.merchant_id=g\\.merchant_id and ${alias}\\.employee_id=g\\.employee_id and ${alias}\\.grant_id=g\\.id`, "g");
    assert.equal([...body.matchAll(join)].length, 2, `${alias} must bind the same grant before and after worker lock`);
  }
  assert.equal([...body.matchAll(/g.merchant_id=p_site_id and g.employee_id=viewer.id and sw.worker_id=worker and sl.location_id=target_location/g)].length, 2);
  assert.match(body, /access_mode<>'manager' or e.location_id=target_location/);
});

test("manager expiry is re-dated after lock waits and rechecked after response serialization", () => {
  ordered("where merchant_id=p_site_id and id=worker for share", "now_at:=clock_timestamp()", "select count(*)>0,case when bool_or(g.valid_until is null) then null else max(g.valid_until) end", "g.valid_from<=now_at", "select count(*) into authorized_count");
  assert.match(body, /g.valid_from<=now_at and \(g.valid_until is null or now_at<g.valid_until\)/);
  assert.match(body, /if not granted then raise exception 'attendance_access_denied'/);
  ordered("result:=jsonb_build_object", "octet_length(result::text)>65536", "if access_until is not null and clock_timestamp()>=access_until", "return result");
  assert.doesNotMatch(body, /min\(g.valid_until\)/);
});

test("a whole event batch is authorized before any private receipt lookup", () => {
  ordered("select count(*) into authorized_count", "if authorized_count<>requested_count then raise exception 'attendance_access_denied'", "foreach requested_event in array requested_events loop", "from public.merchant_attendance_onsite_receipts r");
  assert.match(body, /e.id=any\(requested_events\) and e.merchant_id=p_site_id and e.worker_id=worker/);
  assert.match(body, /select \* into ev from public.merchant_attendance_events\s*where id=requested_event and merchant_id=p_site_id and worker_id=worker/);
  assert.equal([...body.matchAll(/from public.merchant_attendance_onsite_receipts/g)].length, 1);
});

test("provenance is null-safe and corrupt bindings fail closed instead of becoming web", () => {
  assert.match(body, /into origin from public.merchant_attendance_onsite_receipts r where r.event_id=ev.id;/);
  for (const [origin, event] of [["merchant_id", "merchant_id"], ["worker_id", "worker_id"], ["employee_id", "actor_employee_id"], ["operation_id", "operation_id"]]) {
    assert.ok(body.includes(`origin.${origin} is distinct from ev.${event}`));
  }
  assert.match(body, /origin.terminal_id is null or ev.source is distinct from 'web'/);
  assert.match(body, /origin.claim_site is distinct from ev.merchant_id/);
  assert.match(body, /origin.claim_terminal is distinct from origin.terminal_id::text/);
  assert.match(body, /origin.claim_location is distinct from ev.location_id::text/);
  const bindingCheck = body.slice(at("if found then"), at("channel_now:='onsite_qr'"));
  assert.match(bindingCheck, /raise exception 'attendance_unavailable'/);
  assert.match(body, /channel_now:=ev.source;terminal_now:=null/);
  assert.match(body, /channel_now:='onsite_qr';terminal_now:=origin.terminal_id/);
});

test("historical reads remain independent of current admission and terminal validity", () => {
  assert.doesNotMatch(body, /\bs.enabled\b|\bw.active\b|\bviewer_scope.active\b|device_expires_at|paired_at|revoked_at|secret|nonce|p_allow_new/);
  assert.doesNotMatch(body, /(?:from|join) public\.merchant_attendance_(?:terminals|locations|employment_periods)\b/);
  assert.doesNotMatch(body, /attendance_disabled|attendance_terminal_denied|attendance_location_denied/);
});

test("results preserve input order with exact minimal fields and a 64-KiB output ceiling", () => {
  assert.match(body, /array_agg\(entry.value::uuid order by entry.ordinality\)/);
  assert.match(body, /with ordinality as entry\(value,ordinality\)/);
  assert.match(body, /foreach requested_event in array requested_events loop/);
  const item = body.slice(at("items:=items||jsonb_build_array"), at("end loop;"));
  const envelope = body.slice(at("result:=jsonb_build_object"), at("if octet_length(result::text)"));
  for (const key of ["eventId", "action", "occurredAt", "channel", "terminalId"]) assert.ok(item.includes(`'${key}',`));
  for (const key of ["siteId", "access", "workerId", "locationId", "viewerEmployeeId", "asOf", "accessValidUntil", "items"]) assert.ok(envelope.includes(`'${key}',`));
  assert.deepEqual([...item.matchAll(/(?:jsonb_build_object\(|,)\s*'([A-Za-z]+)',/g)].map(match => match[1]), ["eventId", "action", "occurredAt", "channel", "terminalId"]);
  assert.deepEqual([...envelope.matchAll(/(?:jsonb_build_object\(|,)\s*'([A-Za-z]+)',/g)].map(match => match[1]), ["siteId", "access", "workerId", "locationId", "viewerEmployeeId", "asOf", "accessValidUntil", "items"]);
  assert.doesNotMatch(item + envelope, /claims|command|nonce|operation|auth_user|permissions|secret|actor_employee|scopeRevision/);
  assert.match(envelope, /case when access_mode='owner' then null else viewer.id end/);
  assert.match(body, /ev.occurred_at>now_at\s*then raise exception 'attendance_unavailable'/);
  assert.match(body, /octet_length\(result::text\)>65536 then raise exception 'attendance_unavailable'/);
  assert.ok(item.includes('YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  assert.ok(envelope.includes('YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
});
