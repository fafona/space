// Source recipe tests ONLY: no native SQL, account, clock or publication claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dayReviewDaySourceBodies,dayReviewSourcePins,dayReviewCollectorSql,dayReviewSqlFunctions,dayReviewDependencyManifest,dayReviewInstallRecipe} from './merchant-attendance-day-review-source.mjs';
const read=name=>readFileSync(new URL('./supabase-migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
function currentSources(){
 const original=read('202610070179_merchant_attendance_outage_periods.sql'),migration=read('202610080195_merchant_attendance_administrative_closure.sql');
 const recipes=JSON.parse(migration.match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)?.[1]??'null');assert(Array.isArray(recipes));
 const prepare=name=>{
  const marker='create or replace function public.'+name+'(',start=original.indexOf(marker);assert(start>=0);
  const declaration=original.indexOf('as $$',start),end=original.indexOf('$$;',declaration+5);assert(declaration>start&&end>declaration);
  let body=original.slice(declaration+5,end);const recipe=recipes.find(r=>r.name===name);assert(recipe);
  assert.equal(createHash('sha256').update(body).digest('hex'),recipe.oldHash);
  for(const change of recipe.changes){assert.equal(body.split(change.from).length-1,change.count);body=body.split(change.from).join(change.to);}
  assert.equal(createHash('sha256').update(body).digest('hex'),recipe.newHash);return body;
 };
 return {base:prepare('faolla_attendance_period_closure_source_base_v1'),wrapper:prepare('faolla_attendance_period_closure_source_v1')};
}
test('C15-A private day collector is pinned to current195; old bodies remain byte-identical',()=>{
 const {base,wrapper}=currentSources(),a=dayReviewDaySourceBodies(base,wrapper),b=dayReviewDaySourceBodies(base,wrapper);
 assert.deepEqual(a,b);assert.equal(a.actualSql,false);assert.equal(a.planSourceIncluded,false);assert.equal(a.oldBodiesModified,false);
 assert.equal(createHash('sha256').update(base).digest('hex'),dayReviewSourcePins.base);
 assert.equal(createHash('sha256').update(wrapper).digest('hex'),dayReviewSourcePins.wrapper);
 assert.throws(()=>dayReviewDaySourceBodies(base+'\n',wrapper));assert.throws(()=>dayReviewDaySourceBodies(base,wrapper+'\n'));
});
test('C15-A own saved case keeps UTC frame and identity; missing requested case never falls back to current zone',()=>{
 const {base,wrapper}=currentSources(),b=dayReviewDaySourceBodies(base,wrapper).base;
 assert.match(b,/day_case public\.merchant_attendance_day_review_cases%rowtype/);
 assert.match(b,/if day_case\.case_id is null then raise exception 'attendance_day_review_not_found'/);
 assert.match(b,/day_case\.employee_id is distinct from emp\.id or day_case\.employee_auth_user_id is distinct from emp\.auth_user_id/);
 assert.match(b,/fixed_zone:=day_case\.time_zone;a:=day_case\.start_at;b:=day_case\.end_at/);
 const branch=b.slice(b.indexOf('if requested_case is not null then'),b.indexOf('--199 own DAY frame ends'));
 const [saved,current]=branch.split('  else\n');assert(!saved.includes('control_day_boundary'));assert(current.includes('control_day_boundary'));
 assert.match(b,/p_query->'slotId' is distinct from 'null'::jsonb/);
 for(const forbidden of ['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','fixed_pid','set_config'])assert(!b.includes(forbidden));
});
test('C15-A full bounded current collector and context are not replaced by a selected plan subset or empty fallback',()=>{
 const {base,wrapper}=currentSources(),r=dayReviewDaySourceBodies(base,wrapper);
 for(const part of ['expected_report_count>=100','total_events>4000','limit 2003','limit 101','limit 11','faolla_attendance_period_session_v1',
  'faolla_attendance_administrative_boundary_v1','faolla_attendance_period_closure_unified_report_v1','pendingCorrections','calendar','faolla_attendance_period_canonical_v1'])assert(r.base.includes(part),part);
 assert(r.wrapper.includes('faolla_attendance_work_arrangement_context_v1'));assert(r.wrapper.includes('faolla_attendance_outage_period_context_v1'));
 assert(!r.base.includes('return public.faolla_attendance_period_source_v1'));
 assert(!r.base.includes('exception when others'));assert.match(r.base,/source_text,'UTF8'\)\)>1048576/);
});

