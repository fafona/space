// Source invariants only: no PostgreSQL, real Auth or production evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
import {retentionDisposalMetadataDiagnostic,retentionDisposalMetadataLimits,retentionDisposalCatalogDiagnostic,retentionDisposalCatalogLimits,
 retentionDisposalConstraintOrderDiagnostic,retentionDisposalConstraintOrderLimits,
 retentionDisposalConstraintComparisonDiagnostic,retentionDisposalConstraintComparisonLimits} from './merchant-attendance-retention-disposal-metadata-native.mjs';

const filename='202610080197_merchant_attendance_retention_disposal.sql',directory=new URL('./supabase-migrations/',import.meta.url);
const read=n=>readFileSync(new URL(n,directory),'utf8').replaceAll('\r\n','\n'),sql=read(filename),hash=s=>createHash('sha256').update(s).digest('hex');
const extract=s=>[...s.matchAll(/create(?: or replace)? function public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns ([\s\S]*?)as \$\$([\s\S]*?)\$\$;/gi)],funcs=extract(sql);
const body=n=>{const f=funcs.find(x=>x[1]==='faolla_attendance_'+n);assert(f,n);return f[4];};
const include=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const section=tag=>{const m=sql.match(new RegExp('\\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'));assert(m,tag);return m[1];};
const before=JSON.parse(section('disposal_functions_before')),after=JSON.parse(section('disposal_functions_after')),recipes=JSON.parse(section('disposal_recipes'));

test('197 is local-only atomic five-table candidate, no archive/event/user rewrite',()=>{
 assert.equal((sql.match(/^create table if not exists public\./gm)||[]).length,5);assert.equal(funcs.length,20);
 include(sql,"version=202610080195 and name='merchant_attendance_administrative_closure'","set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080197,'merchant_attendance_retention_disposal')");
 assert(sql.trim().endsWith('commit;'));assert.doesNotMatch(sql,/drop (?:table|function|index|column)|disable trigger|session_replication_role|create extension|delete from public\./i);
 const writes=funcs.flatMap(f=>[...f[4].matchAll(/(?:insert into|update|delete from) public\.([a-z_]+)/g)].map(m=>m[1]));
 assert.deepEqual([...new Set(writes)].sort(),['merchant_attendance_disposal_approvals','merchant_attendance_disposal_artifact_coverage','merchant_attendance_disposal_artifact_event_refs','merchant_attendance_disposal_event_coverage','merchant_attendance_disposal_executions','merchant_attendance_location_results']);
 assert.equal(validateMigrationSource(filename,sql).length,0);
});

test('every new exact body/signature/metadata and RPC permission pinned before reentry and after install',()=>{
 assert.deepEqual(before,after);assert.equal(before.length,funcs.length);
 for(const f of funcs){const pin=before.find(p=>p.name===f[1]);assert(pin,f[1]);assert.equal(hash(f[4]),pin.hash,f[1]);assert.equal(pin.securityDefiner,/security definer/.test(f[3]));assert.equal(pin.rpc,f[1]==='faolla_attendance_retention_disposal_v1');}
 assert(sql.indexOf('$disposal_new_preflight$;')<sql.indexOf('create or replace function'));
 include(sql,'fn.proargnames','fn.pronargdefaults','fn.proconfig','fn.proparallel','fn.prosupport','acl.is_grantable',"'NULL::jsonb, false'",'guard.prosrc',"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a");
});

test('all new PLpgSQL local names are disjoint from explicit relation aliases, including the actual catalog lookup regression',()=>{
 // Finite source invariant, not a general SQL parser: the twenty new bodies
 // are reviewed together; strings/comments are masked before alias matching.
 const conflicts=source=>{
  const clean=source.replace(/'(?:''|[^'])*'/g,"''").replace(/--[^\n]*/g,'');
  const declarations=clean.match(/^\s*declare\s+([\s\S]*?)\bbegin\b/i)?.[1]??'';
  const names=new Set(declarations.split(';').map(d=>d.trim().match(/^([a-z_][a-z0-9_]*)\s+/i)?.[1]).filter(Boolean));
  const aliases=[...clean.matchAll(/\b(?:from|join)\s+(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*\s+(?:as\s+)?([a-z_][a-z0-9_]*)\b/gi)].map(m=>m[1]);
  return [...new Set(aliases.filter(a=>names.has(a)))].sort();
 };
 for(const f of funcs)assert.deepEqual(conflicts(f[4]),[],f[1]);
 const preview=body('disposal_preview_v1');
 include(preview,'declare ev public.merchant_attendance_events%rowtype','c public.merchant_attendance_disposal_event_coverage%rowtype','n integer:=0',
  'from pg_class catalog_table join pg_namespace catalog_namespace on catalog_namespace.oid=catalog_table.relnamespace');
 const old=preview.replaceAll('catalog_namespace','n').replaceAll('catalog_table','c');
 assert.deepEqual(conflicts(old),['c','n']);
});

