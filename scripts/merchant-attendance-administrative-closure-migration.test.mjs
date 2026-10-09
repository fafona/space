// C04-B source/recipe tests only. These do not execute or validate PostgreSQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610080195_merchant_attendance_administrative_closure.sql';
const directory=new URL('./supabase-migrations/',import.meta.url);
const read=name=>readFileSync(new URL(name,directory),'utf8').replaceAll('\r\n','\n');
const sql=read(filename),hash=s=>createHash('sha256').update(s).digest('hex');
const extract=s=>[...s.matchAll(/create(?: or replace)? function public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns ([\s\S]*?)as \$\$([\s\S]*?)\$\$;/gi)];
const funcs=extract(sql),body=name=>{const f=funcs.find(x=>x[1]==='faolla_attendance_'+name);assert(f,name);return f[4];};
const include=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const section=tag=>sql.match(new RegExp('\\$'+tag+'\\$([\\s\\S]*?)\\$'+tag+'\\$'))[1];
const recipes=JSON.parse(section('administrative_recipes'));
const before=JSON.parse(section('administrative_new_before')),after=JSON.parse(section('administrative_new_after'));
const punchRecipes=JSON.parse(read('202610080193_merchant_attendance_operational_punch.sql').match(/\$punch_recipes\$([\s\S]*?)\$punch_recipes\$/)[1]);
const originals=new Map(),changed=new Map();
for(const r of recipes){
 let original;
 if(r.source.startsWith('193recipe:')){
  const pr=punchRecipes.find(v=>(v.core||v.name)===r.name);assert(pr,r.name);
  original=extract(read(pr.file)).find(f=>f[1]===pr.name)[4];assert.equal(hash(original),pr.originalHash);
  for(const c of pr.changes){assert.equal(original.split(c.from).length-1,c.count);original=original.split(c.from).join(c.to);}
  assert.equal(hash(original),pr.core?pr.coreHash:pr.wrapperHash);
 }else original=extract(read(r.source)).find(f=>f[1]===r.name)[4];
 assert.equal(hash(original),r.oldHash,r.name+' old pin');let result=original;
 for(const c of r.changes){assert(c.from);assert.equal(result.split(c.from).length-1,c.count,r.name+' exact recipe');result=result.split(c.from).join(c.to);}
 assert.equal(hash(result),r.newHash,r.name+' replacement pin');originals.set(r.name,original);changed.set(r.name,result);
}
const forward=n=>{const b=changed.get('faolla_attendance_'+n);assert(b,n);return b;};

test('195 is one bounded installation, two new ledgers, and no raw/history rewrite',()=>{
 assert.equal(funcs.length,25);assert.equal(recipes.length,28);
 assert.equal((sql.match(/^create table if not exists public\./gm)||[]).length,2);
 assert.equal((sql.match(/^create temporary table /gm)||[]).length,2);
 include(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080195,'merchant_attendance_administrative_closure')");
 assert(sql.trim().endsWith('commit;'));assert.doesNotMatch(sql,/NOT FROZEN|--195_|drop (?:table|function|index)|disable trigger|session_replication_role|create extension/i);
 const writes=[...funcs.flatMap(f=>[...f[4].matchAll(/(?:insert into|update|delete from) public\.([a-z_]+)/g)].map(v=>v[1]))];
 assert.deepEqual([...new Set(writes)].sort(),['merchant_attendance_administrative_closure_entries','merchant_attendance_administrative_closures']);
 assert.equal(validateMigrationSource(filename,sql).length,0);
});