const migration=()=>read('202610080199_merchant_attendance_day_reviews.sql');
const dependencies=sql=>dayReviewDependencyManifest(sql,readdirSync(new URL('./supabase-migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')&&name<'202610080199').sort().map(name=>({name,text:read(name)})));
test('199 embeds the exact pinned full private DAY recipe; no old definition is replaced',()=>{
 const sql=migration(),collector=dayReviewCollectorSql(read('202610070179_merchant_attendance_outage_periods.sql'),read('202610080195_merchant_attendance_administrative_closure.sql'));
 assert(sql.includes(collector));const functions=dayReviewSqlFunctions(sql);assert.equal(functions.length,15);
 assert(functions.every(f=>f.name.startsWith('faolla_attendance_day_review_')));assert.equal(functions.filter(f=>f.definer).length,2);
 assert(!sql.includes('PLACEHOLDER'));assert(!/drop (?:table|function|trigger|index)|delete from public\./i.test(sql));
});
test('199 installation exact pins and parser-templated tables are checked before reentry DDL and after ACL',()=>{
 const sql=migration(),deps=dependencies(sql),recipe=dayReviewInstallRecipe(sql,deps);assert.equal(deps.length,25);assert.equal(recipe.ownCount,15);
 assert.equal(sql.split('--199 PREFLIGHT START\n')[1].split('\n--199 PREFLIGHT END')[0],recipe.preflight);
 assert.equal(sql.split('--199 FINAL START\n')[1].split('\n--199 FINAL END')[0],recipe.final);
 assert(recipe.preflight.includes('legacyHash'));assert(recipe.preflight.includes('has190'));
 const templates=recipe.preflight.slice(recipe.preflight.indexOf('--Empty transaction-local'),recipe.preflight.indexOf('do $day_review_preflight$'));
 assert(!templates.includes('references public.'));assert.equal((templates.match(/create temp table/g)??[]).length,5);
 assert.equal((templates.match(/on commit drop/g)??[]).length,5);
 for(const marker of ['conkey','confkey','confrelid','pg_get_expr','indclass','indoption','tgdeferrable','tginitdeferred','relrowsecurity','pg_policy','aclexplode','proargnames','pronargdefaults','proconfig','prosrc','proparallel','prosupport','proallargtypes','proargmodes','pronargs','procost','prorows','defaultExpression'])assert(recipe.preflight.includes(marker),marker);
 assert(recipe.preflight.indexOf('own_spec:=$day_review_own$')<recipe.preflight.indexOf('foreach table_name'));
});
test('199 minimal recovery and exact same POST precede every current authority, flag and source; fresh race checks repeat under settings lock',()=>{
 const sql=migration(),body=dayReviewSqlFunctions(sql).find(f=>f.name==='faolla_attendance_day_review_v1').body;
 const recover=body.indexOf("if mode='recover'"),samePost=body.indexOf('--An exact original POST'),auth=body.indexOf('from public.merchants');
 assert(recover>=0&&samePost>recover&&auth>samePost);assert(body.indexOf('p_allow_write is distinct from true')>auth);
 assert(body.includes("p_command->>'action'='decide' and p_allow_write is distinct from true"));
 const recovery=body.slice(recover,auth);for(const forbidden of ['from public.merchant_attendance_settings','faolla_attendance_day_review_source_v1(','insert into'])assert(!recovery.includes(forbidden));
 assert(recovery.includes('saved.query is distinct from p_query'));assert(recovery.includes('saved.command is distinct from p_command'));
 assert(recovery.includes('saved.actor_auth_user_id is distinct from p_auth_user_id'));assert(recovery.includes('saved.command_fingerprint is distinct from fingerprint'));
 assert.equal((body.match(/saved\.query is distinct from p_query/g)??[]).length,2);
 assert(body.includes("kind','receipt'"));assert(body.includes('attendance_operation_conflict'));
});
test('199 full PLAN v1/v2/v3 basis and every current point are normalized; limited/unproven never becomes a complete empty day',()=>{
 const sql=migration(),body=dayReviewSqlFunctions(sql).find(f=>f.name==='faolla_attendance_day_review_source_v1').body;
 for(const marker of ['plan-exception-source-v1','plan-exception-source-v2','plan-exception-source-v3',"raw->'source'->'evaluation'->'basis'","raw->'source'->'evaluation'->'observations'",
  "(basis->'sessions')||(context->'unassociated'->'items')",'faolla_attendance_period_session_v1','faolla_attendance_plan_posthoc_missing_v1','faolla_attendance_outage_period_context_v1',
  "part->>'limited' is distinct from 'false'",'attendance_day_review_ineligible','attendance_day_review_too_large'])assert(body.includes(marker),marker);
 assert(!body.includes('exception when others'));assert(body.includes("'sourceId',v->'requestId'"));assert(!body.includes("'sourceId',v->'rootRequestId'"));
 assert(body.includes("jsonb_array_elements(context->'missing'->'items') where value->>'isCurrentApproved'='true'"));
 assert(body.includes("'slotId',t->'slotId','operationId',x->'claim'->'operationId'"));
 assert(body.includes("'attendance-day-review-evidence-v1',t,base_canonical"));
 const facts=body.slice(body.indexOf('facts:=jsonb_build_object'),body.indexOf('canonical:=jsonb_build_array'));
 for(const k of ['coverage','identity','plans','records','calendar','pending','conflicts','arrangements'])assert(facts.includes("'"+k+"'"));
 for(const k of ['fingerprint','current','caseHead','asOf','actorId','readAt'])assert(!facts.includes("'"+k+"'"));
 assert(body.includes('c.target is distinct from t'));assert(body.includes('current_source:=not'));
});