test('only actual serial193→195→196 core-location and current retention source advance, preserving OID/ACL/defaults',()=>{
 const oldRecipes=JSON.parse(read('202610080195_merchant_attendance_administrative_closure.sql').match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)[1]);
 const punch=JSON.parse(read('202610080193_merchant_attendance_operational_punch.sql').match(/\$punch_recipes\$([\s\S]*?)\$punch_recipes\$/)[1]);
 const independent=JSON.parse(read('202610080196_merchant_attendance_independent_workers.sql').match(/\$independent_recipes\$([\s\S]*?)\$independent_recipes\$/)[1]);
 include(sql,"version=202610080196 and name='merchant_attendance_independent_workers'");
 assert.deepEqual(recipes.map(r=>r.name),['faolla_attendance_operational_punch_core_location_v1','faolla_attendance_retention_source_v1']);
 for(const r of recipes){const old=oldRecipes.find(o=>o.name===r.name);let original;
  if(old.source.startsWith('193recipe:')){const p=punch.find(p=>(p.core||p.name)===old.name);original=extract(read(p.file)).find(f=>f[1]===p.name)[4];for(const c of p.changes)original=original.split(c.from).join(c.to);}
  else original=extract(read(old.source)).find(f=>f[1]===old.name)[4];
  for(const c of old.changes)original=original.split(c.from).join(c.to);
  const latest=independent.find(o=>o.name===r.name);
  if(latest){assert.equal(hash(original),latest.oldHash);for(const c of latest.changes){assert.equal(original.split(c.from).length-1,1);original=original.replace(c.from,c.to);}assert.equal(hash(original),latest.newHash);assert.notEqual(latest.oldHash,r.oldHash);}
  assert.equal(hash(original),r.oldHash);assert.equal(r.changes.length,1);
  for(const c of r.changes){assert.equal(original.split(c.from).length-1,1);original=original.replace(c.from,c.to);}assert.equal(hash(original),r.newHash);
  include(original,'faolla_attendance_disposal_projection_v1');assert(!r.securityDefiner&&!r.serviceExecute);
 }
 include(sql,'original_oid:=fn.oid;original_acl:=fn.proacl','execute replace(definition,fn.prosrc,body_value)',"(to_jsonb(new_fn)-array['prosrc','proargdefaults'])",'pg_get_expr(new_fn.proargdefaults,0) is distinct from defaults_value');
});

test('coverage boundary is genuine new event TX plus deferred full checked artifact traversal, never old backfill',()=>{
 const capture=body('disposal_event_capture_v1'),walk=body('disposal_artifact_refs_v1'),artifact=body('disposal_artifact_capture_v1');
 include(sql,'lock table public.merchant_attendance_events,public.merchant_attendance_period_artifacts,public.merchant_attendance_location_results in share row exclusive mode',
  'create trigger disposal_event_capture after insert','create constraint trigger disposal_event_proof after insert','create constraint trigger disposal_artifact_capture after insert');
 include(capture,'new.id,new.merchant_id,new.worker_id,new.sequence,1','tg_relid');
 include(walk,'faolla_attendance_period_artifact_checked_v1(p)','with recursive walk','jsonb_each','jsonb_array_elements','faolla_attendance_disposal_json_v1','w.depth<65','262145','count_nodes>262144','node.depth>64',"('sourceText','artifactText')",'where id=candidate','cardinality(ids)>=65536');
 assert(walk.indexOf('cardinality(ids)>=65536')<walk.indexOf('ids:=array_append'));include(walk,'reference_limit:=true','if reference_limit then exit');
 assert.doesNotMatch(walk,/limit (?:25|26)\b|join public\.merchant_attendance_events|update public\./);
 include(artifact,'faolla_attendance_disposal_artifact_refs_v1(new)','actual is distinct from',"refs->'eventIds'");
 assert.doesNotMatch(sql,/insert into public\.merchant_attendance_disposal_event_coverage[\s\S]{0,150}\bselect\b/i);
});

