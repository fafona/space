//210 INERT, local owned-context acceptance. The existing parent alone owns
//the synthetic database, namespace cleanup and cluster shutdown.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {utcValidationFastpathRecipe,utcValidationFastpathMigration,utcValidationFoundationMigration,utcValidationFastpathSql} from './merchant-attendance-utc-validation-fastpath-source.mjs';

export const utcValidationNativeCases=Object.freeze([null,'','UTC','utc','Utc',' UTC','UTC ','UTC\n','UTC\t','Etc/UTC','Etc/GMT','GMT','Europe/Madrid','America/New_York','Asia/Shanghai','Pacific/Auckland','Europe/Paris','Asia/Kathmandu','Africa/Cairo','Australia/Sydney','NOT_A_TIME_ZONE','UTC'.repeat(40),'\u0001','\u200bUTC','UTC\u00a0']);
export const utcValidationNativeSha='05d6882d23e9c4db26d945a5f1dda7c96267fb2aac4a17977f55f3aaebf1b9e6';
const fn='public.faolla_attendance_valid_zone_v1(text)';
const sha=value=>createHash('sha256').update(value.replaceAll('\r\n','\n'),'utf8').digest('hex');
export function utcValidationNativeEquivalenceSql(expression){
 assert.equal(typeof expression,'string');assert(expression.includes('pg_timezone_names'));
 return `select jsonb_agg(jsonb_build_object('input',p_zone,'old',(${expression}),'current',public.faolla_attendance_valid_zone_v1(p_zone)) order by ordinal)
  from (values ${utcValidationNativeCases.map((v,n)=>`(${n},${quote(v)}::text)`).join(',')}) inputs(ordinal,p_zone);`;
}
export async function installAndVerifyUtcValidationNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(scope?.schema,d.owned.schema);
 assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);
 const directory=path.join(native.root,'scripts/supabase-migrations'),foundation=readFileSync(path.join(directory,utcValidationFoundationMigration),'utf8');
 const recipe=utcValidationFastpathRecipe(foundation),raw=readFileSync(path.join(directory,utcValidationFastpathMigration),'utf8');
 assert.equal(sha(raw),utcValidationNativeSha);assert.equal(raw.replaceAll('\r\n','\n'),utcValidationFastpathSql(foundation));
 const body=boundClockMigrationBody(native.root,utcValidationFastpathMigration),names=d.inventory().filter(n=>n!=='faolla_schema_migrations');
 const facts=d.fingerprint(names),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const oid=Number(d.exec(`select '${fn}'::regprocedure::oid;`));assert(Number.isSafeInteger(oid)&&oid>0);
 const metadata=()=>d.exec(`select jsonb_build_array(oid,to_jsonb(p)-'prosrc') from pg_proc p where oid=${oid};`);
 //The CLI transport trims outer output whitespace. JSON preserves the exact
 //leading/trailing newlines of prosrc; trimming a body would change its pin.
 const prosrc=()=>JSON.parse(d.exec(`select to_jsonb(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=${oid};`));
 const unaffected=()=>d.exec(`select md5(jsonb_agg(to_jsonb(p) order by oid)::text) from pg_proc p where pronamespace=${d.owned.oid} and oid<>${oid};`);
 const registry=()=>d.exec('select jsonb_agg(to_jsonb(r) order by version) from public.faolla_schema_migrations r;');
 const beforeMeta=metadata(),beforeOthers=unaffected(),beforeRegistry=registry();
 assert.equal(sha(prosrc()),recipe.oldHash,'utc210_old_exact_source');
 let driftRefusals=0;
 const unchanged=()=>{assert.equal(metadata(),beforeMeta);assert.equal(unaffected(),beforeOthers);assert.equal(d.fingerprint(names),facts);assert.equal(d.tableCatalog(),catalog);};
 const refuse=(setup,pattern)=>{
  const definitions=d.definitions(),register=registry();
  assert.throws(()=>d.exec(setup+'\n'+body),new RegExp('ERROR:\\s+'+pattern+'(?:\\s|$)'));
  assert.equal(d.definitions(),definitions,'utc210_failed_transaction_definitions_exact');assert.equal(registry(),register,'utc210_failed_transaction_registry_exact');unchanged();driftRefusals++;
 };
 const bodyDrift=`do $utc210_native_drift$ declare x text;s text;begin select pg_get_functiondef(oid),prosrc into x,s from pg_proc where oid=${oid};execute replace(x,s,s||E'\\n--synthetic drift');end;$utc210_native_drift$;`;
 refuse(bodyDrift,'merchant_attendance_utc_validation_forward_drift');
 refuse(`alter function ${fn} cost 101;`,'merchant_attendance_utc_validation_installation_conflict');
 refuse(`grant execute on function ${fn} to authenticated;`,'merchant_attendance_utc_validation_permission_conflict');
 refuse(`alter function ${fn} owner to service_role;`,'merchant_attendance_utc_validation_installation_conflict');
 assert.equal(registry(),beforeRegistry);
 d.exec(body);unchanged();assert.equal(sha(prosrc()),recipe.newHash,'utc210_new_exact_source');
 const installedDefinitions=d.definitions(),installedRegistry=registry();
 const oldRows=JSON.parse(beforeRegistry),newRows=JSON.parse(installedRegistry);
 assert.deepEqual(newRows.filter(row=>oldRows.some(old=>old.version===row.version)),oldRows,'utc210_all_old_registry_rows_exact');
 assert.deepEqual(newRows.filter(row=>!oldRows.some(old=>old.version===row.version)).map(row=>[row.version,row.name]),[[202610090210,'merchant_attendance_utc_validation_fastpath']],'utc210_exact_one_registry_addition');
 assert.equal(d.exec("select name from public.faolla_schema_migrations where version=202610090210;"),'merchant_attendance_utc_validation_fastpath');
 d.exec(body);unchanged();assert.equal(d.definitions(),installedDefinitions);assert.equal(registry(),installedRegistry);
 refuse(bodyDrift,'merchant_attendance_utc_validation_forward_drift');
 refuse(`alter function ${fn} cost 101;`,'merchant_attendance_utc_validation_installation_conflict');
 refuse(`grant execute on function ${fn} to service_role;`,'merchant_attendance_utc_validation_permission_conflict');
 refuse(`alter function ${fn} owner to service_role;`,'merchant_attendance_utc_validation_installation_conflict');
 const equivalence=JSON.parse(d.exec(utcValidationNativeEquivalenceSql(recipe.expression)));
 assert.equal(equivalence.length,utcValidationNativeCases.length);assert.deepEqual(equivalence.map(x=>x.input),utcValidationNativeCases);
 for(const item of equivalence)assert.equal(item.current,item.old,'utc210_actual_old_expression_equivalence:'+JSON.stringify(item.input));
 assert.equal(equivalence.find(x=>x.input==='UTC').current,true);assert.equal(equivalence.find(x=>x.input==='Europe/Madrid').current,true);
 unchanged();assert.equal(d.definitions(),installedDefinitions);assert.equal(registry(),installedRegistry);
 assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 native.pass('210 actual install/reentry/25 original-expression comparisons/8 atomic drift refusals; same OID and complete metadata, other functions, facts, catalog and fixed archives exact');
 return {phase:210,installAndReentry:true,equivalenceCases:equivalence.length,driftRefusals,oldFactsUnchanged:true,metadataOidAclUnchanged:true,otherFunctionsUnchanged:true,catalogUnchanged:true,archivesUnchanged:true,newTables:0,newFunctions:0,newClusters:0,production:false,deployed:false};
}
