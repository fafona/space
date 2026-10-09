// INERT 197 adapter: only the explicitly named, already owned 195 cluster.
// No database creation, dependency install, production access or browser launch.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAdministrativeClosureNative} from './merchant-attendance-administrative-closure-native.mjs';
import {installAndVerifyIndependentWorkersNative} from './merchant-attendance-independent-native.mjs';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {outageNativeFingerprintSql} from './fixtures/attendance-outage-native.mjs';

export const retentionDisposalNativeMigration='202610080197_merchant_attendance_retention_disposal.sql';
export const retentionDisposalNativeLimits=Object.freeze({steps:190,installMs:90000,fixtureMs:90000,competitionMs:90000,
 extraConnections:1,newDatabases:0,externalAuthRequests:0,kdfCalls:0});
export const retentionDisposalNativeNewTables=Object.freeze([
 'merchant_attendance_disposal_approvals','merchant_attendance_disposal_artifact_coverage','merchant_attendance_disposal_artifact_event_refs',
 'merchant_attendance_disposal_event_coverage','merchant_attendance_disposal_executions',
]);
export const retentionDisposalNativePrerequisites=Object.freeze([
 Object.freeze({version:202609300074,name:'merchant_attendance_location_reviews',file:'202609300074_merchant_attendance_location_reviews.sql',
  sourceHash:'b720acdb8fe5a38c5d85aa26a48b23da99f72ce2da04c7fdbcdfed0d6cb0a06d',table:'merchant_attendance_location_reviews',functions:Object.freeze([
   Object.freeze({name:'faolla_attendance_location_review_entry_v1',types:'public.merchant_attendance_location_reviews,uuid',argNames:['p_row','p_actor'],language:'sql',volatility:'i',rpc:false,hash:'1ffd9feb0cd5be38c5bbd9061c10f2417619245e0a27035482533e1e39523c45'}),
   Object.freeze({name:'faolla_attendance_location_reviews_v1',types:'text,uuid,jsonb,jsonb',argNames:['p_site_id','p_auth_user_id','p_query','p_command'],language:'plpgsql',volatility:'v',rpc:true,hash:'8b46175baed338ec5e94ea1695c4f0eaee54287c5387ebf4623e866a93b76f53'}),
  ])}),
 Object.freeze({version:202609300075,name:'merchant_attendance_location_discussion',file:'202609300075_merchant_attendance_location_discussion.sql',
  sourceHash:'1ea0f95c85c45e5acdce40b09709abb1d7acb7f811130fedf8773c04788a0702',table:'merchant_attendance_location_discussion',functions:Object.freeze([
   Object.freeze({name:'faolla_attendance_location_discussion_entry_v1',types:'public.merchant_attendance_location_discussion',argNames:['p_row'],language:'sql',volatility:'i',rpc:false,hash:'c52670780789d1b4549702a87968a2d2b9fd4f706d1e8c90a1fa5d9cdb3cc17e'}),
   Object.freeze({name:'faolla_attendance_location_discussion_v1',types:'text,uuid,jsonb,jsonb',argNames:['p_site_id','p_auth_user_id','p_query','p_command'],language:'plpgsql',volatility:'v',rpc:true,hash:'4467b972d1da8654666e0408c2ae2fb4012e1852ef557878223f3aac3dc35561'}),
  ])}),
]);
const directDependencies=Object.freeze({
 faolla_attendance_administrative_scalar_v1:'jsonb,text',faolla_attendance_group_text_v1:'text,integer,integer',
 faolla_attendance_period_artifact_checked_v1:'public.merchant_attendance_period_artifacts',faolla_attendance_retention_policy_v1:'text,text',
 faolla_attendance_retention_receipt_v1:'jsonb,uuid,bigint,text,timestamptz',faolla_attendance_retention_source_v1:'text,text,uuid',
 faolla_attendance_shift_rule_binding_object_v1:'jsonb,text[]',faolla_attendance_shift_rule_binding_scalar_v1:'jsonb,text',
});
export function retentionDisposalNativeDependencies(body){
 const functions=[...body.matchAll(/create(?: or replace)? function public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns ([\s\S]*?)as \$\$([\s\S]*?)\$\$;/gi)];
 assert.equal(functions.length,20);const newNames=new Set(functions.map(f=>f[1])),source=functions.map(f=>f[4]).join('\n');
 const relations=[...new Set([...source.matchAll(/\bpublic\.((?:merchant_[a-z0-9_]+|merchants))\b/g)].map(m=>m[1]))].sort();
 const calls=[...new Set([...source.matchAll(/\bpublic\.(faolla_[a-z0-9_]+)\s*\(/g)].map(m=>m[1]))].filter(n=>!newNames.has(n)).sort();
 assert.deepEqual(calls,Object.keys(directDependencies).sort(),'disposal_uninventoried_direct_dependency');
 assert.equal(relations.length,14);assert(retentionDisposalNativeNewTables.every(t=>relations.includes(t)));
 return Object.freeze({relations:Object.freeze(relations.filter(t=>!retentionDisposalNativeNewTables.includes(t))),
  functions:Object.freeze(calls.map(n=>'public.'+n+'('+directDependencies[n]+')'))});
}
export function retentionDisposalNativeDependencyDiagnosticSql(body){
 const dependencies=retentionDisposalNativeDependencies(body);
 return `select jsonb_build_object('missingRelations',(select coalesce(jsonb_agg(name order by name),'[]') from jsonb_array_elements_text(${json(dependencies.relations)}) name where to_regclass('public.'||name) is null),
  'missingFunctions',(select coalesce(jsonb_agg(signature order by signature),'[]') from jsonb_array_elements_text(${json(dependencies.functions)}) signature where to_regprocedure(signature) is null));`;
}
export function assertRetentionDisposalNativeDependencies(d,body,{allowMissingPrerequisites=false}={}){
 const failures=JSON.parse(d.exec(retentionDisposalNativeDependencyDiagnosticSql(body)));
 assert.deepEqual(Object.keys(failures).sort(),['missingFunctions','missingRelations']);
 const permitted=allowMissingPrerequisites?retentionDisposalNativePrerequisites.map(p=>p.table):[];
 assert.deepEqual(failures.missingFunctions,[],`disposal_missing_dependencies:${JSON.stringify(failures)}`);
 assert.deepEqual(failures.missingRelations.filter(n=>!permitted.includes(n)),[],`disposal_missing_dependencies:${JSON.stringify(failures)}`);
 return failures;
}
export function retentionDisposalNativePrerequisiteFunctionSql(spec,schema){
 assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);const signature='public.'+spec.name+'('+spec.types+')';
 return `select jsonb_build_object('sourceHash',encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),${quote(schema+'.')},'pub'||'lic.'),'UTF8')),'hex'),
  'namespace',p.pronamespace::bigint,'owner',p.proowner::regrole::text,'result',p.prorettype::regtype::text,'language',l.lanname,
  'securityDefiner',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,
  'returnsSet',p.proretset,'kind',p.prokind,'supportAbsent',p.prosupport=0::oid,'config',p.proconfig,'argNames',p.proargnames,'argCount',p.pronargs,
  'allArgTypesNull',p.proallargtypes is null,'argModesNull',p.proargmodes is null,'defaultCount',p.pronargdefaults,'defaults',pg_get_expr(p.proargdefaults,0),
  'acl',(select jsonb_agg(jsonb_build_array(a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))
  from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(${quote(signature)});`;
}
function assertPrerequisiteFunctions(d,spec){
 for(const f of spec.functions){
  const actual=JSON.parse(d.exec(retentionDisposalNativePrerequisiteFunctionSql(f,d.owned.schema)));
  assert.deepEqual(actual,{sourceHash:f.hash,namespace:d.owned.oid,owner:d.owned.owner,result:'jsonb',language:f.language,
   securityDefiner:f.rpc,volatility:f.volatility,parallel:'u',strict:false,leakproof:false,returnsSet:false,kind:'f',supportAbsent:true,
   config:['search_path=pg_catalog'],argNames:f.argNames,argCount:f.argNames.length,allArgTypesNull:true,argModesNull:true,
   defaultCount:f.rpc?1:0,defaults:f.rpc?'NULL::jsonb':null,
   acl:[[d.owned.owner,d.owned.owner,'EXECUTE',false],...(f.rpc?[[d.owned.owner,'service_role','EXECUTE',false]]:[])]},'disposal_prerequisite_function_metadata:'+f.name);
 }
}
export async function installRetentionDisposalNativePrerequisites(ctx,body){
 const {d,native,archive,periodArchive}=ctx;
 const diagnostic=assertRetentionDisposalNativeDependencies(d,body,{allowMissingPrerequisites:true});
 console.log(JSON.stringify({phase:'197_dependency_inventory',...diagnostic,oldRelations:9,directOldFunctions:8}));
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive()),installed=[];
 for(const spec of retentionDisposalNativePrerequisites){
  const source=readFileSync(path.join(native.root,'scripts/supabase-migrations',spec.file),'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(source).digest('hex'),spec.sourceHash,'disposal_prerequisite_original_source:'+spec.file);
  const registered=d.exec(`select coalesce((select name from public.faolla_schema_migrations where version=${spec.version}),'');`);
  assert(['',spec.name].includes(registered),'disposal_prerequisite_registry_conflict:'+spec.file);
  if(registered){assertPrerequisiteFunctions(d,spec);continue;}
  const objects=JSON.parse(d.exec(`select jsonb_build_object('relation',to_regclass(${quote('public.'+spec.table)})::text,'type',to_regtype(${quote('public.'+spec.table)})::text,
   'functions',(select count(*) from pg_proc where pronamespace=${d.owned.oid} and proname=any(array[${spec.functions.map(f=>quote(f.name)).join(',')}])));`));
  assert.deepEqual(objects,{relation:null,type:null,functions:0},'disposal_prerequisite_unregistered_objects:'+spec.file);
  const oldTables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),factsSql=outageNativeFingerprintSql(oldTables),facts=retentionDisposalReadFacts(d,factsSql),catalog=JSON.parse(d.tableCatalog());
  const registry=d.exec('select coalesce(jsonb_agg(to_jsonb(m) order by version),\'[]\')::text from public.faolla_schema_migrations m;');
  const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const definitions=()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(to_jsonb(p),pg_get_functiondef(p.oid)) order by p.oid)::text) from pg_proc p where p.oid=any(${quote(oldOids)}::oid[]);`);
  const originalFunctions=definitions();d.exec(boundClockMigrationBody(native.root,spec.file));
  assert.equal(retentionDisposalReadFacts(d,factsSql),facts,'disposal_prerequisite_changed_old_facts:'+spec.file);
  assert.equal(definitions(),originalFunctions,'disposal_prerequisite_changed_old_function_OID_metadata_ACL:'+spec.file);
  assert.deepEqual(JSON.parse(d.tableCatalog()).filter(t=>catalog.some(old=>old[0]===t[0])),catalog,'disposal_prerequisite_changed_old_catalog:'+spec.file);
  assert.equal(d.exec(`select coalesce(jsonb_agg(to_jsonb(m) order by version),'[]')::text from public.faolla_schema_migrations m where version<>${spec.version};`),registry,'disposal_prerequisite_changed_old_registry');
  assert.equal(d.exec(`select name from public.faolla_schema_migrations where version=${spec.version};`),spec.name);
  assert.deepEqual(d.inventory().filter(t=>t!=='faolla_schema_migrations'&&!oldTables.includes(t)),[spec.table]);
  const table=JSON.parse(d.exec(`select jsonb_build_object('rows',(select count(*) from public.${spec.table}),'rls',c.relrowsecurity,
   'externalAcl',(select count(*) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner or a.grantor<>c.relowner),
   'triggers',(select jsonb_agg(jsonb_build_array(t.tgname,t.tgtype,t.tgenabled,t.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal))
   from pg_class c where c.oid='public.${spec.table}'::regclass;`));
  assert.deepEqual(table,{rows:0,rls:true,externalAcl:0,triggers:[[spec.table+'_no_rewrite',27,'O',true],[spec.table+'_no_truncate',34,'O',true]]});
  assertPrerequisiteFunctions(d,spec);installed.push(spec.version);
 }
 assertRetentionDisposalNativeDependencies(d,body);
 assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 native.pass('197 prerequisites074/075: original sources only, exact registry/object absence, four function hashes/metadata/ACL, empty private tables, all old facts/functions/OIDs/catalog/archives preserved');
 return installed;
}
export function retentionDisposalNativeManifest(body){
 const found=body.match(/\$disposal_recipes\$([\s\S]*?)\$disposal_recipes\$/);assert(found);
 const recipes=JSON.parse(found[1]);assert.equal(recipes.length,2);
 assert.deepEqual(recipes.map(r=>r.name),['faolla_attendance_operational_punch_core_location_v1','faolla_attendance_retention_source_v1']);
 for(const r of recipes){assert.match(r.oldHash,/^[a-f0-9]{64}$/);assert.match(r.newHash,/^[a-f0-9]{64}$/);assert.notEqual(r.oldHash,r.newHash);}
 return recipes;
}
// Installation adds one NULL column to the old location table. Compare every
// pre-existing fact after projecting ONLY that new column, never whole rows away.
export function retentionDisposalOldFactsSql(names,where={}){
 assert(Array.isArray(names)&&names.length>0);
 return `(select md5(jsonb_object_agg(n,rows order by n)::text) from (${names.map(n=>{
  assert(/^(?:merchants|merchant_[a-z0-9_]+)$/.test(n));
  const row=n==='merchant_attendance_location_results'?"to_jsonb(x)-'disposal_operation_id'":'to_jsonb(x)';
  return `select ${quote(n)} n,(select coalesce(jsonb_agg(${row} order by (${row})::text),'[]'::jsonb) from public.${n} x${where[n]?` where ${where[n]}`:''}) rows`;
 }).join(' union all ')}) old_facts)`;
}
// SET LOCAL requires a transaction. Use the same fixed representation as the
// actual fixture sessions, including baseline/reentry/finally reads made by a
// separate psql connection. This changes serialization, never the wall clock.
export const retentionDisposalReadFacts=(d,expression)=>d.exec('begin;'+periodContinuationSerialization+'select '+expression+';rollback;');
export async function installVerifyRetentionDisposalNative(ctx,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'disposal_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'disposal_native_business_cases_invalid');
 const {d,h,native,scope,archive,periodArchive}=ctx;
 assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const start=Date.now(),body=boundClockMigrationBody(native.root,retentionDisposalNativeMigration);
 const prerequisiteVersions=await installRetentionDisposalNativePrerequisites(ctx,body);
 assert(Date.now()-start<retentionDisposalNativeLimits.installMs,'disposal_prerequisite_deadline');
 const oldTables=d.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFactsSql=retentionDisposalOldFactsSql(oldTables);
 const oldFacts=retentionDisposalReadFacts(d,oldFactsSql),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const recipes=retentionDisposalNativeManifest(body);
 const pins=JSON.parse(d.exec(`select jsonb_agg(jsonb_build_object('name',r->>'name','expected',r->>'oldHash',
  'actual',encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),${quote(d.owned.schema+'.')},'pub'||'lic.'),'UTF8')),'hex')) order by r->>'name')
  from jsonb_array_elements(${json(recipes)}) r left join pg_proc p on p.oid=to_regprocedure('public.'||(r->>'name')||'('||(r->>'types')||')');`));
 assert.deepEqual(pins.filter(p=>p.actual!==p.expected),[],'disposal_prerequisite_body_pins');
 const oldOids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const replaced=d.exec(`select array_agg(to_regprocedure('public.'||(r->>'name')||'('||(r->>'types')||')')::oid order by r->>'name')::text from jsonb_array_elements(${json(recipes)}) r;`);
 const unaffected=()=>d.exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
  from pg_proc where oid=any(${quote(oldOids)}::oid[]) and oid<>all(${quote(replaced)}::oid[]) and prokind='f';`);
 const metadata=()=>d.exec(`select jsonb_agg(jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0)) order by oid)::text
  from pg_proc p where oid=any(${quote(replaced)}::oid[]) and pronamespace=${d.owned.oid};`);
 const originalFunctions=unaffected(),originalMetadata=metadata();assert.equal(JSON.parse(originalMetadata).length,2);
 d.exec(body);assert(Date.now()-start<retentionDisposalNativeLimits.installMs,'disposal_install_deadline');
 assert.equal(retentionDisposalReadFacts(d,oldFactsSql),oldFacts,'disposal_install_old_facts');
 assert.equal(unaffected(),originalFunctions);assert.equal(metadata(),originalMetadata);
 assert.deepEqual(d.inventory().filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),retentionDisposalNativeNewTables);
 const installedFacts=outageNativeFingerprintSql(d.inventory()),installed=retentionDisposalReadFacts(d,installedFacts),definitions=d.definitions(),catalog=d.tableCatalog();
 d.exec(body);assert(Date.now()-start<retentionDisposalNativeLimits.installMs,'disposal_reentry_deadline');
 assert.equal(retentionDisposalReadFacts(d,installedFacts),installed);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
 assert.equal(unaffected(),originalFunctions);assert.equal(metadata(),originalMetadata);
 assert.equal(d.exec("select count(*) from pg_class where relnamespace=pg_my_temp_schema() and relkind in('r','p');"),'0');
 native.pass('197 install/reentry: five private tables, two exact forward bodies, every old fact/OID/ACL and fixed archive unchanged');
 let acceptance=null;
 if(businessCases==='run'){
  const {verifyRetentionDisposalNative}=await import('./fixtures/attendance-retention-disposal-native.mjs');
  acceptance=await verifyRetentionDisposalNative(ctx);assert.equal(acceptance.mainRollbackRestored,true);
 }else{
  assert.equal(retentionDisposalReadFacts(d,installedFacts),installed,'disposal_skip_installed_facts_changed');
  assert.equal(retentionDisposalReadFacts(d,oldFactsSql),oldFacts,'disposal_skip_old_facts_changed');
 }
 assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.equal(unaffected(),originalFunctions);assert.equal(metadata(),originalMetadata);
 assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 return {phase:197,installAndReentry:true,prerequisiteVersions,newTables:5,forwardSignatures:2,oldFactsUnchanged:true,oldArchivesUnchanged:true,acceptance,businessCasesExecuted:businessCases==='run',
  cleanupOwnedByParent:true,newCluster:false,browser:false,realAuth:false,productionAccess:false,deployed:false};
}
// Serial migration order is part of the candidate contract: 196 has already
// advanced the location core. Never reinstall193/195 or accept its stale hash.
export const runRetentionDisposalNative=args=>runAdministrativeClosureNative(args,async ctx=>{
 await installAndVerifyIndependentWorkersNative(ctx);
 return installVerifyRetentionDisposalNative(ctx);
});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runRetentionDisposalNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'retention_disposal_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
