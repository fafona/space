// Inert, local-fresh-PG-only mechanism acceptance. This does NOT install the149
// original migration bodies, create a cluster/role/database, contact a server,
// emit a compatibility/ready receipt, or replace full fresh052→210 acceptance.
// Root supplies bounded stdin-psql transports for one newly owned fixture DB.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 loadAttendanceProductionScope,protectedAttendanceMigrationSql,attendanceLegacyRowFingerprintSql,
 attendanceProtectedMultiphaseMigrations,attendanceProductionIdentity,
} from './attendance-production-database-migrations.mjs';

const DATABASE='faolla_attendance_multiphase_fixture';
const MARKER=/^faolla-attendance-multiphase-20261010:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const TABLES=['merchants','merchant_enterprise_roles','merchant_enterprise_employees'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
function need(condition,code){if(!condition)throw Error(code);}
export function validateAttendanceMultiphaseNativeIdentity(identity){
 need(identity&&typeof identity==='object'&&!Array.isArray(identity),'attendance_phase_native_identity');
 assert.deepEqual(Object.keys(identity).sort(),['databaseName','databaseOid','systemIdentifier','serverVersionNum','port','marker'].sort());
 need(identity.databaseName===DATABASE&&/^[1-9][0-9]{0,9}$/.test(identity.databaseOid)&&identity.databaseOid!=='5','attendance_phase_native_database');
 need(/^[0-9]{10,24}$/.test(identity.systemIdentifier)&&identity.systemIdentifier!==attendanceProductionIdentity.systemIdentifier,'attendance_phase_native_system');
 need(/^15[0-9]{4}$/.test(identity.serverVersionNum)&&Number.isSafeInteger(identity.port)&&identity.port>=1024&&identity.port<=65535&&MARKER.test(identity.marker),'attendance_phase_native_connection');
 return identity;
}
function identityGuard(identity){return `do $attendance_phase_native_identity$ begin
 if current_database()<>'${DATABASE}' or current_user<>'supabase_admin' or session_user<>'postgres'
 or (select oid::text from pg_database where datname=current_database())<>'${identity.databaseOid}'
 or (select pg_get_userbyid(datdba) from pg_database where datname=current_database())<>'supabase_admin'
 or (select shobj_description(oid,'pg_database') from pg_database where datname=current_database()) is distinct from '${identity.marker}'
 or (select system_identifier::text from pg_control_system())<>'${identity.systemIdentifier}'
 or current_setting('server_version_num')<>'${identity.serverVersionNum}'
 or host(inet_server_addr()) is distinct from '127.0.0.1' or inet_server_port() is distinct from ${identity.port}
 then raise exception 'attendance_phase_native_identity_changed';end if;
end;$attendance_phase_native_identity$;\n`;}

// Extract ONLY our generated, fixed wrapper tags. The real source buffer and
// its exact transaction/index offsets are checked by the production generator.
// No original function/DO body is parsed or executed as a fixture phase body.
export function attendanceMultiphaseNativePieces(migration,prior,manifest){
 const plan=attendanceProtectedMultiphaseMigrations.find(item=>item.fileName===migration.fileName);
 need(plan,'attendance_phase_native_not_multiphase');
 const wrapped=protectedAttendanceMigrationSql(migration,prior,manifest);
 const entries=[...wrapped.matchAll(/\nset transaction isolation level repeatable read;\n[\s\S]*?\nupdate pg_temp\.faolla_attendance_protected_rows_guard set v=case k [^\n]* end;\n/g)].map(match=>match[0]);
 const exits=[...wrapped.matchAll(/\ndo \$attendance_production_poststate\$ begin\n[\s\S]*?\nend;\$attendance_production_poststate\$;\n/g)].map(match=>match[0]);
 need(entries.length===plan.transactions.length&&exits.length===plan.transactions.length,'attendance_phase_native_wrapper_shape');
 let removed=wrapped;for(let i=0;i<entries.length;i++)removed=removed.replace(entries[i],'').replace(exits[i],'');
 need(removed===migration.source,'attendance_phase_native_original_bytes');
 return {plan,wrapped,entries,exits,gaps:plan.transactions.slice(0,-1).map((transaction,i)=>migration.source.slice(transaction.commit+7,plan.transactions[i+1].begin))};
}
export function attendanceMultiphaseNativeIndexNames(sources){return attendanceProtectedMultiphaseMigrations.flatMap(plan=>{
 const migration=sources.find(source=>source.fileName===plan.fileName);
 need(migration&&sha(migration.source)===plan.sha256,'attendance_phase_native_source_pin');
 return plan.concurrentIndexes.map(({start,end})=>{
  const name=migration.source.slice(start,end).match(/^create index concurrently if not exists ([a-z0-9_]+)\s+/)?.[1];
  need(name,'attendance_phase_native_index_name');return name;
 });
}).sort();}
const fixtureDdl=`begin;
create table public.faolla_schema_migrations(version bigint primary key,name text not null);
${TABLES.map(table=>`create table public.${table}(id text,note text);`).join('\n')}
create table public.attendance_phase_native_commits(version text not null,phase int not null,primary key(version,phase));
create table public.merchant_attendance_schedule_slots(merchant_id text,revision bigint,id text);
create table public.merchant_attendance_shift_schedule_relations(merchant_id text,slot_id text,start_event_id text);
create table public.merchant_attendance_correction_entries(merchant_id text,worker_id text,proposal jsonb,request_id text,action text);
create table public.merchant_attendance_revision_requests(merchant_id text,worker_id text,command jsonb,request_id text,action text);
create function public.faolla_attendance_instant_v1(text) returns text language sql immutable as $$ select $1 $$;
create table public.merchant_attendance_missing_requests(merchant_id text,worker_id text,employee_id text,actor_auth_user_id text,location_id text,submitted_at timestamptz,request_id text);
${['correction','missing','application'].map(type=>`create table public.merchant_attendance_${type}_delegations(merchant_id text,worker_id text,employee_id text,employee_auth_user_id text,delegate_employee_id text,delegate_auth_user_id text,grant_id text${type==='application'?',category text':''});`).join('\n')}
commit;\n`;
function fixtureSeed(manifest,prior){
 const rows=JSON.stringify([...manifest.baseline,...manifest.migrations.slice(0,prior).map(({version,name})=>({version,name}))]).replaceAll("'","''");
 return `begin;truncate public.faolla_schema_migrations,public.attendance_phase_native_commits,${TABLES.map(table=>'public.'+table).join(',')};
 insert into public.faolla_schema_migrations select version::bigint,name from jsonb_to_recordset('${rows}'::jsonb) r(version text,name text);
 ${TABLES.map(table=>`insert into public.${table}(id,note) values ('duplicate','synthetic'),('duplicate','synthetic'),('nullable',null);`).join('\n')}
 commit;\n`;
}
function fixtureBody(migration,phase,final,{register=final,addColumn=false,mutation=''}={}){return `
insert into public.attendance_phase_native_commits values ('${migration.version}',${phase});
${addColumn?`alter table public.merchants add column phase_${migration.version}_${phase} integer default 7;`:''}
${register?`insert into public.faolla_schema_migrations(version,name) values (${migration.version},'${migration.name}');`:''}
${mutation}\n`;}
function phaseSql(migration,pieces,phase,options){return 'begin;'+pieces.entries[phase]+fixtureBody(migration,phase,phase===pieces.entries.length-1,options)+pieces.exits[phase]+'commit;\n';}
function snapshotSql(){return `begin read only;
select jsonb_build_object(
 'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations),
 'rows',jsonb_build_object(${TABLES.map(table=>`'${table}',${attendanceLegacyRowFingerprintSql(table)}`).join(',')}),
 'columns',jsonb_build_object(${TABLES.map(table=>`'${table}',(select jsonb_agg(jsonb_build_array(attname,atttypid::text,atttypmod,attcollation::text) order by attnum) from pg_attribute where attrelid='public.${table}'::regclass and attnum>0 and not attisdropped)`).join(',')}),
 'commits',(select coalesce(jsonb_agg(jsonb_build_array(version,phase) order by version,phase),'[]'::jsonb) from public.attendance_phase_native_commits),
 'tempAbsent',to_regclass('pg_temp.faolla_attendance_protected_rows_guard') is null,
 'xactLockAbsent',not exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and classid=20260731 and objid=1 and objsubid=2)
)::text;commit;\n`;}
export async function checkAttendanceProductionMultiphaseGuards({rootDir,identity,query,openConnection}){
 validateAttendanceMultiphaseNativeIdentity(identity);
 need(typeof rootDir==='string'&&typeof query==='function'&&typeof openConnection==='function','attendance_phase_native_transport');
 const scope=await loadAttendanceProductionScope({rootDir,rootOwned:false});
 const guard=identityGuard(identity),checks=[];let requests=0;
 const submit=async(source,{expectFailure=false,transport=query}={})=>{
  need(typeof source==='string'&&Buffer.byteLength(source)<600000&&++requests<=1000,'attendance_phase_native_request_bound');
  const result=await transport(guard+source,{expectFailure});
  need(result&&Number.isInteger(result.status)&&typeof result.stdout==='string'&&typeof result.stderr==='string'&&result.timedOut===false,'attendance_phase_native_result');
  need(Buffer.byteLength(result.stdout)<1000000&&Buffer.byteLength(result.stderr)<200000,'attendance_phase_native_output_bound');
  if(expectFailure)need(result.status!==0,'attendance_phase_native_expected_rejection');
  else need(result.status===0,'attendance_phase_native_query_failed:'+result.stderr.slice(-500));
  return result;
 };
 const json=async(source,options)=>JSON.parse((await submit(source,options)).stdout.trim());
 const initial=await json(`begin read only;select jsonb_build_object('relations',(select count(*) from pg_class where relnamespace='public'::regnamespace),'routines',(select count(*) from pg_proc where pronamespace='public'::regnamespace))::text;commit;\n`);
 assert.deepEqual(initial,{relations:0,routines:0},'attendance_phase_native_fresh_database_required');
 await submit(fixtureDdl);
 const snapshot=()=>json(snapshotSql());
 const equalSnapshot=(actual,expected)=>assert.deepEqual(actual,expected,'attendance_phase_native_failed_transaction_changed_facts');
 for(const plan of attendanceProtectedMultiphaseMigrations){
  const prior=scope.sources.findIndex(source=>source.fileName===plan.fileName),migration=scope.sources[prior],pieces=attendanceMultiphaseNativePieces(migration,prior,scope.manifest);
  const prefix=count=>plain([...scope.manifest.baseline,...scope.manifest.migrations.slice(0,count).map(({version,name})=>({version,name}))]);
  await submit(fixtureSeed(scope.manifest,prior));
  // Each original gap is submitted to stdin-psql OUTSIDE any wrapper BEGIN.
  // These are all eight original CONCURRENTLY statements, without rewriting.
  const positive=await openConnection('positive_'+migration.version);
  need(positive&&typeof positive.query==='function'&&typeof positive.close==='function','attendance_phase_native_connection_shape');
  try{
   const transport=positive.query.bind(positive);
   const positivePid=await json('select pg_backend_pid();\n',{transport});
   for(let phase=0;phase<pieces.entries.length;phase++){
    // Same backend for every phase/gap. The immediate post-COMMIT query on
    // that backend proves the temp guard and xact lock actually disappeared.
    const actual=await json(phaseSql(migration,pieces,phase,{addColumn:true})+snapshotSql(),{transport});
    assert.deepEqual(actual.registry,prefix(prior+(phase===pieces.entries.length-1?1:0)));
    assert.equal(actual.commits.length,phase+1);assert.equal(actual.tempAbsent,true);assert.equal(actual.xactLockAbsent,true);
    if(phase<pieces.gaps.length){
     await submit(pieces.gaps[phase],{transport});
     if(phase===0){
      const business=await openConnection('business_'+migration.version);
      need(business&&typeof business.query==='function'&&typeof business.close==='function','attendance_phase_native_connection_shape');
      try{
       const businessPid=await json("begin;update public.merchants set note='legitimate-between-phase';commit;select pg_backend_pid();\n",{transport:business.query.bind(business)});
       assert.notEqual(businessPid,positivePid,'attendance_phase_native_business_must_use_another_backend');
      }finally{await business.close();}
     }
    }
   }
  }finally{await positive.close();}
  checks.push({version:migration.version,check:'phase-commits-original-concurrent-indexes-and-business-gap',phases:pieces.entries.length});
  // Execute the same production entry/exit against controlled fixture bodies.
  // No failure is swallowed as success: actual PG must reject, the entire
  // current transaction must roll back, and earlier commits must remain exact.
  for(let phase=0;phase<pieces.entries.length;phase++){
   const final=phase===pieces.entries.length-1;
   const failures=[
    ...TABLES.map(table=>({name:'row-'+table,mutation:`update public.${table} set note='forbidden-within-phase';`,error:'attendance_production_legacy_rows_changed'})),
    {name:'duplicate-count',mutation:'delete from public.merchants where ctid=(select ctid from public.merchants where id=\'duplicate\' limit 1);',error:'attendance_production_legacy_rows_changed'},
    {name:'old-column',mutation:'alter table public.merchants drop column id;',error:'attendance_production_legacy_columns_changed'},
    {name:'registry-name',mutation:`update public.faolla_schema_migrations set name='forbidden' where version=${scope.manifest.baseline[0].version};`,error:'attendance_production_registry_changed'},
    {name:'registry-empty',mutation:'delete from public.faolla_schema_migrations;',error:final?'attendance_production_registration_missing':'attendance_production_registry_changed'},
    {name:'phase-registration',register:!final,error:final?'attendance_production_registration_missing':'attendance_production_registry_changed'},
    {name:'mid-phase-fault',mutation:"do $fault$ begin raise exception 'attendance_phase_native_injected_failure';end;$fault$;",error:'attendance_phase_native_injected_failure'},
   ];
   await submit(fixtureSeed(scope.manifest,prior));
   for(let earlier=0;earlier<phase;earlier++)await submit(phaseSql(migration,pieces,earlier));
   const before=await snapshot();assert.equal(before.commits.length,phase);
   for(const failure of failures){
    const result=await submit(phaseSql(migration,pieces,phase,failure),{expectFailure:true});
    need(result.stderr.includes(failure.error),'attendance_phase_native_wrong_rejection:'+failure.name+':'+result.stderr.slice(-500));
    equalSnapshot(await snapshot(),before);
    checks.push({version:migration.version,phase,check:failure.name});
   }
  }
  await submit(fixtureSeed(scope.manifest,prior));
  const before=await snapshot();
  const owner=await submit('set role postgres;'+phaseSql(migration,pieces,0),{expectFailure:true});
  need(owner.stderr.includes('attendance_production_lock_or_owner'),'attendance_phase_native_owner_not_rejected');
  equalSnapshot(await snapshot(),before);
  const holder=await openConnection('lock_'+migration.version);
  need(holder&&typeof holder.query==='function'&&typeof holder.close==='function','attendance_phase_native_connection_shape');
  try{
   await submit('begin;select pg_advisory_xact_lock(20260731,1);\n',{transport:holder.query.bind(holder)});
   const locked=await submit(phaseSql(migration,pieces,0),{expectFailure:true});
   need(locked.stderr.includes('attendance_production_lock_or_owner'),'attendance_phase_native_busy_lock_not_rejected');
   equalSnapshot(await snapshot(),before);
  }finally{await holder.close();}
  await submit(`begin;update public.faolla_schema_migrations set name='entry-drift' where version=${scope.manifest.baseline[0].version};commit;\n`);
  const drifted=await snapshot();
  const entry=await submit(phaseSql(migration,pieces,0),{expectFailure:true});
  need(entry.stderr.includes('attendance_production_registry_changed'),'attendance_phase_native_entry_registry_not_rejected');
  equalSnapshot(await snapshot(),drifted);
  await submit('begin;delete from public.faolla_schema_migrations;commit;\n');
  const empty=await snapshot();assert.equal(empty.registry,null);
  const emptyEntry=await submit(phaseSql(migration,pieces,0),{expectFailure:true});
  need(emptyEntry.stderr.includes('attendance_production_registry_changed'),'attendance_phase_native_empty_entry_registry_not_rejected');
  equalSnapshot(await snapshot(),empty);
  checks.push({version:migration.version,check:'owner-busy-xact-lock-and-entry-registry-rejected'});
 }
 const indexes=await json(`begin read only;select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'owner',pg_get_userbyid(c.relowner)) order by c.relname),'[]'::jsonb)::text from pg_index i join pg_class c on c.oid=i.indexrelid where c.relnamespace='public'::regnamespace and c.relname like 'attendance_%_idx';commit;\n`);
 const expectedIndexes=attendanceMultiphaseNativeIndexNames(scope.sources);
 assert.deepEqual(indexes.map(index=>index.name),expectedIndexes);assert.equal(indexes.length,8);
 for(const index of indexes)assert.deepEqual(index,{name:index.name,valid:true,ready:true,live:true,owner:'supabase_admin'});
 const proof={kind:'attendance-multiphase-real-pg-mechanism',databaseName:DATABASE,serverVersionNum:identity.serverVersionNum,
  sourceCount:8,transactionCount:19,originalConcurrentIndexCount:8,checks:checks.length,requests,
  transcriptSha256:sha(JSON.stringify(checks)),passed:true,full149CompatibilityProven:false,originalMigrationBodiesInstalled:false,
  productionAccess:false,rolesChanged:false,filesWritten:false,cleanupPerformed:false};
 return proof;
}
