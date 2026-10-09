//Finite SOURCE checks only; not PostgreSQL/KDF/Auth/device acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {delegatedCredentialsMigration,delegatedCredentialsActions,delegatedCredentialsForwardRecipes,delegatedCredentialsInstallRecipe,delegatedCredentialsFreezeSql} from './merchant-attendance-delegated-credentials-source.mjs';
const dir=new URL('./supabase-migrations/',import.meta.url),sql=readFileSync(new URL(delegatedCredentialsMigration,dir),'utf8').replaceAll('\r\n','\n');
const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedCredentialsMigration).sort().map(name=>({name,text:readFileSync(new URL(name,dir),'utf8')}));
const r=delegatedCredentialsInstallRecipe(sql,migrations),functions=dayReviewSqlFunctions(sql),body=name=>{const f=functions.find(f=>f.name===name);assert(f,name);return f.body;};

test('207 generated SOURCE is byte-exact19 own functions, five metadata-preserving forwards, inert import',()=>{
 assert.equal(delegatedCredentialsFreezeSql(sql,migrations),sql);assert.equal(r.own.length,19);assert.equal(r.forward.cores.length,3);
 assert.equal(r.own.filter(f=>f.isRpc).length,2);assert.equal(r.own.filter(f=>f.definer).length,3);
 assert.match(sql,/credentials207_forward_metadata\)<>5/);
 for(const field of ["to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression",
  "to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata",
  'pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression',"meta.pronargdefaults<>(spec->>'defaults')::integer"])assert(sql.includes(field),field);
 for(const field of ['pg_get_expr(meta.proargdefaults,0)','aclexplode','meta.proargnames','meta.proconfig','meta.proowner'])assert(sql.includes(field));
 assert.doesNotMatch(readFileSync(new URL('./merchant-attendance-delegated-credentials-source.mjs',import.meta.url),'utf8'),/import .*child_process|pg_ctl|createdb|initdb|listen\(/);
});
test('207 three private NULL-context cores preserve original owner body byte-for-byte, Auth and metadata',()=>{
 assert.deepEqual(r.forward.cores.map(f=>f.oldHash),['55c20b87de72d6bb5d5ac6465cffa72c7dd1e725cfb34ca871ff8ad5c4703d17','5576a8f69dbf2af7b3e6171aca170f1109791ea6aa267961e0e3618adaa59bf2','95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb']);
 for(const f of r.forward.cores){assert.equal(body(f.coreName),f.core);assert.equal(f.core.split(f.anchor).length-1,1);
  assert(f.core.includes(' if p_grant_id is null then\n'+f.anchor+' else\n'));
  assert.match(f.newBody,/null\);/);assert.doesNotMatch(f.core,/p_auth\s*:=|p_auth=>m\.user_id/);
  assert.equal(f.defaults,0);assert.equal(f.result,'jsonb');assert.equal(f.definer,true);assert.equal(f.searchPath,'search_path=pg_catalog');
 }
 const independent=r.forward.cores[2];assert.match(independent.newBody,/p_material=>p_material,p_allow_new=>p_allow_new,p_grant_id=>null/);
});
test('207 snapshot adds only approved historical prepare provenance, not current perpetual grant or changed TTL/device checks',()=>{
 const s=r.forward.snapshot;assert.equal(s.oldHash,'eeffc89f77cba9000046a15c7c95bfade2664c8543b419c77f6d45b53c2d70ac');
 assert.equal(s.newBody.replace(/\((coalesce\(t\.created_by=any\(array\[[\s\S]*?\]\),false\)) or public\.faolla_attendance_delegated_credentials_issuer_v1\(t\.merchant_id,t\.id\)\)/,'$1'),s.oldBody);
 assert.equal(s.volatility,'s');assert.equal(s.definer,false);assert.equal(s.isRpc,false);
 for(const check of ['not l.active','l.time_zone<>t.time_zone','p_now<t.created_at','p_now>=t.pair_expires_at','p_now>=t.device_expires_at'])assert(s.newBody.includes(check));
 const issuer=body('faolla_attendance_delegated_credentials_issuer_v1');assert.match(issuer,/actual\.user_id=g\.actor_auth_user_id/);
 assert.match(issuer,/proof_v1\(p,false\)/);assert.doesNotMatch(issuer,/management_current|authorize_v1|epoch|role_row|valid_until/);
});
test('207 exact four action command tuple and member private commitment match the frozen nonsecret wire',()=>{
 assert.deepEqual(delegatedCredentialsActions,['terminal_prepare','terminal_revoke','pin_issue','pin_revoke']);
 const c=body('faolla_attendance_delegated_credentials_command_v1'),h=body('faolla_attendance_delegated_credentials_hash_v1'),m=body('faolla_attendance_delegated_credentials_member_material_v1');
 assert.match(c,/jsonb_build_array\(a,c->'operationId',c->'terminalId',c->'locationId'\)/);
 assert.match(c,/jsonb_build_array\(k,a,c->'operationId',c->'workerId',c->'employeeId',c->'employeeAuthUserId',c->'workerNo',c->'expectedRevision',c->'reason'\)/);
 assert.match(c,/c->'subjectId',c->'expectedSubjectRevision',c->'expectedGeneration',c->'expectedWorkerVersion',c->'expectedSettingsVersion',c->'expectedCredentialRevision',c->'reason'/);
 assert.match(h,/'attendance-delegated-terminals-v1-command' else 'attendance-delegated-pin-v1-command'/);
 assert.match(m,/'attendance-delegated-member-pin-material-v1',[\s\S]*site,actor,id,c->'operationId',c->'workerId',c->'employeeId',c->'employeeAuthUserId',\(c->>'expectedRevision'\)::bigint\+1,material->'salt',material->'verifier'/);
 assert.doesNotMatch(c+h,/verifier|pairSecret|'pin'/);assert.match(c,/>8192/);assert.match(c,/>999999997/);
});
test('207 two RPCs use the exact five named parameters, only PIN issue accepts exact private material',()=>{
 for(const name of ['faolla_attendance_delegated_terminals_v1','faolla_attendance_delegated_pin_v1']){
  const f=functions.find(f=>f.name===name);assert.deepEqual(f.args,['p_query','p_auth_user_id','p_command','p_allow_write','p_material']);
  assert.equal(f.defaults,3);assert.equal(f.defaultExpression,'NULL::jsonb, false, NULL::jsonb');
 }
 const b=body('faolla_attendance_delegated_credentials_execute_v1');
 assert.match(b,/if a is distinct from 'pin_issue' then\s*if p_material is not null then raise exception/);
 assert.match(b,/array\['salt','verifier','commitment'\]/);assert.match(b,/\{32\}/);assert.match(b,/\{64\}/);
 assert.match(b,/p_material=>p_material,p_allow_new=>true,p_grant_id=>id/);
 assert.match(b,/p_material=>null,p_allow_new=>false,p_grant_id=>id/);
});
test('207 secret-free exact POST and minimal GET recover are before current auth/flag and checked again after settings',()=>{
 const b=body('faolla_attendance_delegated_credentials_execute_v1'),receipt=body('faolla_attendance_delegated_credentials_receipt_v1');
 assert(b.indexOf("if mode_name='recover' then")<b.indexOf('for pass in 1..2 loop'));
 assert.match(b,/for pass in 1\.\.2 loop/);assert.match(b,/if a<>'pin_issue' then return/);
 assert(b.indexOf('proof.command is distinct from p_command')<b.indexOf('actual.id=site for share'));
 assert.match(b,/row\(stored.actor_auth_user_id,stored.grant_id,stored.command_fingerprint\) is distinct from row\(p_auth_user_id,id,fp\)/);
 assert.match(receipt,/actual.actor_auth_user_id=actor and actual.grant_id=id/);assert.match(receipt,/proof_v1\(p,false\)/);
 assert.doesNotMatch(receipt,/management_current|authorize_v1|p_material/);
});
test('207 PIN issue original POST must have current scoped authority and flag before comparing private commitment',()=>{
 const b=body('faolla_attendance_delegated_credentials_execute_v1'),start=b.indexOf('stamp:=clock_timestamp();g:='),gate=b.indexOf('p_allow_write is distinct from true'),material=b.indexOf("if a='pin_issue' then"),stored=b.indexOf('if proof.material_commitment is distinct from commitment');
 assert(start>0&&start<gate&&gate<material&&material<stored);assert.match(b,/commitment is distinct from p_material->>'commitment'/);
 assert.match(b,/independent_material_hash_v1\(site,[\s\S]*expectedCredentialRevision'\)::bigint\+1,op,p_material->>'salt',p_material->>'verifier'/);
 assert.match(b,/if stored.operation_id is not null then\s*if proof.material_commitment/);
});
test('207 fresh real actor/source CAS plus before/post create or generation consume do not broaden202current',()=>{
 const a=body('faolla_attendance_delegated_credentials_authorize_v1'),current=body('faolla_attendance_delegated_credentials_current_v1'),b=body('faolla_attendance_delegated_credentials_execute_v1');
 assert.match(a,/g.delegate_auth_user_id is distinct from actor/);assert.match(a,/management_hash_v1\(site,g.actor_auth_user_id,g.command\)/);
 assert.match(current,/return public.faolla_attendance_management_current_v1\(g,stamp\)/);
 for(const check of ['actual.enabled','actual.user_id=g.actor_auth_user_id','epoch.paused','epoch.generation','employee.status=','role_row.status=','g.valid_until'])assert(current.includes(check));
 assert.match(current,/sub.generation=\(g.scope->>'generation'\)::bigint\+1/);assert.match(current,/actual.created_at=stamp/);
 assert.match(b,/values\(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action/);
 assert.equal(r.forward.guard.oldHash,'37216d21b66510291fb3833781951ffeef20218594879bfcb4729fea7496c4be');
 assert.doesNotMatch(r.forward.guard.newBody,/current_v1[\s\S]*replace|generation\s*:=|owner_id\s*:=/);
});
test('207 no-op or legacy facts are never adopted as new sidecar success; exact actual auditAction references',()=>{
 const b=body('faolla_attendance_delegated_credentials_execute_v1'),business=body('faolla_attendance_delegated_credentials_business_v1');
 assert.match(b,/actual.revoked_at is not null\)\s*then raise exception 'attendance_operation_conflict'/);
 assert.match(b,/member_credential.worker_id is null or not member_credential.enabled/);assert.match(b,/independent_credential.subject_id is null or not independent_credential.enabled/);
 assert.match(b,/merchant_attendance_pin_audit actual where actual.merchant_id=site and actual.operation_id=op\) then raise exception 'attendance_operation_conflict'/);
 assert.match(b,/merchant_attendance_independent_entries actual where actual.merchant_id=site and actual.operation_id=op\) then raise exception 'attendance_operation_conflict'/);
 assert.match(b,/recordedAt'\)::timestamptz<started_at/);
 assert.match(business,/'auditAction',terminal_audit.action/);assert.doesNotMatch(business,/auditOrdinal|credentialId/);
 assert.match(business,/\(a='pin_issue'\) is distinct from \(independent_entry.credential_id is not null\)/);
});
test('207 private seven-column append-only proof pairs real public-H business proof atomically with202 sidecar',()=>{
 const ownTable=sql.slice(sql.indexOf('create table if not exists public.merchant_attendance_delegated_credential_proofs'),sql.indexOf('alter table public.merchant_attendance_delegated_credential_proofs'));
 assert.deepEqual([...ownTable.matchAll(/^ ([a-z_]+) (?:text|uuid|jsonb|timestamptz)(?: not null)?,?$/gm)].map(m=>m[1]),['merchant_id','operation_id','command','command_fingerprint','reference','material_commitment','recorded_at']);
 assert.match(ownTable,/references public.merchant_attendance_management_delegation_operations\(merchant_id,operation_id\) deferrable initially deferred/);
 assert.match(sql,/create constraint trigger credentials207_proof_pair after insert[\s\S]*deferrable initially deferred/);
 const pair=functions.find(f=>f.name==='faolla_attendance_delegated_credentials_pair_v1');assert.equal(pair.definer,true);assert.equal(pair.searchPath,'search_path=pg_catalog');
 assert.match(pair.body,/if p.operation_id is null then raise exception/);assert.match(pair.body,/proof_v1\(p,false\)/);
 assert.match(body('faolla_attendance_delegated_credentials_authority_v1'),/proof_v1\(p,true\)/);
 for(const name of ['audit_export','group_cancel','worker_save','location_save','operational_rule_withdraw','attendance_management_executor_unavailable'])assert(r.forward.guard.newBody.includes(name));
});
test('207 immutable historical reference/commitments stay verifiable after credential changes without reading current KDF material',()=>{
 const proof=body('faolla_attendance_delegated_credentials_proof_v1'),business=body('faolla_attendance_delegated_credentials_business_v1');
 assert.match(proof,/require_current then perform[\s\S]*authorize_v1/);assert.match(proof,/proof.command_fingerprint is distinct from p.command_fingerprint/);
 assert.match(proof,/actual.recorded_at<=p.recorded_at/);assert.match(proof,/p.recorded_at>=g.valid_until/);
 assert.match(business,/member_audit.command_hash is distinct from coalesce\(material_commitment/);
 assert.match(business,/independent_entry.material_commitment is distinct from material_commitment/);
 assert.doesNotMatch(business,/from public.merchant_attendance_(?:pin_credentials|independent_credentials)|management_current|head_v1/);
 assert.equal((business.match(/stamp at time zone 'UTC'/g)||[]).length,4);
});
test('207 context is exact point scope, no owner catalog/impersonation/secret material response',()=>{
 const b=body('faolla_attendance_delegated_credentials_execute_v1');
 assert.match(b,/actual.id=\(g.scope->>'locationId'\)::uuid/);assert.match(b,/actual.id=\(g.scope->>'workerId'\)::uuid/);
 assert.match(b,/jsonb_build_object\('siteId',site,'mode','detail','subjectId',g.scope->'subjectId'\)/);
 assert.doesNotMatch(b,/mode','members|mode','locations|mode','list|p_auth=>g.actor_auth_user_id|p_auth_user_id\s*:=/);
 assert.match(b,/>262144/);assert.match(b,/>4096/);
 const out=b.slice(b.indexOf('if p_command is null then\n  if p_family='),b.indexOf('\n else\n  started_at:='));
 assert.doesNotMatch(out,/salt|verifier|commitment|pairHash|pairSecret/);
});
test('207 all19 owned functions private except two RPCs;15 exact table templates with only TEMP FKs and real PK/CHECK metadata',()=>{
 assert.equal((sql.match(/^grant execute on function/gm)||[]).length,2);
 for(const f of r.own)assert(sql.includes('revoke all on function '+f.signature+' from public,anon,authenticated,service_role;'));
 assert.equal(r.templates.tables.length,15);assert.doesNotMatch(r.templates.sql,/references public\./);assert.equal(r.triggerManifest.length,24);
 for(const field of ['connoinherit','convalidated','confkey','indnkeyatts','indnullsnotdistinct','indisvalid','pg_attrdef','attacl','tginitdeferred','tgfoid'])assert(r.tableChecks.includes(field),field);
 assert.match(r.tableChecks,/\(trigger_spec->>'name'\)::name/);assert.match(r.preflight,/version=202610080206/);assert.match(r.preflight,/version=202610080196/);
 assert.doesNotMatch(r.preflight,/oldHash'\)\s*(?:or|in)|disable trigger|session_replication_role/);
});
test('207 templates retain exactly the two203 ledger read indexes, with all index comparisons still fail-closed',()=>{
 const legacy=migrations.find(m=>m.name==='202610080203_merchant_attendance_delegated_audit.sql');assert(legacy);
 const indexes=[['management_audit_grant_time_idx','merchant_attendance_management_delegations','grant_id'],['management_audit_revoke_time_idx','merchant_attendance_management_delegation_revocations','operation_id']];
 for(const [name,table,id] of indexes){
  const original='create index if not exists '+name+' on public.'+table+'(merchant_id,recorded_at desc,'+id+' desc);';
  const expected=original.replace(' if not exists','').replace('on public.','on pg_temp.');
  assert.equal(legacy.text.split(original).length-1,1);assert.equal(r.templates.sql.split(expected).length-1,1);
  const missing=migrations.map(m=>m===legacy?{...m,text:m.text.replace(original,'')}:m);
  assert.throws(()=>delegatedCredentialsInstallRecipe(sql,missing),/credentials207_exact203_index_/);
 }
 assert.equal((r.templates.sql.match(/^create (?:unique )?index /gm)||[]).length,10);
 assert.doesNotMatch(r.templates.sql,/management_audit_exports_actor_idx|management_audit_export_time_idx|on public\./);
 for(const field of ['(select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table)','index_conflict','index_spec','indnkeyatts','indnullsnotdistinct','indisvalid','pg_get_expr(actual_index.indpred,actual_table)','pg_get_expr(actual_index.indexprs,actual_table)'])assert(r.tableChecks.includes(field),field);
});
test('207 retains the exact164 PIN account activation trigger and its private canonical function pin',()=>{
 const legacy=migrations.find(m=>m.name==='202610060164_merchant_attendance_account_suspensions.sql');assert(legacy);
 const name='faolla_attendance_account_activation_guard_v1',definitions=migrations.flatMap(m=>dayReviewSqlFunctions(m.text).filter(f=>f.name===name));
 assert.equal(definitions.length,1);assert.equal(definitions[0].hash,'2a4f30a259800b7f0e9fda5104f3f16c94629939c28e486962fced41fea4851a');
 assert(legacy.text.includes("foreach n in array array['merchant_attendance_workers','merchant_attendance_pin_credentials'] loop"));
 assert(legacy.text.includes('create trigger attendance_account_activation_guard before insert or update on %s for each row execute function public.faolla_attendance_account_activation_guard_v1()'));
 assert(legacy.text.includes("('merchant_attendance_pin_credentials','attendance_account_activation_guard',23,'public.faolla_attendance_account_activation_guard_v1()')"));
 assert(legacy.text.includes('revoke all on function public.faolla_attendance_account_activation_guard_v1() from public,anon,authenticated,service_role;'));
 assert.equal(r.dependencies.length,36);
 assert.deepEqual(r.dependencies.find(f=>f.name===name),{name,signature:'public.'+name+'()',hash:definitions[0].hash,result:'trigger',language:'plpgsql',volatility:'v',definer:false,defaults:0,defaultExpression:null,args:[],searchPath:'search_path=pg_catalog',isRpc:false});
 assert.deepEqual(r.triggerManifest.filter(t=>t.table==='merchant_attendance_pin_credentials'),[{table:'merchant_attendance_pin_credentials',name:'attendance_account_activation_guard',type:23,fn:name,deferred:false}]);
 for(const check of ["actual.tgtype=(trigger_spec->>'type')::integer","actual.tgfoid=to_regprocedure(ns||'.'||(trigger_spec->>'fn')||'()')","actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and actual.tgparentid=0","actual.tgdeferrable=(trigger_spec->>'deferred')::boolean and actual.tginitdeferred=(trigger_spec->>'deferred')::boolean"])assert(r.tableChecks.includes(check),check);
});

test('207 trigger count rejection retains its exact predicate and error, with failure-only bounded nonsecret DETAIL',()=>{
 const rejection=r.tableChecks.slice(r.tableChecks.indexOf(' if (select count(*) from pg_trigger actual'),r.tableChecks.indexOf('\n for trigger_spec'));
 const manifest='$credentials207_triggers$'+JSON.stringify(r.triggerManifest)+'$credentials207_triggers$::jsonb';
 assert(rejection.startsWith(" if (select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)<>(select count(*) from jsonb_array_elements("+manifest+") expected where expected->>'table'=table_name) then\n"));
 assert.match(rejection,/raise exception 'merchant_attendance_delegated_credentials_trigger_conflict' using detail=/);
 for(const field of ["'table',table_name","'actualCount',(select count(*) from pg_trigger actual where actual.tgrelid=actual_table and not actual.tgisinternal)",
  "'expectedCount',(select count(*) from jsonb_array_elements("+manifest+") expected where expected->>'table'=table_name)",
  "jsonb_build_object('name',limited.tgname,'function',limited.function_identity)",
  'left(actual.tgfoid::regprocedure::text,180) function_identity',
  'where actual.tgrelid=actual_table and not actual.tgisinternal order by actual.tgname,actual.oid limit 8'])assert(rejection.includes(field),field);
 assert.doesNotMatch(rejection,/pg_get_functiondef|prosrc|tgargs|\brow_to_json\b|salt|verifier|secret|pin_value|errcode|\breturn\b|\bnotice\b/i);
 assert.equal((rejection.match(/raise exception/g)||[]).length,1);assert.match(rejection,/\)::text;\n end if;$/);
});
test('207 every actual called helper is exactly pinned, and drift rejects rather than accepting old/new alternatives',()=>{
 const pinned=new Set([...r.own,...r.dependencies,...r.forward.cores,r.forward.snapshot,r.forward.guard].map(f=>f.name));pinned.add('faolla_valid_merchant_enterprise_permissions_v1');
 for(const f of functions.filter(f=>pinned.has(f.name)))for(const [,name]of f.body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))assert(pinned.has(name),f.name+':'+name);
 assert(!r.dependencies.some(f=>'body' in f||'oldBody' in f||'newBody' in f));
 const changed=migrations.map(m=>m.name==='202610010104_merchant_attendance_terminals.sql'?{...m,text:m.text.replace("then raise exception 'attendance_terminal_limit'","then raise exception 'drift_terminal_limit'")}:m);
 assert.throws(()=>delegatedCredentialsForwardRecipes(changed));
});
