import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {delegatedConfigurationMigration,delegatedConfigurationForwardRecipes,delegatedConfigurationInstallRecipe,delegatedConfigurationFreezeSql} from './merchant-attendance-delegated-configuration-source.mjs';
const dir=new URL('./supabase-migrations/',import.meta.url),sql=readFileSync(new URL(delegatedConfigurationMigration,dir),'utf8').replaceAll('\r\n','\n');
const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedConfigurationMigration).sort().map(name=>({name,text:readFileSync(new URL(name,dir),'utf8')}));
const r=delegatedConfigurationInstallRecipe(sql,migrations),f=dayReviewSqlFunctions(sql),body=name=>{const found=f.find(x=>x.name===name);assert(found);return found.body;};
test('205 exact freeze and two forward OID/default/ACL metadata invariants',()=>{
 assert.equal(delegatedConfigurationFreezeSql(sql,migrations),sql);assert.equal(r.own.length,10);assert.equal(r.own.filter(x=>x.isRpc).length,1);
 assert.match(sql,/config205_forward_metadata\)<>2/);
 for(const field of ["to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression",
  "to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata",
  'pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression',"meta.pronargdefaults<>(spec->>'defaults')::integer"])assert(sql.includes(field),field);
 assert.match(sql,/pg_get_expr\(meta.proargdefaults,0\)/);assert.match(sql,/aclexplode/);assert.match(sql,/config205_forward_0/);assert.match(sql,/config205_forward_1/);
});
test('205 legacy NULL context exactly retains166 body except single authorized cutpoint',()=>{
 const p=delegatedConfigurationForwardRecipes(migrations);assert.equal(p.core.replace(p.boundary,p.ownerAnchor),p.current);
 assert.equal(p.legacy.oldHash,'67aa7c785dec53199a500517e05c0f58646e24f7bd5be0041a23679e32d19949');
 assert.match(p.legacy.newBody,/p_command,p_operation_id,null/);assert.equal(p.legacy.defaults,2);assert.equal(p.legacy.defaultExpression,'NULL::jsonb, NULL::uuid');
 for(const invariant of ['attendance_open_sessions','attendance_history_protected','attendance_version_conflict','faolla_attendance_employment_config_v1','actor_auth_user_id,version,command,before_value,after_value'])assert(p.core.includes(invariant));
 assert.match(p.boundary,/p_command is null/);assert.match(p.boundary,/'view','settings','cursor',null,'search',''/);
});
test('205 private core and nine helpers never service executable; sole new RPC grants service only',()=>{
 for(const x of r.own){assert(sql.includes('revoke all on function '+x.signature+' from public,anon,authenticated,service_role;'));if(x.name==='faolla_attendance_admin_core_v2')assert.equal(x.definer,false);}
 assert.equal((sql.match(/^grant execute on function/gm)||[]).length,1);assert.equal(r.own.filter(x=>x.definer).length,1);
});
test('205 original receipt independent of current gates, rechecked after settings serialization',()=>{
 const b=body('faolla_attendance_delegated_config_v1'),first=b.indexOf('receipt:=public.faolla_attendance_delegated_config_receipt_v1'),lock=b.indexOf('for update;'),second=b.indexOf('receipt:=public.faolla_attendance_delegated_config_receipt_v1',first+1),gate=b.indexOf('not p_allow_write'),authorize=b.indexOf('g:=public.faolla_attendance_delegated_config_authorize_v1');
 assert(first<lock&&lock<second&&second<gate&&gate<authorize);assert.match(b,/receipt->>'commandFingerprint' is distinct from fp/);
 const rec=body('faolla_attendance_delegated_config_receipt_v1');assert.match(rec,/actual.actor_auth_user_id=actor and actual.grant_id=id/);assert.match(rec,/operation_v1\(saved,false\)/);assert.doesNotMatch(rec,/management_current_v1|authorize_v1/);
});
test('205 two commands only, actualAuth preserved and no delegated broad GET or settings bootstrap',()=>{
 const rpc=body('faolla_attendance_delegated_config_v1');assert.match(rpc,/admin_core_v2\(site,p_auth_user_id,jsonb_build_object\('view','settings'/);
 assert.match(rpc,/values\(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation/);assert.doesNotMatch(rpc,/'view','(?:workers|locations|employees)'/);
 assert.match(body('faolla_attendance_delegated_config_command_v1'),/not in\('worker','location'\)/);assert.match(rpc,/g.scope->'locationIds' @> jsonb_build_array/);
 assert.doesNotMatch(sql,/^create (?:table|index|trigger).*public\.|^alter table public\.|^delete from public\./m);
 assert.match(rpc,/from jsonb_array_elements_text\(g.scope->'locationIds'\) requested\(id\)/);
 assert.match(rpc,/cross join lateral\(select point.id,point.name,point.time_zone,point.active[\s\S]*where point.merchant_id=site and point.id=requested.id::uuid offset 0\) actual/);
 assert.doesNotMatch(rpc,/where actual.merchant_id=site and g.scope->'locationIds' @>/);
});
test('205 one-use create proves actualpostimage real employment and both target/delegate epochs',()=>{
 const a=body('faolla_attendance_delegated_config_authorize_v1'),p=body('faolla_attendance_delegated_config_operation_v1');
 assert.match(a,/if not p_created then[\s\S]*management_current_v1/);assert.match(a,/epoch.employee_id=g.delegate_employee_id/);assert.match(a,/epoch.employee_id=g.employee_id/);
 assert.match(a,/target.auth_user_id is distinct from g.employee_auth_user_id/);assert.match(p,/created is distinct from \(b.before_value is null\)/);
 assert.match(p,/w.version<>previous_version\+1/);assert.match(p,/l.version<>previous_version\+1/);assert.match(p,/actual.starts_on=\(v->>'startsOn'\)::date/);
 assert.match(p,/b.before_value->'default_location_id'/);assert.match(p,/jsonb_build_array\(v->'locationId'\)/);assert.match(p,/w.updated_at>b.recorded_at/);
 assert.doesNotMatch(p,/w.created_at<>b.recorded_at/);assert(!f.some(x=>x.name==='faolla_attendance_management_current_v1'));
});
test('205 business SHA binds immutable oldoperation and guard preserves203audit/204groups; other families still refuse',()=>{
 const b=body('faolla_attendance_delegated_config_business_v1');for(const key of ['p.command','p.before_value','p.after_value','p.version','p.recorded_at'])assert(b.includes(key));
 assert.equal(r.forward.guard.oldHash,'5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183');
 assert.match(r.forward.guard.newBody,/new.delegated_action='audit_export'/);assert.match(r.forward.guard.newBody,/group_cancel/);assert.match(r.forward.guard.newBody,/in\('worker_save','location_save'\)/);assert.match(r.forward.guard.newBody,/attendance_management_executor_unavailable/);
});
test('205 configoperation complete columns/defaults/FKs/index/immutable guard manifest uses TEMP-only parents',()=>{
 assert.doesNotMatch(r.preflight,/references public\./);for(const x of ['convalidated','connoinherit','indnkeyatts','indisvalid','pg_attrdef','merchant_attendance_config_no_rewrite','merchant_attendance_config_no_truncate'])assert(r.tableChecks.includes(x));
 assert.match(r.preflight,/merchant_attendance_config_audit_time_idx/);assert.match(r.preflight,/acl.privilege_type='SELECT'/);
 assert(r.dependencies.some(x=>x.name==='faolla_attendance_account_activation_guard_v1'));assert(r.dependencies.some(x=>x.name==='faolla_attendance_employment_config_v1'));
});
