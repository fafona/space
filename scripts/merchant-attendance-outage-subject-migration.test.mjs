//Static scope/guard checks only. Actual PostgreSQL acceptance is root-owned.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./supabase-migrations/202610070180_merchant_attendance_outage_subject.sql',import.meta.url),'utf8');
const body=sql.slice(sql.indexOf('create or replace function'),sql.indexOf('revoke all on function'));
test('180 only adds one dedicated read RPC and a migration registry row',()=>{
 assert.deepEqual([...sql.matchAll(/create or replace function public\.([a-z0-9_]+)/g)].map(m=>m[1]),['faolla_attendance_outage_subject_v1']);
 assert.equal([...sql.matchAll(/\binsert into\b/gi)].length,1);assert(sql.includes('insert into public.faolla_schema_migrations'));
 for(const token of ['create table','alter table','create index','delete from','truncate ','update public.','insert into public.merchant_','drop function','disable trigger'])assert(!sql.toLowerCase().includes(token),token);
 assert(sql.includes("values(202610070180,'merchant_attendance_outage_subject')"));assert(sql.trim().endsWith('commit;'));
});
test('reentry verifies exact metadata/owner/ACL both before and after its single new function',()=>{
 for(const token of ['version=202610070176','version=202610070179','installed<>(to_regprocedure(signature) is not null)',
  "meta.proargnames is distinct from array['p_query','p_auth_user_id','p_allow_write']",'meta.pronargs<>3','meta.pronargdefaults<>1',
  'meta.proowner<>(select oid from pg_roles where rolname=current_user)',"meta.proconfig is distinct from array['search_path=pg_catalog']",
  "has_function_privilege(r,signature,'EXECUTE') is distinct from (r='service_role')",'a.grantee<>p.proowner',"a.grantee<>(select oid from pg_roles where rolname='service_role')"]){
   assert(sql.includes(token),token);if(token.startsWith('meta.')||token.startsWith('has_function'))assert.equal(sql.split(token).length-1,2,token);
 }
 assert(sql.includes('security definer set search_path=pg_catalog'));
 assert(sql.includes('revoke all on function public.faolla_attendance_outage_subject_v1(jsonb,uuid,boolean) from public,anon,authenticated,service_role;'));
 assert(sql.includes('grant execute on function public.faolla_attendance_outage_subject_v1(jsonb,uuid,boolean) to service_role;'));
});
test('owner exact target and self null target are checked before database reads',()=>{
 for(const token of ["array['siteId','access','workerId','incidentId']","if access_name='owner' then", "elsif p_query->'workerId' is distinct from 'null'::jsonb",'octet_length(convert_to(p_query::text,\'UTF8\'))>4096'])assert(body.includes(token),token);
 assert(body.indexOf("elsif p_query->'workerId'")<body.indexOf('perform 1 from public.merchants'));
});
test('preparation keeps176 lock ordering and validates the locked current identity',()=>{
 const positions=['perform 1 from public.merchants','select * into s from public.merchant_attendance_settings','select * into w from public.merchant_attendance_workers',
  'select * into e from public.merchant_enterprise_employees','select * into r from public.merchant_enterprise_roles'].map(t=>body.indexOf(t));
 assert(positions.every(n=>n>=0));assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
 for(const token of ["(access_name='self' or user_id=p_auth_user_id) for share",'merchant_id=site and id=wid for update',
  'merchant_id=site and id=w.employee_id for share','e.auth_user_id is distinct from p_auth_user_id',"e.status<>'active'",'w.employee_id is distinct from e.id'])assert(body.includes(token),token);
});
test('self requires current role, active worker and unpaused epoch but owner can prepare paper transcription',()=>{
 for(const token of ["r.status<>'active'",'faolla_valid_merchant_enterprise_permissions_v1(r.permissions)',
  "array['enterprise.view','attendance.self.view','attendance.self.request']", "access_name='self' and (not w.active or coalesce(epoch.paused,false))",
  "raise exception 'attendance_account_suspended'",'generation_no:=coalesce(epoch.generation,0)',"'canWrite',p_allow_write and s.enabled"])assert(body.includes(token),token);
 assert(!body.includes('insert into'));assert(!body.includes('faolla_attendance_account_epoch_guard_v1('));
});
test('known incident preparation does not query declarations or disclose owner reason/peer counts',()=>{
 assert(body.includes('merchant_attendance_outage_incidents where merchant_id=site and incident_id=iid'));
 assert(!body.includes('merchant_attendance_outage_declarations'));assert(!body.includes('i.reason'));assert(!body.includes('i.actor_auth_user_id'));
 const incident=body.slice(body.indexOf("'incident',jsonb_build_object"),body.indexOf('if octet_length(convert_to(result'));
 assert.deepEqual([...incident.matchAll(/'([A-Za-z]+)'\s*,/g)].map(m=>m[1]),['incident','id','type','channel','locationId','interval']);
 assert(body.includes("raise exception 'attendance_outage_subject_not_found'"));
});
test('snapshot exposes only actual current versions and absence-based epoch zero, not fabricated clocks',()=>{
 for(const token of ["'workerId',w.id,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id", "'workerVersion',w.version,'employeeVersion',e.version,'generation',generation_no",
  "'displayName',w.display_name,'active',w.active,'paused',coalesce(epoch.paused,false)",'faolla_attendance_outage_interval_v1(i.declared_interval)',
  'octet_length(convert_to(result::text,\'UTF8\'))>16384'])assert(body.includes(token),token);
 for(const token of ['faolla_attendance_outage_v1(','faolla_attendance_outage_links_v1(','faolla_attendance_outage_review_v1(','merchant_attendance_events','p_command'])assert(!body.includes(token),token);
});
