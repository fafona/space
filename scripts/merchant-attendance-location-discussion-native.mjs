import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";
function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", otherSite = "99990008", owner = id(75001), auth = id(75002), employee = id(75003), role = id(75004), worker = id(75005), place = id(75006), otherWorker = id(75007);
  const event = n => id(75100 + n), op = n => id(75200 + n), json = x => `'${JSON.stringify(x).replaceAll("'", "''")}'::jsonb`;
  const list = { access: "self", mode: "list", expectedWorkerId: null, fromAt: "2026-09-01T00:00:00.000000Z", toAt: "2026-10-01T00:00:00.000000Z", asOf: null, cursorAt: null, cursorId: null };
  const detail = (access = "self", operationId = null, eventId = event(1)) => ({ access, mode: "detail", expectedWorkerId: access === "self" ? worker : null, eventId, operationId });
  const cmd = (n, revision = 0, note = "Synthetic explanation", eventId = event(1)) => ({ eventId, operationId: op(n), expectedRevision: revision, note });
  const call = (q = detail(), c = null, who = q.access === "self" ? auth : owner, tenant = site) => `public.faolla_attendance_location_discussion_v1('${tenant}','${who}',${json(q)},${c ? json(c) : "null"})`;
  const deny = (code, expr) => `begin perform ${expr};raise exception 'unexpected acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const read = name => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = ["bounded empty batch continues across microsecond ties", "self anomalies require current worker AND original employee actor",
    "private owner notes never appear in either discussion projection", "employee explanation and explicit owner reply serialize through revision CAS",
    "lost response replays original receipt without duplicates or cross-actor leakage", "new explanation remains visibly unanswered after an internal reviewed status",
    "current view permission is required; clock permission controls new explanations only", "employee/role revocation, worker pin and current owner are rechecked",
    "latest 20 messages and older operation receipt remain independently available", "malformed input, cross-tenant and non-anomalies are rejected",
    "service-only RPC and append-only ledger protect original facts and internal reviews"];
  const output = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${read("202609300072_merchant_attendance_location_clock.sql")}
    ${read("202609300074_merchant_attendance_location_reviews.sql")}
    ${read("202609300075_merchant_attendance_location_discussion.sql")}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('${otherSite}','${id(75999)}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC'),('${otherSite}','UTC');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Discussion self',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${employee}','${site}','${auth}','discussion@example.test','Synthetic employee','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${place}','${site}','Disabled historical place','UTC',false);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active) values
      ('${worker}','${site}','${employee}','DISC','Synthetic worker',false),('${otherWorker}','${site}',null,'OTHER','Other worker',false);
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,actor_employee_id)
      select ('00000000-0000-4000-8000-'||lpad((75100+n)::text,12,'0'))::uuid,'${site}','${worker}','${place}',
        ('00000000-0000-4000-8000-'||lpad((75500+n)::text,12,'0'))::uuid,n,case when n%2=1 then 'clock_in' else 'clock_out' end,'web','UTC',
        '2026-09-28T10:00:00Z'::timestamptz+((n-1)/2)*interval '1 microsecond',case when n=4 then null else '${employee}'::uuid end from generate_series(1,54)n;
    insert into public.merchant_attendance_location_results(event_id,settings_version,worker_version,location_version,algorithm_version,reason,needs_review,captured_at,accuracy_meters,distance_meters)
      select id,1,1,1,1,case when sequence=3 then 'inside' else 'denied' end,sequence<>3,
        case when sequence=3 then occurred_at else null end,case when sequence=3 then 10 else null end,case when sequence=3 then 0 else null end
      from public.merchant_attendance_events where merchant_id='${site}' and sequence<=4;
    do $seed$ begin perform public.faolla_attendance_location_reviews_v1('${site}','${owner}',${json({ mode: "detail", eventId: event(1), operationId: null })},
      ${json({ ...cmd(90), outcome: "noted", note: "PRIVATE_INTERNAL_DO_NOT_DISCLOSE" })});end $seed$;
    create temp table original_discussion_events as select * from public.merchant_attendance_events;
    create temp table original_discussion_summaries as select * from public.merchant_attendance_location_results;
    create temp table original_discussion_reviews as select * from public.merchant_attendance_location_reviews;
    set local role service_role;
    do $checks$ declare a jsonb;b jsonb;q jsonb;begin
      a:=${call(list)};assert a->>'scanned'='50' and a->'items'='[]'::jsonb and a->'nextCursor'->>'id'='${event(5)}','empty first batch';
      q:=${json(list)}||jsonb_build_object('expectedWorkerId','${worker}','asOf',a->'asOf','cursorAt',a->'nextCursor'->'occurredAt','cursorId',a->'nextCursor'->'id');
      b:=public.faolla_attendance_location_discussion_v1('${site}','${auth}',q,null);
      assert b->>'scanned'='4' and jsonb_array_length(b->'items')=2 and b->'items'->1->>'eventId'='${event(1)}' and b->'nextCursor'='null'::jsonb,'only original employee anomalies';
      a:=${call({ ...list, access: "owner" })};
      q:=${json({ ...list, access: "owner" })}||jsonb_build_object('asOf',a->'asOf','cursorAt',a->'nextCursor'->'occurredAt','cursorId',a->'nextCursor'->'id');
      b:=public.faolla_attendance_location_discussion_v1('${site}','${owner}',q,null);
      assert jsonb_array_length(b->'items')=3 and b->'workerId'='null'::jsonb and b->'employeeId'='null'::jsonb,'owner branch includes all anomalies without employee binding';
      ${deny("attendance_review_not_found", call(detail("self", null, event(3))))}
      ${deny("attendance_review_not_found", call(detail("self", null, event(4))))}
      ${deny("attendance_review_not_found", call(detail("self", null, event(5))))}
      a:=${call()};assert a->'history'='[]'::jsonb and a->'item'->>'reviewState'='reviewed' and a::text not like '%PRIVATE_INTERNAL%','private notes hidden';
      a:=${call(detail(), cmd(1))};assert a->'receipt'->>'revision'='1' and a->'item'->>'lastAuthor'='self','employee append';
      b:=${call(detail(), cmd(1))};assert b->'receipt'=a->'receipt','replay';
      ${deny("attendance_operation_conflict", call(detail(), cmd(1, 0, "Changed")))}
      ${deny("attendance_version_conflict", call(detail("owner"), cmd(2)))}
      b:=${call(detail("owner", op(1)))};assert b->'receipt'='null'::jsonb and b::text not like '%PRIVATE_INTERNAL%','owner cannot read employee receipt';
      ${deny("attendance_operation_conflict", call(detail("owner"), cmd(1)))}
      b:=${call(detail("owner"), cmd(2, 1, "Visible owner reply"))};assert b->'item'->>'lastAuthor'='owner','owner reply';
      b:=${call(detail(), cmd(3, 2, "Later employee explanation"))};assert b->'item'->>'lastAuthor'='self' and b->'item'->>'reviewState'='reviewed','reviewed does not hide new explanation';
      b:=${call(detail("self", op(1)))};assert b->'receipt'=a->'receipt' and b->'item'->>'revision'='3','old receipt independent';
      ${deny("attendance_operation_conflict", call(detail("self", null, event(2)), cmd(1, 0, "Synthetic explanation", event(2))))}
      ${deny("attendance_access_denied", call(detail(), null, owner))}
      ${deny("attendance_access_denied", call(detail("owner"), null, auth))}
      ${deny("attendance_access_denied", call(detail(), null, auth, otherSite))}
      ${deny("attendance_worker_changed", call({ ...detail(), expectedWorkerId: otherWorker }))}
      ${[{ ...list, actor: auth }, { ...list, toAt: "2026-11-01T00:00:00.000000Z" }, { ...list, cursorId: event(5) }, { ...list, asOf: "2099-01-01T00:00:00.000000Z" }, { ...detail(), expectedWorkerId: null }, { ...detail("owner"), expectedWorkerId: worker }].map(q => deny("attendance_invalid_request", call(q))).join("\n")}
      ${[{ ...cmd(9, 3), actor: auth }, { ...cmd(9, 3), expectedRevision: "3" }, cmd(9, 3, ""), cmd(9, 3, "x".repeat(501)), cmd(9, 3, "line\nbreak")].map(c => deny("attendance_invalid_request", call(detail(), c))).join("\n")}
    end $checks$;reset role;
    savepoint permission;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call(detail("self", op(1)))};assert a->'canPost'='false'::jsonb and a->'receipt'->>'revision'='1','view-only recovery';
      a:=${call(detail(), cmd(1))};assert a->'receipt'->>'revision'='1','known replay needs view only';
      ${deny("attendance_access_denied", call(detail(), cmd(4, 3)))}
    end $checks$;reset role;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';
    set local role service_role;do $checks$ begin ${deny("attendance_access_denied", call(detail("self", op(1))))} end $checks$;reset role;
    rollback to savepoint permission;
    savepoint inactive;
    update public.merchant_enterprise_employees set status='disabled' where id='${employee}';
    set local role service_role;do $checks$ begin ${deny("attendance_access_denied", call(list))} end $checks$;reset role;
    rollback to savepoint inactive;
    savepoint rebound;
    update public.merchant_attendance_workers set employee_id=null where id='${worker}';
    update public.merchant_attendance_workers set employee_id='${employee}' where id='${otherWorker}';
    set local role service_role;do $checks$ declare a jsonb;begin
      ${deny("attendance_worker_changed", call(detail("self", op(1))))}
      ${deny("attendance_review_not_found", call({ ...detail(), expectedWorkerId: otherWorker }))}
      a:=${call(list)};assert a->>'workerId'='${otherWorker}' and a->'items'='[]'::jsonb,'fresh list never recovers former worker data';
    end $checks$;reset role;rollback to savepoint rebound;
    savepoint inactive_role;
    update public.merchant_enterprise_roles set status='archived' where id='${role}';
    set local role service_role;do $checks$ begin ${deny("attendance_access_denied", call(detail()))} end $checks$;reset role;
    rollback to savepoint inactive_role;
    savepoint transfer;
    update public.merchants set user_id='${id(75998)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';
    set local role service_role;do $checks$ declare a jsonb;begin
      ${deny("attendance_access_denied", call(detail("owner", op(2))))}
      a:=${call(detail("owner", op(2)), null, id(75998))};assert a->'receipt'='null'::jsonb and jsonb_array_length(a->'history')=3,'new owner public history not old receipt';
    end $checks$;reset role;rollback to savepoint transfer;
    savepoint long_history;
    set local role service_role;do $checks$ declare a jsonb;i integer;begin
      for i in 4..22 loop a:=public.faolla_attendance_location_discussion_v1('${site}','${auth}',${json(detail())},jsonb_build_object('eventId','${event(1)}',
        'operationId',('00000000-0000-4000-8000-'||lpad((75400+i)::text,12,'0')),'expectedRevision',i-1,'note','Synthetic later explanation'));end loop;
      a:=${call(detail("self", op(1)))};assert a->'historyTruncated'='true'::jsonb and jsonb_array_length(a->'history')=20 and a->'history'->19->>'revision'='3' and a->'receipt'->>'revision'='1','bounded history';
    end $checks$;reset role;rollback to savepoint long_history;
    ${["anon", "authenticated"].map(r => `set local role ${r};do $checks$ begin perform ${call()};raise exception 'RPC accepted';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    set local role service_role;do $checks$ begin
      begin perform 1 from public.merchant_attendance_location_discussion;raise exception 'direct read';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_location_discussion_entry_v1(null::public.merchant_attendance_location_discussion);raise exception 'helper';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    do $checks$ begin
      begin update public.merchant_attendance_location_discussion set note='rewrite';raise exception 'rewrite';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_discussion;raise exception 'delete';exception when insufficient_privilege then null;end;
      begin truncate public.merchant_attendance_location_discussion;raise exception 'truncate';exception when insufficient_privilege then null;end;
      assert (select count(*) from public.merchant_attendance_location_discussion)=3,'no duplicates';
      ${["events", "summaries", "reviews"].map((suffix, i) => `assert not exists((select * from original_discussion_${suffix} except select * from public.${["merchant_attendance_events", "merchant_attendance_location_results", "merchant_attendance_location_reviews"][i]}) union all (select * from public.${["merchant_attendance_events", "merchant_attendance_location_results", "merchant_attendance_location_reviews"][i]} except select * from original_discussion_${suffix})),'${suffix} unchanged';`).join("\n")}
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(output), labels); labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(e => { console.error(e); process.exitCode = 1; });
