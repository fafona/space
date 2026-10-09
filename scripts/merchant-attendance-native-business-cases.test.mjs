// Adapter orchestration mocks only: no PostgreSQL, acceptance fixture, PID,
// Auth, KDF, browser or database facts are exercised by these four tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {installAndVerifyIndependentWorkersNative,independentNativeManifest,independentNativeMigration} from './merchant-attendance-independent-native.mjs';
import {installVerifyRetentionDisposalNative,retentionDisposalNativeManifest,retentionDisposalNativeMigration,
 retentionDisposalNativePrerequisites,retentionDisposalNativeNewTables} from './merchant-attendance-retention-disposal-native.mjs';
import {installAndVerifyReviewRoutingNative,reviewRoutingNativeTables} from './merchant-attendance-review-routing-native.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),schema='attendance_race_'+'a'.repeat(32);
const owned={schema,oid:42,tableOid:43,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
const saved=artifact=>{const artifactText=JSON.stringify(artifact);return {artifact,artifactText,artifactBytes:Buffer.byteLength(artifactText),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};};
function mockContext(phase,corruptFinal=false){
 const state={installed:false,installs:0,queries:[],facts:0,definitions:0,catalog:0,archives:{155:0,207:0},connections:0};
 const body=phase===196?readFileSync(new URL('./supabase-migrations/'+independentNativeMigration,import.meta.url),'utf8')
  :phase===197?readFileSync(new URL('./supabase-migrations/'+retentionDisposalNativeMigration,import.meta.url),'utf8'):'';
 const added=phase===196?independentNativeManifest(root,body).tables.map(t=>t.name):phase===197?retentionDisposalNativeNewTables:reviewRoutingNativeTables;
 const recipes=phase===197?retentionDisposalNativeManifest(body):[];
 const inventory=()=>['faolla_schema_migrations','merchant_attendance_settings',...(state.installed?added:[])].sort();
 const facts=()=>{state.facts++;return corruptFinal&&state.facts>=5?'CHANGED_INSTALLED_FACT':'stable_full_facts';};
 const query=sql=>{
  state.queries.push(sql);
  if(sql.includes("jsonb_build_object('schema',n.nspname"))return JSON.stringify(owned);
  if(sql.includes('do $independent_preflight$')||sql.includes('do $disposal_preflight$')||sql.includes('do $routing_preflight$')){state.installed=true;state.installs++;return'';}
  if(sql.includes("'permissionHelperAcl'"))return JSON.stringify({failures:[],permissionHelperAcl:[]});
  if(sql.includes("jsonb_build_object('missingRelations'"))return JSON.stringify({missingRelations:[],missingFunctions:[]});
  if(sql.includes('select coalesce((select name from public.faolla_schema_migrations where version=')){
   const v=sql.match(/version=(\d+)/)[1];return {'202609300074':'merchant_attendance_location_reviews','202609300075':'merchant_attendance_location_discussion',
    '202610010105':'merchant_attendance_kiosk_correction_basis','202610080189':'merchant_attendance_correction_delegation','202610080190':'merchant_attendance_correction_delegation_permission'}[v]??assert.fail('unexpected registry');
  }
  if(sql.includes('select exists(select 1 from public.faolla_schema_migrations where version=202610080198'))return state.installed?'t':'f';
  if(sql.includes("filter(where cardinality(failed_fields)>0)"))return'[]';
  if(sql.includes("jsonb_build_object('sourceHash'")){
   const f=retentionDisposalNativePrerequisites.flatMap(p=>p.functions).find(f=>sql.includes('public.'+f.name+'('));assert(f,'known prerequisite function');
   return JSON.stringify({sourceHash:f.hash,namespace:42,owner:'postgres',result:'jsonb',language:f.language,securityDefiner:f.rpc,volatility:f.volatility,
    parallel:'u',strict:false,leakproof:false,returnsSet:false,kind:'f',supportAbsent:true,config:['search_path=pg_catalog'],argNames:f.argNames,argCount:f.argNames.length,
    allArgTypesNull:true,argModesNull:true,defaultCount:f.rpc?1:0,defaults:f.rpc?'NULL::jsonb':null,
    acl:[['postgres','postgres','EXECUTE',false],...(f.rpc?[['postgres','service_role','EXECUTE',false]]:[])]});
  }
  if(sql.includes("jsonb_build_object('name',r->>'name','expected'"))return JSON.stringify(recipes.map(r=>({name:r.name,expected:r.oldHash,actual:r.oldHash})));
  if(sql.includes('jsonb_agg(relname order by relname)'))return JSON.stringify(inventory());
  if(sql.includes('array_agg(oid order by oid)::text')||sql.includes('array_agg(to_regprocedure('))return'{1,2}';
  if(sql.includes("to_jsonb(p)-array['prosrc','proargdefaults']"))return JSON.stringify(Array.from({length:phase===196?7:phase===197?2:1},(_,i)=>i));
  if(sql.includes('md5(jsonb_object_agg(n,rows order by n)::text)')||sql.includes('md5(jsonb_object_agg(outage_fact_name,outage_fact_rows order'))return facts();
  if(sql.includes('md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid)'))return'stable_unaffected_OID_ACL';
  if(sql.includes('md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid)')){state.definitions++;return'stable_definitions';}
  if(sql.includes('jsonb_agg(jsonb_build_array(c.oid,c.relname')){state.catalog++;return'stable_catalog';}
  if(sql.includes('pg_my_temp_schema()'))return'0';
  return assert.fail('unexpected mocked SQL: '+sql.slice(0,180));
 };
 const ctx={d:{syntheticOnly:true,owned,guard:'',exec:query,inventory,fingerprint:facts,
   definitions:()=>{state.definitions++;return'stable_definitions';},tableCatalog:()=>{state.catalog++;return'stable_catalog';}},
  h:{syntheticOnly:true},scope:{schema,sql:s=>s},native:{root,query,connect:()=>{state.connections++;assert.fail('skip must not open fixture or race connections');},pass:()=>{}},
  archive:async()=>{state.archives[155]++;return saved({archive:155});},periodArchive:async()=>{state.archives[207]++;return saved({archive:207});}};
 return {ctx,state};
}
for(const [phase,install]of [[196,installAndVerifyIndependentWorkersNative],[197,installVerifyRetentionDisposalNative],[198,installAndVerifyReviewRoutingNative]]){
 test(phase+' explicit business skip still executes complete install/reentry and final facts/metadata/catalog/archive protections (mock)',async()=>{
  const {ctx,state}=mockContext(phase);const result=await install(ctx,{businessCases:'skip'});
  assert.equal(result.phase,phase);assert.equal(result.installAndReentry,true);assert.equal(result.businessCasesExecuted,false);assert.equal(result.acceptance,null);
  assert.equal(state.installs,2);assert.equal(state.connections,0);assert(state.facts>=5);assert(state.definitions>=3);assert(state.catalog>=3);
  assert(state.archives[155]>=2&&state.archives[207]>=2);assert.equal(result.oldFactsUnchanged,true);assert.equal(result.oldArchivesUnchanged,true);
  assert(state.queries.some(s=>s.includes('pg_get_functiondef')));assert(state.queries.some(s=>s.includes("to_jsonb(p)-array['prosrc','proargdefaults']")));
  if(phase===196)assert(result.protection.protectionDispatches<=64);if(phase===198)assert.equal(result.rollbackRestored,null);
  const changed=mockContext(phase,true);await assert.rejects(()=>install(changed.ctx,{businessCases:'skip'}),/installed_facts_changed|fixture_not_rolled_back/);
 });
}
test('196/197/198 defaults retain run and import their acceptance fixture only inside that explicit branch; invalid options touch no transport',async()=>{
 const entries=[['independent','installAndVerifyIndependentWorkersNative','attendance-independent-native.mjs',installAndVerifyIndependentWorkersNative],
  ['retention-disposal','installVerifyRetentionDisposalNative','attendance-retention-disposal-native.mjs',installVerifyRetentionDisposalNative],
  ['review-routing','installAndVerifyReviewRoutingNative','attendance-review-routing-native.mjs',installAndVerifyReviewRoutingNative]];
 for(const [name,fn,fixture,install]of entries){
  const source=readFileSync(new URL('./merchant-attendance-'+name+'-native.mjs',import.meta.url),'utf8'),tail=source.slice(source.indexOf('export async function '+fn));
  assert(tail.includes("const {businessCases='run'}=options"));assert(tail.includes("businessCasesExecuted:businessCases==='run'"));
  const branch=tail.indexOf("if(businessCases==='run')"),importAt=tail.indexOf("import('./fixtures/"+fixture+"')");assert(branch>=0&&importAt>branch);
  for(const options of [null,[],{businessCases:'unknown'},{businessCases:null},{businessCases:'skip',unsafe:true}])
   await assert.rejects(()=>install(null,options),/native_options_invalid|native_business_cases_invalid/);
 }
});
