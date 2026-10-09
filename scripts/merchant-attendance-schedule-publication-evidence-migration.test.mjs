// Source contracts only. The separate owner-controlled native checker verifies
// actual transaction rollback, PostgreSQL locks, eligibility and concurrent DDL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050136_merchant_attendance_schedule_publication_evidence.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const old=readFileSync(new URL('./supabase-migrations/202610010099_merchant_attendance_schedule.sql',import.meta.url),'utf8');
const table='merchant_attendance_schedule_publication_evidence';
const rpc='faolla_attendance_schedule_evidenced_v1';
const slots='faolla_attendance_schedule_publication_slots_v1';
const guard='faolla_attendance_schedule_publication_guard_v1';
const fn=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const ordered=(text,...parts)=>{let position=-1;for(const part of parts){const next=text.indexOf(part,position+1);assert(next>position,part);position=next;}};
const signature=(text,name)=>{const match=text.match(new RegExp(`create (?:or replace )?function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns jsonb`));assert(match,name);return match[1].replace(/\s+/g,'');};

test('136 is an additive candidate with exactly one new table, one narrow index and three new functions',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create table if not exists public\.(\w+)/g)].map(m=>m[1]),[table]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),[slots,guard,rpc]);
  assert.deepEqual([...clean.matchAll(/create index concurrently if not exists (\w+)/g)].map(m=>m[1]),['attendance_schedule_publication_idx']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),[table,'faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:drop|lock\s+table|update\s+public\.|delete\s+from)\b/i);
  assert.deepEqual([...clean.matchAll(/alter table public\.(\w+)/g)].map(m=>m[1]),[table]);
});

test('concurrent index is outside both transactions; atomic final registration follows second validation',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,2);assert.equal((clean.match(/^commit;/gm)||[]).length,2);
  assert.equal((clean.match(/set local lock_timeout='3s'/g)||[]).length,2);
  ordered(clean,'$schedule_publication_prerequisites$;', 'commit;',
    'create index concurrently if not exists attendance_schedule_publication_idx',
    'on public.merchant_attendance_schedule_slots(merchant_id,revision,id);','begin;',"set local lock_timeout='3s';",
    '$schedule_publication_index_ready$;',`create table if not exists public.${table}`,
    "values(202610050136,'merchant_attendance_schedule_publication_evidence') on conflict(version) do nothing",'commit;');
  assert.doesNotMatch(clean,/drop\s+index|reindex|set\s+(?!local\b)(?:lock_timeout|statement_timeout)|disable\s+trigger|session_replication_role/i);
});

test('same-name index is verified before and after create; partial invalid or wrong-key objects cannot be adopted',()=>{
  for(const fragment of ["i.indrelid='public.merchant_attendance_schedule_slots'::regclass","am.amname='btree'",
    'i.indisvalid and i.indisready and i.indislive','not i.indisunique and not i.indisexclusion','i.indpred is null and i.indexprs is null',
    'i.indnatts=3 and i.indnkeyatts=3',"pg_get_indexdef(idx,1,true)='merchant_id'","pg_get_indexdef(idx,2,true)='revision'",
    "pg_get_indexdef(idx,3,true)='id'",'unnest(i.indoption::smallint[])'])assert.equal(clean.split(fragment).length-1,2,fragment);
  assert(clean.includes('if installed and idx is null then'));
  assert(clean.includes('if idx is not null and not exists('));
  assert(clean.includes('merchant_attendance_schedule_publication_index_conflict'));
});

test('installation requires exact064/099 and rejects unregistered table/helpers or a conflicting registry name',()=>{
  for(const fragment of ["202609290064::bigint,'merchant_attendance_owner_configuration'","202610010099::bigint,'merchant_attendance_schedule'",
    'public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean)','public.faolla_attendance_events_append_only_v1()',
    "installed<>(to_regclass('public.merchant_attendance_schedule_publication_evidence') is not null)",
    'installed<>(to_regprocedure(p) is not null)',"name<>'merchant_attendance_schedule_publication_evidence'",
    'merchant_attendance_schedule_publication_installation_conflict'])assert(clean.includes(fragment),fragment);
  assert.doesNotMatch(clean,/202610040128|faolla_attendance_sources_v1|faolla_attendance_rule_sources_v1/);
});

