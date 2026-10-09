//185 static provenance/scope proofs. PostgreSQL/runtime is root-owned.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const filename='202610050155_merchant_attendance_period_fixed_boundaries.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read(filename),clean=sql.replace(/--[^\n]*/g,'');
const old153=read('202610050153_merchant_attendance_period_session_capacity.sql');
const old154=read('202610050154_merchant_attendance_period_missing_root_capacity.sql');
const old103=read('202610010103_merchant_attendance_missing_revisions.sql');
const old149=read('202610050149_merchant_attendance_period_closure.sql');
const fn=(text,name)=>{const start=text.indexOf('create or replace function public.'+name+'('),open=text.indexOf('$$',start),end=text.indexOf('$$;',open+2);assert(start>=0&&open>start&&end>open,name);return text.slice(start,end+3);};
const once=(text,from,to)=>{assert.equal(text.split(from).length,2,from);return text.replace(from,()=>to);};
const region=(text,from,to)=>{const a=text.indexOf(from),b=text.indexOf(to,a);assert(a>=0&&b>a,from);return text.slice(a,b);};
const has=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const order=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const source=fn(sql,'faolla_attendance_period_closure_source_v1'),closure=fn(sql,'faolla_attendance_period_closure_v1');
const original=fn(old154,'faolla_attendance_period_source_v1');
const frame=region(source,'  --155 fixed frame begins.','  --155 fixed frame ends.')+'  --155 fixed frame ends.\n';
const oldBoundary="from_at:=public.faolla_attendance_control_day_boundary_v1(first_day,s.time_zone);\n  to_at:=public.faolla_attendance_control_day_boundary_v1(last_day+1,s.time_zone);\n  if (from_at at time zone s.time_zone)::date<>first_day or\n    (public.faolla_attendance_control_day_boundary_v1(last_day,s.time_zone) at time zone s.time_zone)::date<>last_day\n    then raise exception 'attendance_local_date_does_not_exist';end if;";
const newBoundary="from_at:=(p_frame->>'fromAt')::timestamptz;to_at:=(p_frame->>'toAt')::timestamptz;\n  if public.faolla_attendance_shift_rule_binding_object_v1(p_frame,array['timeZone','fromAt','toAt']) is distinct from true\n    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_frame->'timeZone','zone') is distinct from true\n    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_frame->'fromAt','stamp6') is distinct from true\n    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_frame->'toAt','stamp6') is distinct from true\n    or from_at>=to_at then raise exception 'attendance_period_closure_invalid';end if;";
const oldDays="  for d in select generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')::date loop\n    a:=public.faolla_attendance_control_day_boundary_v1(d,s.time_zone);b:=public.faolla_attendance_control_day_boundary_v1(d+1,s.time_zone);\n    day_items:=day_items||jsonb_build_array(jsonb_build_object('date',d,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'skipped',a=b));\n  end loop;";
const declarations="  fixed_head public.merchant_attendance_period_closures%rowtype;fixed_artifact public.merchant_attendance_period_artifacts%rowtype;\n  fixed_version public.merchant_attendance_period_versions%rowtype;fixed_body jsonb;current_body jsonb;fixed_frame jsonb;fixed_day jsonb;fixed_pid uuid;fixed_index integer:=0;\n  fixed_previous timestamptz;\n";