test('199 legacy PLAN points closed administratively before the full slot fail closed rather than extending or emptying source',()=>{
 const body=dayReviewSqlFunctions(migration()).find(f=>f.name==='faolla_attendance_day_review_source_v1').body;
 const guard=body.slice(body.indexOf('--159/173 compact legacy points'),body.indexOf('--A currently moved-out point'));
 assert(guard.includes("nullif(record_item->'administrativeBoundary','null'::jsonb) is not null"));
 assert(guard.includes("record_item->'administrativeBoundary'->>'verifiedEndAt'"));
 assert(guard.includes("then raise exception 'attendance_day_review_ineligible'"));
 assert(!/coalesce\([^;]*observed/.test(guard));assert(!guard.includes('records:='));
 const filter=body.slice(body.indexOf('--A currently moved-out point'),body.indexOf("for v in select value from jsonb_array_elements(context->'missing'->'items')"));
 assert.equal((filter.match(/coalesce\(\(record_item->'administrativeBoundary'->>'verifiedEndAt'\)/g)??[]).length,2);
});
test('199 SQL deterministic four outcomes preserve no-auto-absence and administrative-boundary semantics',()=>{
 const f=dayReviewSqlFunctions(migration()).find(f=>f.name==='faolla_attendance_day_review_compute_v1').body;
 assert(f.includes("array['follow_up','calendar_exempt','not_worked_reported','recorded_work_reviewed']"));
 for(const k of ['evidence_insufficient','pending_source','open_record','source_conflict','unassociated_record','no_record','recorded_work',
  'administrative_hours_unassessed','covering_closure_missing','latest_not_worked_statement_required','work_record_present','recorded_work_required','self_review'])assert(f.includes(k),k);
 assert(f.includes("value->>'kind'='closure' and value->>'status'='created'"));assert(f.includes("plan->>'hasPublicationEvidence'='true'"));
 assert(f.includes("s->'caseHead'->'latestSelf'->>'claim'='not_worked'"));assert(!/absent|payroll|deduct|zero.hours/i.test(f));
});
test('199 new decisions re-collect and CAS append; direct forged inserts and ledger mutation fail closed',()=>{
 const functions=dayReviewSqlFunctions(migration()),rpc=functions.find(f=>f.name==='faolla_attendance_day_review_v1').body,guard=functions.find(f=>f.name==='faolla_attendance_day_review_guard_v1').body;
 assert(rpc.includes('rev<>(p_command->>\'expectedRevision\')::bigint'));assert(rpc.includes('attendance_day_review_head_changed'));
 assert(rpc.includes("p_command->'expectedFingerprint' is distinct from input->'source'->'fingerprint'"));
 assert(rpc.includes("candidate->'blockers'<>'[]'::jsonb"));assert(rpc.includes('insert into public.merchant_attendance_day_review_entries select entry_row.*'));
 assert(guard.includes("tg_op in('UPDATE','DELETE','TRUNCATE')"));assert(guard.includes('attendance_day_review_immutable'));
 assert(guard.includes('faolla_attendance_day_review_source_v1(new.query,new.actor_auth_user_id)'));assert(guard.includes("fresh-'asOf' is distinct from new.normalized_input-'asOf'"));
 assert(guard.includes('new.source_text is distinct from new.canonical::text'));assert(guard.includes('head<>new.revision-1'));
 assert(guard.includes('new.actor_auth_user_id<>c.employee_auth_user_id'));assert(guard.includes('x.revision=1 and x.action=\'decide\' and x.recorded_at=new.opened_at'));
});
