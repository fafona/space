import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {delegatedGroupsMigration,delegatedGroupsForwardRecipes,delegatedGroupsInstallRecipe,delegatedGroupsFreezeSql,delegatedGroupsOwnManifest} from './merchant-attendance-delegated-groups-source.mjs';
const dir=new URL('./supabase-migrations/',import.meta.url);
const sql=readFileSync(new URL(delegatedGroupsMigration,dir),'utf8');
const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedGroupsMigration).sort().map(name=>({name,text:readFileSync(new URL(name,dir),'utf8')}));
const groups=migrations.find(m=>m.name.startsWith('202610030124_')).text,foundation=migrations.find(m=>m.name.startsWith('202610080202_')).text;
const recipe=delegatedGroupsInstallRecipe(sql,migrations),functions=dayReviewSqlFunctions(sql),get=n=>functions.find(f=>f.name===n).body;
test('204 exact frozen installation/reentry is mechanical, dependency metadata and two OIDs preserved',()=>{
 assert.equal(delegatedGroupsFreezeSql(sql,migrations),sql);assert.equal(recipe.own.length,9);
 assert.match(sql,/count\(\*\) from groups204_forward_metadata\)<>2/);
 for(const field of ["to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression",
  "to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata",
  'pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression',"meta.pronargdefaults<>(spec->>'defaults')::integer"])assert(sql.includes(field),field);
 assert.match(sql,/groups204_forward_0/);assert.match(sql,/groups204_forward_1/);assert.match(sql,/connoinherit/);assert.match(sql,/::name/);
});
test('204 legacy NULL branch retains original body except one exact owner boundary; no old CAS/history/results change',()=>{
 const f=delegatedGroupsForwardRecipes(groups,foundation),original=dayReviewSqlFunctions(groups).find(x=>x.name==='faolla_attendance_groups_v1');
 const changed="  if p_grant_id is null then\n  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;\n  if not found then raise exception 'attendance_access_denied';end if;\n  else\n    if view_name<>'context' or p_query->'operationId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;\n    perform public.faolla_attendance_delegated_groups_authorize_v1(site,p_auth_user_id,p_grant_id,action_name,false);\n  end if;";
 assert.equal(f.core.replace(changed,"  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;\n  if not found then raise exception 'attendance_access_denied';end if;"),original.body);
 assert.match(f.legacy.newBody,/core_v2\(p_query,p_auth_user_id,p_command,p_allow_write,null\)/);
 assert.equal(f.legacy.oldHash,'d130e4c2de2fef57ce6f18c15cc9ddb99b1d0fedb029b4e44872aee071bb9068');
});
test('204 only public scoped wrapper is service executable; core and eight helpers are private',()=>{
 for(const f of delegatedGroupsOwnManifest(sql)){assert.match(sql,new RegExp('revoke all on function '+f.signature.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' from public,anon,authenticated,service_role;'));if(f.name==='faolla_attendance_groups_core_v2')assert.equal(f.definer,false);}
 assert.equal(recipe.own.filter(f=>f.isRpc).length,1);assert.equal(recipe.own.filter(f=>f.definer).length,1);
 assert.equal((sql.match(/^grant execute on function/gm)||[]).length,1);
});
test('204 finite scoped writes reuse actual actor and original validators; no merchant enumeration path',()=>{
 const rpc=get('faolla_attendance_delegated_groups_v1');assert.match(rpc,/'view','context'/);assert.doesNotMatch(rpc,/'view','(?:members|groups)'/);
 assert.match(rpc,/groups_core_v2\(q,p_auth_user_id,p_command,p_allow_write,id\)/);
 assert.match(rpc,/values\(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation/);
 const core=get('faolla_attendance_groups_core_v2');assert.match(core,/actor_auth_user_id,command,snapshot,recorded_at/);assert.match(core,/attendance_group_overlap/);assert.match(core,/attendance_version_conflict/);
});
test('204 original GET and exact POST receipts precede gates, and are checked again after settings wait',()=>{
 const body=get('faolla_attendance_delegated_groups_v1');assert.equal(body.split('receipt:=public.faolla_attendance_delegated_groups_receipt_v1').length-1,3);
 const first=body.indexOf('receipt:=public.faolla_attendance_delegated_groups_receipt_v1'),lock=body.indexOf('for update;'),second=body.indexOf('receipt:=public.faolla_attendance_delegated_groups_receipt_v1',first+1),gate=body.indexOf('not p_allow_write'),auth=body.indexOf('g:=public.faolla_attendance_delegated_groups_authorize_v1');
 assert(first<lock&&lock<second&&second<gate&&gate<auth);
 const r=get('faolla_attendance_delegated_groups_receipt_v1');assert.match(r,/actual.actor_auth_user_id=actor and actual.grant_id=id/);assert.match(r,/operation_v1\(saved,false\)/);assert.doesNotMatch(r,/management_current_v1|authorize_v1|jsonb_build_object\('command'/);
});
test('204 create consumes ABSENT scope using exact rev1 actor/postimage proof, never changes global current guard',()=>{
 const a=get('faolla_attendance_delegated_groups_authorize_v1'),p=get('faolla_attendance_delegated_groups_operation_v1');
 assert.match(a,/if not p_created then[\s\S]*management_current_v1/);assert.match(a,/g.scope->'create'<>'true'/);assert.match(a,/epoch.paused/);assert.match(a,/role_row.permissions @> array\['enterprise.view',g.capability\]/);
 assert.match(p,/go.operation_id<>go.group_id/);assert.match(p,/group_row.actor_auth_user_id<>p.actor_auth_user_id/);assert.match(p,/group_row.revision<>1/);assert.match(p,/snapshot is distinct from public.faolla_attendance_group_item_v1/);
 assert.equal(functions.filter(f=>f.name==='faolla_attendance_management_current_v1').length,0);
});
test('204 only new202 guard is forwarded after203; original audit branch retained and all other actions rejected',()=>{
 const f=recipe.forward.guard;assert.equal(f.oldHash,'46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110');
 assert.match(f.newBody,/new.delegated_action='audit_export'/);assert.match(f.newBody,/in\('group_save','group_assign','group_end','group_cancel'\)/);assert.match(f.newBody,/attendance_management_executor_unavailable/);
 assert.doesNotMatch(sql,/^alter table public\.|^create (?:constraint )?trigger|^update public\.|^delete from public\./m);
});
test('204 temporary parser templates retain all real FKs and deferrable receipt cycles, without permanent TEMP FK targets',()=>{
 assert.doesNotMatch(recipe.preflight,/references public\./);assert.match(recipe.preflight,/attendance_group_create_receipt_fk/);assert.match(recipe.preflight,/attendance_group_assignment_receipt_fk/);
 assert.match(recipe.preflight,/deferrable initially deferred/);assert.match(recipe.tableChecks,/indnkeyatts/);assert.match(recipe.tableChecks,/convalidated/);assert.match(recipe.tableChecks,/tgenabled='O'/);
});
test('204 temporary worker parent preserves061 physical referenced-column order without relaxing FK checks',()=>{
 const foundation=migrations.find(m=>m.name==='202609290061_merchant_attendance_foundation.sql').text;
 assert.match(foundation,/create table if not exists public\.merchant_attendance_workers \(\s*id uuid[^\n]+\n\s*merchant_id text/);
 assert.match(recipe.preflight,/create temp table groups_expected_workers\(id uuid,merchant_id text,primary key\(merchant_id,id\)\)/);
 assert.doesNotMatch(recipe.preflight,/groups_expected_workers\(merchant_id text,id uuid/);
 assert.match(recipe.tableChecks,/actual_constraint\.confkey/);
 assert.match(recipe.tableChecks,/constraint_spec\.confkey,foreign_table::oid/);
});
