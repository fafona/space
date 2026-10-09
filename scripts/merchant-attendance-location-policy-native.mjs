import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";

function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", foreign = "99990008", owner = id(73001), place = id(73002), other = id(73003), foreignPlace = id(73004);
  const values = { purpose: "Synthetic attendance review", notice: "Draft only", contact: "Synthetic owner", alternative: "Explicit manual registration and review", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
  const command = (op, revision = 0, patch = {}) => ({ operationId: id(op), expectedRevision: revision, expectedSettingsVersion: 1, expectedLocationVersion: 1, values, ...patch });
  const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const call = (cmd = null, options = {}) => `public.faolla_attendance_location_policy_draft_v1('${options.site ?? site}','${options.owner ?? owner}','${options.place ?? place}',${cmd ? json(cmd) : "null"},${options.op ? `'${id(options.op)}'::uuid` : "null"},${options.allow ?? "true"})`;
  const reject = (code, expression) => `begin perform ${expression};raise exception 'unexpected draft acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const migration = readFileSync(path.join(root, "scripts/supabase-migrations/202609300073_merchant_attendance_location_policy_drafts.sql"), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = [
    "empty read never creates or enables policy/configuration",
    "owner saves draft revisions with immutable original receipts and adjacent snapshots",
    "same original command replays once while another payload with that ID conflicts",
    "stale draft/settings/location versions reject without a write",
    "paused new writes still allow receipt recovery and original POST replay",
    "inactive location denies new draft, but permits owner history and recovery",
    "current owner transfer removes old read/write/recovery access",
    "cross-tenant and foreign/unknown locations do not leak policy",
    "cross-location operation reuse and another actor cannot hijack old receipt",
    "strict SQL payload rejects switches, malformed numbers, text, extra keys and mixed reads/writes",
    "anonymous/authenticated cannot call RPC, service cannot directly read/write policy rows",
    "policy revisions resist update/delete/truncate and operational settings/fences remain unchanged",
  ];
  const output = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${migration}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${id(73999)}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC'),('${foreign}','UTC');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
      values('${place}','${site}','Synthetic policy place','UTC',true),('${other}','${site}','Other synthetic place','UTC',true),('${foreignPlace}','${foreign}','Foreign synthetic place','UTC',true);
    create temp table original_policy_settings as select * from public.merchant_attendance_settings;
    create temp table original_policy_places as select * from public.merchant_attendance_locations;
    set local role service_role;
    do $checks$ declare a jsonb;b jsonb;begin
      a:=${call()};assert a->'draftOnly'='true'::jsonb and a->'current'='null'::jsonb and a->'previous'='null'::jsonb and a->'receipt'='null'::jsonb,'empty draft read';
      a:=${call(command(73101))};assert a->'current'->>'revision'='1' and a->'receipt'->>'operationId'='${id(73101)}','first draft';
      assert a->'current'->'values'=${json(values)},'exact values';
      b:=${call(command(73101))};assert b=a,'exact replay';
      ${reject("attendance_operation_conflict", call(command(73101, 0, { values: { ...values, radiusMeters: 110 } })))}
      ${reject("attendance_version_conflict", call(command(73102)))}
      ${reject("attendance_version_conflict", call(command(73102, 1, { expectedSettingsVersion: 2 })))}
      ${reject("attendance_version_conflict", call(command(73102, 1, { expectedLocationVersion: 2 })))}
      b:=${call(command(73102, 1, { values: { ...values, notice: "Updated draft notice" } }))};
      assert b->'current'->>'revision'='2' and b->'previous'=a->'current','adjacent audit';
      assert not (b->'current' ? 'actor_auth_user_id') and not(b ? 'command'),'public projection';
      b:=${call(null, { op: 73101 })};assert b->'receipt'=a->'receipt' and b->'current'->>'revision'='2','old receipt separate from latest';
      ${reject("attendance_platform_paused", call(command(73103, 2), { allow: "false" }))}
      b:=${call(command(73101), { allow: "false" })};assert b->'receipt'=a->'receipt','paused replay';
      ${reject("attendance_operation_conflict", call(command(73101), { place: other }))}
      b:=${call(null, { place: other, op: 73101 })};assert b->'receipt'='null'::jsonb and b->'current'='null'::jsonb,'cross place receipt hidden';
      ${reject("attendance_access_denied", call(null, { owner: id(73998) }))}
      ${reject("attendance_access_denied", call(null, { site: foreign }))}
      ${reject("attendance_location_denied", call(null, { place: foreignPlace }))}
      ${reject("attendance_location_denied", call(null, { place: id(73997) }))}
      ${reject("attendance_invalid_request", call(command(73103, 2), { op: 73101 }))}
      ${[
        { ...command(73103, 2), enabled: true }, { ...command(73103, 2), expectedRevision: "2" },
        ...[{ enabled: true }, { latitude: 91 }, { longitude: -181 }, { radiusMeters: 0 }, { radiusMeters: 1.1 }, { retentionDays: 3651 },
          { notice: "" }, { contact: "x".repeat(121) }, { purpose: "with\nnewline" }, { notice: " padded " }].map(v => command(73103, 2, { values: { ...values, ...v } })),
      ].map(c => reject("attendance_invalid_request", call(c))).join("\n")}
    end $checks$;reset role;
    savepoint inactive_place;
    update public.merchant_attendance_locations set active=false where id='${place}';
    set local role service_role;do $checks$ declare r jsonb;begin
      ${reject("attendance_location_denied", call(command(73103, 2)))}
      r:=${call(command(73101))};assert r->'receipt'->>'revision'='1' and r->'location'->'active'='false'::jsonb,'inactive replay';
    end $checks$;reset role;rollback to savepoint inactive_place;
    savepoint changed_setting;
    update public.merchant_attendance_settings set version=2 where merchant_id='${site}';
    set local role service_role;do $checks$ declare r jsonb;begin
      ${reject("attendance_version_conflict", call(command(73103, 2)))}
      r:=${call(command(73101))};assert r->>'settingsVersion'='2' and r->'receipt'->>'revision'='1','changed settings replay';
    end $checks$;reset role;rollback to savepoint changed_setting;
    savepoint owner_transfer;
    update public.merchants set user_id='${id(73996)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';
    set local role service_role;do $checks$ declare r jsonb;begin
      ${reject("attendance_access_denied", call(null, { op: 73101 }))}
      ${reject("attendance_access_denied", call(command(73101)))}
      r:=${call(null, { owner: id(73996), op: 73101 })};assert r->'current'->>'revision'='2' and r->'receipt'='null'::jsonb,'new owner sees draft not old actor receipt';
      ${reject("attendance_operation_conflict", call(command(73101), { owner: id(73996) }))}
    end $checks$;reset role;rollback to savepoint owner_transfer;
    ${["anon", "authenticated"].map(role => `set local role ${role};do $checks$ begin perform ${call()};raise exception 'unexpected direct RPC';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    set local role service_role;do $checks$ begin
      begin perform 1 from public.merchant_attendance_location_policy_drafts;raise exception 'direct read';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_policy_drafts;raise exception 'direct delete';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    do $checks$ begin
      begin update public.merchant_attendance_location_policy_drafts set recorded_at=clock_timestamp();raise exception 'rewrite';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_policy_drafts;raise exception 'delete';exception when insufficient_privilege then null;end;
      begin truncate public.merchant_attendance_location_policy_drafts;raise exception 'truncate';exception when insufficient_privilege then null;end;
      assert (select count(*) from public.merchant_attendance_location_policy_drafts)=2,'no unintended revisions';
      assert not exists((select * from original_policy_settings except select * from public.merchant_attendance_settings)
        union all(select * from public.merchant_attendance_settings except select * from original_policy_settings)),'operational settings unchanged';
      assert not exists((select * from original_policy_places except select * from public.merchant_attendance_locations)
        union all(select * from public.merchant_attendance_locations except select * from original_policy_places)),'operational fences unchanged';
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(output), labels); labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(error => { console.error(error); process.exitCode = 1; });