test('every new body/metadata is pinned before reentry and after installation',()=>{
 assert.deepEqual(before,after);assert.equal(before.length,25);
 for(const f of funcs){const pin=before.find(v=>v.name===f[1]);assert(pin,f[1]);assert.equal(hash(f[4]),pin.hash,f[1]);assert.equal(pin.securityDefiner,/security definer/.test(f[3]));
  assert.equal(hash(f[4].replaceAll('public.','owned_195.').replaceAll('owned_195.','public.')),pin.hash);}
 include(sql,'fn.proargnames','fn.pronargdefaults','fn.proconfig','fn.proparallel','fn.proleakproof','acl.is_grantable',"'NULL::jsonb, false'");
 assert(sql.indexOf('$administrative_preflight$;')<sql.indexOf('create or replace function'));
});

test('forward compatibility is an exact 28-function whitelist, preserving OID, ACL and defaults',()=>{
 assert.equal(new Set(recipes.map(r=>r.name)).size,28);
 for(const n of ['period_closure_v1','period_closure_v2','period_delegated_closure_v1','period_storage_insert_v2','operational_punch_before_v1','operational_punch_result_v1'])assert(!recipes.some(r=>r.name==='faolla_attendance_'+n));
 include(sql,'original_oid:=fn.oid;original_acl:=fn.proacl','pg_get_functiondef(fn.oid)','execute replace(definition,fn.prosrc,body_value)',
  "(to_jsonb(new_fn)-array['prosrc','proargdefaults']) is distinct from (to_jsonb(fn)-array['prosrc','proargdefaults'])",'pg_get_expr(new_fn.proargdefaults,0) is distinct from original_defaults', "case when installed then spec->>'newHash' else spec->>'oldHash' end");
 assert(recipes.filter(r=>r.name.includes('operational_punch_core')).every(r=>!r.securityDefiner&&!r.serviceExecute));
});

test('case identity/start is immutable; each unknown/close owns a new pause/tail/source version',()=>{
 const b=body('administrative_source_v1'),g=body('administrative_guard_v1');
 include(b,'for update','for share','ep.paused','pause.original_event_id','employment.starts_on>today','sequence between greatest(1,tail.sequence-2001)',
  "'context',context_value","'epoch'","'sourceBytes'","'sourceFingerprint'",'2003');
 include(g,'new.case_scope','new.revision<>old.revision+1','old.closed_operation_id is not null','source_entry','prior.recorded_at>e.recorded_at');
 assert.doesNotMatch(body('administrative_scope_v1'),/suspensionId|tailEventId|generation/);
 include(body('administrative_entry_v1'),"source_value->'frame' is distinct from p.frame",'events_value is distinct from',"'endsOn',null",'Immutable prefix only');
});

test('close has fresh source/head CAS and lock-rechecked end time, with no synthetic event',()=>{
 const b=body('administrative_closures_v1');include(b,"source_value->'context'->>'sourceFingerprint' is distinct from p_command->>'expectedSourceFingerprint'",
  'scope_value is distinct from h.case_scope','stamp:=clock_timestamp()',"verifiedEndAt')::timestamptz>stamp",'faolla_attendance_period_assert_open_v1',"'startAt'","'endAt'");
 assert(b.indexOf('from public.merchants')<b.indexOf('for update'));assert.doesNotMatch(b,/insert into public\.merchant_attendance_events|update public\.merchant_attendance_workers/);
 include(b,"source_value:=source_value||jsonb_build_object('frame',null,'context',null)");
});

