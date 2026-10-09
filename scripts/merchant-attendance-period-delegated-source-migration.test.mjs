//Private collection contracts only: no database, browser, network or business writes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const file='202610080184_merchant_attendance_period_delegated_source.sql';
const dir=new URL('./supabase-migrations/',import.meta.url);
const read=name=>readFileSync(new URL(name,dir),'utf8').replace(/\r/g,'');
const sql=read(file);
const specs=[
  [
    "binding",
    "202610040135_merchant_attendance_shift_rule_binding_reader.sql",
    "faolla_attendance_shift_rule_binding_v1"
  ],
  [
    "shift",
    "202610050143_merchant_attendance_pin_schedule.sql",
    "faolla_attendance_shift_check_v1"
  ],
  [
    "coverage",
    "202610050139_merchant_attendance_plan_coverage.sql",
    "faolla_attendance_plan_coverage_v1"
  ],
  [
    "adoptions",
    "202610050145_merchant_attendance_plan_adoption_view.sql",
    "faolla_attendance_plan_coverage_adoptions_v1"
  ],
  [
    "exception_legacy",
    "202610060159_merchant_attendance_work_arrangement_exceptions.sql",
    "faolla_attendance_plan_exception_source_legacy_v1"
  ],
  [
    "exception",
    "202610060159_merchant_attendance_work_arrangement_exceptions.sql",
    "faolla_attendance_plan_exception_source_v1"
  ],
  [
    "posthoc_preview",
    "202610060171_merchant_attendance_plan_posthoc_adoption.sql",
    "faolla_attendance_plan_posthoc_preview_v1"
  ],
  [
    "posthoc_read",
    "202610060171_merchant_attendance_plan_posthoc_adoption.sql",
    "faolla_attendance_plan_posthoc_adoption_v1"
  ],
  [
    "formal_facts",
    "202610060173_merchant_attendance_plan_posthoc_formal_source.sql",
    "faolla_attendance_plan_posthoc_formal_facts_v1"
  ],
  [
    "formal_source",
    "202610060173_merchant_attendance_plan_posthoc_formal_source.sql",
    "faolla_attendance_plan_posthoc_formal_source_v1"
  ],
  [
    "report",
    "202610050153_merchant_attendance_period_session_capacity.sql",
    "faolla_attendance_period_report_v2"
  ],
  [
    "unified",
    "202610010103_merchant_attendance_missing_revisions.sql",
    "faolla_attendance_unified_report_v1"
  ],
  [
    "fixed_report",
    "202610050155_merchant_attendance_period_fixed_boundaries.sql",
    "faolla_attendance_period_closure_report_v1"
  ],
  [
    "fixed_unified",
    "202610050155_merchant_attendance_period_fixed_boundaries.sql",
    "faolla_attendance_period_closure_unified_report_v1"
  ],
  [
    "source",
    "202610060175_merchant_attendance_plan_posthoc_periods.sql",
    "faolla_attendance_period_source_v1"
  ],
  [
    "fixed_source",
    "202610070179_merchant_attendance_outage_periods.sql",
    "faolla_attendance_period_closure_source_base_v1"
  ],
  [
    "envelope",
    "202610070179_merchant_attendance_outage_periods.sql",
    "faolla_attendance_period_closure_source_v1"
  ]
];
const pinned={
  "binding": "e13c2a8d9265985dae141a96fa56d733f77ac2a007b830f07cb3d0be1bfd1437",
  "shift": "54632325e0d569c9835dfadc628632115c2f13a86c0466e852906a3f426bcfb0",
  "coverage": "21917f1580f1b831e38064ce9bb003bf146a133858693e6b7a858b516d5f5c73",
  "adoptions": "bd1383469e3692438b3af55a504ef8348f9ef6cdd1e4134e705e0a4c9c227a0f",
  "exception_legacy": "89309840b875cf0d530abc9e80fa8c0bcd93a34c64f23053c446a16eeea1bc8c",
  "exception": "1234394b481e1e3063d6a12d83bf606e11be1cb8d64b4b86ea194091eb5334b1",
  "posthoc_preview": "9640704dae146d72816cdebc8e4da81bf82b99b242df063ea2251a3c2e20df0c",
  "posthoc_read": "a12c7b2e71b3c98c379680e3be8a8c592f299e2475fdf6737cb9d1184279288e",
  "formal_facts": "c9c0ced9eca39a7ad6f70710a04ef6f25d8add120839c91beb38ae6e7b70eacc",
  "formal_source": "7794ff1971454006e2410476c4848faf3972d0e8bb67039c9acfb13dc32c7d64",
  "report": "9c98806622a8f997ced37f7e83aaf548bd3ca04524ce55775c2828ba3639f389",
  "unified": "b75e43356987a9754d1af8f9942996416b1405490aac618e7c0041cf66fd4a81",
  "fixed_report": "7b5afdd059188deb1edd06668b308b4830b1937b4ca904f90e527535660001bf",
  "fixed_unified": "e113571f21684a514ea5be8536debbc97fc4096601fe6af91f8e01213ce0b775",
  "source": "9bb7f3abfaf07c110b33286950d347bab5b94874a35a6d459aef409bf341d4ca",
  "fixed_source": "512322083cd3b668f41d44322dec10f65b322388c8c4a470f34c5c691ba9eeb1",
  "envelope": "a89321433586376f607a9277306803ff363f43d07b157a1bc40f7aaf08be0f24"
};
const fn=(text,name)=>{const m=text.match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'));assert(m,name);return m[0];};
const body=text=>{const m=text.match(/as \$\$([\s\S]*)\$\$;/);assert(m);return m[1];};
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const clean=text=>text.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
const top=fn(sql,'faolla_attendance_period_delegated_source_v1');
const has=(text,...tokens)=>tokens.forEach(token=>assert(text.includes(token),token));
function transform(key, input) {
 let s=input.replace(/\r/g,"");
 const names=Object.fromEntries(specs.map(([k,,name])=>[name,"faolla_attendance_pd_"+k+"_v1"]));
 if(key==="posthoc_read"){
  const head=s.slice(0,s.indexOf("\nbegin\n"));
  const readStart=s.indexOf("  --Acquire writable locks first:");
  const readEnd=s.indexOf("  if op is not null then",readStart);
  const tailStart=s.indexOf("  for entry_row in select * from public.merchant_attendance_plan_posthoc_operations",readEnd);
  if(readStart<0||readEnd<0||tailStart<0)throw Error("posthoc read boundary");
  s=head.replace("(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)","(p_query jsonb,p_auth_user_id uuid)")+
    "\nbegin\n  if p_auth_user_id is null or p_query is null\n"+
    "    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId']) is distinct from true\n"+
    "    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'\n"+
    "    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true\n"+
    "    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') is distinct from true\n"+
    "    or octet_length(convert_to(p_query::text,'UTF8'))>4096 then raise exception 'attendance_invalid_request';end if;\n"+
    "  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;\n"+
    s.slice(readStart,readEnd)+
    "  query_source:=jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid);\n"+
    "  preview:=public.faolla_attendance_plan_posthoc_preview_v1(query_source,p_auth_user_id,revision_no,head.operation_id);\n"+
    s.slice(tailStart);
 }
 if(key==="formal_facts"){
  const from="public.faolla_attendance_plan_posthoc_adoption_v1(p_query||jsonb_build_object('mode','detail','operationId',null),p_auth_user_id,null,false)";
  if(!s.includes(from))throw Error("formal read boundary");
  s=s.replace(from,"public.faolla_attendance_plan_posthoc_adoption_v1(p_query,p_auth_user_id)");
 }
 if(["unified","fixed_unified"].includes(key)){
  const start=s.indexOf("  if mode='owner' then"), end=s.indexOf("  worker:=",start);
  if(start<0||end<0)throw Error("unified boundary");
  const call=key==="unified"?"faolla_attendance_period_report_v2(p_site_id,p_auth_user_id,p_query-'access')":"faolla_attendance_period_closure_report_v1(p_site_id,p_auth_user_id,p_query-'access',p_frame)";
  s=s.slice(0,start)+"  if mode is distinct from 'delegate' then raise exception 'attendance_invalid_request';end if;\n  base:=public."+call+";\n"+s.slice(end);
  s=s.replaceAll("mode='owner'","mode='delegate'");
 }
 if(["source","fixed_source"].includes(key)){
  s=s.replace("p_query->>'access' not in('owner','self')","p_query->>'access' is distinct from 'delegate'");
  s=s.replace(" and (access_name='self' or user_id=p_auth_user_id)","");
  s=s.replaceAll("'owner'","'delegate'").replaceAll("'owner_checked'","'delegate_checked'");
 }
 s=s.replaceAll(" and user_id=p_auth_user_id","");
 for(const [from,to] of Object.entries(names))s=s.replaceAll("public."+from+"(","public."+to+"(");
 s=s.replace(/^create function /,"create or replace function ").replace(" security definer "," ");
 return s;
}

test('184 adds exactly eighteen private invoker functions, no public RPC or business DDL/DML',()=>{
 assert.deepEqual(validateMigrationSource(file,sql),[]);
 const names=[...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map(x=>x[1]);
 assert.deepEqual(names,[...specs.map(([key])=>'faolla_attendance_pd_'+key+'_v1'),'faolla_attendance_period_delegated_source_v1']);
 for(const name of names){assert(name.length<=63);const f=fn(sql,name);assert.doesNotMatch(clean(f),/security definer|\b(?:insert into|delete from|update public\.|truncate|execute |set_config\(|current_setting\()/i);}
 assert.doesNotMatch(clean(sql),/create table|alter table|disable trigger|grant execute|drop (?:table|function|schema)/i);
 has(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080184,'merchant_attendance_period_delegated_source')");
});
test('all eighteen functions revoke public, anon, authenticated and service execution and reject foreign ACL grants',()=>{
 for(const name of [...specs.map(([key])=>'faolla_attendance_pd_'+key+'_v1'),'faolla_attendance_period_delegated_source_v1']){
  const declaration=fn(sql,name).match(/function public\.([^(]+)\(([\s\S]*?)\)\s*returns/);
  const signature='public.'+name+'('+declaration[2].split(',').map(x=>x.trim().split(/\s+/)[1]).join(',')+')';
  has(sql,'revoke all on function '+signature+' from public,anon,authenticated,service_role;');
 }
 has(sql,'function_meta.prosecdef','function_meta.proconfig is distinct from', 'a.grantee<>function_meta.proowner');
 assert.doesNotMatch(sql,/from public,anon,authenticated;\s*grant/);
});
test('upstream executable body hashes are independently pinned to the latest exact source files',()=>{
 const migrations=readdirSync(dir).filter(x=>/^\d{12}_.+\.sql$/.test(x)).sort();
 for(const [key,path,name] of specs){
  const upstream=fn(read(path),name);
  assert.equal(hash(body(upstream)),pinned[key],name+' changed: explicitly review and synchronize the private collector');
  assert.equal(migrations.filter(x=>new RegExp('create (?:or replace )?function public\\.'+name+'\\(').test(read(x))).at(-1),path,name+' latest source changed');
  has(sql,pinned[key]);
 }
});
for(const [key,path,name] of specs)test('strict read-only derivation: '+key,()=>{
 assert.equal(fn(sql,'faolla_attendance_pd_'+key+'_v1'),transform(key,fn(read(path),name)));
});
test('both installation and every top-level call enforce the same dependency profile, owner, exact signature/config and role ACL',()=>{
 const blocks=[...sql.matchAll(/  --DEPENDENCY_PROFILE_BEGIN[^\n]*\n([\s\S]*?)  --DEPENDENCY_PROFILE_END/g)].map(x=>x[1]);
 assert.equal(blocks.length,2);assert.equal(blocks[0],blocks[1]);
 has(blocks[0],'to_regprocedure(dependency.signature)','proowner is distinct from expected_owner','proargnames is distinct from dependency.argnames',
  'proargmodes is not null','pronargdefaults is distinct from dependency.defaults','proconfig is distinct from',
  "sha256(convert_to(replace(replace(function_meta.prosrc,chr(13),'')","'attendance_period_delegated_source_incompatible'",
  "has_function_privilege(checked_role,function_meta.oid,'EXECUTE')");
});
test('reentry proves every installed private body and exact signature before replacing anything',()=>{
 const profile=sql.match(/--MIRROR_PROFILE_BEGIN[\s\S]*?--MIRROR_PROFILE_END/)[0];
 const rows=[...profile.matchAll(/\('public\.(\w+)\(([^']*)\)','([0-9a-f]{64})',/g)];
 assert.equal(rows.length,18);
 for(const [,name,,digest] of rows)assert.equal(hash(body(fn(sql,name))),digest,name);
 has(profile,'if installed then','to_regprocedure(dependency.signature)','proargnames is distinct from dependency.argnames',
  'pronargdefaults is distinct from dependency.defaults','merchant_attendance_period_delegated_source_installation_conflict');
 assert(sql.indexOf('--MIRROR_PROFILE_END')<sql.indexOf('create or replace function'));
});
test('namespace normalization preserves body semantics: only CR and the function own qualification relocate',()=>{
 const source=body(fn(read(specs[0][1]),specs[0][2])),namespace='attendance_owned_232';
 const normalized=text=>text.replace(/\r/g,'').replaceAll(namespace+'.','public.');
 assert.equal(hash(normalized(source.replaceAll('public.',namespace+'.').replaceAll('\n','\r\n'))),pinned.binding);
 assert.notEqual(hash(normalized(source.replace('for share','for update'))),pinned.binding);
 assert.notEqual(hash(normalized(source.replace('public.merchants','other_schema.merchants'))),pinned.binding);
 has(sql,"quote_ident((select nspname from pg_namespace where oid=function_meta.pronamespace))||'.','public'||'.'");
});
test('top entry validates every authority input and exact double identity without requiring actor worker or self permissions',()=>{
 has(top,'p_site is null','p_worker is null','p_employee is null','p_employee_auth is null','p_actor is null','p_from is null','p_through is null',
  'not isfinite(p_from)','p_through-p_from not between 0 and 30','p_actor=p_employee_auth',
  'w.employee_id is distinct from p_employee','e.auth_user_id is distinct from p_employee_auth',
  "actor_employee.auth_user_id is distinct from p_actor","actor_employee.status is distinct from 'active'");
 assert.doesNotMatch(top,/attendance\.self|employee_id=actor_employee_id|\buser_id=p_actor/);
 const tokens=['from public.merchants','for share','from public.merchant_attendance_settings','for update',
  'from public.merchant_attendance_workers','for update','order by x.id for share','faolla_attendance_pd_envelope_v1'];
 let position=-1;for(const token of tokens){position=top.indexOf(token,position+1);assert(position>=0,token);}
});
test('new sources honestly identify delegated access, preserve canonical hashes, and keep all prior byte/count limits',()=>{
 for(const key of ['source','fixed_source']){
  const value=fn(sql,'faolla_attendance_pd_'+key+'_v1');
  has(value,"p_query->>'access' is distinct from 'delegate'","'delegate_checked'",'expected_report_count>=100','total_events>4000',
   'public.faolla_attendance_period_canonical_v1(result)','>1048576','>4194304');
  assert.doesNotMatch(value,/'owner_checked'|'access','owner'|\buser_id=p_auth_user_id/);
 }
 has(top,"'access','delegate'","result->>'validation' is distinct from 'delegate_checked'",
  "result->>'sourceText' is distinct from (result->'sourceCanonical')::text","result->>'sourceFingerprint' is distinct from encode(sha256");
});
test('171 extraction is strictly detail-only and preserves current identity, claim projection, preview and bounded saved history',()=>{
 const value=fn(sql,'faolla_attendance_pd_posthoc_read_v1');
 assert.doesNotMatch(clean(value),/p_command|p_allow_write|mode_name=|insert into|delete from|update public\./i);
 has(value,"array['siteId','workerId','slotId']", 'count_ops<>revision_no','actual_claims<>expected_claims',
  'row(head.worker_id,head.case_id,head.employee_id,head.employee_auth_user_id)','order by revision desc limit 25',
  'faolla_attendance_pd_posthoc_preview_v1(query_source,p_auth_user_id,revision_no,head.operation_id)',
  "'actorId',p_auth_user_id");
});
test('all collection calls keep actual caller, use private mirrors, and never invoke historical writers or fresh credential RPCs',()=>{
 const all=specs.map(([key])=>fn(sql,'faolla_attendance_pd_'+key+'_v1')).join('\n');
 for(const [, ,name] of specs)assert(!new RegExp('public\\.'+name+'\\(').test(all),name);
 assert.doesNotMatch(clean(all),/faolla_attendance_(?:pin_begin|pin_finish|onsite_v1|self_v1|correction_self|missing_v1|leave_v1|period_closure_v[12])\(/);
 has(all,"'actorId',p_auth_user_id","'requestAuthUserId',b.request_auth_user_id");
 assert.doesNotMatch(clean(all),/select (?:m\.)?user_id|p_auth_user_id\s*:=|set_config|current_setting/);
});
test('approved source footprint adds no GPS or attachments and fixed frames never rederive saved dates from today timezone',()=>{
 const all=specs.map(([key])=>fn(sql,'faolla_attendance_pd_'+key+'_v1')).join('\n');
 assert.doesNotMatch(clean(all),/merchant_attendance_location_results|\blatitude\b|\blongitude\b|\battachment|\bsigned_url|\bobject_key/);
 const fixed=fn(sql,'faolla_attendance_pd_fixed_source_v1');
 has(fixed,'fixed_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact)',
  "'timeZone',fixed_head.time_zone", "current_body->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'",
  "fixed_artifact.source_fingerprint is distinct from encode(sha256");
 has(fn(sql,'faolla_attendance_pd_envelope_v1'),'faolla_attendance_outage_period_context_v1','faolla_attendance_work_arrangement_context_v1');
});