test('trusted preview samples authentic current metadata, full site coverage and bounded event reverse dependencies',()=>{
 const b=body('disposal_preview_v1');include(b,"p_site is distinct from '99990197'",'faolla_attendance_retention_source_v1',"'category','location_results'",'faolla_attendance_retention_policy_v1','where event_id=p_event',
  'status=\'incomplete\'','where r.merchant_id=p_site and r.event_id=p_event order by r.artifact_id limit 26','n>25',"then 'over_limit'",'faolla_attendance_disposal_hold_v1',
  "'basis',basis","'eventCovered',event_covered","'artifactsComplete',artifacts_complete","'artifactLimitExceeded',artifact_limit","'alreadyDisposed',disposed");
 const names=[...b.matchAll(/blockers:=blockers\|\|'"([a-z_]+)"'/g)].map(m=>m[1]);
 assert.doesNotMatch(b,/from public\.merchant_attendance_period_artifacts a where a\.merchant_id=p_site|not exists\(\s*select 1 from public\.merchant_attendance_disposal_artifact_coverage covered/);
 assert.deepEqual(names,['policy_unconfigured','not_due','not_inside','precision_not_present','session_not_closed','location_review','location_discussion','historical_location_snapshot','artifact_dependencies_incomplete','location_held','event_held','artifact_held','dependency_coverage_unknown','artifact_coverage_incomplete','artifact_dependency_limit','already_disposed']);
 include(b,"'attendance-retention-disposal-policy-v1'","'attendance-retention-disposal-dependencies-v1'","'attendance-retention-disposal-holds-v1'","'attendance-retention-disposal-preview-v1'",'due_at),blockers',
  'guard_trigger.tgenabled', 'guard_function.prosrc', 'guard_spec.source_sha', 'guard_function.proacl');
 const basis=b.slice(b.indexOf('location_value:='),b.indexOf("if policy->>'retentionDays'"));assert.doesNotMatch(basis,/'capturedAt',loc\.captured_at[,)]|'accuracyMeters',loc\.accuracy_meters[,)]|'distanceMeters',loc\.distance_meters[,)]/);
});

test('artifact capture writes genuine coverage and all references in one statement before immediate proof, retaining exact collector and final checks',()=>{
 const b=body('disposal_artifact_capture_v1');
 include(b,'refs:=public.faolla_attendance_disposal_artifact_refs_v1(new);','with inserted_coverage as (',
  'returning merchant_id,artifact_id',
  'insert into public.merchant_attendance_disposal_artifact_event_refs(merchant_id,event_id,artifact_id,coverage_version)',
  "from inserted_coverage cross join lateral jsonb_array_elements(refs->'eventIds') id_value;",
  'c.reference_count<>jsonb_array_length(actual)',"actual is distinct from refs->'eventIds'","c.references_fingerprint is distinct from refs->>'referencesFingerprint'");
 const statement=b.slice(b.indexOf(' with inserted_coverage as ('),b.indexOf(' select * into c'));
 assert.equal((statement.match(/;/g)||[]).length,1);
 assert.equal((statement.match(/insert into public\.merchant_attendance_disposal_artifact_coverage/g)||[]).length,1);
 assert.equal((statement.match(/insert into public\.merchant_attendance_disposal_artifact_event_refs/g)||[]).length,1);
 assert.doesNotMatch(b,/\bfor\s+id\b|set constraints|set_config|disable trigger|exception when/i);
 const pinned=before.find(f=>f.name==='faolla_attendance_disposal_artifact_capture_v1');
 include(body('disposal_preview_v1'),`'faolla_attendance_disposal_artifact_capture_v1','${pinned.hash}',true`);
});

test('raw original session really closes, and no correction/admin closure supplies known hours',()=>{
 const b=body('disposal_session_v1');include(b,'p.sequence-2001','limit 2003','n>2002','e.sequence<>expected',"e.action='clock_out' then state:='closed'",'e.actor_employee_id is distinct from first_event.actor_employee_id','e.received_at>p_as_of');
 assert.doesNotMatch(b,/administrative_|correction_|revision_|schedule_|verifiedEndAt/);
 include(body('disposal_hold_v1'),'faolla_attendance_retention_receipt_v1','h.source_snapshot is distinct from canonical','h.recorded_at>p_as_of');
});

