// Source contracts, not a substitute for the root-owned actual145 SQL probes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610050145_merchant_attendance_plan_adoption_view.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const strip=text=>text.replace(/--[^\n]*/g,'');
const source=read(file),clean=strip(source);
const helper='faolla_attendance_shift_plan_adoption_read_v1',shift='faolla_attendance_shift_check_adoption_v1',plan='faolla_attendance_plan_coverage_adoptions_v1';
const fn=(name,text=clean)=>{const start=text.indexOf(`create or replace function public.${name}(`);assert(start>=0,name);return text.slice(start,text.indexOf('$$;',start)+3);};
const proof=fn(helper),one=fn(shift),many=fn(plan);
const contains=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const ordered=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};

test('145 is additive: exactly three new functions and one registry write, no old storage/definition/ACL mutations',()=>{
  assert.deepEqual(validateMigrationSource(file,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[helper,shift,plan]);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|index)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop\s+(?:table|function|index)|create\s+trigger/i);
  const access=clean.slice(clean.indexOf('revoke all on function'),clean.indexOf('insert into public.faolla_schema_migrations'));
  assert.deepEqual([...new Set([...access.matchAll(/public\.(\w+)\(/g)].map(x=>x[1]))],[helper,shift,plan]);
});

test('atomic installation checks exact prerequisites, all-or-none function presence and registry conflict without repair',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  contains(clean,"set local lock_timeout='3s';","202610050138::bigint,'merchant_attendance_shift_check'",
    "202610050139::bigint,'merchant_attendance_plan_coverage'","202610050144::bigint,'merchant_attendance_self_schedule_adoption'",
    "name<>'merchant_attendance_plan_adoption_view'",'installed<>(to_regprocedure(signature) is not null)',
    "values(202610050145,'merchant_attendance_plan_adoption_view') on conflict(version) do nothing");
  assert.doesNotMatch(clean,/statement_timeout|pg_advisory|lock\s+table|session_replication_role|disable trigger/i);
  for(const block of clean.matchAll(/do \$(\w+)\$([\s\S]*?)\$\1\$;/g)){
    const declaration=block[2].slice(0,block[2].indexOf('begin'));
    for(const variable of declaration.matchAll(/\b(\w+)\s+record\b/g))
      assert.doesNotMatch(block[2],new RegExp('\\b(?:from|join)\\s+[\\w.]+\\s+(?:as\\s+)?'+variable[1]+'\\b','i'));
  }
});