test('original-actor recovery is minimum receipt before current permissions and never returns source',()=>{
 const b=body('administrative_closures_v1'),start=b.indexOf(" if mode_name='recover' then\n  -- Original-actor"),end=b.indexOf('\n else\n  select user_id',start);
 assert(start>=0&&end>start);const recovery=b.slice(start,end);include(recovery,'actor_auth_user_id=p_auth_user_id','actor_access=access_name',"'kind','receipt'");
 assert.doesNotMatch(recovery.replace(/--[^\n]*/g,''),/source_v1\(|boundary_v1\(|\bmember\b|settings|owner_id/);
 include(b,"e.command is distinct from p_command","p_allow_close is distinct from true","p_command->>'expectedClosedOperationId' is distinct from h.closed_operation_id::text");
 assert.doesNotMatch(body('administrative_receipt_v1'),/from public\.merchants|from public\.merchant_enterprise_employees|source_v1\(/);
});

test('self opinions require original current binding; owner response never clears boundary or disputes',()=>{
 const b=body('administrative_closures_v1');include(b,"access_name='self'",'h.employee_auth_user_id is distinct from p_auth_user_id',"ref_entry.action is distinct from 'self_dispute'",
  "latest_source_operation_id=case when p_command->>'action' in('record_unknown','close')", "closed_operation_id=case when p_command->>'action'='close'");
 assert.doesNotMatch(b,/status\s*=\s*'active'|attendance\.self\.view/);
 include(body('administrative_entry_v1'),'p.actor_auth_user_id is distinct from head.employee_auth_user_id','x.revision<p.revision');
});

test('all real cores preserve raw sequence/receipt while valid administrative proof supplies operating off',()=>{
 for(const n of ['self','pin','onsite','location']){const b=forward('operational_punch_core_'+n+'_v1');include(b,'faolla_attendance_administrative_current_v1','faolla_attendance_operating_head_v1','operational_punch_before_v1','operational_punch_replay_v1');}
 include(forward('pin_schedule_v1'),'faolla_attendance_administrative_current_v1','operational_punch_legacy_gate_v1');
 assert.equal((forward('operational_punch_core_location_v2').match(/administrative_current_v1\(p_site_id,w.id\) is null/g)||[]).length,2);
 const b=body('operating_head_v1');include(b,"'lastEvent',public.faolla_attendance_event_receipt_v1(tail)","'sequence',coalesce(tail.sequence,0)","'administrativeBoundary',b");
 assert.doesNotMatch(b,/clock_out'\s*[,)]|lastEvent',null|update /);
});

test('166 requires actual employment close/rejoin; new complete successor sessions retain the original state machine',()=>{
 include(forward('employment_detail_v1'),"ev.action<>'clock_out' and public.faolla_attendance_administrative_current_v1", "'currentAction',ev.action");
 include(body('administrative_restore_v1'),"last_period->>'id'=b->>'employmentPeriodId'", "'{canRestore}','false'",'faolla_attendance_employment_chain_v1');
 for(const n of ['shift_check_v1','pd_shift_v1']){const b=forward(n);include(b,'faolla_attendance_administrative_predecessor_v1',"if state_name<>'completed' and administrative_value is null then",
   "elsif ev.action='clock_out' and state_name='working' then state_name:='completed'", "administrative_value->>'tailSequence'");
  assert.doesNotMatch(b,/unresolved_review|administrative_hours_unassessed|state_name:='completed'.*administrative/);}
 include(forward('period_session_v1'),'independent identity evidence',"administrative_value is null and not exists",'predecessorBoundary');
 assert(recipes.find(r=>r.name==='faolla_attendance_self_session_v1').source.includes('110_'));
});

test('public report projection is exactly 12 fields and no Auth/reason/pause/employment leakage',()=>{
 const b=body('administrative_report_boundary_v1');const keys=[...b.matchAll(/'([A-Za-z]+)',(?:p->|'attendance)/g)].map(x=>x[1]);
 assert.deepEqual(keys,['protocol','operationId','startEventId','startSequence','startAt','tailEventId','tailSequence','tailAction','tailOccurredAt','verifiedEndAt','recordedAt','sourceFingerprint']);
 assert.doesNotMatch(b,/employee|Auth|worker|suspension|generation|employment|reason/);
 include(body('administrative_report_v1'),'faolla_attendance_administrative_boundary_v1','if not affected then return p',"'raw-and-approved-v3'","'administrativeUnassessedCount'","'totalsComplete'");
});

test('v5 distinguishes own unknown hours from predecessor proof and preserves historical source versions',()=>{
 const b=body('administrative_source_result_v1');include(b,"key_name='administrativeBoundary'",'range_to','range_from',"proofs='[]'::jsonb then return p",'source_identity_changed',"'{context,administrativeClosures}'","'administrative_hours_unassessed'");
 for(const n of ['period_source_v1','period_closure_source_base_v1','pd_source_v1','pd_fixed_source_v1'])include(forward(n),'faolla_attendance_administrative_source_result_v1',"coalesce(child->'item'->'administrativeBoundary','null'::jsonb)='null'::jsonb", "administrative_value->>'verifiedEndAt'");
 for(const n of ['period_closure_source_v1','pd_envelope_v1'])include(forward(n),"when result->>'sourceVersion'='attendance-period-source-v5' then 'attendance-period-source-v5'");
 include(body('administrative_saved_source_v1'),'expected is distinct from full_boundary','public.faolla_attendance_administrative_report_boundary_v1(full_boundary) is distinct from part','cardinality(used)<>cardinality(seen)');
});

test('saved owner/delegate artifacts and retention accept v5 only through fixed proof, without quota changes',()=>{
 include(forward('period_artifact_shape_v2'),"if src->>'sourceVersion'='attendance-period-source-v5'",'administrative_saved_source_v1');
 include(forward('period_artifact_checked_v1'),"if a->'source'->>'sourceVersion'='attendance-period-source-v5'",'administrative_saved_source_v1','period_delegation_proof_v1');
 include(forward('retention_source_v1'),'attendance-period-source-v5','period_artifact_checked_v1');
 assert.doesNotMatch(body('administrative_saved_source_v1'),/current_v1\(|source_result_v1\(|from public\.merchants|settings|grant/);
 assert(!recipes.some(r=>/storage|summary|period_closure_v[12]$|period_delegated_closure_v1$/.test(r.name)));
});

test('candidate artifact preflight samples one upper bound; saved artifacts retain their original recorded_at',()=>{
 const b=body('administrative_saved_source_v1');
 include(b,'proof_limit timestamptz:=coalesce(p_recorded,clock_timestamp())','not isfinite(proof_limit)',"recordedAt')::timestamptz>proof_limit");
 assert.equal((b.match(/clock_timestamp\(\)/g)??[]).length,1);
 assert.doesNotMatch(b,/p_recorded is null|>p_recorded|period_canonical_v1|source_result_v1/);
 include(read('202610050149_merchant_attendance_period_closure.sql'),'recorded_at timestamptz not null','check(isfinite(recorded_at))');
});

test('append-only entries and controlled heads have exact deferred proof, RLS, keys/indexes and zero privileged table access',()=>{
 include(sql,'administrative_closure_immutable','administrative_closure_shape','administrative_closure_proof','tgdeferrable and tginitdeferred',
  'pg_get_constraintdef(c.oid,true)','pg_get_expr(i.indpred,i.indrelid)','i.indisvalid','i.indisready','i.indislive',
  "has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",'acl.grantee<>expected_owner');
 const grants=[...sql.matchAll(/^grant execute on function public\.(\w+)/gm)].map(x=>x[1]);assert.deepEqual(grants,['faolla_attendance_administrative_closures_v1']);
 for(const name of ['head','entry']){const probe=sql.match(new RegExp('create temporary table administrative_closure_'+name+'_check_probe\\(([\\s\\S]*?)\\) on commit drop;'))[1];assert.doesNotMatch(probe,/references |foreign key/i);}
 assert.doesNotMatch(sql,/drop table|pg_temp.*delete|truncate public\./i);
});

test('bounded discovery/history and command/source sizes retain sentinels and do not impose a historical-count cap',()=>{
 include(body('administrative_closures_v1'),'limit 26','least(25,coalesce(before_revision-1,h.revision))','>131072');
 include(body('administrative_source_v1'),'2003','>1048576');
 include(body('administrative_saved_source_v1'),'>100','not between 1 and 200');
 assert.doesNotMatch(body('administrative_closures_v1'),/count\(\*\).*administrative_closure_entries|revision>100/);
});
