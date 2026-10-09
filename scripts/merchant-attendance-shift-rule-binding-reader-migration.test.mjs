// Source contracts only. Native SQL acceptance belongs to the root-owned run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610040135_merchant_attendance_shift_rule_binding_reader.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const body=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const rpc=body('faolla_attendance_shift_rule_binding_v1');
const graph=body('faolla_attendance_shift_rule_binding_graph_v1');
const scalar=body('faolla_attendance_shift_rule_binding_scalar_v1');
const ordered=(...parts)=>{let position=-1;for(const part of parts){const next=rpc.indexOf(part,position+1);assert(next>position,part);position=next;}};

test('135 adds only three private validators and one readonly RPC, without old tables indexes or business writes',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),[
    'faolla_attendance_shift_rule_binding_object_v1','faolla_attendance_shift_rule_binding_scalar_v1',
    'faolla_attendance_shift_rule_binding_graph_v1','faolla_attendance_shift_rule_binding_v1']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:create\s+(?:table|index)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop|lock\s+table)\b/i);
  assert.doesNotMatch(rpc,/\b(?:insert|update|delete|truncate|execute|pg_advisory|offset)\b/i);
});

test('064 and133 installation prerequisites and every new signature are checked before reapply',()=>{
  for(const fragment of ["202609290064::bigint,'merchant_attendance_owner_configuration'","202610040133::bigint,'merchant_attendance_shift_rule_bindings'",
    'public.faolla_attendance_shift_rule_source_valid_v1(text,text,uuid,text,integer)',
    'installed<>(to_regprocedure(p) is not null)','merchant_attendance_shift_rule_binding_reader_installation_conflict',
    "values(202610040135,'merchant_attendance_shift_rule_binding_reader') on conflict(version) do nothing"] )assert(clean.includes(fragment));
});

test('input is exact site worker and startEventId only, with canonical UUID and4096byte query cap',()=>{
  for(const text of ["object_v1(p_query,array['siteId','workerId','startEventId'])","octet_length(convert_to(p_query::text,'UTF8'))>4096",
    "scalar_v1(p_query->'workerId','uuid')","scalar_v1(p_query->'startEventId','uuid')","raise exception 'attendance_invalid_request'"])assert(rpc.includes(text));
  assert.doesNotMatch(rpc,/p_command|p_allow|p_module|p_query->>'(?:limit|offset|operationId|actorId)'/);
});

test('current owner settings worker and employee are SHARE-locked before the exact original event lookup',()=>{
  ordered('perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share',
    'select * into s from public.merchant_attendance_settings where merchant_id=site for share',
    'select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share',
    'select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    "if w.employee_id is null or e.id is null or e.auth_user_id is null",'where merchant_id=site and worker_id=wid and id=eid',
    "if ev.id is null or ev.action<>'clock_in'",'ev.actor_employee_id is distinct from w.employee_id');
  assert(rpc.includes('attendance_shift_rule_binding_not_found'));assert(rpc.includes('attendance_shift_rule_binding_identity_changed'));
  assert.doesNotMatch(rpc,/for update|if not w.active|if e.status|s.enabled/i);
});

test('stored binding dualidentity and every eventpoint column match; PIN request auth is not member auth',()=>{
  ordered('select * into b from public.merchant_attendance_shift_rule_bindings where merchant_id=site and start_event_id=eid',
    'b.employee_id is distinct from w.employee_id or b.employee_auth_user_id is distinct from e.auth_user_id',
    'row(b.worker_id,b.operation_id,b.sequence,b.location_id,b.occurred_at,b.event_time_zone)',
    'row(ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone)');
  for(const text of ["ev.source not in('web','kiosk')","(b.channel='pin')<>(ev.source='kiosk')",
    "b.channel='pin' and b.request_auth_user_id is not null","b.channel<>'pin' and b.request_auth_user_id is distinct from e.auth_user_id",
    'b.worker_version not between 1 and w.version','b.settings_version not between 1 and s.version'])assert(rpc.includes(text));
  assert.doesNotMatch(rpc,/b\.request_auth_user_id\s*(?:<>|=|is distinct from)\s*p_auth_user_id/);
});

