//200 INERT owned-context adapter. Import never starts PostgreSQL, a browser,
//Auth, a KDF, or old acceptance matrices. The parent alone owns cleanup.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './fixtures/attendance-period-continuation-native.mjs';
import {outageNativeFingerprintSql} from './fixtures/attendance-outage-native.mjs';
import {cycleInstallationManifest} from './merchant-attendance-cycle-installation.mjs';

export const operationalCycleNativeMigration='202610080200_merchant_attendance_operational_cycle.sql';
export const operationalCycleNativeSha='203104A41C59D526BDD9740268D6FA3D835E21AE02C7386872737169F18A110E';
export const operationalCycleNativePrerequisites=Object.freeze([
 Object.freeze({version:202610080195,name:'merchant_attendance_administrative_closure'}),
 Object.freeze({version:202610080197,name:'merchant_attendance_retention_disposal'}),
 Object.freeze({version:202610080198,name:'merchant_attendance_review_routing'}),
]);
export const operationalCycleNativeBudget=Object.freeze({groups:8,steps:180,milliseconds:120000,statementMs:10000,maxConnections:3,
 protectionQueries:64,archiveCallbacks:8,pidRaces:2,pidPollsPerRace:34,pidPollIntervalMs:75,pidPollDeadlineMs:2500,
 newClusters:0,newDatabases:0,browser:0,realAuth:0,kdf:0,production:0});

//Preserve exact captured-string equality. Only a failure is summarized; this
//does not normalize, filter, query or repair any catalog object. In particular
//do not attach the whole256KiB catalog as AssertionError.actual/expected.
export function assertAttendanceNativeCatalogEqual(actual,expected,label){
 assert.match(label,/^[a-z0-9_]{1,80}$/);
 if(actual===expected)return;
 assert.equal(typeof actual,'string','native_catalog_actual_string_required');
 assert.equal(typeof expected,'string','native_catalog_expected_string_required');
 let firstCharacter=0;
 while(firstCharacter<actual.length&&firstCharacter<expected.length&&actual[firstCharacter]===expected[firstCharacter])firstCharacter++;
 const fields=['oid','name','owner','acl','row_security','constraints','triggers'];
 const diagnostic={label,kind:'serialization_mismatch',actualLength:actual.length,expectedLength:expected.length,firstCharacter};
 try{
  const a=JSON.parse(actual),e=JSON.parse(expected);let visited=0;
  const difference=(left,right,at=[])=>{
   if(Object.is(left,right))return null;
   if(++visited>100000||at.length>32)return{path:at,kind:'diagnostic_budget'};
   if(Array.isArray(left)&&Array.isArray(right)){
    for(let n=0;n<Math.min(left.length,right.length);n++){const found=difference(left[n],right[n],[...at,n]);if(found)return found;}
    return left.length===right.length?null:{path:[...at,'length'],kind:'length',actual:left.length,expected:right.length};
   }
   if(left&&right&&typeof left==='object'&&typeof right==='object'){
    const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();
    for(const key of keys){const found=difference(left[key],right[key],[...at,key]);if(found)return found;}return null;
   }
   return{path:at,kind:'value',actual:left,expected:right};
  };
  const found=difference(a,e);
  if(found){
   diagnostic.kind=found.kind;diagnostic.path=found.path;
   const rowIndex=found.path[0],fieldIndex=found.path[1];
   if(Number.isInteger(rowIndex)){
    const table=row=>Array.isArray(row)?{oid:Number.isSafeInteger(row[0])?row[0]:null,name:typeof row[1]==='string'&&/^[a-z0-9_]{1,100}$/.test(row[1])?row[1]:null}:null;
    diagnostic.actualTable=table(a[rowIndex]);diagnostic.expectedTable=table(e[rowIndex]);
   }
   if(Number.isInteger(fieldIndex))diagnostic.field=fields[fieldIndex]??'unknown';
   const leaf=(value,other)=>{
    if(typeof value==='string'){
     let at=0;if(typeof other==='string')while(at<value.length&&at<other.length&&value[at]===other[at])at++;
     const start=Math.max(0,at-60);return{type:'string',length:value.length,differenceAt:at,start,excerpt:value.slice(start,start+160).replace(/[\u0000-\u001f\u007f]/g,'?')};
    }
    if(value===null||typeof value==='number'||typeof value==='boolean')return value;
    return{type:Array.isArray(value)?'array':typeof value};
   };
   diagnostic.actual=leaf(found.actual,found.expected);diagnostic.expected=leaf(found.expected,found.actual);
  }
 }catch{diagnostic.kind='unparseable_catalog';}
 assert.fail('attendance_native_catalog_mismatch:'+JSON.stringify(diagnostic).slice(0,1800));
}

