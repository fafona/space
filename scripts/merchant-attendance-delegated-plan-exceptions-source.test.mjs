//SOURCE contracts only; these tests never claim PostgreSQL/Auth/browser evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {delegatedPlanExceptionsMigration,delegatedPlanExceptionsActions,delegatedPlanExceptionsForwardRecipes,delegatedPlanExceptionsInstallRecipe,delegatedPlanExceptionsFreezeSql,delegatedPlanExceptionsServiceAclHistory} from './merchant-attendance-delegated-plan-exceptions-source.mjs';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const dir=new URL('./supabase-migrations/',import.meta.url),sql=readFileSync(new URL(delegatedPlanExceptionsMigration,dir),'utf8').replaceAll('\r\n','\n');
const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedPlanExceptionsMigration).sort().map(name=>({name,text:readFileSync(new URL(name,dir),'utf8')}));
const recipe=delegatedPlanExceptionsInstallRecipe(sql,migrations),functions=dayReviewSqlFunctions(sql);
const own=name=>{const f=functions.find(f=>f.name==='faolla_attendance_delegated_plan_exceptions'+(name==='v1'?'_v1':'_'+name+'_v1'));assert(f,name);return f.body;};
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const preAdministrativeSql=()=>{
 const helpers=recipe.dependencies.filter(f=>f.name.startsWith('faolla_attendance_administrative_'));assert.equal(helpers.length,14);
 const previous=recipe.dependencies.filter(f=>!helpers.includes(f)).map(f=>{const forward=recipe.administrativeForwardBodies.find(r=>r.name===f.name);return forward?{...f,hash:forward.oldHash}:f;});
 assert.equal(previous.length,145);const current=JSON.stringify(recipe.dependencies);assert.equal(sql.split(current).length-1,2);
 return sql.split(current).join(JSON.stringify(previous)).replace("  or not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')\n",'');
};