test('missing and unverified are explicit, never a current-source fallback or fake zero threshold',()=>{
  for(const text of ["binding_item jsonb:=null;state_name text:='missing';reason_name text:='binding_missing'",
    "elsif b.status='unverified' then",'if b.source_id is not null or b.reason is null',"'source',source_item"])assert(rpc.includes(text));
  assert.doesNotMatch(clean,/faolla_attendance_(?:shift_rule_collect|bind_shift_rules|rule_sources|sources|rules|personal_rules)_v1\(/);
  assert.doesNotMatch(rpc,/merchant_attendance_(?:group_assignments|rule_operations|personal_rule_operations)/);
  assert(rpc.includes("'formalReady',false"));
});

test('saved text hash verification fails closed on false or NULL and binds graph identity and versions',()=>{
  for(const text of ['where merchant_id=site and source_id=b.source_id and worker_id=wid',
    'public.faolla_attendance_shift_rule_source_valid_v1(a.source_text,site,wid,a.source_sha256,a.source_bytes) is distinct from true',
    "graph->>'employeeId' is distinct from b.employee_id::text","graph->>'employeeAuthUserId' is distinct from b.employee_auth_user_id::text",
    "graph->'workerVersion' is distinct from to_jsonb(b.worker_version)","graph->'settingsVersion' is distinct from to_jsonb(b.settings_version)",
    'faolla_attendance_shift_rule_binding_graph_v1(graph,ev.occurred_at)'])assert(rpc.includes(text));
  assert.doesNotMatch(rpc,/a\.source_id\s*(?:<>|=|is distinct from)\s*(?:ev\.id|eid)|a\.created_at\s*<\s*ev\.occurred_at/);
  assert(rpc.includes('a.created_at>b.recorded_at'));
});

test('saved UTC dates and boundaries use no current IANA rules; source and event zones remain distinct',()=>{
  assert.doesNotMatch(clean,/faolla_attendance_(?:valid_zone|rule_day_start|personal_rule_end|group_date)_v1\(|pg_timezone_names/i);
  for(const m of clean.matchAll(/at time zone\s+([^\n,;)]*)/gi))assert(m[1].startsWith("'UTC'"),m[0]);
  assert(scalar.includes("kind in('stamp3','stamp6')"));assert(scalar.includes("to_char(d,'YYYY-MM-DD')=v"));
  assert.doesNotMatch(rpc,/graph->>'timeZone'\s*(?:<>|=|is distinct from)|graph->'timeZone'\s*(?:<>|=|is distinct from)/);
  assert.equal((graph.match(/date_trunc\('milliseconds'/g)||[]).length,3);
});

test('assignment history is bounded and immutable with exact saved interval containing the event',()=>{
  for(const text of ["array['detail','workerVersion','settingsVersion','groupRevision','fromAt','toAt','originalFromAt','originalToAt']",
    "jsonb_array_length(d->'history') not between 1 and 2", "(a->>'fromAt')::timestamptz>point_at",
    "(a->>'toAt')::timestamptz<=point_at", "cmd->>'action' is distinct from 'assign'", "cmd->>'action' is distinct from 'end'",
    "previous_item is distinct from d-array['history','canEnd','canCancel']","g->'active' is distinct from 'true'::jsonb"] )assert(graph.includes(text));
});

test('selected publications and personal approval have exact shapes, bounded revisions and saved UTC point applicability',()=>{
  for(const text of ["array['revision','publication']", "item->>'action' is distinct from 'publish'",
    "(item->>'effectiveAt')::timestamptz>point_at", "item->'groupRevision' is distinct from 'null'::jsonb",
    "array['revision','approval']", "item->>'action' is distinct from 'approve'", "item->'employeeId' is distinct from p->'employeeId'",
    "item->'employeeAuthUserId' is distinct from p->'employeeAuthUserId'", "(item->>'endsOn')::date-(item->>'startsOn')::date not between 0 and 30",
    "(item->>'fromAt')::timestamptz>point_at", "(item->>'toAt')::timestamptz<=point_at", "r.value->>'mode'<>'inherit'"])assert(graph.includes(text));
  assert.doesNotMatch(graph,/p_auth_user_id|select .* from public\./i);
});

test('wire is readonly with current worker, original event, unchanged source bytes and bounded reply',()=>{
  for(const text of ["'protocol','shift-rule-binding-v1','readOnly',true,'formalReady',false", "'worker',jsonb_build_object('workerId',w.id",
    "'event',jsonb_build_object('startEventId',ev.id", "'sourceText',a.source_text", "'canonicalFormat','pg-jsonb-text-utf8-v1'",
    "'status',state_name,'reason',reason_name,'binding',binding_item", "octet_length(convert_to(result::text,'UTF8'))>262144",
    'read_at<ev.occurred_at or b.recorded_at is not null and read_at<b.recorded_at'])assert(rpc.includes(text));
  assert.doesNotMatch(rpc,/sourceText.*graph::text|graph::text.*sourceText/);
});

test('only service gets RPC execute; all helpers remain private with effective and PUBLIC ACL postconditions',()=>{
  assert.equal((clean.match(/grant execute/g)||[]).length,1);
  assert(clean.includes('grant execute on function public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid) to service_role'));
  assert(clean.includes('from public,anon,authenticated,service_role'));
  assert(clean.includes("has_function_privilege(r,p,'EXECUTE') is distinct from (r='service_role'"));
  assert(clean.includes("a.grantee=0 and a.privilege_type='EXECUTE'"));
  assert(clean.includes('merchant_attendance_shift_rule_binding_reader_acl_postcondition_failed'));
});