//One bounded manifest diagnostic, no function bodies/credential data in output.
//Never installs a guessed prerequisite or changes the expected source hash.
export function operationalCycleNativeDependencyDiagnosticSql(manifest,schema){
 assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);
 const fields=['name','types','securityDefiner','volatility','language','resultType','config','argumentNames','defaults','defaultExpression','serviceExecute','hash'];
 const specs=[...manifest.dependencies,...manifest.forward.map(f=>({...f,hash:f.oldHash}))]
  .map(f=>Object.fromEntries(fields.map(k=>[k,f[k]])));
 return `with specs as(select v,format('%I.%I(%s)',${quote(schema)},v->>'name',replace(v->>'types','public.',${quote(schema+'.')})) signature from jsonb_array_elements(${json(specs)}) v),
 owner_row as(select relowner from pg_class where oid='public.merchant_attendance_settings'::regclass),
 checked as(select s.signature,array_remove(array[
 case when p.oid is null then 'missing' end,
 case when p.proowner is distinct from o.relowner then 'owner' end,
 case when p.prosecdef is distinct from (s.v->>'securityDefiner')::boolean then 'definer' end,
 case when p.provolatile::text is distinct from s.v->>'volatility' then 'volatility' end,
 case when l.lanname is distinct from s.v->>'language' then 'language' end,
 case when p.prorettype is distinct from to_regtype(replace(s.v->>'resultType','public.',${quote(schema+'.')})) then 'result' end,
 case when p.proconfig is distinct from array(select jsonb_array_elements_text(s.v->'config')) then 'config' end,
 case when coalesce(p.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(s.v->'argumentNames')) then 'argnames' end,
 case when p.pronargdefaults is distinct from (s.v->>'defaults')::integer or pg_get_expr(p.proargdefaults,0) is distinct from s.v->>'defaultExpression' then 'defaults' end,
 case when p.prokind is distinct from 'f' or p.proparallel is distinct from 'u' or p.proisstrict is distinct from false or p.proleakproof is distinct from false
  or p.proretset is distinct from false or p.provariadic is distinct from 0 or p.proargmodes is not null or p.proallargtypes is not null
  or p.pronargs is distinct from jsonb_array_length(s.v->'argumentNames') or p.procost is distinct from 100::real or p.prorows is distinct from 0::real then 'function_shape' end,
 case when encode(sha256(convert_to(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),${quote(schema+'.')},'pub'||'lic.'),'UTF8')),'hex') is distinct from s.v->>'hash' then 'source_hash' end,
 case when exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantor<>o.relowner or a.privilege_type<>'EXECUTE' or a.is_grantable
  or a.grantee<>o.relowner and (not(s.v->>'serviceExecute')::boolean or a.grantee<>(select oid from pg_roles where rolname='service_role')))
  or (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>(case when (s.v->>'serviceExecute')::boolean then 2 else 1 end)
  or not has_function_privilege(o.relowner,p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
  or has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from (s.v->>'serviceExecute')::boolean then 'acl' end
 ]::text[],null) failed_fields from specs s cross join owner_row o left join pg_proc p on p.oid=to_regprocedure(s.signature) left join pg_language l on l.oid=p.prolang)
 select coalesce(jsonb_agg(jsonb_build_object('signature',signature,'failedFields',failed_fields) order by signature) filter(where cardinality(failed_fields)>0),'[]')::text from checked;`;
}

export function createOperationalCycleNativeProtection(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'cycle_owned_context_required');
 assert.equal(typeof native?.query,'function');assert.equal(typeof native?.connect,'function');assert.equal(scope?.schema,d.owned.schema);
 assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);assert.equal(typeof d.guard,'string');
 const dispatches=[],archives=[];
 const charge=(label,write)=>{assert.match(label,/^[a-z0-9_]+$/);assert(dispatches.length<operationalCycleNativeBudget.protectionQueries,'cycle_protection_max64');dispatches.push({label,write});};
 const run=(label,sql)=>{charge(label,false);return native.query(scope.sql(`begin read only;${periodContinuationSerialization}${d.guard}set local statement_timeout='10s';set local lock_timeout='3s';${sql}commit;`));};
 const install=body=>{charge('install_or_reentry',true);return native.query(scope.sql(body));};
 const inventory=()=>JSON.parse(run('inventory',`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${d.owned.oid} and relkind in('r','p');`));
 const fingerprint=names=>run('facts',`select ${outageNativeFingerprintSql(names)};`);
 const definitions=()=>run('definitions',`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text) from pg_proc p where p.pronamespace=${d.owned.oid} and p.prokind='f';`);
 const catalog=()=>run('catalog',`select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,
  (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
  (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.oid) from pg_class c where c.relnamespace=${d.owned.oid} and c.relkind in('r','p');`);
 const archiveBytes=async label=>{assert(['155','207'].includes(label));assert(archives.length<8);archives.push(label);return periodContinuationArchiveBytes(await(label==='155'?archive:periodArchive)());};
 const functions=(oids,replaced)=>run('unaffected_functions',`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text) from pg_proc where oid=any(${quote(oids)}::oid[]) and oid<>all(${quote(replaced)}::oid[]) and prokind='f';`);
 const metadata=replaced=>run('forward_metadata',`select jsonb_agg(jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0)) order by oid)::text from pg_proc p where oid=any(${quote(replaced)}::oid[]) and pronamespace=${d.owned.oid};`);
 return Object.freeze({run,install,inventory,fingerprint,definitions,catalog,archiveBytes,functions,metadata,
  summary:()=>({group:'installation_catalog_all_facts_archives',protectionQueries:dispatches.length,dispatches:[...dispatches],archiveCallbacks:archives.length,
   archiveInternalTransportCount:'opaque_parent_callback_not_claimed',businessRpcCalls:0,pidObserverQueries:0})});
}

