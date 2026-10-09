//183 static contracts only. Actual SQL edge validation, capacities, archived
//bodies and planner behaviour are verified by the root-owned native acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const filename='202610050154_merchant_attendance_period_missing_root_capacity.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sql=read(filename),clean=sql.replace(/--[^\n]*/g,'');
const old=read('202610050153_merchant_attendance_period_session_capacity.sql');
const writer=read('202610010103_merchant_attendance_missing_revisions.sql');
const fn=text=>{
  const start=text.indexOf('create or replace function public.faolla_attendance_period_source_v1(');
  const open=text.indexOf('$$',start),end=text.indexOf('$$;',open+2);
  assert(start>=0&&open>start&&end>open);return text.slice(start,end+3);
};
const body=fn(sql),original=fn(old);
const has=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const order=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const once=(text,from,to)=>{assert.equal(text.split(from).length,2,from);return text.replace(from,()=>to);};
const region=(text,from,to)=>{const start=text.indexOf(from);assert(start>=0,from);const end=text.indexOf(to,start);assert(end>start,to);return text.slice(start,end);};
const edge=region(body,'    --154 direct-approved-edge validation begins.','    --154 direct-approved-edge validation ends.');
const declarations="\n  missing_approved_ids uuid[];missing_edge_ids uuid[];missing_sibling_ids uuid[];missing_is_current boolean;\n"+
  "  missing_successor public.merchant_attendance_missing_requests%rowtype;missing_successor_first public.merchant_attendance_missing_entries%rowtype;\n"+
  "  missing_successor_approval public.merchant_attendance_missing_entries%rowtype;missing_checked_approval public.merchant_attendance_missing_entries%rowtype;\n";

test('154 changes only the existing source function and registers one atomic candidate',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.deepEqual([...clean.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map(m=>m[1]),['faolla_attendance_period_source_v1']);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|index|trigger)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop\s+(?:function|table|index)|reindex/i);
  assert.doesNotMatch(clean,/statement_timeout|pg_advisory|lock\s+table|session_replication_role|disable trigger/i);
  has(clean,"set local lock_timeout='3s'");
});

test('154 requires named103 and148-153 predecessors and rejects its registry name collision',()=>{
  for(const [version,name] of [
    ['202610010093','merchant_attendance_versioned_reports'],['202610010103','merchant_attendance_missing_revisions'],
    ['202610050148','merchant_attendance_period_source'],['202610050149','merchant_attendance_period_closure'],
    ['202610050150','merchant_attendance_period_seal_guards'],['202610050151','merchant_attendance_period_source_ranges'],
    ['202610050152','merchant_attendance_period_missing_context'],['202610050153','merchant_attendance_period_session_capacity'],
  ])has(clean,"("+version+"::bigint,'"+name+"')");
  order(clean,"version=202610050154 and name<>'merchant_attendance_period_missing_root_capacity'",
    '$period_missing_root_capacity_prerequisites$;','create or replace function',
    '$period_missing_root_capacity_postconditions$;',"values(202610050154,'merchant_attendance_period_missing_root_capacity')",'commit;');
  has(clean,'m.version=dependency.version and m.name=dependency.name','on conflict(version) do nothing');
});

test('source signature/security/ACL metadata is checked both before and after replacement',()=>{
  for(const section of [clean.slice(0,clean.indexOf('create or replace function')),clean.slice(clean.indexOf('do $period_missing_root_capacity_postconditions$'))]){
    has(section,"('public.faolla_attendance_period_source_v1(jsonb,uuid)',array['p_query','p_auth_user_id']::text[])",
      'function_id:=to_regprocedure(spec.signature)',"p.prokind='f'","p.prorettype='jsonb'::regtype",'not p.proretset',
      'p.proargnames=spec.arg_names','p.proargmodes is null','p.pronargdefaults=0','p.pronargs=cardinality(spec.arg_names)',
      "l.lanname='plpgsql'",'p.prosecdef',"p.provolatile='v'","p.proparallel='u'","p.proconfig=array['search_path=pg_catalog']::text[]",
      "array['anon','authenticated']","has_function_privilege('service_role',spec.signature,'EXECUTE')",
      "a.privilege_type='EXECUTE'","a.grantee not in(p.proowner,(select oid from pg_roles where rolname='service_role'))",
      "raise exception 'merchant_attendance_period_missing_root_capacity_installation_conflict'");
    assert.doesNotMatch(section,/faolla_attendance_(?:scoped_)?period_report_v2/);
  }
  assert.equal((clean.match(/grant execute on function/g)||[]).length,1);
  has(clean,'revoke all on function public.faolla_attendance_period_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;',
    'grant execute on function public.faolla_attendance_period_source_v1(jsonb,uuid) to service_role;');
});

