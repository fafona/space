import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {dayReviewSqlFunctions} from './merchant-attendance-day-review-source.mjs';
import {delegatedRulesMigration,delegatedRulesActions,delegatedRulesForwardRecipes,delegatedRulesInstallRecipe,delegatedRulesFreezeSql} from './merchant-attendance-delegated-rules-source.mjs';
const dir=new URL('./supabase-migrations/',import.meta.url),sql=readFileSync(new URL(delegatedRulesMigration,dir),'utf8').replaceAll('\r\n','\n');
const migrations=readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n)&&n<delegatedRulesMigration).sort().map(name=>({name,text:readFileSync(new URL(name,dir),'utf8')}));
const r=delegatedRulesInstallRecipe(sql,migrations),functions=dayReviewSqlFunctions(sql),body=name=>{const f=functions.find(f=>f.name===name);assert(f,name);return f.body;};

test('206 generated SOURCE is exact, bounded19 own functions and four OID/default/ACL-preserving forwards',()=>{
 assert.equal(delegatedRulesFreezeSql(sql,migrations),sql);assert.equal(r.own.length,19);assert.equal(r.forward.cores.length,3);
 assert.equal(r.own.filter(f=>f.isRpc).length,1);assert.equal(r.own.filter(f=>f.definer).length,1);
 assert.match(sql,/rules206_forward_metadata\)<>4/);
 for(const field of ["to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression",
  "to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata",
  'pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression',"meta.pronargdefaults<>(spec->>'defaults')::integer"])assert(sql.includes(field),field);
 for(const text of ['pg_get_expr(meta.proargdefaults,0)','aclexplode','meta.proargnames','meta.proconfig','meta.proowner'])assert(sql.includes(text),text);
 assert(!r.dependencies.some(f=>'core' in f||'oldBody' in f||'newBody' in f));
});
test('206 NULL legacy cores differ only at the approved owner boundary, no owner Auth impersonation',()=>{
 for(const f of r.forward.cores){
  const start=f.core.indexOf('  if p_grant_id is null then\n'),end=f.core.indexOf('\n  end if;',start)+'\n  end if;'.length;
  assert(start>=0&&end>start);assert.equal(f.core.slice(0,start)+f.anchor+f.core.slice(end),f.oldBody);
  assert.equal(body(f.coreName),f.core);assert.match(f.newBody,/p_query,p_auth_user_id,p_command,p_allow_write,null/);
  assert.match(f.core,/p_auth_user_id/);assert.doesNotMatch(f.core,/p_auth_user_id\s*:=|m\.user_id\s*,\s*p_command/);
  for(const invariant of ['expectedRevision','attendance_access_denied','for update','clock_timestamp()'])assert(f.core.includes(invariant),f.name+invariant);
 }
 assert.deepEqual(r.forward.cores.map(f=>f.oldHash),['f10892ab5cb5e4920a63b9a31e75a7f33cb2542979cfb2736553b8ec918e8f97','a1f2ddd77655a5b58e7fd27f8fea54a7c0459fbe26b79edecf2d486f37260b08','c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb']);
});
test('206 exact four query variants use real supported validators, bounded UTF8 and anchored cursor',()=>{
 const b=body('faolla_attendance_delegated_rules_query_v1');
 for(const fields of ["array['siteId','grantId','mode','operationId']","array['siteId','grantId','mode','cursor']","array['siteId','grantId','atRevision','beforeRevision']","array['siteId','grantId','mode','sourceDraftRevision','effectiveOn','endsOn']"])assert(b.includes(fields));
 assert.match(b,/octet_length\(convert_to\(p::text,'UTF8'\)\)>8192/);assert.match(b,/\^\[0-9\]\{8\}\$/);assert.doesNotMatch(b,/_scalar_v1\([^\n]+,'site'\)/);
 assert.match(b,/c->'siteId' is distinct from p->'siteId'/);assert.match(b,/c->'grantId' is distinct from p->'grantId'/);
 assert.match(b,/beforeRevision'\)::numeric>\(c->>'atRevision'/);
});
test('206 eight actions only and command SHA canonical tuple agrees with frozen wire field order',()=>{
 assert.equal(delegatedRulesActions.length,8);const c=body('faolla_attendance_delegated_rules_command_v1'),h=body('faolla_attendance_delegated_rules_hash_v1');
 assert.match(c,/jsonb_build_array\(d->>'action',d->>'operationId',\(d->>'expectedRevision'\)::bigint,d->>'reason'\)/);
 assert.match(c,/array\['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes'\]/);
 assert.match(c,/jsonb_build_array\('value',\(v->>'minutes'\)::integer\)/);assert.match(c,/jsonb_build_array\(family,public.faolla_attendance_operational_rule_command_v1\(d\)\)/);
 assert.match(c,/expectedWorkerVersion'[\s\S]*expectedSettingsVersion'[\s\S]*employeeId'[\s\S]*employeeAuthUserId'[\s\S]*timeZone'[\s\S]*startsOn'[\s\S]*endsOn',choices/);
 assert.match(h,/'attendance-delegated-rules-command-v1',site,actor,id,public.faolla_attendance_delegated_rules_command_v1\(c\)/);
 const a=body('faolla_attendance_delegated_rules_action_v1');for(const action of delegatedRulesActions)assert(a.includes("'"+action+"'"));
});
test('206 original actor minimal recover/exactPOST precede flags/current authorization and recheck after settings lock',()=>{
 const b=body('faolla_attendance_delegated_rules_v1'),first=b.indexOf('receipt:=public.faolla_attendance_delegated_rules_receipt_v1'),lock=b.indexOf('for update;'),second=b.indexOf('receipt:=public.faolla_attendance_delegated_rules_receipt_v1',first+1),flag=b.indexOf('not p_allow_write'),auth=b.indexOf('g:=public.faolla_attendance_delegated_rules_authorize_v1');
 assert(first<lock&&lock<second&&second<flag&&flag<auth);assert.match(b,/receipt->>'commandFingerprint' is distinct from fp/);
 const rec=body('faolla_attendance_delegated_rules_receipt_v1');assert.match(rec,/p.actor_auth_user_id is distinct from actor/);assert.match(rec,/p.grant_id is distinct from id/);assert.match(rec,/operation_v1\(p,false\)/);assert.doesNotMatch(rec,/authorize_v1|management_current_v1/);
 const proof=body('faolla_attendance_delegated_rules_operation_v1');assert.match(proof,/effects_v1\(g,b->'command',p.recorded_at,p.business_revision\)/);assert.match(proof,/if p_current then perform[\s\S]*authorize_v1/);
});
test('206 fresh complete grant, actual actor and personal self refusal retain old core CAS before atomic sidecar effect guard',()=>{
 const a=body('faolla_attendance_delegated_rules_authorize_v1'),rpc=body('faolla_attendance_delegated_rules_v1'),proof=body('faolla_attendance_delegated_rules_operation_v1');
 assert.match(a,/g.delegate_auth_user_id is distinct from actor/);assert.match(a,/management_current_v1\(g,clock_timestamp\(\)\)/);
 assert.match(a,/g.employee_id=g.delegate_employee_id or g.employee_auth_user_id=actor/);assert.match(a,/e.role_id for share/);
 assert.match(rpc,/values\(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action/);
 assert.doesNotMatch(rpc,/perform public.faolla_attendance_delegated_rules_effects_v1/);assert.match(body('faolla_attendance_delegated_rules_authority_v1'),/operation_v1\(p,true\)/);
 assert.match(proof,/p.business_revision<>\(b->'command'->>'expectedRevision'\)::bigint\+1/);
 assert.match(proof,/p.business_fingerprint is distinct from[\s\S]*'attendance-delegated-rules-business-v1',family,b/);
});
test('206 partial keys compare complete same-layer choices, all actual segment boundaries and explicit UUID whitelist only',()=>{
 const b=body('faolla_attendance_delegated_rules_choices_v1'),e=body('faolla_attendance_delegated_rules_effects_v1');
 assert.match(b,/before_rules->key_name is distinct from after_rules->key_name/);assert.match(b,/allowedRuleKeys' @> jsonb_build_array\(key_name\)/);
 assert.match(b,/foreach v in array array\[before_rules->'locationScope',after_rules->'locationScope'\]/);assert.match(b,/v->>'mode'='value' and exists/);assert.match(b,/locationIds' @> jsonb_build_array\(requested.id\)/);
 assert.doesNotMatch(b.replace(/^\s*--.*$/gm,''),/locationScope'->>'mode'.*(?:inherit|disabled).*raise|default_location|population/);
 assert.match(e,/select distinct point_value from unnest\(points\)/);assert.match(e,/array_append\(points,candidate.ends_at\)/);
 assert.match(e,/at_v1\(g.merchant_id,family,subject,point_at,ceiling,target_revision\)/);
 assert.match(e,/candidate_count=26 then raise exception 'attendance_delegated_rules_too_large'/);assert.match(e,/personal_rule_overlap/);
});
test('206 baseline is saved draft first, otherwise actual currently effective publication not latest future publication',()=>{
 const b=body('faolla_attendance_delegated_rules_baseline_v1'),at=body('faolla_attendance_delegated_rules_at_v1');
 assert.match(b,/previous.draft_revision_after/);assert.match(b,/prior_operational.draft_revision_after/);assert.match(b,/'baselineKind','draft','baselineRevision'/);
 assert.match(b,/at_v1\(site,family,subject,stamp,ceiling,null\)/);assert.match(at,/actual.effective_at<=stamp and actual.revision<ceiling/);
 assert.match(at,/candidate.withdrawn_revision is null or candidate.withdrawn_revision>=ceiling/);assert.match(at,/candidate.ends_at is null or candidate.ends_at>stamp/);
 assert.match(b,/case when r->'revision'='null'::jsonb then 'default' else 'publication' end/);
 assert.match(body('faolla_attendance_delegated_rules_v1'),/baseline_v1\(site,family,subject,clock_timestamp\(\),revision_value\+1\)/);
});
test('206 reviewRouting after references must be one of the immutable before-layer exact pairs or owner',()=>{
 const b=body('faolla_attendance_delegated_rules_choices_v1');
 assert.equal((b.match(/array\['correction','missing','leave','work_arrangement'\]/g)||[]).length,2);
 assert.match(b,/before_rules->'reviewRouting'->>'mode'='value'/);assert.match(b,/known_routes:=known_routes\|\|jsonb_build_array\(v\)/);
 assert.match(b,/after_rules->'reviewRouting'->>'mode'='value'/);assert.match(b,/v<>'"owner"'::jsonb and not\(known_routes @> jsonb_build_array\(v\)\)/);
 assert.doesNotMatch(b,/from public\.merchant_enterprise_employees|from public\.merchant_enterprise_roles|auth\.users/);
 const e=body('faolla_attendance_delegated_rules_effects_v1');assert.match(e,/choices_v1\(g,before_rules,after_rules\);\s*end loop/);
 //The old value parser has already required exactly Employee/Auth UUID fields;
 //both are compared together, not matching only an employee or only an Auth.
 assert.match(b,/operational_rule_values_v1\(before_rules\);perform public.faolla_attendance_operational_rule_values_v1\(after_rules\)/);
});
test('206 history25+1 prelimits every family and fixes withdrawal visibility to cursor anchor',()=>{
 const b=body('faolla_attendance_delegated_rules_v1');assert.equal((b.match(/order by actual.revision desc limit 26\)/g)||[]).length,3);
 assert.match(b,/cursor_value->>'atRevision'/);assert.match(b,/at_revision>revision_value/);assert.match(b,/seen:=seen\+1;exit when seen=26/);
 assert.match(b,/last_revision-1/);assert.match(b,/actual.revision<=at_revision/);assert.match(b,/actual.withdrawn_revision<=at_revision/);
 assert.match(b,/jsonb_build_object\('item',record_value.item,'withdrawnByRevision',withdrawn\)/);
 assert.match(b,/'beforeRevision',last_revision/);assert.match(b,/seen<26 and at_revision>0 and last_revision is distinct from 1/);
});
test('206 no broad owner catalog/new persisted tables, one new RPC grant and strict transport/result bounds',()=>{
 assert.doesNotMatch(sql,/^create (?:table|index|trigger).*public\.|^alter table public\.|^delete from public\./m);
 assert.equal((sql.match(/^grant execute on function/gm)||[]).length,1);
 for(const f of r.own)assert(sql.includes('revoke all on function '+f.signature+' from public,anon,authenticated,service_role;'));
 const rpc=body('faolla_attendance_delegated_rules_v1');assert.doesNotMatch(rpc,/mode','catalog|mode','groups|mode','workers/);assert.match(rpc,/>49152/);assert.match(rpc,/>262144/);
 const business=body('faolla_attendance_delegated_rules_business_v1');assert.equal((business.match(/recorded_at at time zone 'UTC'/g)||[]).length,3);assert.match(business,/from_at at time zone 'UTC'/);assert.match(business,/effective_at at time zone 'UTC'/);
});
test('206 seven actual rule table templates retain FK/index/trigger checks, all TEMP parents and exact connoinherit shape',()=>{
 assert.equal(r.templates.tables.length,7);assert.doesNotMatch(r.templates.sql,/references public\./);
 for(const x of ['convalidated','connoinherit','confkey','indnkeyatts','indnullsnotdistinct','indisvalid','pg_attrdef','attacl','tginitdeferred','tgfoid'])assert(r.tableChecks.includes(x),x);
 assert.match(r.tableChecks,/trigger_spec.name::name/);assert.match(r.tableChecks,/expected_ref.attname/);
 assert.match(r.preflight,/version=202610080205/);assert.match(r.preflight,/jsonb_build_array\(forward_spec\)/);
});

test('206 trigger metadata alias avoids reserved INITIALLY while retaining exact guard generation',()=>{
 assert.match(r.tableChecks,/expected\(name,kind,deferred,initially_deferred,fn\)/);
 assert.match(r.tableChecks,/actual\.tginitdeferred=trigger_spec\.initially_deferred and actual\.tgfoid/);
 assert.doesNotMatch(sql,/expected\(name,kind,deferred,initially,fn\)|trigger_spec\.initially\b/);
 assert.equal((sql.match(/expected\(name,kind,deferred,initially_deferred,fn\)/g)||[]).length,2);
 assert.equal((sql.match(/actual\.tginitdeferred=trigger_spec\.initially_deferred/g)||[]).length,2);
 const stale=sql.replaceAll('expected(name,kind,deferred,initially_deferred,fn)','expected(name,kind,deferred,initially,fn)')
  .replaceAll('trigger_spec.initially_deferred','trigger_spec.initially');
 assert.equal(delegatedRulesFreezeSql(stale,migrations),sql);
 assert.deepEqual(dayReviewSqlFunctions(stale).map(f=>[f.name,f.hash]),functions.map(f=>[f.name,f.hash]));
});
test('206 all existing called helpers are pinned, exact old recipe drift is rejected instead of accepted alternative',()=>{
 const pinned=new Set([...r.own,...r.dependencies,...r.forward.cores,r.forward.guard].map(f=>f.name));
 for(const f of functions.filter(f=>f.name.startsWith('faolla_attendance_delegated_rules_')))for(const [,name]of f.body.matchAll(/public\.(faolla_\w+)\(/g))assert(pinned.has(name),f.name+':'+name);
 const changed=migrations.map(m=>m.name.startsWith('202610040127_')?{...m,text:m.text.replace("raise exception 'attendance_rule_group_inactive'","raise exception 'changed_rule_group'")}:m);
 assert.throws(()=>delegatedRulesForwardRecipes(changed));
 assert.equal(r.forward.guard.oldHash,'0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7');
 for(const old of ['audit_export','group_cancel','worker_save','location_save','attendance_management_executor_unavailable'])assert(r.forward.guard.newBody.includes(old));
});