test('owner approve/execute are locked, gated, preview-CAS explicit writes, never guessed recovery',()=>{
 const b=body('retention_disposal_v1');assert(b.indexOf('from public.merchants')<b.indexOf('from public.merchant_attendance_settings'));assert(b.indexOf('from public.merchant_attendance_settings')<b.indexOf('from public.merchant_attendance_workers'));assert(b.indexOf('from public.merchant_attendance_workers')<b.indexOf('where event_id=event_value for update'));
 include(b,"site<>'99990197'",'p_allow_write is distinct from true','a.actor_auth_user_id is distinct from p_auth_user_id','as_of>now_at','faolla_attendance_disposal_preview_v1(site,event_value,a.preview_at)',
  'faolla_attendance_disposal_matches_v1(p,a.command)','pg_current_xact_id()',"p_command->>'action'='approve'");
 assert.equal((b.match(/insert into public\.merchant_attendance_disposal_approvals/g)||[]).length,1);assert.equal((b.match(/insert into public\.merchant_attendance_disposal_executions/g)||[]).length,1);
 include(body('disposal_hash_v1'),"'attendance-retention-disposal-command-v1',p_site,p_actor,c");
 const recovery=b.slice(b.indexOf("if mode_name='recover'"),b.indexOf("elsif mode_name='preview'"));assert.doesNotMatch(recovery,/owner_id|merchants|settings|allow_write|99990197|preview_v1/);
 const receipt=body('disposal_receipt_v1');include(receipt,'actor_auth_user_id=p_actor',"'operationId',p_operation");assert.doesNotMatch(receipt,/from public\.merchants|preview_v1\(|retention_source_v1\(/);
});

test('disposal is SQL NULL only, immutable remaining columns, same TX execution and deferred after fingerprint proof',()=>{
 const guard=body('disposal_location_guard_v1'),proof=body('disposal_proof_v1'),rpc=body('retention_disposal_v1');
 include(guard,"tg_op='INSERT'",'old.disposal_operation_id is not null','new.captured_at is not null','new.accuracy_meters is not null','new.distance_meters is not null',
  "to_jsonb(new)-array['captured_at','accuracy_meters','distance_meters','disposal_operation_id']",'x.transaction_id is distinct from pg_current_xact_id()','x.before_source_fingerprint');
 include(rpc,'set captured_at=null,accuracy_meters=null,distance_meters=null,disposal_operation_id=operation_value');
 include(proof,"tg_when='BEFORE'",'public.faolla_attendance_disposal_matches_v1(p,a.command)','x.after_source_fingerprint is distinct from public.faolla_attendance_disposal_sha_v1(src)',
  'loc.disposal_operation_id is distinct from x.operation_id','x.transaction_id is distinct from pg_current_xact_id()');
 include(sql,'pg_get_expr(conbin,conrelid)=expected_expr','unnest(constraint_value.conkey)',"if n<>1 then",'disposal_location_proof after update','deferrable initially deferred');
 include(sql,"disposal_operation_id is not null and reason='inside' and not needs_review");
 assert.doesNotMatch(sql,/alter table public\.merchant_attendance_period_artifacts|update public\.merchant_attendance_events|update public\.merchant_attendance_period_artifacts/);
});

test('private exact table/index/trigger schemas and non-erasure claims are bounded',()=>{
 assert.doesNotMatch(sql,/(?:<>|is distinct from)\s+case\b/);
 include(sql,'pg_temp.probe_','pg_get_constraintdef(oid)','pg_get_expr(i.indpred,i.indrelid)','i.indisvalid','attnotnull','attgenerated','attndims','t.tgconstraint<>0',
  "revoke all on %s from public,anon,authenticated,service_role",'grant execute on function public.faolla_attendance_retention_disposal_v1(jsonb,uuid,jsonb,boolean) to service_role');
 const approvals=sql.slice(sql.indexOf('create table if not exists public.merchant_attendance_disposal_approvals'),sql.indexOf('create table if not exists public.merchant_attendance_disposal_executions'));
 assert.doesNotMatch(approvals,/captured_at\s+(?:text|timestamptz)|accuracy_meters\s|distance_meters\s|source_snapshot|source_text/);
});

test('temporary probes have no permanent FK; all eight real FKs retain an exact named catalog manifest',()=>{
 const probes=sql.slice(sql.indexOf('create temporary table probe_merchant_attendance_disposal_event_coverage'),sql.indexOf('do $disposal_table_postconditions$'));
 assert.equal((probes.match(/create temporary table /g)||[]).length,5);
 assert.doesNotMatch(probes,/\breferences\b|\bforeign key\b/i);
 const keys=JSON.parse(section('disposal_foreign_keys'));assert.equal(keys.length,8);
 assert.equal(new Set(keys.map(s=>s[1])).size,8);
 const definitions=sql.slice(sql.indexOf('create table if not exists public.merchant_attendance_disposal_event_coverage'),sql.indexOf('alter table public.merchant_attendance_location_results'));
 assert.equal((definitions.match(/\breferences public\./g)||[]).length,8);
 for(const spec of keys){
  assert.equal(spec.length,12);const [table,name,columns,referenced,referencedColumns,onUpdate,onDelete,match,validated,noInherit,deferrable,deferred]=spec;
  assert(name.length<64);assert.deepEqual([onUpdate,match,validated,noInherit,deferrable,deferred],['a','s',true,true,false,false]);
  assert.equal(onDelete,name==='disposal_event_coverage_event_fk'?'r':'a');
  const tableBody=definitions.match(new RegExp('create table if not exists public\\.'+table+'\\(([\\s\\S]*?)\\n\\);'))?.[1];assert(tableBody,table);
  const reference=tableBody.match(new RegExp('constraint '+name+' (?:foreign key\\(([^)]*)\\) )?references public\\.([a-z_]+)\\(([^)]*)\\)( on delete restrict)?'));
  assert(reference,name);assert.equal(reference[2],referenced);assert.deepEqual(reference[3].split(','),referencedColumns);
  assert.equal(Boolean(reference[4]),onDelete==='r');
  if(reference[1])assert.deepEqual(reference[1].split(','),columns);
  else assert.match(tableBody.slice(0,reference.index),new RegExp(columns[0]+' (?:text|uuid)(?: not null| primary key)? $'));
 }
 const check=section('disposal_table_postconditions');
 include(check,"c.contype='f'",'c.conname','unnest(c.conkey) with ordinality','c.confrelid::text','unnest(c.confkey) with ordinality',
  'c.confupdtype::text,c.confdeltype::text,c.confmatchtype::text,c.convalidated,c.connoinherit,c.condeferrable,c.condeferred',
  "to_regclass('public.'||(spec->>3))::oid::text",'spec->5,spec->6,spec->7,spec->8,spec->9,spec->10,spec->11',
  "if actual is distinct from expected then raise exception 'merchant_attendance_disposal_foreign_key_changed'",'order by c.conname','order by spec->>1');
 // Pure metadata-negative model only. Every field must remain observable to the
 // SQL exact sorted comparison, including missing/extra/renamed constraints.
 const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>a[1].localeCompare(b[1])));
 const unchanged=canonical(keys);assert.equal(canonical([...keys].reverse()),unchanged);
 for(const [index,replacement] of [[1,'renamed_fk'],[2,['wrong_column']],[3,'wrong_table'],[4,['wrong_ref_column']],
  [5,'c'],[6,'c'],[7,'f'],[8,false],[9,false],[10,true],[11,true]]){
  const changed=structuredClone(keys);changed[0][index]=replacement;assert.notEqual(canonical(changed),unchanged,`foreign_key_field_${index}`);
 }
 assert.notEqual(canonical(keys.slice(1)),unchanged);assert.notEqual(canonical([...keys,keys[0]]),unchanged);
 assert.doesNotMatch(sql,/alter table public\.merchant_attendance_disposal_[a-z_]+ (?:drop|rename) constraint/i);
});