export function operationalCycleNativeOptions(options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'cycle_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'cycle_native_business_cases_invalid');return Object.freeze({businessCases});
}
export async function installAndVerifyOperationalCycleNative(ctx,options={}){
 const {businessCases}=operationalCycleNativeOptions(options);
 const audit=createOperationalCycleNativeProtection(ctx),{d,native,scope}=ctx;
 assert.deepEqual(assertLifecycleSandbox(sql=>audit.run('owned_schema',sql)),d.owned);
 const file=path.join(native.root,'scripts/supabase-migrations',operationalCycleNativeMigration),body=readFileSync(file,'utf8');
 assert.equal(createHash('sha256').update(body).digest('hex').toUpperCase(),operationalCycleNativeSha,'cycle_frozen_migration_SHA');
 const manifest=cycleInstallationManifest(native.root,body.replaceAll('\r\n','\n'));
 assert.deepEqual(JSON.parse(audit.run('prerequisite_registry',`select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]') from public.faolla_schema_migrations where version in(202610080195,202610080197,202610080198);`)),operationalCycleNativePrerequisites);
 const mismatches=JSON.parse(audit.run('dependency_diagnostic',operationalCycleNativeDependencyDiagnosticSql(manifest,scope.schema)));
 assert.deepEqual(mismatches,[],`cycle_exact_dependency_mismatch:${JSON.stringify(mismatches)}`);
 const oldTables=audit.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=audit.fingerprint(oldTables);
 const archive155=await audit.archiveBytes('155'),archive207=await audit.archiveBytes('207');
 const oldOids=audit.run('old_function_oids',`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const replaced=audit.run('approved_function_oids',`select array_agg(to_regprocedure('public.'||(r->>'name')||'('||(r->>'types')||')')::oid order by r->>'name')::text from jsonb_array_elements(${json(manifest.forward)}) r;`);
 const unaffected=audit.functions(oldOids,replaced),metadata=audit.metadata(replaced);assert.equal(JSON.parse(metadata).length,5);
 audit.install(body);assert.equal(audit.fingerprint(oldTables),oldFacts);assert.equal(audit.functions(oldOids,replaced),unaffected);assert.equal(audit.metadata(replaced),metadata);
 const names=audit.inventory();assert.deepEqual(names.filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),manifest.tables.map(t=>t.name).sort());
 const installed=audit.fingerprint(names),definitions=audit.definitions(),catalog=audit.catalog();
 audit.install(body);assert.equal(audit.fingerprint(names),installed);assert.equal(audit.definitions(),definitions);assertAttendanceNativeCatalogEqual(audit.catalog(),catalog,'cycle200_reentry_catalog');
 assert.equal(audit.functions(oldOids,replaced),unaffected);assert.equal(audit.metadata(replaced),metadata);
 native.pass('200 install/reentry: four private sidecars, four public forwards and one private delegated-source profile forward, current197 capture retained; all old facts/OID/ACL preserved');
 let acceptance=null;
 try{
  if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-cycle-native.mjs')).verifyOperationalCycleNative({...ctx,cycleAudit:audit});
  else assert.equal(audit.fingerprint(names),installed,'cycle_skip_installed_facts_changed');
 }
 finally{
  assert.equal(audit.definitions(),definitions);assertAttendanceNativeCatalogEqual(audit.catalog(),catalog,'cycle200_final_catalog');assert.equal(audit.functions(oldOids,replaced),unaffected);assert.equal(audit.metadata(replaced),metadata);
  assert.deepEqual(await audit.archiveBytes('155'),archive155);assert.deepEqual(await audit.archiveBytes('207'),archive207);
 }
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.steps<=180);assert.equal(acceptance.oldFactsUnchanged,true);}
 return{phase:200,acceptance,businessCasesExecuted:businessCases==='run',protection:audit.summary(),installAndReentry:true,newTables:4,newFunctions:20,approvedOldBodies:5,
  oldFactsUnchanged:true,oldArchivesUnchanged:true,newCluster:false,browser:false,realAuth:false,kdf:false,productionAccess:false,deployed:false,cleanupOwnedByParent:true};
}