test('existing103 parent index is checked as ready valid exact btree without creating or repairing it',()=>{
  const guard=region(clean,'  if not exists(select 1 from pg_index','  for spec in');
  has(guard,"to_regclass('public.attendance_missing_parent_idx')","to_regclass('public.merchant_attendance_missing_requests')",
    'i.indisvalid and i.indisready and not i.indisunique',"am.amname='btree'",'i.indnkeyatts=2 and i.indnatts=2 and i.indexprs is null',
    "pg_get_indexdef(i.indexrelid,1,true)='merchant_id'","pg_get_indexdef(i.indexrelid,2,true)='supersedes_request_id'",
    "opc.opcname='text_ops'","opc.opcname='uuid_ops'",'i.indcollation[0]','i.indcollation[1]=0',
    'i.indoption[0]=0 and i.indoption[1]=0',"pg_get_expr(i.indpred,i.indrelid)='(supersedes_request_id IS NOT NULL)'");
});

test('undo only approved local declaration/root/boolean changes and the whole function equals153 byte for byte',()=>{
  let restored=once(body,'other_ids uuid[];candidate_ids uuid[];','other_ids uuid[];root_ids uuid[];candidate_ids uuid[];');
  restored=once(restored,declarations,'');
  const oldBlock=region(original,'    root_ids:=','    missing:=missing||');
  const newBlock=region(restored,"    status_name:=case missing_op.action",'    missing:=missing||');
  restored=once(restored,newBlock,oldBlock);
  const originalBoolean=region(original,"'isCurrentApproved',status_name=",'    if status_name='); // Includes original semicolon/newline.
  restored=once(restored,"'isCurrentApproved',missing_is_current));\n",originalBoolean);
  assert.equal(restored,original);
});

test('period-related base and pending-child100, all other contexts/caps and canonical serialization remain unchanged',()=>{
  assert.equal(region(body,'  -- Relevant missing facts','    status_name:=case missing_op.action'),
    region(original,'  -- Relevant missing facts','    root_ids:='));
  assert.equal(body.slice(body.indexOf("    if status_name='submitted'")),original.slice(original.indexOf("    if status_name='submitted'")));
  has(body,'cardinality(missing_base_ids)>100','cardinality(ids)>100','all_candidates order by id limit 102',
    "x.start_at>=range_from-interval '744 hours'",'order by x.sequence limit 2003','total_events>4000',
    "octet_length(convert_to(source_text,'UTF8'))>1048576","octet_length(convert_to(result::text,'UTF8'))>4194304",
    'canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;');
  assert.doesNotMatch(body,/\broot_ids\b/);
  assert.doesNotMatch(edge,/limit 101|cardinality\([^)]*\)>100|with recursive/i);
});

test('direct approved successor discovery is not silently filtered by identity/root/date and detects two approvals',()=>{
  const query=region(edge,'    missing_approved_ids:=','    if cardinality(missing_approved_ids)');
  has(query,'approved.revision=2 and approved.action=\'approve\'',
    'successor.merchant_id=site and successor.supersedes_request_id=missing_row.request_id','successor.supersedes_request_id is not null limit 2');
  assert.doesNotMatch(query,/worker_id|employee_id|auth_user_id|root_request_id|start_at|end_at|recorded_at/);
  order(edge,'missing_approved_ids:=',"if cardinality(missing_approved_ids)>1 then raise exception 'attendance_period_source_invalid'",
    "missing_is_current:=status_name='approved' and cardinality(missing_approved_ids)=0;");
});