test('short metadata diagnostic is inert and limited to fourteen TEMP/rollback statements, never a business acceptance',()=>{
 assert.deepEqual(retentionDisposalMetadataLimits,{topLevelStatements:14,callbackMs:15000,newClusters:0,newDatabases:0,businessRows:0});
 const diagnostic=retentionDisposalMetadataDiagnostic(sql);assert.equal(diagnostic.statements.length,14);
 assert.equal(diagnostic.statements[0],'begin;');assert.equal(diagnostic.statements.at(-1),'rollback;');
 assert.equal((diagnostic.sql.match(/create temporary table /g)||[]).length,10);
 assert.equal((diagnostic.sql.match(/\breferences pg_temp\./g)||[]).length,8);
 assert.doesNotMatch(diagnostic.sql,/create (?:table|schema|database|function)|\binsert\b|\bupdate public\.|\bdelete from\b|references public\./i);
 include(diagnostic.sql,'c.conname','c.confrelid::text','c.confupdtype::text,c.confdeltype::text,c.confmatchtype::text',
  "raise exception 'merchant_attendance_disposal_foreign_key_changed'",'constraint original_measured check','constraint disposed_measured check');
});

test('short catalog lookup diagnostic reproduces only the old alias error and fixed exact lookup in TEMP/rollback',()=>{
 assert.deepEqual(retentionDisposalCatalogLimits,{topLevelStatements:8,callbackMs:10000,newClusters:0,newDatabases:0,businessRows:0});
 const diagnostic=retentionDisposalCatalogDiagnostic(sql);assert.equal(diagnostic.statements.length,8);
 assert.equal(diagnostic.statements[0],'begin;');assert.equal(diagnostic.statements.at(-1),'rollback;');
 assert.equal((diagnostic.sql.match(/create temporary table /g)||[]).length,2);
 assert.equal((diagnostic.sql.match(/create function pg_temp\./g)||[]).length,2);
 include(diagnostic.sql,"sqlstate='42703'",'record "c" has no field "relnamespace"','fixed_lookup_namespace_changed',
  'from pg_class catalog_table join pg_namespace catalog_namespace on catalog_namespace.oid=catalog_table.relnamespace');
 assert.doesNotMatch(diagnostic.sql,/create (?:schema|database)|create function public\.|\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/);
});

