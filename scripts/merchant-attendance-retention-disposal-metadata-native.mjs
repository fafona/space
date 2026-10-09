// Inert, finite metadata diagnostic only. All subject/parent tables are TEMP
// skeletons, not installed business tables. No source/command/writer is called.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';

export const retentionDisposalMetadataLimits=Object.freeze({topLevelStatements:14,callbackMs:15000,newClusters:0,newDatabases:0,businessRows:0});
export const retentionDisposalCatalogLimits=Object.freeze({topLevelStatements:8,callbackMs:10000,newClusters:0,newDatabases:0,businessRows:0});
export const retentionDisposalConstraintOrderLimits=Object.freeze({topLevelStatements:10,callbackMs:10000,newClusters:0,newDatabases:0,businessRows:0});
export const retentionDisposalConstraintComparisonLimits=Object.freeze({topLevelStatements:12,callbackMs:10000,newClusters:0,newDatabases:0,businessRows:0});
export function retentionDisposalConstraintOrderDiagnostic(){
 const statements=['begin;',
  'create temporary table rd197_order_artifact(id integer primary key);',
  'create temporary table rd197_order_coverage(id integer primary key);',
  'create temporary table rd197_order_refs(id integer primary key references pg_temp.rd197_order_coverage(id));',
  `create function pg_temp.rd197_order_capture() returns trigger language plpgsql set search_path=pg_catalog as $rd197_order_capture$
   begin insert into pg_temp.rd197_order_coverage values(new.id);insert into pg_temp.rd197_order_refs values(new.id);return new;end;$rd197_order_capture$;`,
  `create function pg_temp.rd197_order_proof() returns trigger language plpgsql set search_path=pg_catalog as $rd197_order_proof$
   begin if not exists(select 1 from pg_temp.rd197_order_refs where id=new.id) then raise exception 'rd197_proof_before_refs';end if;return new;end;$rd197_order_proof$;`,
  'create constraint trigger rd197_order_capture after insert on pg_temp.rd197_order_artifact deferrable initially deferred for each row execute function pg_temp.rd197_order_capture();',
  'create constraint trigger rd197_order_proof after insert on pg_temp.rd197_order_coverage deferrable initially deferred for each row execute function pg_temp.rd197_order_proof();',
  `do $rd197_order_check$ declare reproduced boolean:=false;begin
   begin insert into pg_temp.rd197_order_artifact values(1);set constraints all immediate;
   exception when raise_exception then if sqlstate='P0001' and sqlerrm='rd197_proof_before_refs' then reproduced:=true;else raise;end if;end;
   if not reproduced then raise exception 'rd197_constraint_order_not_reproduced';end if;
   if exists(select 1 from pg_temp.rd197_order_artifact) or exists(select 1 from pg_temp.rd197_order_coverage) or exists(select 1 from pg_temp.rd197_order_refs)
    then raise exception 'rd197_constraint_order_rollback_failed';end if;
  end;$rd197_order_check$;`,
  'rollback;'];
 assert.equal(statements.length,retentionDisposalConstraintOrderLimits.topLevelStatements);
 return Object.freeze({statements:Object.freeze(statements),sql:statements.join('\n')});
}
export async function runRetentionDisposalConstraintOrderNative(args){
 return runAttendanceLabelsReuse(args,async native=>{
  const started=Date.now(),diagnostic=retentionDisposalConstraintOrderDiagnostic();native.query(diagnostic.sql);
  assert(Date.now()-started<retentionDisposalConstraintOrderLimits.callbackMs,'disposal_constraint_order_deadline');
  native.pass('197 constraint ordering only: SET CONSTRAINTS ALL IMMEDIATE fires coverage proof inside capture before refs insert; exact P0001 reproduced, nested rollback leaves all three TEMP tables empty');
  console.log(JSON.stringify({phase:'197_constraint_order_only',actualSql:true,actualBusiness:false,syntheticTriggerShapeOnly:true,
   oldOrderErrorReproduced:true,zeroResidualTempRows:true,topLevelStatements:diagnostic.statements.length,callbackMs:Date.now()-started,
   newCluster:false,newDatabase:false,businessRows:0}));
 });
}
export function retentionDisposalConstraintComparisonDiagnostic(){
 const statements=[...retentionDisposalConstraintOrderDiagnostic().statements.slice(0,-1),
  `create or replace function pg_temp.rd197_order_capture() returns trigger language plpgsql set search_path=pg_catalog as $rd197_order_capture$
   begin with inserted_coverage as(insert into pg_temp.rd197_order_coverage values(new.id) returning id)
    insert into pg_temp.rd197_order_refs select id from inserted_coverage;return new;end;$rd197_order_capture$;`,
  `do $rd197_order_cte_check$ declare forged_rejected boolean:=false;begin
   insert into pg_temp.rd197_order_artifact values(2);set constraints all immediate;
   if (select count(*) from pg_temp.rd197_order_artifact)<>1 or (select count(*) from pg_temp.rd197_order_coverage)<>1 or (select count(*) from pg_temp.rd197_order_refs)<>1
    or not exists(select 1 from pg_temp.rd197_order_artifact a join pg_temp.rd197_order_coverage c using(id) join pg_temp.rd197_order_refs r using(id) where a.id=2)
    then raise exception 'rd197_cte_complete_refs_failed';end if;
   begin insert into pg_temp.rd197_order_coverage values(99);
   exception when raise_exception then if sqlstate='P0001' and sqlerrm='rd197_proof_before_refs' then forged_rejected:=true;else raise;end if;end;
   if not forged_rejected or exists(select 1 from pg_temp.rd197_order_coverage where id=99) or exists(select 1 from pg_temp.rd197_order_refs where id=99)
    then raise exception 'rd197_cte_forgery_guard_failed';end if;
  end;$rd197_order_cte_check$;`,
  'rollback;'];
 assert.equal(statements.length,retentionDisposalConstraintComparisonLimits.topLevelStatements);
 return Object.freeze({statements:Object.freeze(statements),sql:statements.join('\n')});
}
export async function runRetentionDisposalConstraintComparisonNative(args){
 return runAttendanceLabelsReuse(args,async native=>{
  const started=Date.now(),diagnostic=retentionDisposalConstraintComparisonDiagnostic();native.query(diagnostic.sql);
  assert(Date.now()-started<retentionDisposalConstraintComparisonLimits.callbackMs,'disposal_constraint_comparison_deadline');
  native.pass('197 constraint ordering only: old split INSERT fails, writable-CTE coverage+refs passes exact joins under ALL IMMEDIATE, standalone coverage still rejected; whole TEMP transaction rolled back');
  console.log(JSON.stringify({phase:'197_constraint_comparison_only',actualSql:true,actualBusiness:false,syntheticTriggerShapeOnly:true,
   oldOrderErrorReproduced:true,writableCteCompleteRefs:true,standaloneCoverageRejected:true,wholeTempTransactionRolledBack:true,
   topLevelStatements:diagnostic.statements.length,callbackMs:Date.now()-started,newCluster:false,newDatabase:false,businessRows:0}));
 });
}
export function retentionDisposalCatalogDiagnostic(body){
 const preview=body.match(/create or replace function public\.faolla_attendance_disposal_preview_v1\([\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];assert(preview);
 const lookup=preview.match(/ select catalog_namespace\.nspname into guard_namespace from pg_class catalog_table[^\n]+;/)?.[0];assert(lookup);
 assert.equal(lookup.split("'public.merchant_attendance_events'::regclass").length,2);
 const fixed=lookup.replace("'public.merchant_attendance_events'::regclass","'pg_temp.merchant_attendance_events'::regclass");
 const previous=fixed.replaceAll('catalog_namespace','n').replaceAll('catalog_table','c');
 const lookupFunction=(name,query)=>`create function pg_temp.${name}() returns text language plpgsql stable set search_path=pg_catalog as $rd197_lookup$
  declare c pg_temp.merchant_attendance_disposal_event_coverage%rowtype;n integer:=0;guard_namespace text;
  begin ${query} return guard_namespace;end;$rd197_lookup$;`;
 const statements=['begin;',
  'create temporary table merchant_attendance_events(id uuid primary key);',
  'create temporary table merchant_attendance_disposal_event_coverage(event_id uuid primary key);',
  lookupFunction('rd197_old_lookup',previous),lookupFunction('rd197_fixed_lookup',fixed),
  `do $rd197_lookup_check$ declare reproduced boolean:=false;expected_namespace text;actual_namespace text;
   begin
    begin perform pg_temp.rd197_old_lookup();exception when undefined_column then
     if sqlstate='42703' and sqlerrm='record "c" has no field "relnamespace"' then reproduced:=true;else raise;end if;
    end;
    if not reproduced then raise exception 'old_lookup_failure_not_reproduced';end if;
    select ns.nspname into expected_namespace from pg_class relation join pg_namespace ns on ns.oid=relation.relnamespace where relation.oid='pg_temp.merchant_attendance_events'::regclass;
    actual_namespace:=pg_temp.rd197_fixed_lookup();
    if actual_namespace is distinct from expected_namespace or actual_namespace is null then raise exception 'fixed_lookup_namespace_changed';end if;
   end;$rd197_lookup_check$;`,
  `select jsonb_build_object('oldSqlState','42703','oldError','record "c" has no field "relnamespace"','fixedMatchesCatalog',
    pg_temp.rd197_fixed_lookup()=(select ns.nspname from pg_class relation join pg_namespace ns on ns.oid=relation.relnamespace where relation.oid='pg_temp.merchant_attendance_events'::regclass),
    'subjectRows',(select count(*) from pg_temp.merchant_attendance_events)+(select count(*) from pg_temp.merchant_attendance_disposal_event_coverage));`,
  'rollback;'];
 assert.equal(statements.length,retentionDisposalCatalogLimits.topLevelStatements);
 return Object.freeze({statements:Object.freeze(statements),sql:statements.join('\n')});
}
export async function runRetentionDisposalCatalogNative(args){
 return runAttendanceLabelsReuse(args,async native=>{
  const started=Date.now(),body=readFileSync(path.join(native.root,'scripts/supabase-migrations/202610080197_merchant_attendance_retention_disposal.sql'),'utf8');
  const diagnostic=retentionDisposalCatalogDiagnostic(body),result=JSON.parse(native.query(diagnostic.sql));
  assert(Date.now()-started<retentionDisposalCatalogLimits.callbackMs,'disposal_catalog_deadline');
  assert.deepEqual(result,{oldSqlState:'42703',oldError:'record "c" has no field "relnamespace"',fixedMatchesCatalog:true,subjectRows:0});
  native.pass('197 catalog lookup only: old c record alias failure reproduced; fixed actual source lookup matches catalog namespace; zero business rows, TEMP functions rolled back');
  console.log(JSON.stringify({phase:'197_catalog_lookup_only',actualSql:true,actualBusiness:false,...result,
   topLevelStatements:diagnostic.statements.length,callbackMs:Date.now()-started,newCluster:false,newDatabase:false,businessRows:0}));
 });
}
const tables=[
 ['merchant_attendance_disposal_event_coverage',['event_id','merchant_id','worker_id'],'primary key(event_id),unique(merchant_id,event_id)'],
 ['merchant_attendance_disposal_artifact_coverage',['merchant_id','artifact_id'],'primary key(merchant_id,artifact_id)'],
 ['merchant_attendance_disposal_artifact_event_refs',['merchant_id','event_id','artifact_id'],'primary key(merchant_id,event_id,artifact_id)'],
 ['merchant_attendance_disposal_approvals',['merchant_id','operation_id','event_id'],'primary key(merchant_id,operation_id),unique(merchant_id,operation_id,event_id)'],
 ['merchant_attendance_disposal_executions',['merchant_id','operation_id','event_id','approval_operation_id'],'primary key(merchant_id,operation_id),unique(event_id),unique(merchant_id,approval_operation_id)'],
];
export function retentionDisposalMetadataDiagnostic(body){
 const manifest=body.match(/\$disposal_foreign_keys\$([\s\S]*?)\$disposal_foreign_keys\$/)?.[1];assert(manifest);
 const keys=JSON.parse(manifest);assert.equal(keys.length,8);
 const post=body.match(/do \$disposal_table_postconditions\$([\s\S]*?)\$disposal_table_postconditions\$;/)?.[1];assert(post);
 const check=post.slice(post.indexOf('  select jsonb_agg(jsonb_build_array(c.conname,'),post.indexOf("  foreach role_name in array array['anon'"));
 assert(check.includes("raise exception 'merchant_attendance_disposal_foreign_key_changed'"));
 const measured=body.match(/create temporary table disposal_location_check_probe\([\s\S]*?\) on commit drop;/)?.[0];assert(measured);
 const statements=['begin;',
  'create temporary table merchant_attendance_events(id uuid primary key);',
  'create temporary table merchant_attendance_workers(merchant_id text,id uuid,primary key(merchant_id,id));',
  'create temporary table merchant_attendance_settings(merchant_id text primary key);',
  'create temporary table merchant_attendance_period_artifacts(merchant_id text,artifact_id uuid,primary key(merchant_id,artifact_id));',
  ...tables.map(([table,columns,uniques])=>{
   const references=keys.filter(k=>k[0]===table).map(k=>{
    assert.equal(k.length,12);assert.deepEqual([k[5],k[7],k[8],k[9],k[10],k[11]],['a','s',true,true,false,false]);
    assert(['a','r'].includes(k[6]));for(const name of [k[0],k[1],k[3],...k[2],...k[4]])assert(/^[a-z_]+$/.test(name));
    return `constraint ${k[1]} foreign key(${k[2].join(',')}) references pg_temp.${k[3]}(${k[4].join(',')})${k[6]==='r'?' on delete restrict':''}`;
   });assert(references.length>0);
   return `create temporary table ${table}(${columns.map(c=>`${c} ${c==='merchant_id'?'text':'uuid'}`).join(',')},${uniques},${references.join(',')});`;
  }),measured,
  `do $rd197_metadata$ declare n text;t regclass;actual jsonb;expected jsonb;foreign_keys jsonb:=$rd197_manifest$${manifest}$rd197_manifest$::jsonb;begin
    foreach n in array array[${tables.map(t=>`'${t[0]}'`).join(',')}] loop
     t:=to_regclass('pg_temp.'||n);${check.replaceAll('public.','pg_temp.')}
    end loop;end;$rd197_metadata$;`,
  `select jsonb_build_object('foreignKeyCount',(select count(*) from pg_constraint where conrelid in(${tables.map(t=>`'pg_temp.${t[0]}'::regclass`).join(',')}) and contype='f'),
    'checkColumns',(select jsonb_object_agg(conname,array(select a.attname::text from unnest(c.conkey) k join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k order by a.attname))
     from pg_constraint c where conrelid='pg_temp.disposal_location_check_probe'::regclass),
    'subjectRows',${tables.map(t=>`(select count(*) from pg_temp.${t[0]})`).join('+')});`,
  'rollback;'];
 assert.equal(statements.length,retentionDisposalMetadataLimits.topLevelStatements);
 return Object.freeze({statements:Object.freeze(statements),sql:statements.join('\n')});
}
export async function runRetentionDisposalMetadataNative(args){
 return runAttendanceLabelsReuse(args,async native=>{
  const started=Date.now(),body=readFileSync(path.join(native.root,'scripts/supabase-migrations/202610080197_merchant_attendance_retention_disposal.sql'),'utf8');
  const diagnostic=retentionDisposalMetadataDiagnostic(body),result=JSON.parse(native.query(diagnostic.sql));
  assert(Date.now()-started<retentionDisposalMetadataLimits.callbackMs,'disposal_metadata_deadline');
  assert.deepEqual(result,{foreignKeyCount:8,subjectRows:0,checkColumns:{
   original_measured:['accuracy_meters','captured_at','distance_meters','reason'],
   disposed_measured:['accuracy_meters','captured_at','disposal_operation_id','distance_meters','needs_review','reason'],
  }});
  native.pass('197 metadata only: eight named TEMP-skeleton FK catalog tuples and actual measured CHECK parser; zero business rows, one transaction rolled back');
  console.log(JSON.stringify({phase:'197_metadata_only',actualSql:true,actualBusiness:false,subjectDdl:'minimal_foreign_key_shape_only',
   topLevelStatements:diagnostic.statements.length,callbackMs:Date.now()-started,newCluster:false,newDatabase:false,businessRows:0}));
 });
}