test('209 exact historical145 batch service grant includes the second function; only the two metadata literals and temp regex changed',()=>{
 const signature='public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)',acl=delegatedPlanExceptionsServiceAclHistory(migrations).get(signature);
 assert.equal(acl.allowed,true);assert.equal(acl.file,'202610050145_merchant_attendance_plan_adoption_view.sql');assert.match(acl.statementHash,/^[a-f0-9]{64}$/);
 const adoption=recipe.dependencies.find(f=>f.signature===signature);assert.equal(adoption.isRpc,true);assert.equal(adoption.hash,'bd1383469e3692438b3af55a504ef8348f9ef6cdd1e4134e705e0a4c9c227a0f');
 const oldServiceNames=new Set();for(const m of migrations)for(const grant of m.text.matchAll(/grant execute on function public\.(faolla_[a-z0-9_]+)\([^;]*?\) to service_role;/g))oldServiceNames.add(grant[1]);
 assert.deepEqual(recipe.dependencies.filter(f=>f.isRpc!==oldServiceNames.has(f.name)).map(f=>f.signature),[signature]);
 const baseline=preAdministrativeSql(),changed=JSON.stringify(adoption),old=JSON.stringify({...adoption,isRpc:false});assert.equal(baseline.split(changed).length-1,2);
 const explicit="E'^\\\\d{8}$'",ordinary="'^\\d{8}$'";assert.equal(baseline.split(explicit).length-1,1);
 const restored=baseline.split(changed).join(old).split(explicit).join(ordinary);
 assert.equal(createHash('sha256').update(restored,'utf8').digest('hex'),'c869a4e3a411b7ab94546f11a02ee922c6e5e0c9bf087c167ac458c5c8f45dd9','all business/core/guard bodies and other checks byte-for-byte unchanged');
 assert(migrations.find(m=>m.name==='202610050136_merchant_attendance_schedule_publication_evidence.sql').text.includes(ordinary),'original136 unchanged');
 assert.deepEqual(validateMigrationSource(delegatedPlanExceptionsMigration,sql),[]);
});
test('209 pins three real195 DO forwards from exact original sources/edits, recursively adds14 helpers and never allows old/new alternatives',()=>{
 assert.equal(sha(preAdministrativeSql()),'58489b603212b1f67cbe46e2f4699f7d4d95715c8eac1000426a461eb06a3888','only dependency closure and195 prerequisite changed, all business/check bodies byte-equal');
 assert.equal(recipe.dependencySpecs.length,163);assert.equal(recipe.administrativeForwardBodies.length,3);
 const file=migrations.find(f=>f.name==='202610080195_merchant_attendance_administrative_closure.sql'),recipes=JSON.parse(file.text.match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)[1]);
 const pinned=new Set([...recipe.own,...recipe.dependencies,...recipe.forward.cores,recipe.forward.guard].map(f=>f.name));pinned.add('faolla_valid_merchant_enterprise_permissions_v1');
 for(const f of recipe.administrativeForwardBodies){
  const r=recipes.find(r=>r.name===f.name),source=migrations.find(m=>m.name===r.source),original=dayReviewSqlFunctions(source.text).find(fn=>fn.name===r.name);
  assert.equal(original.hash,r.oldHash);let body=original.body;
  for(const change of r.changes){assert.equal(body.split(change.from).length-1,change.count);body=body.split(change.from).join(change.to);}
  assert.equal(sha(body),r.newHash);assert.equal(recipe.dependencies.find(fn=>fn.name===r.name).hash,r.newHash);
  for(const [,callee] of body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))assert(pinned.has(callee),callee);
 }
 const helpers=recipe.dependencies.filter(f=>f.name.startsWith('faolla_attendance_administrative_'));assert.equal(helpers.length,14);
 for(const f of helpers){const original=dayReviewSqlFunctions(file.text).find(fn=>fn.name===f.name);assert(original);assert.equal(f.hash,original.hash);assert.equal(f.isRpc,false);for(const [,callee] of original.body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))assert(pinned.has(callee),callee);}
 for(const change of ['\n-- drift in frozen195\n',"\nselect 'unknown forward';\n"]){
  const changed=migrations.map(m=>m.name===file.name?{...m,text:m.text+change}:m);assert.throws(()=>delegatedPlanExceptionsInstallRecipe(sql,changed),/exact209_administrative_migration/);
 }
});
test('209 exact-signature ACL replay handles every batch entry and ordered explicit revokes; data/comments cannot grant authority',()=>{
 const history=delegatedPlanExceptionsServiceAclHistory([
  {name:'001_first.sql',text:`grant execute on function public.faolla_first_v1(jsonb, uuid),public.faolla_second_v1(uuid),public.faolla_third_v1(text[]) to service_role;
  revoke all on function public.faolla_first_v1(jsonb,uuid),public.faolla_third_v1(text[]) from public,anon,authenticated,service_role;
  grant execute on function public.faolla_third_v1(text[]) to service_role;
  grant execute on function public.faolla_first_v1(text) to service_role;
  -- grant execute on function public.faolla_fake_comment_v1(uuid) to service_role;
  /* nested /* grant execute on function public.faolla_fake_block_v1(uuid) to service_role; */ ignored */
  do $body$ begin execute 'grant execute on function public.faolla_fake_body_v1(uuid) to service_role;'; end; $body$;
  select 'grant execute on function public.faolla_fake_data_v1(uuid) to service_role;';`},
  {name:'002_later.sql',text:'REVOKE EXECUTE ON FUNCTION public.faolla_second_v1(uuid) FROM SERVICE_ROLE;'},
 ]);
 assert.equal(history.get('public.faolla_first_v1(jsonb,uuid)').allowed,false);assert.equal(history.get('public.faolla_first_v1(text)').allowed,true);
 assert.equal(history.get('public.faolla_second_v1(uuid)').allowed,false);assert.equal(history.get('public.faolla_second_v1(uuid)').file,'002_later.sql');
 assert.equal(history.get('public.faolla_third_v1(text[])').allowed,true);assert.equal(history.size,4);
 for(const statement of ['grant execute on function public.faolla_first_v1(uuid) to service_role with grant option;',
  'grant execute on function public.faolla_first_v1(uuid) to service_role,unknown_role;',
  'grant execute on function public.faolla_first_v1(uuid) to service_role,anon;',
  'grant execute on function public.faolla_first_v1(uuid),unknown_object to service_role;']){
  assert.throws(()=>delegatedPlanExceptionsServiceAclHistory([{name:'001_bad.sql',text:statement}]),/exact209_acl_(?:roles|grant_roles|signature)/);
 }
 assert.throws(()=>delegatedPlanExceptionsServiceAclHistory([{name:'002.sql',text:''},{name:'001.sql',text:''}]),/exact209_acl_history_order/);
});

