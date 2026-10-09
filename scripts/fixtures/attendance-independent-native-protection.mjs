//196 local-only explicit protection dispatches. Every query has the original
//owned guard and one known native.query call. No hidden d.exec ownership query.
import assert from 'node:assert/strict';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';

export function createIndependentNativeProtection(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(scope.schema,d.owned.schema);
 assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);assert.equal(typeof d.guard,'string');
 const dispatches=[],archives=[];
 const run=(label,sql,{write=false}={})=>{
  assert.match(label,/^[a-z0-9_]+$/);assert(dispatches.length<64,'independent_max64_protection_dispatches');dispatches.push({label,write});
  return native.query(scope.sql(`begin${write?'':' read only'};${periodContinuationSerialization}${d.guard}set local lock_timeout='3s';set local statement_timeout='10s';${sql}commit;`));
 };
 const inventory=()=>JSON.parse(run('inventory',`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${d.owned.oid} and relkind in('r','p');`));
 const fingerprint=(names)=>run('facts',`select ${outageNativeFingerprintSql(names)};`);
 const definitions=()=>run('definitions',`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
  from pg_proc p where p.pronamespace=${d.owned.oid} and p.prokind='f';`);
 const catalog=()=>run('catalog',`select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,
  (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
  (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.oid)
  from pg_class c where c.relnamespace=${d.owned.oid} and c.relkind in('r','p');`);
 const archiveBytes=async(label)=>{
  assert(['155','207'].includes(label));assert(archives.length<8,'independent_max8_archive_callbacks');archives.push(label);
  //Frozen parent callbacks are not replaced. Their internal transport/statement
  //count is opaque and explicitly NOT included in protectionDispatches.
  return periodContinuationArchiveBytes(await(label==='155'?archive:periodArchive)());
 };
 const functions=(oldOids,replaced)=>run('unaffected_functions',`select md5(coalesce(jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef) order by oid),'[]')::text)
  from pg_proc where oid=any(${quote(oldOids)}::oid[]) and oid<>all(${quote(replaced)}::oid[]) and prokind='f';`);
 const metadata=replaced=>run('forward_metadata',`select jsonb_agg(jsonb_build_array(oid,to_jsonb(p)-array['prosrc','proargdefaults'],pg_get_expr(proargdefaults,0)) order by oid)::text
  from pg_proc p where oid=any(${quote(replaced)}::oid[]) and pronamespace=${d.owned.oid};`);
 return Object.freeze({run,inventory,fingerprint,definitions,catalog,archiveBytes,functions,metadata,
  summary:()=>({group:'installation_catalog_all_facts_archives',protectionDispatches:dispatches.length,dispatches:[...dispatches],archiveCallbacks:archives.length,
   archiveCallbackKinds:[...archives],archiveInternalTransportCount:'opaque_parent_callback_not_claimed',businessRpcCalls:0,pidObserverQueries:0})});
}
