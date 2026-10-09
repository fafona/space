// Static source contracts, not evidence of actual PostgreSQL behavior.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610040130_merchant_attendance_rule_sources.sql';
const sql=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const functionBody=name=>{
  const declaration=`create or replace function public.${name}(`,start=clean.indexOf(declaration);assert(start>=0,name);
  assert.equal(clean.indexOf(declaration,start+declaration.length),-1,`${name}: duplicate definition`);
  const end=clean.indexOf('$$;',start);assert(end>start,`${name}: missing function terminator`);return clean.slice(start,end+3);
};
const body=functionBody('faolla_attendance_rule_sources_v1'),helper=functionBody('faolla_attendance_rule_sources_personal_checked_v1');
const ordered=(...parts)=>{let position=-1;for(const part of parts){const next=body.indexOf(part,position+1);assert(next>position,part);position=next;}};

test('130 adds one independent rule-only RPC and one private checker without changing prior functions, facts, tables or protocols',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(match=>match[1]),['faolla_attendance_rule_sources_personal_checked_v1','faolla_attendance_rule_sources_v1']);
  assert.doesNotMatch(clean,/\b(?:create table|alter table|alter function|create index|drop|delete from|truncate|update public\.)\b/i);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(match=>match[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(body,/faolla_attendance_(?:sources_v1|unified_report|personal_rules_v1|rules_v1|groups_v1)\(/);
  assert.doesNotMatch(body,/merchant_attendance_(?:events|schedule|leave|calendar|missing|correction|effect)|p_command|p_allow_write|for update|lock table/i);
});

test('130 requires064124127129 only and rejects partial/named installation conflicts',()=>{
  for(const pair of ["202609290064::bigint,'merchant_attendance_owner_configuration'","202610030124::bigint,'merchant_attendance_groups'",
    "202610040127::bigint,'merchant_attendance_rule_versions'","202610040129::bigint,'merchant_attendance_personal_rules'"])assert(clean.includes(pair));
  assert.doesNotMatch(clean,/202610040128|control_day_boundary/);
  for(const part of ['merchant_attendance_rule_sources_prerequisite_required','merchant_attendance_rule_sources_installation_conflict',
    "installed<>(to_regprocedure('public.faolla_attendance_rule_sources_v1(jsonb,uuid)') is not null)",
    "installed<>(to_regprocedure('public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)') is not null)",
    "values(202610040130,'merchant_attendance_rule_sources') on conflict(version) do nothing"])assert(clean.includes(part));
  const prerequisites=clean.slice(clean.indexOf('foreach p in array array['),clean.indexOf('select exists(select 1 from public.faolla_schema_migrations'));
  for(const signature of ['faolla_attendance_group_text_v1(text,integer,integer)','faolla_attendance_personal_rule_command_v1(jsonb)',
    'faolla_attendance_personal_rule_item_v1(public.merchant_attendance_personal_rule_operations)',
    'faolla_attendance_personal_rule_stream_checked_v1(public.merchant_attendance_personal_rule_streams)',
    'faolla_attendance_personal_rule_receipt_v1(public.merchant_attendance_personal_rule_operations)',
    'faolla_attendance_rule_day_start_v1(text,text)','faolla_attendance_personal_rule_end_v1(text,text)'])assert(prerequisites.includes(`'public.${signature}'`),signature);
});

test('strict four-key single-worker query has1to7inclusive dates and validates real saved-zone UTC endpoints',()=>{
  for(const part of ['jsonb_object_keys(p_query))<>4',"array['siteId','workerId','fromDate','throughDate']",'last_day-first_day not between 0 and 6',
    "from_at:=public.faolla_attendance_rule_day_start_v1(p_query->>'fromDate',s.time_zone)",
    "to_at:=public.faolla_attendance_personal_rule_end_v1(p_query->>'throughDate',s.time_zone)",'from_at is null or to_at is null or to_at<=from_at'])assert(body.includes(part));
  assert.doesNotMatch(body,/coalesce\(p_auth_user_id|access.*self|access.*manager|s\.enabled/);
});

test('current owner settings worker employee SHARE locks precede all ledger reads; no fake STABLE snapshot guarantee',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share',
    'select * into s from public.merchant_attendance_settings where merchant_id=site for share',
    'select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'select * into personal_stream','assignment_candidates:=array','select * into stream');
  assert(body.includes('language plpgsql security definer set search_path=pg_catalog'));
  assert.doesNotMatch(body,/language plpgsql stable|set transaction|transaction_isolation|pg_advisory|lock table/i);
  assert(sql.includes('All supported124/127/129 writers require settings UPDATE'));
});

test('existing124127129 writing RPCs all take the same settings UPDATE fence before every ledger mutation',()=>{
  for(const [filename,name,prefix] of [
    ['202610030124_merchant_attendance_groups.sql','faolla_attendance_groups_v1','group'],
    ['202610040127_merchant_attendance_rule_versions.sql','faolla_attendance_rules_v1','rule'],
    ['202610040129_merchant_attendance_personal_rules.sql','faolla_attendance_personal_rules_v1','personal_rule'],
  ]){
    const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n').replace(/--[^\n]*/g,'');
    const start=source.indexOf(`create or replace function public.${name}(`);assert(start>=0,name);
    const entry=source.slice(start,source.indexOf('$$;',start)+3);
    const owner=entry.indexOf('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share');
    const fence=entry.indexOf('if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;\n  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;');
    assert(owner>=0&&fence>owner,`${name}: write-lock fence missing or reordered`);
    const writes=[...entry.matchAll(new RegExp(`(?:insert into|update) public\\.merchant_attendance_${prefix}\\w*\\b`,'g'))];
    assert(writes.length>=2,`${name}: expected ledger mutations`);
    for(const write of writes)assert(write.index>fence,`${name}: mutation before shared serialization fence`);
  }
});

test('current dual identity anchors a personal stream even if the queried interval is empty',()=>{
  ordered('select * into personal_stream','personal_stream.employee_id is distinct from w.employee_id or personal_stream.employee_auth_user_id is distinct from e.auth_user_id',
    "raise exception 'attendance_personal_rule_identity_changed'",'faolla_attendance_personal_rule_stream_checked_v1(personal_stream)','personal_candidates:=array');
  for(const part of ["'employeeAuthUserId',e.auth_user_id","'employeeActive',coalesce(e.status='active',false)","raise exception 'attendance_worker_not_found'"])assert(body.includes(part));
});

test('assignment101preflight precedes validation and retains original interval plus current group without silently selecting one membership',()=>{
  ordered('assignment_candidates:=array','order by a.assignment_id limit 101','assignment_limited:=cardinality(assignment_candidates)>100',
    'if not assignment_limited then','faolla_attendance_group_assignment_detail_v1(assignment)','if interval_from_at>=to_at or interval_to_at<=from_at then continue',
    "jsonb_build_object('detail',item,'currentGroup',public.faolla_attendance_group_checked_v1(g))");
  assert(body.includes('a.original_ends_on is null or a.original_ends_on>=first_day-2'));assert(body.includes('boundary_cache'));
  assert.doesNotMatch(body,/a\.status\s*(?:=|<>)|g\.active\s*=|assignment\.ends_on/);
});

test('rule heads and total publications are bounded; carry-in does not depend on latest25operations and withdrawn publications are excluded',()=>{
  for(const part of ['rule_limited:=assignment_limited or cardinality(group_ids)+1>100','order by id nulls first','p.effective_at<=from_at',
    'order by p.effective_at desc limit 1','p.effective_at>from_at and p.effective_at<to_at','wd.published_revision=p.revision',
    'publication_count>100',"rule_items:='[]'",'publication.revision>head_revision','faolla_attendance_rule_receipt_v1(publication)'])assert(body.includes(part));
  assert.doesNotMatch(body,/limit 25|limit 26|beforeRevision|nextBeforeRevision/);
});

test('personal indexed34daylookback caps101before precise overlap and validates both immutable approval and optional withdrawal',()=>{
  ordered('personal_candidates:=array',"p.from_at>=rule_sources.from_at-interval '816 hours'",'p.from_at<rule_sources.to_at order by p.from_at,p.to_at limit 101',
    'personal_limited:=cardinality(personal_candidates)>100','if not personal_limited then','if approval.to_at<=from_at then continue',
    'personal_check_cache:=public.faolla_attendance_rule_sources_personal_checked_v1(approval,personal_check_cache)','p.approved_revision=approval.revision','withdrawal.revision>personal_revision',
    'personal_check_cache:=public.faolla_attendance_rule_sources_personal_checked_v1(withdrawal,personal_check_cache)',"jsonb_build_object('approval',approval.snapshot,'withdrawal',withdrawal_item)");
  assert(body.includes("jsonb_agg(value order by (value->'approval'->>'revision')::bigint)"));
  assert.doesNotMatch(body,/interval '34 days'/);
  assert.doesNotMatch(body,/approval\.rules\s*:=|withdrawal\.snapshot\s*:=|withdrawnByRevision/);
});

test('private cache memoizes only successful complete bodies and date bounds while rechecking each receipt envelope and source relation',()=>{
  assert(helper.includes('language plpgsql security invoker set search_path=pg_catalog'));
  assert.doesNotMatch(helper,/security definer|insert into|update public\.|delete from|set_config|current_setting|pg_timezone_names|while lo<hi/i);
  const commandLoop=helper.slice(helper.indexOf('foreach command in array commands loop'),helper.indexOf('end loop;',helper.indexOf('foreach command in array commands loop')));
  const envelope=commandLoop.slice(0,commandLoop.indexOf('command_key:='));
  for(const part of ["not(command ?& array['operationId','action','expectedRevision','reason'])","jsonb_typeof(command)<>'object'",
    "jsonb_typeof(command->'operationId')<>'string'","coalesce(command->>'operationId','') !~ u","jsonb_typeof(command->'action')<>'string'",
    "jsonb_typeof(command->'reason')<>'string'","not public.faolla_attendance_group_text_v1(command->>'reason',1,200)",
    "jsonb_typeof(command->'expectedRevision')<>'number'","coalesce(command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'",
    "(command->>'expectedRevision')::numeric>9007199254740989"])assert(envelope.includes(part),`uncached common envelope: ${part}`);
  assert(helper.includes("u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'"));
  assert.match(commandLoop,/command_cache:=command_cache\|\|jsonb_build_object\(command_key,true\);\s*end if;\s*if command->>'action'='withdraw' and \(command->>'approvedRevision'\)::numeric>\(command->>'expectedRevision'\)::numeric/);
  for(const part of ["command_key:=(command-array['operationId','expectedRevision','reason'])::text",
    "if command_cache->command_key is distinct from 'true'::jsonb then",
    'if not public.faolla_attendance_personal_rule_command_v1(command)',"command_cache:=command_cache||jsonb_build_object(command_key,true)",
    "not public.faolla_attendance_group_text_v1(command->>'reason',1,200)",
    "(command->>'approvedRevision')::numeric>(command->>'expectedRevision')::numeric",
    "p.command->>'operationId' is distinct from p.operation_id::text","(p.command->>'expectedRevision')::bigint is distinct from p.revision-1",
    'p.snapshot is distinct from expected','previous.operation_id is null','previous.recorded_at>p.recorded_at',
    'previous.snapshot is distinct from public.faolla_attendance_personal_rule_item_v1(previous)',
    'previous.employee_id is distinct from p.employee_id','previous.employee_auth_user_id is distinct from p.employee_auth_user_id',
    "elsif p.action<>'approve'",'target.operation_id is null',"target.action<>'approve'",'target.revision>=p.revision','target.recorded_at>p.recorded_at',
    'target.snapshot is distinct from public.faolla_attendance_personal_rule_item_v1(target)',
    "target.command->>'operationId' is distinct from target.operation_id::text","target.command->>'action' is distinct from target.action",
    "(target.command->>'expectedRevision')::bigint is distinct from target.revision-1",
    'p.recorded_at>=target.from_at',"p.command->'approvedRevision' is distinct from to_jsonb(p.approved_revision)",
    'row(p.employee_id,p.employee_auth_user_id,p.worker_version,p.settings_version,p.time_zone,p.starts_on,p.ends_on,p.from_at,p.to_at,p.rules)',
    'is distinct from row(target.employee_id,target.employee_auth_user_id,target.worker_version,target.settings_version,target.time_zone,target.starts_on,target.ends_on,target.from_at,target.to_at,target.rules)',
    "context.command->'expectedWorkerVersion' is distinct from to_jsonb(context.worker_version)",
    "context.command->'expectedSettingsVersion' is distinct from to_jsonb(context.settings_version)",
    "context.command->>'employeeId' is distinct from context.employee_id::text",
    "context.command->>'employeeAuthUserId' is distinct from context.employee_auth_user_id::text",
    "context.command->>'timeZone' is distinct from context.time_zone or context.rules is distinct from context.command->'rules'",
    "context.command->>'startsOn' is distinct from to_char(context.starts_on,'YYYY-MM-DD')",
    "context.command->>'endsOn' is distinct from to_char(context.ends_on,'YYYY-MM-DD')",
    'context.starts_on<=(context.recorded_at at time zone context.time_zone)::date',
    'context.from_at<=context.recorded_at',"jsonb_build_array('start',context.time_zone,context.command->>'startsOn')::text",
    "jsonb_build_array('end',context.time_zone,context.command->>'endsOn')::text",
    'context.from_at is distinct from context_from_at or context.to_at is distinct from context_to_at'])assert(helper.includes(part),part);
  assert(helper.indexOf('if not public.faolla_attendance_personal_rule_command_v1(command)')<helper.indexOf('command_cache:=command_cache||'));
  for(const [variable,kind,fn,date] of [['context_from_at','start','faolla_attendance_rule_day_start_v1','startsOn'],
    ['context_to_at','end','faolla_attendance_personal_rule_end_v1','endsOn']]){
    const start=helper.indexOf(`boundary_key:=jsonb_build_array('${kind}',context.time_zone,context.command->>'${date}')::text`);
    const cached=helper.slice(start,helper.indexOf('end if;',start));
    for(const part of [`${variable}:=(boundary_cache->>boundary_key)::timestamptz`,`if ${variable} is null then`,
      `${variable}:=public.${fn}(context.command->>'${date}',context.time_zone)`,
      `if ${variable} is null then raise exception 'attendance_personal_rule_invalid'`])assert(cached.includes(part),part);
    assert(helper.includes(`boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,${variable})`));
  }
  assert(helper.includes("return jsonb_build_object('commands',command_cache,'boundaries',boundary_cache)"));
  assert(body.includes("personal_check_cache jsonb:='{}'"));
  assert.doesNotMatch(body,/p_query\s*->>?\s*'(?:commands|boundaries|cache)'/);
});

test('wire protocol carries only rule evidence with canonical precision and total1MiBcap',()=>{
  ordered('read_at:=clock_timestamp()',"result:=jsonb_build_object('protocol','rule-sources-v1'",'octet_length(result::text)>1048576','return result');
  for(const part of ["'personal',jsonb_build_object('revision',personal_revision,'limited',personal_limited,'items',personal_items)",
    'SS.MS"Z"','SS.US"Z"',"raise exception 'attendance_rule_sources_too_large'"])assert(body.includes(part));
  assert.doesNotMatch(body,/'attendance'|'schedule'|'leave'|'calendar'|'assessment'|'payroll'/);
});

test('service-only execute and registry/ACL postconditions preserve the private read boundary',()=>{
  assert.deepEqual([...clean.matchAll(/grant execute on function ([^;]+);/g)].map(match=>match[1]),['public.faolla_attendance_rule_sources_v1(jsonb,uuid) to service_role']);
  for(const part of ['revoke all on function public.faolla_attendance_rule_sources_v1(jsonb,uuid) from public,anon,authenticated,service_role',
    'revoke all on function public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb) from public,anon,authenticated,service_role',
    'grant execute on function public.faolla_attendance_rule_sources_v1(jsonb,uuid) to service_role','merchant_attendance_rule_sources_acl_postcondition_failed',
    'merchant_attendance_rule_sources_registry_postcondition_failed',"notify pgrst, 'reload schema'"])assert(clean.includes(part));
  for(const role of ['service_role','anon','authenticated'])assert(clean.includes(`has_function_privilege('${role}','public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)','EXECUTE')`));
  assert(clean.includes("a.grantee=0 and a.privilege_type='EXECUTE'"));
});