test('155 installs four new functions and narrowly replaces149, no tables/indexes or generic reader definitions',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[
    'faolla_attendance_period_closure_report_v1','faolla_attendance_period_closure_scoped_report_v1',
    'faolla_attendance_period_closure_unified_report_v1','faolla_attendance_period_closure_source_v1','faolla_attendance_period_closure_v1']);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  has(clean,"set local lock_timeout='3s'","values(202610050155,'merchant_attendance_period_fixed_boundaries')");
  assert.doesNotMatch(clean,/create\s+(?:table|index|trigger)|alter\s+table|drop\s+(?:function|table|index)|session_replication_role|disable trigger|statement_timeout|set_config|pg_advisory/i);
  const withoutLifecycle=clean.replace(closure.replace(/--[^\n]*/g,''),'');
  assert.doesNotMatch(withoutLifecycle,/update public\.|delete from|truncate\s|insert into public\.(?!faolla_schema_migrations)/i);
});
test('155 requires exact predecessors093/103/148-154 and guards registry/partial function installations',()=>{
  for(const [v,n] of [
    [202610010093,'merchant_attendance_versioned_reports'],[202610010103,'merchant_attendance_missing_revisions'],
    [202610050148,'merchant_attendance_period_source'],[202610050149,'merchant_attendance_period_closure'],
    [202610050150,'merchant_attendance_period_seal_guards'],[202610050151,'merchant_attendance_period_source_ranges'],
    [202610050152,'merchant_attendance_period_missing_context'],[202610050153,'merchant_attendance_period_session_capacity'],
    [202610050154,'merchant_attendance_period_missing_root_capacity']])has(clean,"("+v+"::bigint,'"+n+"')");
  has(clean,'m.version=dependency.version and m.name=dependency.name',
    "version=202610050155 and name<>'merchant_attendance_period_fixed_boundaries'",
    'installed<>(function_id is not null)','p.oid is distinct from function_id');
  order(clean,'$period_fixed_boundaries_prerequisites$;','create or replace function','$period_fixed_boundaries_postconditions$;',"values(202610050155,",'commit;');
});
test('service-only new source and completely private report forks have exact signatures/metadata before and after',()=>{
  const header=sql.slice(0,sql.indexOf('create or replace function'));
  const footer=sql.slice(sql.indexOf('do $period_fixed_boundaries_postconditions$'));
  for(const s of [header,footer])has(s,"p.prokind='f'","p.prorettype='jsonb'::regtype",'not p.proretset','p.proargnames=spec.arg_names',
    'p.proargmodes is null','p.pronargs=cardinality(spec.arg_names)','p.pronargdefaults=0',"l.lanname='plpgsql'",
    'p.prosecdef',"p.provolatile='v'","p.proparallel='u'","p.proconfig=array['search_path=pg_catalog']::text[]",
    'p.proowner=(select proowner','acl.is_grantable','acl.grantee<>p.proowner','has_function_privilege','spec.service_allowed');
  assert.deepEqual([...clean.matchAll(/grant execute on function ([^;]+);/g)].map(x=>x[1]),['public.faolla_attendance_period_closure_source_v1(jsonb,uuid) to service_role']);
  for(const n of ['report','scoped_report','unified_report'])has(clean,'revoke all on function public.faolla_attendance_period_closure_'+n+'_v1(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;');
});
for(const [oldName,newName] of [
  ['faolla_attendance_period_report_v2','faolla_attendance_period_closure_report_v1'],
  ['faolla_attendance_scoped_period_report_v2','faolla_attendance_period_closure_scoped_report_v1']]){
  test('private '+newName+' differs from153 only by internal frame injection',()=>{
    let restored=fn(sql,newName);
    restored=once(restored,newName,oldName);
    restored=once(restored,'p_auth_user_id uuid,p_query jsonb,p_frame jsonb)','p_auth_user_id uuid,p_query jsonb)');
    restored=once(restored,newBoundary,oldBoundary);
    restored=once(restored,"'timeZone',p_frame->'timeZone',","'timeZone',s.time_zone,");
    assert.equal(restored,fn(old153,oldName));
    assert.doesNotMatch(fn(sql,newName),/control_day_boundary|at time zone s.time_zone/);
  });
}
test('private unified fork is byte-equivalent to103 except routing its two private report calls',()=>{
  let restored=fn(sql,'faolla_attendance_period_closure_unified_report_v1');
  restored=once(restored,'faolla_attendance_period_closure_unified_report_v1','faolla_attendance_unified_report_v1');
  restored=once(restored,'p_auth_user_id uuid,p_query jsonb,p_frame jsonb)','p_auth_user_id uuid,p_query jsonb)');
  restored=once(restored,"public.faolla_attendance_period_closure_report_v1(p_site_id,p_auth_user_id,p_query-'access',p_frame)","public.faolla_attendance_period_report_v2(p_site_id,p_auth_user_id,p_query-'access')");
  restored=once(restored,'public.faolla_attendance_period_closure_scoped_report_v1(p_site_id,p_auth_user_id,p_query,p_frame)','public.faolla_attendance_scoped_period_report_v2(p_site_id,p_auth_user_id,p_query)');
  assert.equal(restored,fn(old103,'faolla_attendance_unified_report_v1'));
});
test('new source is154 byte-equivalent after removing only trusted frame resolution and report/day inputs',()=>{
  let restored=source;
  restored=once(restored,'function public.faolla_attendance_period_closure_source_v1','function public.faolla_attendance_period_source_v1');
  restored=once(restored,declarations,'');
  restored=once(restored,"p_query,array['siteId','access','workerId','fromDate','throughDate','periodId']","p_query,array['siteId','access','workerId','fromDate','throughDate']");
  restored=once(restored,"  if p_query->'periodId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'periodId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;\n  fixed_pid:=(p_query->>'periodId')::uuid;\n",'');
  restored=once(restored,frame,'');
  restored=once(restored,'  report:=public.faolla_attendance_period_closure_unified_report_v1','  report:=public.faolla_attendance_unified_report_v1');
  restored=once(restored,"'fromDate',first_day,'throughDate',last_day) end,fixed_frame);","'fromDate',first_day,'throughDate',last_day) end);");
  restored=once(restored,"  day_items:=fixed_body->'dayBoundaries';",oldDays);
  restored=once(restored,"'timeZone',fixed_head.time_zone,'fromDate'","'timeZone',s.time_zone,'fromDate'");
  assert.equal(restored,original);
});
test('six-key query supplies only period identity; unknown new IDs use old current-source after real actor locks',()=>{
  has(source,"p_query,array['siteId','access','workerId','fromDate','throughDate','periodId']",
    "p_query->'periodId'<>'null'::jsonb","p_query->'periodId','uuid'");
  order(source,"from public.merchants where id=site","from public.merchant_attendance_settings where merchant_id=site for share",
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'from public.merchant_attendance_period_closures where merchant_id=site and period_id=fixed_pid',
    'if fixed_head.period_id is null then',"return public.faolla_attendance_period_source_v1(p_query-'periodId',p_auth_user_id)");
  assert.doesNotMatch(source,/p_query->>?\s*'(?:timeZone|fromAt|toAt|dayBoundaries|frame)'/);
});
test('existing period cannot fall back on wrong worker/date/current identity and source remains owner/self only',()=>{
  has(frame,"fixed_head.worker_id<>wid or fixed_head.from_date<>first_day or fixed_head.through_date<>last_day then raise exception 'attendance_access_denied'",
    "fixed_head.employee_id<>emp.id or fixed_head.employee_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_identity_changed'");
  has(source,"p_query->>'access' not in('owner','self')","emp.auth_user_id<>p_auth_user_id or emp.status<>'active'",
    "'attendance.self.view'=any(role_row.permissions)");
  assert.doesNotMatch(frame,/user_id=p_auth_user_id|current_setting|set_config|update /i);
});
test('frame comes from version1 checked archive and matches immutable head/source/double identity/SHA',()=>{
  order(frame,'version=1;','artifact_id=fixed_version.artifact_id','faolla_attendance_period_artifact_checked_v1(fixed_artifact)',
    'faolla_attendance_period_summary_v1(fixed_head,fixed_body)','fixed_version.version is distinct from 1');
  has(frame,"fixed_body->'source'->>'siteId' is distinct from site","fixed_body->'source'->>'workerId' is distinct from wid::text",
    "fixed_body->'source'->>'employeeId' is distinct from emp.id::text","fixed_body->'source'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text",
    "encode(sha256(convert_to((fixed_body->'source')::text,'UTF8')),'hex')",
    "fixed_body->'dayBoundaries' is distinct from fixed_body->'source'->'dayBoundaries'");
});
test('saved days are ordered civil dates, adjacent UTC endpoints, explicit skipped dates and exact head coverage without tzdata',()=>{
  has(frame,"jsonb_array_length(fixed_body->'dayBoundaries')<>last_day-first_day+1",
    "array['date','fromAt','toAt','skipped']","fixed_day->>'date' is distinct from (first_day+fixed_index)::text",
    "fixed_day->'fromAt','stamp6'","fixed_day->'toAt','stamp6'","jsonb_typeof(fixed_day->'skipped') is distinct from 'boolean'",
    "a>b or fixed_day->'skipped' is distinct from to_jsonb(a=b)",
    'fixed_index=0 and a is distinct from fixed_head.start_at','fixed_index>0 and a is distinct from fixed_previous',
    'fixed_previous:=b;fixed_index:=fixed_index+1','fixed_previous is distinct from fixed_head.end_at',
    "fixed_body->'dayBoundaries'->0->'skipped' is distinct from 'false'::jsonb","fixed_body->'dayBoundaries'->-1->'skipped' is distinct from 'false'::jsonb");
  assert.doesNotMatch(frame,/control_day_boundary|pg_timezone|at time zone (?!'UTC')/i);
});
test('current saved version cannot silently replace the original frame or carry a damaged source hash',()=>{
  has(frame,'version=fixed_head.current_version','current_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact)',
    'faolla_attendance_period_summary_v1(fixed_head,current_body)',
    "current_body->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'",
    "current_body->'source'->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'",
    "encode(sha256(convert_to((current_body->'source')::text,'UTF8')),'hex')");
});
test('149 lifecycle changes only sourceQuery periodId and four calls, preserving recovery, fixed archive and seal UTC logic',()=>{
  let restored=closure;
  restored=once(restored,"source_query:=jsonb_build_object('siteId',site,'access',access_name,'workerId',wid,'fromDate',first_day,'throughDate',last_day,'periodId',pid);",
    "source_query:=jsonb_build_object('siteId',site,'access',access_name,'workerId',wid,'fromDate',first_day,'throughDate',last_day);");
  assert.equal((restored.match(/public.faolla_attendance_period_closure_source_v1\(source_query,p_auth_user_id\)/g)||[]).length,4);
  restored=restored.replaceAll('public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id)','public.faolla_attendance_period_source_v1(source_query,p_auth_user_id)');
  assert.equal(restored,fn(old149,'faolla_attendance_period_closure_v1'));
});
test('full154 caps, long-open/current corrections and contextual calendar own-zone logic are retained',()=>{
  has(source,'all_candidates order by id limit 102','expected_report_count>=100','total_events>4000',"x.start_at>=range_from-interval '744 hours'",
    "octet_length(convert_to(source_text,'UTF8'))>1048576","octet_length(convert_to(result::text,'UTF8'))>4194304",
    'public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone)',
    'canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;');
  assert.doesNotMatch(source,/control_day_boundary_v1\([^\n]*s.time_zone/);
});

