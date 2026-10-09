// Static source contracts, not database execution evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const name='202610030120_merchant_attendance_schedule_overview.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const strip=s=>s.replace(/--[^\n]*/g,'');
const fn=sql.match(/create or replace function[\s\S]*?\n\$\$;/)?.[0];assert(fn);
const body=strip(fn),outside=strip(sql.replace(fn,''));
const ordered=(source,...parts)=>{let at=-1;for(const part of parts){const next=source.indexOf(part,at+1);assert(next>at,part);at=next;}};

test('120 adds only one read-only RPC and its registry row; original099 writers, tables and indexes are untouched',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);
  assert.match(sql,/begin;\nset local lock_timeout='3s';/);
  assert.equal((strip(sql).match(/create or replace function/g)||[]).length,1);
  assert.match(body,/faolla_attendance_schedule_overview_v1\(p_query jsonb,p_auth_user_id uuid\)/);
  assert.doesNotMatch(strip(sql),/\b(create table|create index|alter table|alter function|drop|delete from|owner to|create policy)\b/i);
  assert.doesNotMatch(body,/\b(insert|update|delete|truncate)\b/i);
  assert.match(outside,/values\(202610030120,'merchant_attendance_schedule_overview'\) on conflict\(version\) do nothing/);
  assert.match(outside,/version=202610010099 and name='merchant_attendance_schedule'/);
  for(const dependency of ['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations','attendance_schedule_worker_date_idx'])
    assert(outside.includes(`to_regclass('public.${dependency}') is null`));
  assert(outside.includes("to_regprocedure('public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean)') is null"));
});

test('exact8 query binds sorted unique1..20 UUID workers,31 local dates and safe snapshot versions',()=>{
  assert(body.includes("jsonb_object_keys(p_query))<>8"));
  assert(body.includes("array['siteId','workerIds','fromDate','throughDate','revision','cursorDate','cursorStart','cursorId']"));
  assert(body.includes("jsonb_array_length(p_query->'workerIds') not between 1 and 20"));
  assert(body.includes('worker<=previous_worker'));assert(body.includes('workers:=array_append(workers,worker)'));
  assert(body.includes("between date '2000-01-01' and date '2100-12-31'"));
  assert(body.includes('last_day<first_day or last_day-first_day>30'));
  assert(body.includes("jsonb_typeof(p_query->'revision')<>'number'"));assert(body.includes('::numeric>9007199254740989'));
  assert(body.includes('elsif snapshot_revision>latest_revision then'));
});

test('cursor is all-or-none, snapshot-required and exact UTC milliseconds aligned to a minute',()=>{
  assert(body.includes("(p_query->'cursorDate'='null'::jsonb)<>(p_query->'cursorStart'='null'::jsonb)"));
  assert(body.includes("(p_query->'cursorDate'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb)"));
  assert(body.includes("if snapshot_revision is null or jsonb_typeof(p_query->'cursorId')<>'string'"));
  assert(body.includes('T[0-9]{2}:[0-9]{2}:00\\.000Z$'));
  assert(body.includes('cursor_day not between first_day and last_day'));
  assert(body.includes("to_char(cursor_start at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')<>p_query->>'cursorStart'"));
  assert(body.includes('not isfinite(cursor_start)'));
  assert.doesNotMatch(body,/cursor_start\s*(?:<|>|between)/i,'local date bounds must not silently become UTC year bounds');
});

test('every page locks current owner then settings and selected tenant workers, but does not filter historic active/binding state',()=>{
  ordered(body,"perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;",
    'perform 1 from public.merchant_attendance_settings where merchant_id=site for share;',
    'foreach worker in array workers loop','perform 1 from public.merchant_attendance_workers where merchant_id=site and id=worker for share;',
    'select coalesce(max(revision),0)','with probes as materialized');
  assert.doesNotMatch(body,/merchant_enterprise_employees|merchant_enterprise_roles|employee_id|worker\.active|settings\.enabled|p_allow_write|moduleEnabled/);
});

