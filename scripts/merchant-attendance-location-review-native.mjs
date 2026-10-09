import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";
function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", foreign = "99990008", owner = id(74001), worker = id(74002), place = id(74003), e = n => id(74100 + n);
  const json = v => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  const list = { mode: "list", fromAt: "2026-09-01T00:00:00.000000Z", toAt: "2026-10-01T00:00:00.000000Z", workerId: null, locationId: null, status: "all", asOf: null, cursorAt: null, cursorId: null };
  const detail = (event = e(1), op = null) => ({ mode: "detail", eventId: event, operationId: op });
  const command = (op, expectedRevision = 0, outcome = "noted", event = e(1), note = "Synthetic review reason") => ({ eventId: event, operationId: id(op), expectedRevision, outcome, note });
  const call = (q = detail(), cmd = null, auth = owner, tenant = site) => `public.faolla_attendance_location_reviews_v1('${tenant}','${auth}',${json(q)},${cmd ? json(cmd) : "null"})`;
  const reject = (code, expr) => `begin perform ${expr};raise exception 'unexpected review acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const read = name => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = ["bounded 50-event scan may return empty matches with a valid continuation", "microsecond plus UUID continuation returns remaining exceptions without loss",
    "owner review annotates only an exception, with latest state and immutable original receipt", "stale revisions, changed payloads and cross-event operation collisions reject",
    "reopen adds a reasoned revision without rewriting original evidence", "recent review history is bounded at 20 and signals omitted older revisions",
    "paused settings and inactive historical workers/locations remain reviewable", "current ownership is rechecked for lists, detail, writes and recovery",
    "cross-tenant, unknown, ordinary and inside-range events are consistently inaccessible", "strict query/command bounds reject spoofed actors, bad cursor/period and malformed notes",
    "anonymous and authenticated RPC calls plus direct service table/helper access are denied", "annotations are append-only and original event/location snapshots are unchanged"];
  const output = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${read("202609300072_merchant_attendance_location_clock.sql")}
    ${read("202609300074_merchant_attendance_location_reviews.sql")}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${foreign}','${id(74999)}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC'),('${foreign}','UTC');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values('${place}','${site}','Synthetic review place','UTC');
    insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name,default_location_id) values('${worker}','${site}','REVIEW','Synthetic reviewer fixture','${place}');
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at)
      select ('00000000-0000-4000-8000-'||lpad((74100+n)::text,12,'0'))::uuid,'${site}','${worker}','${place}',
        ('00000000-0000-4000-8000-'||lpad((74500+n)::text,12,'0'))::uuid,n,case when n%2=1 then 'clock_in' else 'clock_out' end,'web','UTC',
        '2026-09-28T10:00:00Z'::timestamptz+((n-1)/2)*interval '1 microsecond' from generate_series(1,54) n;
    insert into public.merchant_attendance_location_results(event_id,settings_version,worker_version,location_version,algorithm_version,reason,needs_review,captured_at,accuracy_meters,distance_meters)
      select id,1,1,1,1,case sequence when 1 then 'denied' when 2 then 'outside' when 3 then 'inside' else 'uncertain' end,sequence<>3,
        case when sequence=1 then null else occurred_at end,case when sequence=1 then null else 10 end,case when sequence=1 then null when sequence=2 then 200 when sequence=3 then 0 else 95 end
      from public.merchant_attendance_events where merchant_id='${site}' and sequence<=4;
    create temp table original_review_events as select * from public.merchant_attendance_events;
    create temp table original_review_summaries as select * from public.merchant_attendance_location_results;
    set local role service_role;
    do $checks$ declare a jsonb;b jsonb; q jsonb;begin
      a:=${call(list)};assert a->>'scanned'='50' and a->'items'='[]'::jsonb and a->'nextCursor'->>'id'='${e(5)}','bounded empty page';
      q:=${json(list)}||jsonb_build_object('asOf',a->'asOf','cursorAt',a->'nextCursor'->'occurredAt','cursorId',a->'nextCursor'->'id');
      b:=public.faolla_attendance_location_reviews_v1('${site}','${owner}',q,null);
      assert b->>'scanned'='4' and jsonb_array_length(b->'items')=3 and b->'nextCursor'='null'::jsonb,'remaining exceptions';
      assert b->'items'->0->>'id'='${e(4)}' and b->'items'->1->>'id'='${e(2)}' and b->'items'->2->>'id'='${e(1)}','microsecond tie order';
      a:=${call()};assert a->'item'->>'reviewRevision'='0' and a->'history'='[]'::jsonb and a->'summary'->'capturedAt'='null'::jsonb,'unreviewed detail';
      ${reject("attendance_invalid_request", call(detail(), command(74299, 0, "reopen")))}
      a:=${call(detail(), command(74201))};assert a->'item'->>'reviewState'='reviewed' and a->'receipt'->>'revision'='1','first noted';
      assert not (a->'receipt' ? 'actor_auth_user_id') and not(a->'item' ? 'operationId'),'response whitelist';
      b:=${call(detail(), command(74201))};assert b->'receipt'=a->'receipt' and b->'item'->>'reviewRevision'='1','same operation replay';
      ${reject("attendance_operation_conflict", call(detail(), command(74201, 0, "follow_up")))}
      ${reject("attendance_version_conflict", call(detail(), command(74202)))}
      ${reject("attendance_operation_conflict", call(detail(e(2)), command(74201, 0, "noted", e(2))))}
      b:=${call(detail(e(2), id(74201)))};assert b->'receipt'='null'::jsonb,'other event recovery hidden';
      b:=${call(detail(), command(74202, 1, "reopen"))};assert b->'item'->>'reviewState'='pending' and jsonb_array_length(b->'history')=2,'reopen appends';
      b:=${call(detail(), command(74203, 2, "follow_up"))};assert b->'item'->>'reviewState'='follow_up','request clarification';
      b:=${call(detail(), command(74201))};assert b->'receipt'=a->'receipt' and b->'item'->>'reviewRevision'='3','old receipt distinct latest';
      ${reject("attendance_access_denied", call(list, null, id(74998)))}
      ${reject("attendance_access_denied", call(detail(), null, owner, foreign))}
      ${reject("attendance_review_not_found", call(detail(e(3))))}
      ${reject("attendance_review_not_found", call(detail(e(5))))}
      ${reject("attendance_review_not_found", call(detail(id(74997))))}
      ${reject("attendance_invalid_request", call(list, command(74299)))}
      ${reject("attendance_invalid_request", call(detail(e(1), id(74201)), command(74201)))}
      ${[{ ...list, actor: owner }, { ...list, toAt: "2026-11-01T00:00:00.000000Z" }, { ...list, cursorId: e(4) }, { ...list, status: "approved_wages" }, { ...list, asOf: "2099-01-01T00:00:00.000000Z" }].map(q => reject("attendance_invalid_request", call(q))).join("\n")}
      ${[{ ...command(74299, 3), actor: owner }, command(74299, 3, "noted", e(1), ""), command(74299, 3, "noted", e(1), "x".repeat(501)), command(74299, 3, "noted", e(1), "line\nbreak"), { ...command(74299, 3), expectedRevision: "3" }].map(c => reject("attendance_invalid_request", call(detail(), c))).join("\n")}
    end $checks$;reset role;
    savepoint long_history;
    set local role service_role;do $checks$ declare r jsonb;i integer;begin
      for i in 4..22 loop
        r:=public.faolla_attendance_location_reviews_v1('${site}','${owner}',${json(detail())},jsonb_build_object('eventId','${e(1)}',
          'operationId',('00000000-0000-4000-8000-'||lpad((74400+i)::text,12,'0')),'expectedRevision',i-1,'outcome','noted','note','Synthetic later review'));
      end loop;
      r:=${call(detail(e(1), id(74201)))};assert r->'historyTruncated'='true'::jsonb and jsonb_array_length(r->'history')=20,'bounded history';
      assert r->'history'->0->>'revision'='22' and r->'history'->19->>'revision'='3' and r->'receipt'->>'revision'='1','old receipt outside recent history';
    end $checks$;reset role;rollback to savepoint long_history;
    savepoint transfer;
    update public.merchants set user_id='${id(74996)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';
    set local role service_role;do $checks$ declare r jsonb;begin
      ${reject("attendance_access_denied", call(list))}
      ${reject("attendance_access_denied", call(detail(e(1), id(74201))))}
      ${reject("attendance_access_denied", call(detail(), command(74201)))}
      r:=${call(detail(e(1), id(74201)), null, id(74996))};assert r->'receipt'='null'::jsonb and r->'history'->0->'byCurrentOwner'='false'::jsonb,'new owner history not receipt';
    end $checks$;reset role;rollback to savepoint transfer;
    ${["anon", "authenticated"].map(role => `set local role ${role};do $checks$ begin perform ${call()};raise exception 'RPC accepted';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    set local role service_role;do $checks$ begin
      begin perform 1 from public.merchant_attendance_location_reviews;raise exception 'direct read';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_location_review_entry_v1(null::public.merchant_attendance_location_reviews,'${owner}');raise exception 'helper read';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_reviews;raise exception 'direct delete';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    do $checks$ begin
      begin update public.merchant_attendance_location_reviews set note='rewrite';raise exception 'rewrite';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_reviews;raise exception 'delete';exception when insufficient_privilege then null;end;
      begin truncate public.merchant_attendance_location_reviews;raise exception 'truncate';exception when insufficient_privilege then null;end;
      assert (select count(*) from public.merchant_attendance_location_reviews)=3,'exact final annotations';
      assert not exists((select * from original_review_events except select * from public.merchant_attendance_events) union all
        (select * from public.merchant_attendance_events except select * from original_review_events)),'events unchanged';
      assert not exists((select * from original_review_summaries except select * from public.merchant_attendance_location_results) union all
        (select * from public.merchant_attendance_location_results except select * from original_review_summaries)),'summary unchanged';
      assert not (select enabled from public.merchant_attendance_settings where merchant_id='${site}'),'paused attendance stayed paused';
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(output), labels); labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(error => { console.error(error); process.exitCode = 1; });