test('returned approved revisions also validate their out-of-period parent without recursive lineage traversal',()=>{
  has(edge,"if status_name='approved' and missing_row.supersedes_request_id is not null then",
    'missing_edge_ids:=array_append(missing_edge_ids,missing_row.request_id)',
    'successor.request_id=any(missing_edge_ids)','parent.request_id=missing_successor.supersedes_request_id');
  assert.equal((edge.match(/array_append\(missing_edge_ids/g)||[]).length,1);
  assert.doesNotMatch(edge,/merchant_attendance_missing_current_v1|faolla_attendance_missing_(?:review|lineage|v1)|with recursive/i);
  has(edge,'missing_sibling_ids:=array(','sibling.supersedes_request_id=missing_parent.request_id',
    'cardinality(missing_sibling_ids)<>1 or missing_sibling_ids[1] is distinct from missing_successor.request_id');
});

test('both endpoints and the original root retain current double identity while historical owner remains allowed',()=>{
  for(const row of ['missing_successor','missing_parent','missing_root'])has(edge,
    "row("+row+".worker_id,"+row+".employee_id,"+row+".actor_auth_user_id)",
    "is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed'");
  has(edge,'missing_parent_approval.operation_id is distinct from missing_successor.supersedes_operation_id',
    'missing_successor.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)',
    'missing_root.root_request_id is not null','missing_root.supersedes_request_id is not null or missing_root.supersedes_operation_id is not null',
    'missing_successor.location_id is distinct from missing_parent.location_id','missing_successor.time_zone is distinct from missing_parent.time_zone',
    'missing_checked_approval.actor_auth_user_id=emp.auth_user_id');
  assert.doesNotMatch(edge,/p_auth_user_id|user_id=p_auth|status='active'|w\.active|deadline_at|clock_timestamp/);
});

test('time comparisons follow103: parent approval strictly precedes child submit and revision approval permits equality',()=>{
  has(edge,'missing_parent_approval.recorded_at>=missing_successor.submitted_at',
    'missing_successor_approval.recorded_at<missing_successor.submitted_at',
    '(missing_parent.supersedes_request_id is not null and missing_parent_approval.recorded_at<missing_parent.submitted_at)',
    'missing_successor_first.recorded_at is distinct from missing_successor.submitted_at');
  assert.doesNotMatch(edge,/missing_successor_approval\.recorded_at<=|recorded_at[><=]+observed|recorded_at[><=]+read_at/);
  has(writer,'d.recorded_at<now_at',"if target.supersedes_request_id is not null and now_at<target.submitted_at");
});

test('successor submit receipt exactly binds the original eleven-key revise command and saved UTC proposal',()=>{
  has(edge,"array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']",
    "missing_successor_first.command->>'action' is distinct from 'revise'",
    "missing_successor_first.command->>'operationId' is distinct from missing_successor.request_id::text",
    "missing_successor_first.command->>'supersedesRequestId' is distinct from missing_parent.request_id::text",
    "missing_successor_first.command->>'expectedApprovalOperationId' is distinct from missing_parent_approval.operation_id::text",
    "missing_successor_first.command->'proposal' is distinct from missing_successor.proposal",
    "missing_successor_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_successor.policy_revision)",
    "(missing_successor_first.command->>'expectedSettingsVersion')::numeric>9007199254740989",
    'faolla_attendance_correction_proposal_v1(missing_successor.proposal,missing_successor.submitted_at)',
    "jsonb_array_length(missing_proposal->'breaks')>8",
    "faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_successor.start_at",
    "faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_successor.end_at");
  assert.doesNotMatch(edge,/at time zone|faolla_attendance_valid_zone|faolla_attendance_control_day_boundary/);
});

test('parent and successor approval receipts bind exact six-key command without recomputing old evidence tokens',()=>{
  has(edge,'approval.operation_id in(missing_parent_approval.operation_id,missing_successor_approval.operation_id)',
    "array['action','operationId','requestId','expectedRevision','evidenceToken','reason']",
    "missing_checked_approval.command->>'action' is distinct from 'approve'",
    "missing_checked_approval.command->>'operationId' is distinct from missing_checked_approval.operation_id::text",
    "missing_checked_approval.command->>'requestId' is distinct from missing_checked_approval.request_id::text",
    "missing_checked_approval.command->'expectedRevision' is distinct from '1'::jsonb",
    "coalesce(missing_checked_approval.command->>'evidenceToken','')!~'^[a-f0-9]{32}$'",
    "char_length(missing_checked_approval.command->>'reason') not between 1 and 200",
    "(missing_checked_approval.command->>'reason') ~ '[[:cntrl:]]'");
});

test('settings SHARE and worker UPDATE locks precede collection; no new lock or new business writes are added',()=>{
  assert.equal(body.slice(0,body.indexOf('  -- Relevant missing facts')).replace(declarations,'').replace('other_ids uuid[];candidate_ids uuid[];','other_ids uuid[];root_ids uuid[];candidate_ids uuid[];'),
    original.slice(0,original.indexOf('  -- Relevant missing facts')));
  order(body,'perform 1 from public.merchants','select * into s from public.merchant_attendance_settings',
    'select * into w from public.merchant_attendance_workers','select * into emp from public.merchant_enterprise_employees',
    'report:=public.faolla_attendance_unified_report_v1');
  assert.doesNotMatch(edge,/for update|for share|pg_advisory|insert into|update public|delete from/);
});