test('209 exact source is additive13 functions/159 recursive dependencies/3 narrow forwards/no permanent business tables',()=>{
 assert.equal(delegatedPlanExceptionsFreezeSql(sql,migrations),sql);assert.equal(recipe.own.length,13);assert.equal(recipe.dependencies.length,159);
 assert.equal(recipe.own.filter(f=>f.isRpc).length,1);assert.equal(recipe.own.filter(f=>f.definer).length,1);
 assert.equal(recipe.forward.cores.length,2);assert.match(sql,/exceptions209_forward_metadata\)<>3/);
 assert.deepEqual(delegatedPlanExceptionsActions,['plan_exception_decide']);
 assert.doesNotMatch(sql,/^create table (?:if not exists )?public\./m);
 assert.equal((sql.match(/^grant execute on function/gm)||[]).length,1);
 for(const f of recipe.own)assert(sql.includes('revoke all on function '+f.signature+' from public,anon,authenticated,service_role;'));
 assert.doesNotMatch(readFileSync(new URL('./merchant-attendance-delegated-plan-exceptions-source.mjs',import.meta.url),'utf8'),/child_process|pg_ctl|createdb|initdb|listen\(/);
});
test('209 NULL core restores entire successful170 and174 bodies, true delegate never receives owner UUID',()=>{
 for(const f of recipe.forward.cores){
  let restored=f.core.replace(f.boundary,f.anchor);for(const r of f.replacements)restored=restored.replace(r.boundary,r.original);
  assert.equal(restored,f.oldBody);assert.equal(f.core.split(f.boundary).length-1,1);
  assert.equal(f.newBody,'\nbegin\n return public.'+f.coreName+'('+f.coreArgs.split(',').map(a=>a.split(' ')[0]).slice(0,-1).join(',')+',null);\nend;\n');
  assert.match(f.core,/if p_grant_id is null then[\s\S]*user_id=p_auth_user_id/);
  assert.match(f.core,/core_authorize_v1\(site,p_auth_user_id,p_grant_id,wid,sid,access_name,mode_name\)/);
  assert.doesNotMatch(f.core,/p_auth_user_id\s*:=|owner_auth|set_config|current_setting/);
 }
 assert.deepEqual(recipe.forward.cores.map(f=>[f.name,f.oldHash]),[
  ['faolla_attendance_plan_exception_clearance_execute_v1','449701832073245222b442d7d5fbb13d80b123bb80dbcc7076c0299d4d683412'],
  ['faolla_attendance_plan_exception_posthoc_execute_v1','a28df0ec556702b0e4fb30e434dc089d853c358a14ab907eab23b6b3a287be5f']]);
 assert.match(recipe.forward.cores[0].core,/public.faolla_attendance_pd_exception_v1/);
 assert.match(recipe.forward.cores[1].core,/public.faolla_attendance_pd_formal_source_v1/);
 assert.match(recipe.forward.cores[1].core,/clearance_core_v1\(p_query,p_auth_user_id,p_command,p_allow_write,p_allow_clearance,p_capture_notifications,p_grant_id\)/);
});
test('209 existing immutable published evidence, not createdAt or caller authority, is the default includePending boundary',()=>{
 const b=own('target');assert.match(b,/merchant_attendance_schedule_slots[\s\S]*merchant_attendance_schedule_publication_evidence[\s\S]*merchant_attendance_schedule_commands/);
 assert.match(b,/publication.published_at<g.recorded_at/);assert.match(b,/not\(g.scope->>'includePending'\)::boolean/);
 assert.match(b,/original.recorded_at,slot.location_id,slot.time_zone/);
 assert.match(b,/publication.identity_status is distinct from 'bound'/);
 assert.match(b,/publication.slots @> jsonb_build_array\(expected_slot\)/);
 assert.match(b,/row\(g.worker_id,g.employee_id,g.worker_id,g.employee_id,g.employee_auth_user_id\)/);
 assert.doesNotMatch(b,/now\(\)|clock_timestamp|created_at|p_material|insert into|update public/);
});
test('209 current authority uses real employee/worker/role/epoch lock order, target+delegate identities and self decision refusal',()=>{
 const b=own('authorize');
 for(const s of ["g.scope->>'kind' is distinct from 'formal_exception'","g.delegated_action is distinct from 'plan_exception_decide'",'g.delegate_auth_user_id is distinct from actor','g.employee_id=g.delegate_employee_id','g.employee_auth_user_id=actor',"g.capability is distinct from 'attendance.plan_exception.review'",'management_current_v1(g,clock_timestamp())','actual.employee_id=g.employee_id and actual.paused'])assert(b.includes(s),s);
 assert(b.indexOf('actual.id=site for share')<b.indexOf('merchant_attendance_settings'));
 assert(b.indexOf('from public.merchant_attendance_settings')<b.indexOf('from public.merchant_attendance_workers'));
 assert(b.indexOf('from public.merchant_attendance_workers')<b.indexOf('order by actual.id for share'));
 assert.match(b,/actual.id in\(g.employee_id,g.delegate_employee_id\) order by actual.id for share/);
 assert.match(b,/actual.employee_id in\(g.employee_id,g.delegate_employee_id\) order by actual.employee_id for share/);
 assert.match(b,/row\(w.employee_id,e.auth_user_id,delegate.auth_user_id\) is distinct from row\(g.employee_id,g.employee_auth_user_id,actor\)/);
 assert.doesNotMatch(b,/g.actor_auth_user_id\s*:=|update public|delete from/);
});
test('209 full current and actual historical SQL evidence is scope-checked without redacting source or accepting caller material',()=>{
 const b=own('scope');for(const s of ['with recursive nodes(value,depth)','parent.depth<65','count_nodes>50000','count_sources>201','octet_length(sample::text)>2097152',"node ? 'locationId'","array['startEventId','lastEventId','endEventId']",'node ? event_key','actual.actor_employee_id=g.employee_id','actual.kind=\'decision\''])assert(b.includes(s),s);
 assert.match(b,/select r->'detail'->'current' union all select actual.evidence from public.merchant_attendance_plan_exception_entries/);
 assert.match(b,/r->'detail'->'current'->>'actorId' is distinct from g.delegate_auth_user_id::text/);
 assert.doesNotMatch(b,/jsonb_set|jsonb_strip|p_material|insert into|update public/);
});
test('209 seven exact RPC args preserve independent default-off flags and old decision command grammar',()=>{
 const f=functions.find(f=>f.name==='faolla_attendance_delegated_plan_exceptions_v1');
 assert.deepEqual(f.args,['p_query','p_auth_user_id','p_command','p_allow_write','p_allow_posthoc','p_allow_clearance','p_capture_notifications']);
 assert.equal(f.defaults,5);assert.equal(f.defaultExpression,'NULL::jsonb, false, false, false, false');
 assert.match(own('command'),/review_command_v1\('decide',c\) is distinct from true/);
 assert.doesNotMatch(own('command'),/'annul'|ownerId|actorId|authority|p_allow_write/);
 const b=own('v1');assert.match(b,/posthoc_core_v1\(old_query,p_auth_user_id,p_command,p_allow_write,p_allow_posthoc,p_allow_clearance,p_capture_notifications,id\)/);
 assert.match(b,/p_allow_write is distinct from true then raise exception 'attendance_delegated_plan_exceptions_disabled'/);
 assert.match(b,/can_clear:=can_decide and p_allow_clearance/);assert.match(b,/can_not_applicable:=can_decide and p_allow_posthoc/);
});
test('209 exact complete POST original and minimal GET recovery precede current flags, permission and collectors',()=>{
 const b=own('v1'),r=own('receipt'),p=own('operation');
 assert(b.indexOf("if mode_name='recover' then")<b.indexOf('for pass in 1..2 loop'));
 assert(b.indexOf("b->'decision'->'command' is distinct from p_command")<b.indexOf('actual.id=site for share'));
 assert(b.indexOf('for pass in 1..2 loop')<b.indexOf('g:=public.faolla_attendance_delegated_plan_exceptions_authorize_v1'));
 assert.match(r,/p.actor_auth_user_id is distinct from actor/);assert.match(r,/operation_v1\(p,false\)/);
 assert.match(r,/actual.id=p.delegate_employee_id and actual.auth_user_id=actor for share/);
 assert.doesNotMatch(r,/actual.status|account_epochs|actual.active|p_auth_user_id/);
 assert.doesNotMatch(r,/authorize_v1|management_current|clock_timestamp|p_allow_write/);
 assert.match(p,/if require_current then perform public.faolla_attendance_delegated_plan_exceptions_authorize_v1/);
 assert.match(b,/row\(p.actor_auth_user_id,p.grant_id,p.command_fingerprint\) is distinct from row\(p_auth_user_id,id,fp\)/);
 assert.match(own('hash'),/jsonb_build_array\(wid,sid\)/);
 assert.match(b,/octet_length\(convert_to\(result::text,'UTF8'\)\)>524288/);
});
test('209 original business case/decision and atomic management authority proof do not adopt old IDs or judge old history again',()=>{
 const b=own('business'),p=own('operation'),rpc=own('v1');
 assert.match(b,/review_entry_v1\(d\)/);assert.match(b,/d.actor_auth_user_id=d.employee_auth_user_id/);
 assert.match(p,/p.business_reference_id,p.business_revision,p.recorded_at/);
 assert.match(p,/p.recorded_at<g.valid_from or p.recorded_at>=g.valid_until/);
 assert.match(p,/'attendance-delegated-plan-exceptions-business-v1',b/);
 assert.match(rpc,/Never adopt a legacy decision\/read/);assert.match(rpc,/stamp<started_at/);
 assert.match(rpc,/values\(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,'plan_exception_decide',op,sid/);
 assert.doesNotMatch(b,/effect_current|management_current|for update|insert into/);
 const guard=recipe.forward.guard,delta="\n  if new.delegated_action='plan_exception_decide' then perform public.faolla_attendance_delegated_plan_exceptions_authority_v1(new);return new;end if;";
 assert.equal(guard.oldHash,'284e4388128f1bd0984fb5995a0f34cc9f23e2d1d67dfb4f5286cc46c1e006e6');assert.equal(guard.newBody.replace(delta,''),guard.oldBody);
 assert.equal(guard.newBody.split(delta).length-1,1);assert(guard.newBody.includes('attendance_management_executor_unavailable'));
});
test('209 complete historical25 table metadata/index/ACL/defaults/52 trigger manifests and view reject unknown structural drift',()=>{
 assert.equal(recipe.templates.tables.length,25);assert.equal(recipe.templates.extraTables.length,7);assert.equal(recipe.triggerManifest.length,52);
 assert.doesNotMatch(recipe.templates.sql,/references public\./);
 assert.match(recipe.templates.sql,/attendance_plan_exception_first_entry_fk[\s\S]*deferrable initially deferred/);
 assert.match(recipe.templates.sql,/create index attendance_schedule_publication_idx\s+on pg_temp.merchant_attendance_schedule_slots/);
 for(const f of ['connoinherit','convalidated','confkey','indnkeyatts','indnullsnotdistinct','indisvalid','pg_attrdef','attacl','tginitdeferred','tgfoid','pg_get_viewdef'])assert(recipe.tableChecks.includes(f),f);
 // Referenced temp stubs need only the named unique columns. Actual FK keys
 // are resolved by those names (061 workers uses id,merchant_id), never by
 // reusing the stub's raw attnum order (the historical204 failure).
 for(const f of ['unnest(constraint_spec.confkey) with ordinality','expected_ref.attnum=requested.attnum','actual_ref.attname=expected_ref.attname','constraint_spec.conkey,reference_keys,foreign_table::oid'])assert(recipe.tableChecks.includes(f),f);
 for(const f of ['pg_get_expr(meta.proargdefaults,0)','aclexplode','meta.proargnames','meta.proconfig','meta.proowner',"to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata"])assert(sql.includes(f),f);
 for(const [table,count] of [['schedule_commands',2],['schedule_slots',2],['schedule_cancellations',2],['schedule_publication_evidence',3],['plan_exception_cases',2],['plan_exception_entries',2],['plan_exception_reads',2]])assert.equal(recipe.triggerManifest.filter(t=>t.table==='merchant_attendance_'+table).length,count);
 for(const mutation of ['alter table public.merchant_attendance_plan_exception_cases add column forbidden text;', 'create index forbidden on public.merchant_attendance_plan_exception_entries(merchant_id);']){
  const changed=migrations.map((m,i)=>i===migrations.length-1?{...m,text:m.text+'\n'+mutation}:m);
  assert.throws(()=>delegatedPlanExceptionsInstallRecipe(sql,changed),/exact209_unmodeled_table_/);
 }
});
test('209 every recursively-called helper is exact-pinned and oldcore/source drift refuses generation',()=>{
 const pinned=new Set([...recipe.own,...recipe.dependencies,...recipe.forward.cores,recipe.forward.guard].map(f=>f.name));pinned.add('faolla_valid_merchant_enterprise_permissions_v1');
 for(const f of functions)for(const [,name]of f.body.matchAll(/public\.(faolla_[a-z0-9_]+)\(/g))assert(pinned.has(name),f.name+':'+name);
 assert.equal(new Set(recipe.dependencies.map(f=>f.name)).size,recipe.dependencies.length);
 const changed=migrations.map(m=>m.name==='202610060174_merchant_attendance_plan_posthoc_reviews.sql'?{...m,text:m.text.replace("  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;","  perform 1;")}:m);
 assert.throws(()=>delegatedPlanExceptionsForwardRecipes(changed));
});