test('public wrappers delegate exact query and owner auth once before looking up private fixed evidence',()=>{
  contains(one,`${shift}(p_query jsonb,p_auth_user_id uuid)`,"original_check->'binding'->>'actorId' is distinct from p_auth_user_id::text",
    "original_check->'binding'->'event'->>'startEventId' is distinct from p_query->>'startEventId'");
  contains(many,`${plan}(p_query jsonb,p_auth_user_id uuid)`,"original_coverage->>'actorId' is distinct from p_auth_user_id::text",
    "original_coverage->'slot'->>'id' is distinct from p_query->>'slotId'");
  assert.equal((one.match(/public\.faolla_attendance_shift_check_v1\(/g)||[]).length,1);
  assert.equal((many.match(/public\.faolla_attendance_plan_coverage_v1\(/g)||[]).length,1);
  ordered(one,'original_check:=public.faolla_attendance_shift_check_v1(p_query,p_auth_user_id)',`public.${helper}(original_check)`);
  ordered(many,'original_coverage:=public.faolla_attendance_plan_coverage_v1(p_query,p_auth_user_id)',`public.${helper}(child)`);
  assert.doesNotMatch(one+many,/p_command|p_allow_write|p_module_enabled|p_selection|p_approval_id|for update|for share|from public\.merchants/);
});

test('existing owner/read mutex order is inherited, including empty plan sets, with no new lock upgrade',()=>{
  const owner=read('202610040135_merchant_attendance_shift_rule_binding_reader.sql');
  ordered(owner,'from public.merchants where id=site and user_id=p_auth_user_id for share',
    'from public.merchant_attendance_settings where merchant_id=site for share',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share');
  const currentShift=fn('faolla_attendance_shift_check_v1',strip(read('202610050143_merchant_attendance_pin_schedule.sql')));
  contains(currentShift,'binding:=public.faolla_attendance_shift_rule_binding_v1(p_query,p_auth_user_id)');
  const coverage=fn('faolla_attendance_plan_coverage_v1',strip(read('202610050139_merchant_attendance_plan_coverage.sql')));
  ordered(coverage,'from public.merchants where id=site and user_id=p_auth_user_id for share',
    'from public.merchant_attendance_settings where merchant_id=site for share',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'candidates:=array(', 'public.faolla_attendance_shift_check_v1(');
  assert.doesNotMatch(proof+one+many,/for\s+(?:update|share)|pg_advisory|clock_timestamp|statement_timestamp/);
});

test('private lookup is by original event PK and uses verified employee Auth, never owner impersonation or active-only gating',()=>{
  contains(proof,"array['protocol','binding','asOf','events','effect','relation']",
    "member_auth:=(p_check->'binding'->'worker'->>'employeeAuthUserId')::uuid",
    'w.employee_id is distinct from employee or e.auth_user_id is distinct from member_auth',
    'from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.start_event_id=eid',
    'from public.merchant_attendance_shift_plan_adoptions x where x.merchant_id=site and x.start_event_id=eid',
    'saved.worker_id is distinct from wid or saved.employee_id is distinct from employee or saved.employee_auth_user_id is distinct from member_auth');
  assert.doesNotMatch(proof,/p_auth_user_id|->>'actorId'|\.active|\.status='active'|\.enabled|order by|offset\s+\d/i);
});

test('missing sidecar remains null for old137 relation or old facts; orphan and relation mismatch fail closed',()=>{
  ordered(proof,'if saved.start_event_id is null then',
    'if original_relation is not null or proof.start_event_id is not null then', 'return null;',
    "(original_relation-'currentCancelled') is distinct from expected_relation",'if proof.start_event_id is null then return null;end if;',
    'expected_adoption:=public.faolla_attendance_shift_plan_adoption_v1');
  contains(proof,"'status',saved.status,'reason',saved.reason,'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision",
    "saved.operation_id::text is distinct from p_check->'binding'->'event'->>'operationId'");
  assert.doesNotMatch(proof,/'not_approved'|'approval_missing'|jsonb_set|coalesce\([^)]*adoption/i);
});

test('all four channels require exact saved row equality and complete existing receipt proof',()=>{
  contains(proof,'row(proof.worker_id,proof.operation_id,proof.employee_id,proof.employee_auth_user_id,proof.slot_id,proof.recorded_at)',
    'row(saved.worker_id,saved.operation_id,saved.employee_id,saved.employee_auth_user_id,saved.slot_id,saved.recorded_at)',
    "proof.channel not in('self','location','onsite','pin')",'proof.adoption is distinct from expected_adoption',
    "proof.approval_operation_id::text is distinct from expected_adoption->'approval'->>'operationId'");
  const common=fn('faolla_attendance_shift_plan_adoption_v1',strip(read('202610050144_merchant_attendance_self_schedule_adoption.sql')));
  for(const channel of ['location','onsite','pin','self'])contains(common,`public.faolla_attendance_${channel}_schedule_receipt_v1(p,p_auth)`);
  contains(common,"if p_current then",'elsif target is not null then',
    'where x.merchant_id=p.merchant_id and x.operation_id=target');
});

test('saved140 reference uses p_current=false and validates stored hash/bytes/source instead of latest head or copied rule bodies',()=>{
  contains(proof,'public.faolla_attendance_shift_plan_adoption_v1(saved,member_auth,proof.approval_operation_id,false,proof.channel)');
  assert.equal((proof.match(/public\.faolla_attendance_shift_plan_adoption_v1\(/g)||[]).length,1);
  assert.doesNotMatch(proof+one+many,/merchant_attendance_plan_rule_streams|faolla_attendance_plan_rule_approvals_v1|sourceText|source_text|expectedFingerprint|time_zone|timezone|at time zone(?! 'UTC')/i);
  const common=fn('faolla_attendance_shift_plan_adoption_v1',strip(read('202610050144_merchant_attendance_self_schedule_adoption.sql')));
  contains(common,"f.source_sha256 is distinct from encode(sha256(convert_to(f.source::text,'UTF8')),'hex')",
    "f.source_bytes is distinct from octet_length(convert_to(f.source::text,'UTF8'))",'public.faolla_attendance_plan_rule_source_v1(f.source)',
    "'sourceSha256',f.source_sha256,'recordedAt',to_char(a.recorded_at at time zone 'UTC',fmt)");
});

test('raw envelopes contain exact old check/coverage unchanged and no invented observation/commit timestamps',()=>{
  contains(one,"jsonb_build_object('protocol','shift-check-adoption-source-v1','check',original_check,'adoption',adoption)");
  contains(many,"jsonb_build_object('protocol','plan-coverage-adoptions-source-v1','coverage',original_coverage,'adoptions',adoptions)");
  assert.doesNotMatch(one+many,/jsonb_set|readStartedAt'\s*,[^']|readCompletedAt'\s*,[^']|asOf'\s*,|recordedAt'\s*,|commit_timestamp/);
});

test('plan pairs exactly one nullable adoption with each original ordered UUID, without rereading or time filtering sessions',()=>{
  ordered(many,"for child in select value from jsonb_array_elements(original_coverage->'sessions') loop",
    "start_id:=(child->'binding'->'event'->>'startEventId')::uuid",'if previous_id is not null and start_id<=previous_id',
    `adoption:=public.${helper}(child)`,"adoptions:=adoptions||jsonb_build_array(jsonb_build_object('startEventId',start_id,'adoption',adoption))");
  contains(many,"adoptions jsonb:='[]'::jsonb","child->'binding'->'worker' is distinct from original_coverage->'worker'",
    "child->'relation'->'slot'->>'id' is distinct from p_query->>'slotId'");
  assert.doesNotMatch(many,/from public\.merchant_attendance_shift_schedule_relations|where .*occurred|where .*start_at|if adoption is not null/);
});

test('whole raw remains1MiB with repeated10 sessions and2002 total original event caps, no truncation/partial success',()=>{
  contains(one,'if event_count<1 then',"if event_count>2002 then raise exception 'attendance_plan_adoption_view_too_large'");
  contains(many,"if jsonb_array_length(original_coverage->'sessions')>10 then raise exception 'attendance_plan_adoption_view_too_large'",
    'if child_count<1 then','event_count:=event_count+child_count',"if event_count>2002 then raise exception 'attendance_plan_adoption_view_too_large'");
  for(const body of [one,many])contains(body,"if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_adoption_view_too_large'");
  assert.doesNotMatch(one+many,/limit |2097152|exception when|when others|return '\[\]'|limited/);
});

test('only new public RPCs get service execute; helper is invoker and denied all application roles with audited postconditions',()=>{
  contains(proof,'returns jsonb language plpgsql set search_path=pg_catalog');
  for(const body of [one,many])contains(body,'returns jsonb language plpgsql security definer set search_path=pg_catalog');
  contains(clean,'from public,anon,authenticated,service_role;',
    `grant execute on function public.${shift}(jsonb,uuid),\n  public.${plan}(jsonb,uuid) to service_role;`,
    "x.prosecdef=is_rpc and x.provolatile='v'","x.prorettype='jsonb'::regtype and x.proconfig=array['search_path=pg_catalog']",
    "has_function_privilege(role_name,signature,'EXECUTE') is distinct from (is_rpc and role_name='service_role')",
    "acl.grantee=0 and acl.privilege_type='EXECUTE'","notify pgrst, 'reload schema'");
});