test('wrapper signature and unchanged return match099; GET cancel and malformed requests delegate without new evidence reads',()=>{
  assert.equal(signature(clean,rpc),signature(old,'faolla_attendance_schedule_v1'));
  const body=fn(rpc),call='public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write)';
  ordered(body,"p_command->>'action' is distinct from 'publish'",`return ${call};`,"jsonb_typeof(p_query) is distinct from 'object'",`return ${call};`,
    'site:=p_query', 'for share;', 'for update;',`result:=${call};`,'if already_recorded then return result;end if;',`insert into public.${table}`,'return result;');
  assert.equal((body.match(/result\s*:=/g)||[]).length,1);
  assert.doesNotMatch(body,/result\s*\|\||jsonb_set\(result|return\s+jsonb|result->'?entries/);
});

test('safe site and operation validation precede casts and authorization locks',()=>{
  const body=fn(rpc);
  ordered(body,"jsonb_typeof(p_query) is distinct from 'object'",'jsonb_object_keys(p_query)',
    "coalesce(p_query->>'siteId','') !~ '^\\d{8}$'","coalesce(p_command->>'operationId','') !~ u",
    "op:=(p_command->>'operationId')::uuid",'from public.merchants');
  assert(body.includes("p_query->>'access' is distinct from 'owner'"));
  assert(body.includes("p_query->'operationId' is distinct from 'null'::jsonb"));
});

test('freshness is probed under old lock order before099 and never inferred from absent evidence',()=>{
  const body=fn(rpc);
  ordered(body,'from public.merchants where id=site and user_id=p_auth_user_id for share',
    'from public.merchant_attendance_settings where merchant_id=site for update',
    'c.merchant_id=site and c.operation_id=op) into already_recorded','result:=public.faolla_attendance_schedule_v1(',
    'if already_recorded then return result;end if;','select * into publication','select * into worker','select * into location','select * into employee');
  assert.doesNotMatch(body,new RegExp(`(?:from|join) public\\.${table}`));
  assert.doesNotMatch(body,/xmin|txid_current|replayed|on conflict|\bexception\s+when\b|employee\.auth_user_id\s+is\s+null\s+then\s+raise/i);
  ordered(old,'from public.merchants','from public.merchant_attendance_settings where merchant_id=site for update',
    'from public.merchant_attendance_workers where merchant_id=site and id=worker for share',
    'from public.merchant_attendance_locations where merchant_id=site and id=w.default_location_id for share',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share');
});

test('successful publication receipt is cross-checked and actual new slots are read through exact indexed revision with33 sentinel',()=>{
  const body=fn(rpc);
  for(const fragment of ['publication.actor_auth_user_id is distinct from p_auth_user_id','publication.query is distinct from p_query',
    'publication.command is distinct from p_command',"result->'receipt' is distinct from jsonb_build_object('operationId',publication.operation_id,'revision',publication.revision,'command',publication.command)",
    'x.merchant_id=site and x.revision=publication.revision order by x.id limit 33',
    'if slot_count>32 then raise exception',"slot_count<>jsonb_array_length(p_command->'slots')"])assert(body.includes(fragment),fragment);
  assert.doesNotMatch(body,/result->'entries'|rangeLimited|limit 100|limit 101/);
});

test('immutable row retains exact command refs, dual identity including explicit unbound, context versions and no current/future rules',()=>{
  for(const fragment of ['primary key(merchant_id,revision),unique(merchant_id,operation_id)',
    'references public.merchant_attendance_schedule_commands(merchant_id,revision)',
    'references public.merchant_attendance_schedule_commands(merchant_id,operation_id)',
    "employee_auth_user_id is null and identity_status='unbound'","employee_auth_user_id is not null and identity_status='bound'",
    "case when employee.auth_user_id is null then 'unbound' else 'bound' end",'worker.version,location.id,location.version,settings.version,location.time_zone',
    "captured_slots,publication.recorded_at,clock_timestamp(),'publish-identity-context-v1'"])assert(clean.includes(fragment),fragment);
  assert.doesNotMatch(clean,/employee_auth_user_id uuid not null|auth_user_id\s*:=\s*p_auth|coalesce\(employee\.auth_user_id|clock_in|clock_out|faolla_attendance_.*rules|\bpayroll\b/i);
});

test('saved slot validator is bounded, exact, sorted unique, minute-aligned UTC and timezone-database independent',()=>{
  const body=fn(slots);
  for(const fragment of ['jsonb_array_length(p) not between 1 and 32',"octet_length(convert_to(p::text,'UTF8'))>16384",
    "array['id','workDate','startAt','endAt']",'jsonb_object_keys(item))<>4','slot_id<=previous_id',"b-a>interval '24 hours'",
    "d not between date '2000-01-01' and date '2100-12-31'",'HH24:MI:SS.MS',"at time zone 'UTC'",'return false;'])assert(body.includes(fragment),fragment);
  assert.doesNotMatch(body,/pg_timezone_names|valid_zone|time_zone|current_timestamp|clock_timestamp|\bfrom public\./);
});

test('private insert guard binds both FK refs to one command and checks complete one-to-one immutable slot snapshot',()=>{
  const body=fn(guard);
  for(const fragment of ['original.operation_id is distinct from new.operation_id','original.actor_auth_user_id is distinct from new.actor_auth_user_id',
    'original.recorded_at is distinct from new.published_at',"original.command->'expectedRevision' is distinct from to_jsonb(new.revision-1)",
    "original.command->'expectedSettingsVersion' is distinct from to_jsonb(new.settings_version)",
    'x.merchant_id=new.merchant_id and x.revision=new.revision order by x.id limit 33',
    'slot.employee_id is distinct from new.employee_id','slot.worker_id is distinct from new.worker_id','slot.location_id is distinct from new.location_id',
    "jsonb_array_elements(original.command->'slots') expected where expected.value=pair",'jsonb_array_elements(seen_pairs) seen where seen.value=pair',
    "slot_count<>jsonb_array_length(original.command->'slots')",'expected_slots is distinct from new.slots'])assert(body.includes(fragment),fragment);
  assert.doesNotMatch(body,/\bexception\s+when\b|on conflict|current_setting|auth\.uid/);
});

test('evidence is RLS private append-only, and no trigger intercepts or mutates original tables',()=>{
  assert(clean.includes(`alter table public.${table} enable row level security`));
  assert(clean.includes(`revoke all on public.${table} from public,anon,authenticated,service_role`));
  for(const event of ['before insert','before update or delete','before truncate'])assert(clean.includes(`${event} on public.${table}`));
  assert.equal((clean.match(/execute function public\.faolla_attendance_events_append_only_v1\(\)/g)||[]).length,2);
  assert.equal((clean.match(/create trigger /g)||[]).length,3);
  for(const fragment of ['t.tgname=trigger_name','t.tgfoid=trigger_function::oid','t.tgtype=trigger_type',"t.tgenabled in('O','A')",
    'not t.tgisinternal and t.tgqual is null and t.tgnargs=0',"::regprocedure,7::smallint","::regprocedure,27::smallint","::regprocedure,34::smallint",
    'merchant_attendance_schedule_publication_trigger_conflict'])assert(clean.includes(fragment),fragment);
  assert.doesNotMatch(clean,/create policy|grant\s+(?:select|insert|update|all)|on public\.merchant_attendance_schedule_(?:slots|commands)\s+for each/i);
});

test('only new wrapper has service execute; private helpers and table grants have explicit PUBLIC/role postconditions',()=>{
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes(`grant execute on function public.${rpc}(jsonb,uuid,jsonb,boolean) to service_role`));
  for(const signature of [`${rpc}(jsonb,uuid,jsonb,boolean)`,`${slots}(jsonb)`,`${guard}()`]){
    assert(clean.includes(`revoke all on function public.${signature} from public,anon,authenticated,service_role`));
  }
  for(const fragment of ["pg_has_role(r,c.relowner,'USAGE')","pg_has_role(r,a.grantee,'USAGE')",'has_function_privilege(r,p,',"a.grantee=0 and a.privilege_type='EXECUTE'",'acldefault(\'r\',c.relowner)',
    'merchant_attendance_schedule_publication_acl_postcondition_failed'])assert(clean.includes(fragment),fragment);
});
