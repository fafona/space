//222 static migration checks only: no DB, processes, network or SQL execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610070181_merchant_attendance_outage_relations.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const start=sql.indexOf('create or replace function public.'+name+'('),end=sql.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return sql.slice(start,end+4);};
const has=(s,...values)=>values.forEach(value=>assert(s.includes(value),value));
const order=(s,...values)=>{let last=-1;for(const value of values){const next=s.indexOf(value,last+1);assert(next>last,value);last=next;}};
const command=fn('faolla_attendance_outage_relation_command_v1'),hash=fn('faolla_attendance_outage_relation_hash_v1');
const evidence=fn('faolla_attendance_outage_relation_evidence_v1'),entry=fn('faolla_attendance_outage_relation_entry_v1');
const guard=fn('faolla_attendance_outage_relation_guard_v1'),rpc=fn('faolla_attendance_outage_relations_v1');

test('181 adds one ledger and six new functions without replacing prior business or period logic',()=>{
  assert.deepEqual(validateMigrationSource(file,sql),[]);
  assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(x=>x[1]),
    ['command','hash','evidence','entry','guard'].map(x=>'faolla_attendance_outage_relation_'+x+'_v1').concat('faolla_attendance_outage_relations_v1'));
  assert.deepEqual([...sql.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map(x=>x[1]),['merchant_attendance_outage_relation_operations']);
  assert.deepEqual([...sql.matchAll(/\b(?:insert into|update|delete from)\s+public\.([a-z0-9_]+)/g)].map(x=>x[1]),
    ['merchant_attendance_outage_relation_operations','faolla_schema_migrations']);
  assert.equal([...sql.matchAll(/create index if not exists/g)].length,1);
  assert.doesNotMatch(sql,/disable trigger|create policy|pg_get_functiondef|set_config\(|period_closure|outage_link_operations|outage_review_operations|account_capture|events\s*\(/i);
  has(sql,"set local lock_timeout='3s'","version=202610070180 and name='merchant_attendance_outage_subject'",
    "values(202610070181,'merchant_attendance_outage_relations') on conflict(version) do nothing","notify pgrst, 'reload schema';\ncommit;");
});

test('commands require actual JSON strings and bounded exact keys, leaving revision100 only for revoke',()=>{
  has(command,"octet_length(convert_to(p::text,'UTF8'))>8192","jsonb_typeof(p->'action') is distinct from 'string'",
    "jsonb_typeof(p->'reason') is distinct from 'string'","faolla_attendance_group_text_v1(p->>'reason',1,1000)",
    "array['action','operationId','expectedRevision','expectedFingerprint','kind','reason']",
    "array['action','operationId','expectedRevision','expectedFingerprint','reason']",
    "jsonb_typeof(p->'kind')='string'","p->>'kind' in('possible_duplicate','complementary')",
    "when p->>'action'='apply' then 0 else 1 end","when p->>'action'='apply' then 98 else 99 end");
  has(sql,'check(revision between 1 and 100)',"action='apply' and revision<=99","action='revoke' and evidence is null and revision>=2");
});

test('canonical pair and operation direction are separate and command hash is the exact scalar tuple',()=>{
  has(sql,'unique(merchant_id,left_declaration_id,right_declaration_id,revision)',
    'foreign key(merchant_id,left_declaration_id) references public.merchant_attendance_outage_declarations(merchant_id,declaration_id)',
    'foreign key(merchant_id,right_declaration_id) references public.merchant_attendance_outage_declarations(merchant_id,declaration_id)',
    'left_declaration_id<right_declaration_id and least(declaration_id,related_declaration_id)=left_declaration_id',
    'greatest(declaration_id,related_declaration_id)=right_declaration_id','faolla_attendance_outage_relation_command_v1(command) is true');
  has(hash,"jsonb_build_array(p_site,'owner',p_declaration,p_related,p->'action',p->'operationId',p->'expectedRevision',p->'expectedFingerprint'",
    "case when p->>'action'='apply' then p->'kind' else 'null'::jsonb end,p->'reason'",
    "string_agg(value::text,',' order by ordinal)");
  assert.doesNotMatch(hash,/least\(|greatest\(|clock_timestamp|sourceText|recordedAt/);
});

test('fresh evidence binds both immutable declaration projections plus current counters, not business conclusions',()=>{
  has(evidence,'p_left.declaration_id>=p_right.declaration_id',
    'row(p_left.worker_id,p_left.employee_id,p_left.employee_auth_user_id) is distinct from row(p_right.worker_id,p_right.employee_id,p_right.employee_auth_user_id)',
    "'workerVersion',p_worker_version,'employeeVersion',p_employee_version,'generation',p_generation",
    'faolla_attendance_outage_declaration_v1(p_left)::text','faolla_attendance_outage_declaration_v1(p_right)::text');
  assert.doesNotMatch(evidence,/p_left\.worker_version|p_left\.employee_version|p_left\.generation|to_jsonb\(|clock_timestamp|readAt|source_link|outage_review|period|resolved/);
  has(rpc,'faolla_attendance_outage_relation_evidence_v1(l,r,w.version,e.version,generation_no)');
});

test('saved entry validation retains original counters and immutable evidence without recollecting current personnel',()=>{
  has(entry,"array['protocol','siteId','workerId','employeeId','employeeAuthUserId','workerVersion','employeeVersion','generation','declarations']",
    "faolla_attendance_outage_relation_evidence_v1(l,r,(p.evidence->>'workerVersion')::bigint,(p.evidence->>'employeeVersion')::bigint,(p.evidence->>'generation')::bigint)",
    'ev is distinct from p.evidence','previous.operation_id is null or previous.recorded_at>p.recorded_at',
    "previous.action is distinct from 'apply'",'p.kind is distinct from previous.kind','p.source_fingerprint is distinct from previous.source_fingerprint',
    "'sourceText',(case when p.evidence is null then null else p.evidence::text end)");
  assert.doesNotMatch(entry,/merchant_attendance_workers|merchant_enterprise_employees|account_epochs|clock_timestamp|outage_relations_v1\(/);
});

test('self Auth, current dual identity and role are verified before either declaration lookup',()=>{
  order(rpc,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for update',
    "if access_name='self' then",'y.auth_user_id=p_auth_user_id',
    'from public.merchant_attendance_workers where merchant_id=site and id=self_worker for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share',
    "array['enterprise.view','attendance.self.view','attendance.self.request']::text[]",
    'select * into d from public.merchant_attendance_outage_declarations');
  assert.equal([...rpc.matchAll(/access_name='owner' or row\(worker_id,employee_id,employee_auth_user_id\)=row\(w.id,e.id,p_auth_user_id\)/g)].length,3);
  has(rpc,"e.auth_user_id is distinct from p_auth_user_id or e.status is distinct from 'active'",
    "if d.declaration_id is null then raise exception 'attendance_outage_relations_not_found'",
    "if l.declaration_id is null or r.declaration_id is null then raise exception 'attendance_outage_relations_not_found'");
});

test('owner receipt recovery precedes current worker state, gate and CAS; reverse same-operation is not replay',()=>{
  order(rpc,'select * into saved from public.merchant_attendance_outage_relation_operations',
    'saved.actor_auth_user_id<>p_auth_user_id or saved.left_declaration_id<>left_id or saved.right_declaration_id<>right_id',
    'saved.declaration_id<>did or saved.related_declaration_id<>related',
    "raise exception 'attendance_operation_conflict'","receipt:=jsonb_build_object('operationId',saved.operation_id",'if receipt is null then',
    'from public.merchant_attendance_workers where merchant_id=site and id=d.worker_id for update',
    "if not p_allow_write then raise exception 'attendance_outage_relations_disabled'");
  has(rpc,"access_name<>'owner'",'saved.command is distinct from p_command',
    "elsif mode_name='recover' then raise exception 'attendance_outage_relations_not_found'");
});

test('paired rows lock in canonical order after shared settings and current personnel locks',()=>{
  order(rpc,'from public.merchant_attendance_settings where merchant_id=site for update',
    'from public.merchant_attendance_workers where merchant_id=site and id=d.worker_id for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'declaration_id=any(array[did,related]) order by declaration_id for share');
  assert.doesNotMatch(rpc,/insert into public\.merchant_attendance_account_epochs|for update of|pg_advisory/);
});

test('twenty-five pair capacity counts all history on both endpoints; revoke does not reclaim it',()=>{
  has(guard,'array[new.left_declaration_id,new.right_declaration_id]',
    'select distinct left_declaration_id,right_declaration_id','left_declaration_id=target or right_declaration_id=target',
    'limit 26','if count_pairs>25');
  has(rpc,'if head.operation_id is null then','array[left_id,right_id]',"if pair_count>=25 then blocks:=array_append(blocks,'pair_limit')");
  assert.doesNotMatch(guard,/action='apply'|action='revoke'|delete|update/);
});

test('safe revoke preserves kind and fingerprint but still requires enabled rollout, expected revision and current apply',()=>{
  const writes=rpc.slice(rpc.indexOf('if p_command is not null then',rpc.indexOf('eligible:=')),rpc.indexOf('insert into public.merchant_attendance_outage_relation_operations'));
  order(writes,"if not p_allow_write then raise exception 'attendance_outage_relations_disabled'",
    "revision_no<>(p_command->>'expectedRevision')::integer",'if revision_no>=100',"if p_command->>'action'='revoke' then",
    "head.action is distinct from 'apply'",'evidence:=null;fp:=head.source_fingerprint;kind_name:=head.kind;',
    'else',"if not s.enabled then raise exception 'attendance_platform_paused'",'if not eligible');
  has(writes,"head.source_fingerprint is distinct from p_command->>'expectedFingerprint'",
    "'revision_limit'=any(blocks) or 'pair_limit'=any(blocks)");
});

test('detail eligibility is independent of rollout; canWrite reflects either apply or safe revoke only',()=>{
  has(rpc,"blocks:=array_append(blocks,'identity_changed')","blocks:=array_append(blocks,'worker_inactive')",
    "blocks:=array_append(blocks,'employee_inactive')","blocks:=array_append(blocks,'account_suspended')",
    "blocks:=array_append(blocks,'settings_disabled')","blocks:=array_append(blocks,'revision_limit')",
    'eligible:=evidence is not null and cardinality(blocks)=0',
    "can_write:=access_name='owner' and p_allow_write and (eligible or (head.action='apply' and revision_no<100))");
  const beforeWrites=rpc.slice(rpc.indexOf('if not identity_ok then blocks'),rpc.indexOf('if p_command is not null then',rpc.indexOf('eligible:=')));
  assert.doesNotMatch(beforeWrites,/p_allow_write/);
});

test('list is bounded by other declaration ID and histories use exclusive revision cursor without full evidence',()=>{
  has(rpc,'select distinct on(left_declaration_id,right_declaration_id)',
    'order by (case when x.left_declaration_id=did then x.right_declaration_id else x.left_declaration_id end) limit 26',
    "if n>25 then raise exception 'attendance_outage_relations_too_large'",
    "items:=items||jsonb_build_array(entry-'evidence'-'sourceText')",
    'and (before_rev is null or revision<before_rev) order by revision desc limit 26',
    'if n>25 then truncated:=true;exit',"history:=history||jsonb_build_array(entry-'evidence'-'sourceText')",
    "octet_length(convert_to(result::text,'UTF8'))>262144");
});

test('service has only RPC execute, table has no API grants/policy and validator remains private security definer',()=>{
  has(sql,'alter table public.merchant_attendance_outage_relation_operations enable row level security',
    'revoke all on public.merchant_attendance_outage_relation_operations from public,anon,authenticated,service_role',
    'before update or delete on public.merchant_attendance_outage_relation_operations',
    'before truncate on public.merchant_attendance_outage_relation_operations',
    'after insert on public.merchant_attendance_outage_relation_operations',
    'grant execute on function public.faolla_attendance_outage_relations_v1(jsonb,uuid,jsonb,boolean) to service_role',
    "p.proconfig is distinct from array['search_path=pg_catalog']::text[]",'pg_policy where polrelid=t',
    'a.grantee<>x.relowner',"tgtype=27","tgtype=34","tgtype=5");
  has(guard,'returns trigger language plpgsql security definer set search_path=pg_catalog','faolla_attendance_outage_relation_entry_v1(new)');
  assert.equal([...sql.matchAll(/grant execute on function/g)].length,1);
  assert.equal([...sql.matchAll(/revoke all on function/g)].length,6);
});

test('installation and reentry reject extra functions, ACL drift, nondefault triggers and wrong ordinary index',()=>{
  has(sql,"installed<>(to_regclass('public.merchant_attendance_outage_relation_operations') is not null)",
    '<>(case when installed then 1 else 0 end)',"p.proparallel<>'u'",'p.proowner<>(select oid from pg_roles where rolname=current_user)',
    'p.proargnames is distinct from f.names','p.pronargs<>coalesce(cardinality(f.names),0)','p.pronargdefaults<>f.defaults','p.prorettype<>f.return_type::regtype',
    'aclexplode(coalesce(p.proacl,acldefault',"r='service_role' and f.name='faolla_attendance_outage_relations_v1'",
    "tgenabled='O'",'not idx.indisvalid or not idx.indisready or idx.indisunique',
    "array['merchant_id','right_declaration_id','left_declaration_id','revision']::text[]");
  assert.doesNotMatch(sql,/<>case\b|<>\s*case\b|a\(name,args,returns,/);
});
