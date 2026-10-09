//Pure migration contracts only. No PostgreSQL process/connection or deployment.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const name='202610080183_merchant_attendance_period_continuation.sql';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replace(/\r/g,'');
const sql=read(name),old149=read('202610050149_merchant_attendance_period_closure.sql'),
  old150=read('202610050150_merchant_attendance_period_seal_guards.sql'),
  old179=read('202610070179_merchant_attendance_outage_periods.sql'),old182=read('202610070182_merchant_attendance_retention.sql');
const fn=(text,name)=>{const start=text.indexOf('create or replace function public.'+name+'('),end=text.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return text.slice(start,end+4);};
const v1=fn(sql,'faolla_attendance_period_closure_v1'),v2=fn(sql,'faolla_attendance_period_closure_v2');
const block=(text,start,end)=>{const i=text.indexOf(start),j=text.indexOf(end,i+start.length);assert(i>=0&&j>i,start);return text.slice(i,j);};
const clean=text=>text.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
const has=(text,...values)=>values.forEach(value=>assert(text.includes(value),value));
const order=(text,...values)=>{let pos=-1;for(const value of values){pos=text.indexOf(value,pos+1);assert(pos>=0,value);}};

test('183 is additive registration with a short-lock transaction and no destructive catalog commands',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);
  assert.match(sql,/^--231/);has(sql,"set local lock_timeout='3s'",'values(202610080183,');
  assert.equal((sql.match(/create table if not exists public\./g)||[]).length,2);
  assert.doesNotMatch(sql,/disable trigger|drop\s+(?:table|column|schema)|alter\s+column|delete\s+from\s+public\./i);
  assert(!sql.includes('create or replace function public.faolla_attendance_period_closure_source_v1('));
});
test('only five numeric checks change after exact database deparser proof; reapply checks exact new definitions',()=>{
  const ddl=block(sql,'do $continuation_numeric_constraints$','$continuation_numeric_constraints$;');
  has(ddl,'create temporary table attendance_period_continuation_check_probe','on commit drop',
    'pg_get_constraintdef(c.oid,true)=','pg_get_constraintdef(p.oid,true)','if found_count<>1','spec.probe_name');
  assert.equal((ddl.match(/execute format\('alter table %s drop constraint %I'/g)||[]).length,1);
  has(ddl,'revision between 1 and 2147483647','current_version between 1 and 2147483647','not sealed or revision<2147483647',
    'revision::bigint=(command->>\'expectedRevision\')::bigint+1');
  assert.doesNotMatch(ddl,/merchant_attendance_period_closures_check\d|regexp_replace/);
});
test('v2 command remains exact old seven-key intent with representable counters and no wire renaming',()=>{
  let expected=fn(old149,'faolla_attendance_period_closure_command_v1').replaceAll('faolla_attendance_period_closure_command_v1','faolla_attendance_period_closure_command_v2');
  expected=expected.replace("'^(0|[1-9][0-9]{0,2})$'",()=>"'^(0|[1-9][0-9]{0,9})$'")
    .replace("(p->>'expectedRevision')::integer>100 or (p->>'expectedVersion')::integer>20",()=>"(p->>'expectedRevision')::numeric>=2147483647 or (p->>'expectedVersion')::numeric>(p->>'expectedRevision')::numeric");
  assert.equal(clean(fn(sql,'faolla_attendance_period_closure_command_v2')),clean(expected));
  has(fn(sql,'faolla_attendance_period_entry_v2'),"p.revision::bigint<>(p.command->>'expectedRevision')::bigint+1",'p.version::bigint<>');
});
test('quota and immutable names are projected once then charged only by actual artifact INSERT',()=>{
  const trigger=fn(sql,'faolla_attendance_period_storage_insert_v2');
  order(trigger,'for update','faolla_attendance_period_artifact_checked_v1(new)','faolla_attendance_period_summary_v1(c,body)',
    'insert into public.merchant_attendance_period_storage','used_bytes=used_bytes+new.artifact_bytes',
    'used_bytes<=67108864-new.artifact_bytes',"raise exception 'attendance_period_storage_limit'",'insert into public.merchant_attendance_period_artifact_metadata');
  assert.doesNotMatch(trigger,/sum\(|count\(|current_version|artifact_text\s*:=/i);
  has(sql,'after insert on public.merchant_attendance_period_artifacts','before update or delete on public.merchant_attendance_period_artifact_metadata',
    "body->'worker'->>'workerName'","body->'worker'->>'workerNo'",'used_bytes between 0 and 67108864');
  assert.doesNotMatch(v1,/sum\(artifact_bytes\)/);assert.doesNotMatch(v2,/sum\(artifact_bytes\)/);
  for(const writer of [v1,v2])order(writer,'if new_version then','source_fingerprint=source_result','if a.artifact_id is null then','insert into public.merchant_attendance_period_artifacts');
});
test('merchant settings serialize write budget and source locks before worker and employee',()=>{
  for(const writer of [v1,v2])order(writer,'from public.merchants','for share','from public.merchant_attendance_settings',
    'for update','from public.merchant_attendance_workers','for update','from public.merchant_enterprise_employees','for share');
  has(v2,"if action_name<>'reopen' and (not coalesce(p_allow_write,false) or not s.enabled)");
});
test('v1 safe writer is unchanged except explicit protocol guard, indexed overlap and shared quota',()=>{
  let expected=fn(old179,'faolla_attendance_period_closure_v1');
  expected=expected.replace("  if mode_name='list' then",()=>"  if c.period_id is not null and (c.revision>100 or c.current_version>20) then raise exception 'attendance_period_protocol_required';end if;\n  if mode_name='list' then");
  expected=expected.replace("      if jsonb_array_length(items)>=20 then",()=>"      if listed.revision>100 or listed.current_version>20 then raise exception 'attendance_period_protocol_required';end if;\n      if jsonb_array_length(items)>=20 then");
  expected=expected.replace("          select coalesce(sum(artifact_bytes),0) into bytes_total from public.merchant_attendance_period_artifacts where merchant_id=site;\n          if bytes_total+artifact_size>67108864 then raise exception 'attendance_period_limit';end if;",()=>'');
  expected=expected.replace('          insert into public.merchant_attendance_period_artifacts select (a).*;',()=>`          begin
            insert into public.merchant_attendance_period_artifacts select (a).*;
          exception when raise_exception then
            if sqlerrm='attendance_period_storage_limit' then raise exception 'attendance_period_limit';else raise;end if;
          end;`);
  expected=expected.replace("if exists(select 1 from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid\n          and start_at<(source_result->>'toAt')::timestamptz and end_at>(source_result->>'fromAt')::timestamptz)",()=>"if exists(select 1 from (select x.end_at from public.merchant_attendance_period_closures x\n          where x.merchant_id=site and x.worker_id=wid and x.start_at<(source_result->>'toAt')::timestamptz\n          order by x.start_at desc,x.period_id desc limit 1) predecessor\n          where predecessor.end_at>(source_result->>'fromAt')::timestamptz)");
  assert.equal(clean(v1),clean(expected));
});
test('existing non-overlap proof precedes identical predecessor semantics for both writers and seal guard',()=>{
  order(sql,'lag(end_at) over(partition by merchant_id,worker_id order by start_at,period_id)','prior_end>start_at','attendance_period_continuation_overlap_conflict',
    'create or replace function public.faolla_attendance_period_assert_open_v1');
  for(const writer of [v1,v2])has(writer,'order by x.start_at desc,x.period_id desc limit 1',"predecessor.end_at>(source_result->>'fromAt')::timestamptz");
  const guard=fn(sql,'faolla_attendance_period_assert_open_v1');
  has(guard,'c.sealed and c.start_at<b','order by c.start_at desc,c.period_id desc limit 1','predecessor.end_at>a');
  assert.equal(clean(guard.slice(0,guard.indexOf('    --183'))),clean(fn(old150,'faolla_attendance_period_assert_open_v1').split('    if exists(select 1 from public.merchant_attendance_period_closures c')[0]));
});
test('v2 removes only lifetime operation/version/period counts, not business or integer gates',()=>{
  assert.doesNotMatch(v2,/limit 101|limit 1000|limit 200|select count\(\*\)|sum\(artifact_bytes\)/i);
  has(v2,'coalesce(c.revision,0)>=2147483647',"coalesce(c.revision,0)>=2147483646 and action_name<>'reopen'",
    'c.current_version>=2147483647',"'unresolved_outage'","source_result->'blockers' is distinct from '[]'::jsonb",
    "raise exception 'attendance_period_source_changed'","raise exception 'attendance_period_not_confirmed'");
});
test('v2 query and cursor are exact scope-bound mode variants, UTC6 and inclusive snapshot/exclusive seek',()=>{
  has(v2,"array['siteId','access','workerId','fromDate','throughDate','mode','periodId','operationId','version','cursor']",
    "cursor_value->k is distinct from p_query->k","cursor_value->>'kind' is distinct from mode_name",
    "cursor_value->'atOpenedAt','stamp6'","cursor_value->'beforeOpenedAt','stamp6'",
    '(x.opened_at,x.period_id)<=(at_opened,at_pid)','(x.opened_at,x.period_id)<(before_opened,before_pid)',
    'x.revision<=at_revision','x.revision<before_revision','x.version<=at_version','x.version<before_version');
});
test('list uses fixed historical metadata, 31-day intersecting window, 25+1 rows and no bodies',()=>{
  const list=block(v2,"  if mode_name='list' then\n    if cursor_value","  if mode_name in('history','versions') then");
  has(list,'x.from_date between first_day-30 and last_day and x.through_date>=first_day','limit 26','jsonb_array_length(items)=25',
    'faolla_attendance_period_summary_v2(listed)',"'openedAt'","'nextCursor'");
  assert.doesNotMatch(list,/artifact_text|artifact_checked|period_artifacts|current_source/);
  const summary=fn(sql,'faolla_attendance_period_summary_v2');
  has(summary,'merchant_attendance_period_artifact_metadata','m.worker_name','m.worker_no');assert.doesNotMatch(summary,/artifact_text|artifact_checked|display_name/);
});
test('history and versions enforce exact bounded first/last pages without lifetime verification',()=>{
  const pages=block(v2,"  if mode_name in('history','versions') then","  if mode_name='preview' then");
  has(pages,'limit 51','limit 21','entry_row.revision<>page_top-jsonb_array_length(items)','v.version<>page_top-jsonb_array_length(items)',
    'jsonb_array_length(items)<>least(50,page_top)','jsonb_array_length(items)<>least(20,page_top)',
    '(page_top>50)<>(next_cursor is not null)','(page_top>20)<>(next_cursor is not null)');
  assert.doesNotMatch(pages,/artifact_text|artifact_checked|select count\(|sum\(/);
  has(pages,"'artifactBytes',x.artifact_bytes,'artifactSha256',x.artifact_sha256");
});
test('exact saved operation is authorized and found before fresh flags, quota or source work',()=>{
  order(v2,'from public.merchants','from public.merchant_attendance_settings','from public.merchant_attendance_workers',
    'c.employee_id<>e.id or c.employee_auth_user_id<>e.auth_user_id','where merchant_id=site and operation_id=op',
    'saved.actor_auth_user_id<>p_auth_user_id','saved.command is distinct from p_command','replayed:=true',
    'if p_command is not null and saved.operation_id is null then');
  has(v2,"elsif mode_name='recover' then raise exception 'attendance_operation_not_found'",'case when replayed then saved.version else c.current_version end',
    "if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then");
});
test('detail has one original artifact text/SHA/byte triple and original entry, never a fake truncated history',()=>{
  const returned=v2.slice(v2.lastIndexOf('  return common||'));
  has(returned,"'artifactText',a.artifact_text","'artifactSha256',a.artifact_sha256,'artifactBytes',a.artifact_bytes","'operation',public.faolla_attendance_period_entry_v2(saved)");
  assert(!returned.includes("'history'"));assert(!v2.includes('history:=history||'));assert(!v2.includes('jsonb_array_length(history)'));
});
test('182 source keeps exactly the same DTO and canonicalization before/after its narrow reference proof',()=>{
  const before=fn(old182,'faolla_attendance_retention_source_v1'),after=fn(sql,'faolla_attendance_retention_source_v1');
  assert.equal(after.slice(0,after.indexOf('    --183:')),before.slice(0,before.indexOf('    --An artifact')));
  const tail="    result:=jsonb_build_object('kind','period_artifact'";
  assert.equal(after.slice(after.indexOf(tail)),before.slice(before.indexOf(tail)));
  has(after,'where v.merchant_id=p_site and v.operation_id=ar.artifact_id','version_row.artifact_id is distinct from ar.artifact_id',
    'version_row.entry_version is distinct from version_row.version','version_row.entry_recorded_at is distinct from ar.recorded_at');
  assert.doesNotMatch(after,/limit 21|n>20|order by v.version/);
});
test('new projection ACLs, private helpers, triggers and cost indexes are verified after install and replay',()=>{
  has(sql,'aclexplode(coalesce(row_item.proacl','row_item.relrowsecurity','from pg_policy',
    'meta.type_bits','g.tgenabled=\'O\'','idx.indisvalid','idx.indisready','idx.indislive','idx.indnkeyatts<>meta.key_count',
    'idx.indoption::text is distinct from meta.options','pg_get_expr(idx.indpred,idx.indrelid,true) is distinct from meta.predicate',
    'metadata_row.worker_name is distinct from persisted_artifact.artifact_text::jsonb',
    'coalesce(quota_current.used_bytes,0)<>coalesce(quota_totals.used_bytes,0)');
  assert.equal((sql.match(/grant execute on function public\.faolla_attendance_period_closure_v[12]\(/g)||[]).length,2);
  assert.doesNotMatch(sql,/grant\s+(?:select|insert|update|delete|all)\s+on/i);
});
test('projection reentry uses distinct row variables and qualified query aliases',()=>{
  const projection=block(sql,'do $continuation_initial_projection$','$continuation_initial_projection$;');
  has(projection,'declare artifact_row public.merchant_attendance_period_artifacts%rowtype',
    'period_row public.merchant_attendance_period_closures%rowtype',
    'source_period.merchant_id=artifact_row.merchant_id',
    'source_period.period_id=artifact_row.period_id',
    'counted_artifact.merchant_id,sum(counted_artifact.artifact_bytes)',
    'quota_current.used_bytes','quota_totals.used_bytes',
    'metadata_row.worker_no is distinct from persisted_artifact.artifact_text::jsonb');
  assert.doesNotMatch(projection,/\b(?:a|c|m|s)\.|#variable_conflict|\b(?:from|join)\s+[^\n;]+\s+(?:artifact_row|period_row)\b/i);
});
test('only v1 maps a new artifact storage rejection to its unchanged definite limit code',()=>{
  const insertion=block(v1,'          begin\n            insert into public.merchant_attendance_period_artifacts','        else');
  has(insertion,"exception when raise_exception then",
    "if sqlerrm='attendance_period_storage_limit' then raise exception 'attendance_period_limit';else raise;end if;");
  assert.equal((v1.match(/sqlerrm='attendance_period_storage_limit'/g)||[]).length,1);
  assert.doesNotMatch(v2,/sqlerrm='attendance_period_storage_limit'/);
  has(v2,"perform public.faolla_attendance_period_artifact_checked_v1(a);\n          insert into public.merchant_attendance_period_artifacts select (a).*;\n        else");
  has(fn(sql,'faolla_attendance_period_storage_insert_v2'),"raise exception 'attendance_period_storage_limit'");
});