test('short constraint order diagnostic is ten TEMP/rollback SQL statements, not a business writer',()=>{
 assert.deepEqual(retentionDisposalConstraintOrderLimits,{topLevelStatements:10,callbackMs:10000,newClusters:0,newDatabases:0,businessRows:0});
 const d=retentionDisposalConstraintOrderDiagnostic();assert.equal(d.statements.length,10);
 assert.equal(d.statements[0],'begin;');assert.equal(d.statements.at(-1),'rollback;');
 assert.equal((d.sql.match(/create temporary table /g)||[]).length,3);assert.equal((d.sql.match(/create function pg_temp\./g)||[]).length,2);
 assert.equal((d.sql.match(/create constraint trigger /g)||[]).length,2);
 include(d.sql,'set constraints all immediate',"sqlstate='P0001' and sqlerrm='rd197_proof_before_refs'",'rd197_constraint_order_rollback_failed');
 assert.doesNotMatch(d.sql,/\bpublic\.|create (?:schema|database)|merchant_attendance/);
});

test('short writable-CTE comparison retains the original proof and FK, rejects standalone coverage, and always rolls back',()=>{
 assert.deepEqual(retentionDisposalConstraintComparisonLimits,{topLevelStatements:12,callbackMs:10000,newClusters:0,newDatabases:0,businessRows:0});
 const d=retentionDisposalConstraintComparisonDiagnostic();assert.equal(d.statements.length,12);
 assert.deepEqual(d.statements.slice(0,9),retentionDisposalConstraintOrderDiagnostic().statements.slice(0,9));
 assert.equal(d.statements.at(-1),'rollback;');assert.equal((d.sql.match(/create constraint trigger /g)||[]).length,2);
 include(d.sql,'with inserted_coverage as(insert into pg_temp.rd197_order_coverage values(new.id) returning id)',
  'insert into pg_temp.rd197_order_refs select id from inserted_coverage','rd197_cte_complete_refs_failed','rd197_cte_forgery_guard_failed',
  'insert into pg_temp.rd197_order_coverage values(99)','references pg_temp.rd197_order_coverage(id)');
 assert.doesNotMatch(d.sql,/\bpublic\.|create (?:schema|database)|merchant_attendance|set_config|disable trigger|drop trigger|set constraints [^;]+deferred/i);
});