test('each index-aligned51 probe precedes revision filtering; merge51 advances a scan cursor for the first50 including empty pages',()=>{
  const probes=body.slice(body.indexOf('with probes as materialized'),body.indexOf('loop\n    count_rows'));
  assert.match(probes,/unnest\(workers\) selected\(worker_id\)[\s\S]*cross join lateral/);
  assert(probes.includes('x.worker_id=selected.worker_id and x.work_date between first_day and last_day'));
  assert(probes.includes('(x.work_date,x.start_at,x.id)>(cursor_day,cursor_start,cursor_id)'));
  assert.equal((probes.match(/limit 51/g)||[]).length,2);
  assert.doesNotMatch(probes,/revision|cancellation|offset\b/i);
  ordered(body,'count_rows:=count_rows+1;exit when count_rows=51;',"next_cursor:=jsonb_build_object('workDate'",'if candidate.revision>snapshot_revision then continue;',
    'select * into published','items:=items||jsonb_build_array');
  assert(body.includes("'scanned',least(count_rows,50)"));
  assert(body.includes("'nextCursor',case when count_rows=51 then next_cursor else 'null'::jsonb end"));
});

test('original publication and cancellation must match each returned slot; future cancellation is hidden by JOIN ON',()=>{
  assert(body.includes("published.command->>'action' is distinct from 'publish'"));
  assert(body.includes("published.query->>'workerId' is distinct from candidate.worker_id::text"));
  assert(body.includes("published.command->>'locationId' is distinct from candidate.location_id::text"));
  assert(body.includes("published.command->>'timeZone' is distinct from candidate.time_zone"));
  assert(body.includes("(published.command->>'expectedRevision')::bigint is distinct from candidate.revision-1"));
  assert(body.includes("published.command->'slots' @> jsonb_build_array(jsonb_build_array(start_text,end_text))"));
  assert.match(body,/left join public\.merchant_attendance_schedule_cancellations c on c\.merchant_id=s\.merchant_id and c\.slot_id=s\.id and c\.revision<=snapshot_revision\s+where s\.merchant_id=site/);
  assert(body.includes("cancelled.command->>'slotId' is distinct from candidate.id::text"));
  assert(body.includes('cancel_revision<=candidate.revision'));
  assert(body.includes("exception when others then raise exception 'attendance_schedule_overview_invalid';end;"));
});

test('safe immutable item projection has12 keys, result11, no employee identity/reasons or invented totals',()=>{
  const projection=body.slice(body.indexOf('items:=items||jsonb_build_array'),body.indexOf('\n  end loop;',body.indexOf('items:=items||jsonb_build_array')));
  assert.deepEqual([...projection.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]),['id','workerId','workerName','locationId','locationName','timeZone','workDate','startAt','endAt','revision','cancelled','cancelRevision']);
  const output=body.slice(body.indexOf("result:=jsonb_build_object('protocol'"),body.indexOf('if octet_length'));
  assert.deepEqual([...output.matchAll(/'([A-Za-z]+)',/g)].map(m=>m[1]),['protocol','readOnly','siteId','ownerId','workerIds','fromDate','throughDate','revision','items','scanned','nextCursor']);
  assert.doesNotMatch(projection+output,/employee|reason|operationId|total|absence|payroll|to_jsonb\(candidate\)/i);
  assert(body.includes("(candidate.start_at at time zone candidate.time_zone)::date<>candidate.work_date"));
  assert(body.includes("date_trunc('minute',candidate.start_at)<>candidate.start_at"));
  assert(body.includes('octet_length(result::text)>131072'));
});

test('service-only ACL and idempotent ledger are checked with no original-table grants or owner replacement',()=>{
  const signature='public.faolla_attendance_schedule_overview_v1(jsonb,uuid)';
  assert(body.includes('security definer set search_path=pg_catalog'));
  assert(outside.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role;`));
  assert(outside.includes(`grant execute on function ${signature} to service_role;`));
  assert.equal((outside.match(/grant execute/g)||[]).length,1);
  for(const role of ['service_role','anon','authenticated'])assert(outside.includes(`has_function_privilege('${role}','${signature}','EXECUTE')`));
  assert.doesNotMatch(outside,/grant (select|insert|update|all)|has_table_privilege|alter function|owner to/i);
  ordered(outside,'on conflict(version) do nothing;','do $schedule_overview_postconditions$',"notify pgrst, 'reload schema';",'commit;');
});
