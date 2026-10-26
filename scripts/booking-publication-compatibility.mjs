// Real PostgreSQL 15 compatibility evidence. Reads production METADATA only;
// writes only a fresh DB in the existing, owned, network-none pilot container.
// No test-only/checklist input can turn this runner into a successful receipt.
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {runMigrationCommand} from './apply-production-database-migrations.mjs';
import {attendanceProductionIdentity as production,loadAttendanceProductionScope} from './attendance-production-database-migrations.mjs';
import {validateAttendance052SchemaOnlySql,guardedAttendanceCompatibilitySourceSql,attendanceCompatibilityMetadataContractSql,
 attendanceCompatibilitySourceProbeSql} from './attendance-production-052-compatibility.mjs';
import {attendanceExtensionMetadataSnapshotSql,validateAttendanceExtensionMetadata,attendanceExtensionMetadataSupplement,
 attendanceGraphqlInitialSchemaAclSnapshotSql,validateAttendanceGraphqlInitialSchemaAclSnapshot} from './attendance-extension-metadata.mjs';
import {BOOKING_RELEASE_BASELINE} from './booking-publication-policy.mjs';
import {BOOKING_MIGRATIONS,bookingDatabaseStateSql,validateBookingDatabaseState,validateBookingRegistry,guardedBookingMigrationSql,assertBookingCompatibilityProof} from './booking-publication-database.mjs';

const image='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d';
const pilotRoot='/opt/faolla-attendance-pilot',owner='attendance-pilot-20261009';
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error('booking_compatibility_'+code);};
const same=(a,b,code)=>need(JSON.stringify(a)===JSON.stringify(b),code);
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
async function owned(file,{privateMode=false}={}){
 const info=await lstat(file);need(!info.isSymbolicLink()&&info.uid===0&&!(info.mode&(privateMode?0o077:0o022))&&await realpath(file)===file,'ownership');return info;
}
async function privateWrite(file,value){await writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
export function bookingCompatibilityInvocation({target,baseline,rootDir,operation}){
 need(/^[a-f0-9]{40}$/.test(target??'')&&baseline===BOOKING_RELEASE_BASELINE&&rootDir===`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`&&operation===`/var/lib/faolla-online-release/${target}`,'invocation');
 return 'faolla_booking_compat_'+target.slice(0,12);
}
export function bookingCompatibilityRollbackMetadataSql(database){
 need(/^faolla_booking_compat_[a-f0-9]{12}$/.test(database),'database_name');
 // Test database ONLY. Remove precisely this migration's new objects INSIDE A
 // ROLLED BACK transaction, then compare the entire original metadata contract.
 // This catches changes to old objects without broadly excluding old catalogs.
 const contract=attendanceCompatibilityMetadataContractSql().replace('begin read only;','').replace(/commit;\s*$/,'');
 return guardedBookingCloneSql(`begin;
do $booking_clone_only$ declare p record;begin
 if exists(select 1 from public.faolla_booking_atomic_control where active) then raise exception 'booking_clone_must_be_inactive';end if;
 for p in select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and proname like 'faolla_booking_%' loop
  if to_regprocedure(p.signature) is not null then execute 'drop function '||p.signature||' cascade';end if;
 end loop;
end;$booking_clone_only$;
drop table public.faolla_booking_mail_jobs,public.faolla_booking_atomic_commands,public.faolla_booking_atomic_control;
${contract}
rollback;
`,database);
}
export function guardedBookingCloneSql(source,database){
 need(/^faolla_booking_compat_[a-f0-9]{12}$/.test(database),'database_name');
 need(source.startsWith('begin;')&&/(commit|rollback);\s*$/.test(source),'transaction_required');
 const rollback=/rollback;\s*$/.test(source);
 const formatted=source.replace(/^begin;/,'begin;\n').replace(/(?:commit|rollback);\s*$/,'\ncommit;\n');
 const guarded=guardedAttendanceCompatibilitySourceSql(formatted,database);
 return rollback?guarded.replace(/commit;\s*$/,'rollback;\n'):guarded;
}
export function bookingCompatibilityLegacyProbeSql(){return `begin;set local statement_timeout='8s';
set local role service_role;
do $legacy_probe$ declare v jsonb;begin
 select blocks into strict v from public.pages where slug='__merchant_booking_records__:v1';
 update public.pages set blocks=jsonb_set(blocks,'{compatibilityProbe}','true'::jsonb) where slug='__merchant_booking_records__:v1';
 if not exists(select 1 from public.pages where slug='__merchant_booking_records__:v1' and blocks->'compatibilityProbe'='true'::jsonb) then raise exception 'booking_legacy_write_failed';end if;
 update public.pages set blocks=v where slug='__merchant_booking_records__:v1';
end;$legacy_probe$;
reset role;
do $inactive_probe$ begin
 if exists(select 1 from public.faolla_booking_atomic_control where active) then raise exception 'booking_unexpected_activation';end if;
 if exists(select 1 from public.faolla_booking_atomic_commands) or exists(select 1 from public.faolla_booking_mail_jobs) then raise exception 'booking_unexpected_job';end if;
end;$inactive_probe$;
rollback;`;}
export async function runBookingCompatibility(input){
 const database=bookingCompatibilityInvocation(input),{target,baseline,rootDir,operation}=input;
 need(process.platform==='linux'&&process.getuid?.()===0,'linux_root_required');
 for(let current=operation;;current=path.dirname(current)){await owned(current,{privateMode:current===operation});if(path.dirname(current)===current)break;}
 await owned(pilotRoot);await owned(pilotRoot+'/.pilot-owner.json');
 const marker=JSON.parse(await readFile(pilotRoot+'/.pilot-owner.json','utf8'));
 need(marker.owner===owner&&marker.root===pilotRoot&&marker.project==='faolla-attendance-pilot','pilot_owner');
 const run=input.runCommand??runMigrationCommand;
 const command=async(args,sql,limit=16000000)=>{const r=await run('docker',['--host','unix:///var/run/docker.sock',...args],{input:sql,timeoutMs:150000,outputLimitBytes:limit});need(r.status===0&&!r.timedOut,'command_unconfirmed');return String(r.stdout??'');};
 const inspect=async id=>JSON.parse(await command(['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"privileged":{{json .HostConfig.Privileged}},"mounts":{{json .Mounts}},"running":{{json .State.Running}}}',id]));
 const pilot=await inspect('faolla-attendance-pilot-db');
 need(/^[a-f0-9]{64}$/.test(pilot.id)&&pilot.id!==production.containerId&&pilot.name==='/faolla-attendance-pilot-db'&&pilot.image===image&&pilot.running===true&&pilot.network==='none'&&pilot.privileged===false&&!Object.keys(pilot.ports??{}).length,'pilot_identity');
 need(pilot.labels?.['com.docker.compose.project']==='faolla-attendance-pilot'&&pilot.labels?.['io.faolla.isolated-pilot']===owner&&pilot.mounts?.length>0&&pilot.mounts.every(m=>m.Type==='bind'&&m.Source.startsWith(pilotRoot+'/')&&!m.Source.includes('/../'))&&pilot.mounts.some(m=>m.Source===pilotRoot+'/runtime/db/data'&&m.RW===true),'pilot_mounts');
 const formal=await inspect(production.containerId);
 need(formal.id===production.containerId&&formal.name==='/supabase-db'&&formal.image===image&&formal.running===true&&formal.mounts.some(m=>m.Type==='bind'&&m.Source===production.dataSource&&m.RW===true),'production_identity');
 const query=async(id,db,sql,json=false)=>{
  need(id===production.containerId&&db==='postgres'||id===pilot.id&&(db==='postgres'||db===database),'query_target');
  if(id===production.containerId)need(/^begin read only;/i.test(sql.trim())||sql.startsWith('-- attendance_'),'production_read_only');
  const value=(await command(['exec','-i',id,'sh','-lc',`set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; export PGOPTIONS='-c lock_timeout=3s -c statement_timeout=120000 -c idle_in_transaction_session_timeout=15000'; exec psql -h 127.0.0.1 -U supabase_admin -d ${db} --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate`],sql)).trim();
  return json?JSON.parse(value):value;
 };
 const {manifest}=await loadAttendanceProductionScope({rootDir});
 const state=()=>query(production.containerId,'postgres',bookingDatabaseStateSql,true);
 const before=validateBookingDatabaseState(await state(),manifest);
 const contractSql=attendanceCompatibilityMetadataContractSql();
 const formalContract=await query(production.containerId,'postgres',contractSql,true);
 const extensions=await query(production.containerId,'postgres',attendanceExtensionMetadataSnapshotSql(),true);validateAttendanceExtensionMetadata(extensions);
 const schemaAcl=await query(production.containerId,'postgres',attendanceGraphqlInitialSchemaAclSnapshotSql(),true);validateAttendanceGraphqlInitialSchemaAclSnapshot(schemaAcl);
 const pilotBefore=await query(pilot.id,'postgres',attendanceCompatibilitySourceProbeSql(database),true);
 need(pilotBefore.databaseName==='postgres'&&pilotBefore.databaseOid==='5'&&pilotBefore.currentUser==='supabase_admin'&&pilotBefore.serverVersionNum===production.serverVersionNum&&pilotBefore.systemIdentifier!==production.systemIdentifier&&pilotBefore.adminSuperuser===true&&pilotBefore.postgresSuperuser===false&&pilotBefore.legacyAdminEdge===false&&pilotBefore.existingCompatibilityDatabase===false,'pilot_prestate');
 for(const field of ['authUsers','merchants','staff','storageObjects'])need(pilotBefore[field]===0,'pilot_not_empty');
 const sources=await Promise.all(BOOKING_MIGRATIONS.map(m=>readFile(path.join(rootDir,'scripts/supabase-migrations',m.fileName),'utf8')));
 const migrationSql=guardedBookingMigrationSql(sources),sourceSha256=sources.map(hash);
 const dump=await command(['exec',production.containerId,'sh','-lc','set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; export PGOPTIONS="-c default_transaction_read_only=on -c lock_timeout=3s -c statement_timeout=120000"; exec pg_dump -h 127.0.0.1 -U supabase_admin -d postgres --schema-only --no-comments --no-security-labels --no-publications --no-subscriptions']);
 const metadata=validateAttendance052SchemaOnlySql(dump);
 const supplement=attendanceExtensionMetadataSupplement(metadata.sql,extensions,{restoreGraphqlInitialAcl:true,restoreGraphqlInitialSchemaAcl:true},schemaAcl);
 same(await query(production.containerId,'postgres',contractSql,true),formalContract,'production_drift_during_dump');
 const attempt={schemaVersion:1,target,baseline,database,pilotId:pilot.id,pilotSystemIdentifier:pilotBefore.systemIdentifier,sourceSha256,productionDataCopied:false,metadataSha256:hash(dump),contractSha256:formalContract,startedAt:new Date().toISOString()};
 await privateWrite(operation+'/booking-compatibility-attempt.json',attempt);
 await privateWrite(operation+'/booking-compatibility-metadata.sql',dump);
 await privateWrite(operation+'/booking-compatibility-extension.json',{extensions,schemaAcl,operations:supplement.operations});
 await privateWrite(operation+'/booking-compatibility-supplement.sql',supplement.supplementSql);
 // Only this checked unique CREATE may target pilot postgres. No existing DB
 // is rebuilt, repaired, dropped, or seeded with production data or globals.
 await query(pilot.id,'postgres',`create database "${database}" with template template0 owner supabase_admin;`);
 const exec=sql=>query(pilot.id,database,guardedBookingCloneSql(sql,database));
 await exec('begin;\n'+supplement.sql+'\ncommit;\n');
 same(await query(pilot.id,database,contractSql,true),formalContract,'clone_metadata_mismatch');
 const emptyProbe=await query(pilot.id,database,attendanceCompatibilitySourceProbeSql(database),true);
 for(const field of ['authUsers','merchants','staff','storageObjects'])need(emptyProbe[field]===0,'clone_not_empty');
 need(await query(pilot.id,database,"begin read only;select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'faolla_booking_%';rollback;")==='0','booking_objects_preexist');
 await exec(`begin;insert into public.faolla_schema_migrations(version,name) values ${before.registry.map(r=>`(${r.version},${literal(r.name)})`).join(',')};commit;`);
 const fixtures=`begin;insert into public.pages(merchant_id,slug,blocks) values
 ('__faolla_booking_persistence__','__merchant_booking_records__:v1','{"version":1,"records":[]}'::jsonb),
 ('__faolla_booking_persistence__','__merchant_booking_rules__:v1','{"version":1,"snapshots":[]}'::jsonb),
 ('__faolla_booking_persistence__','__merchant_booking_workbench__:v1','{"version":1,"settingsBySiteId":{}}'::jsonb);commit;`;
 await exec(fixtures);
 const savedSql="begin read only;select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) order by slug)::text,''),'UTF8')),'hex') from public.pages p;rollback;";
 const savedBefore=await query(pilot.id,database,savedSql);
 await exec(migrationSql);
 const installed=await query(pilot.id,database,bookingDatabaseStateSql,true);
 validateBookingRegistry(installed,manifest,{installed:true});
 need(installed.databaseName===database&&installed.databaseOid!==production.databaseOid&&installed.systemIdentifier===pilotBefore.systemIdentifier&&installed.currentUser==='supabase_admin'&&installed.pagesOwner==='supabase_admin'&&installed.serverVersionNum===production.serverVersionNum,'clone_runtime_identity');
 await exec(bookingCompatibilityLegacyProbeSql());
 same(await query(pilot.id,database,savedSql),savedBefore,'synthetic_saved_rows_changed');
 same(JSON.parse(await query(pilot.id,database,bookingCompatibilityRollbackMetadataSql(database))),formalContract,'outside_metadata_changed');
 // Rollback metadata probe must leave the installed private schema intact.
 need(await query(pilot.id,database,'begin read only;select count(*)=1 and bool_and(not active and protocol=2) from public.faolla_booking_atomic_control;rollback;')==='t','not_inactive');
 const aclSql=`begin read only;select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'anonymous',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname),'[]'::jsonb) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'faolla_booking_%';rollback;`;
 const acls=await query(pilot.id,database,aclSql,true);
 const callable=new Set(['faolla_booking_atomic_snapshot_v1','faolla_booking_atomic_read_v2','faolla_booking_atomic_commit_v1','faolla_booking_command_result_v2','faolla_booking_mail_claim_v1','faolla_booking_mail_settle_v2','faolla_booking_mail_states_v2']);
 need(acls.length===11&&acls.every(r=>r.owner==='supabase_admin'&&r.definer===true&&!r.anonymous&&!r.authenticated&&r.service===callable.has(r.name)),'rpc_acls');
 const pilotAfter=await query(pilot.id,'postgres',attendanceCompatibilitySourceProbeSql(database),true);
 for(const key of ['rolesSha256','catalogSha256','systemIdentifier'])same(pilotAfter[key],pilotBefore[key],'existing_pilot_changed');
 const formalAfter=validateBookingDatabaseState(await state(),manifest);
 same(formalAfter.registry,before.registry,'production_registry_changed');
 same(await query(production.containerId,'postgres',contractSql,true),formalContract,'production_metadata_changed');
 // Business rows may legitimately change while compatibility checks run. We
 // never compare them as an immutable snapshot or copy them into this DB.
 const evidence={...attempt,installed:{databaseName:installed.databaseName,databaseOid:installed.databaseOid,systemIdentifier:installed.systemIdentifier,registry:installed.registry},savedBefore,savedAfter:await query(pilot.id,database,savedSql),acls,productionRegistryUnchanged:true,productionMetadataSha256After:formalContract,pilotCatalogUnchanged:true,completedAt:new Date().toISOString()};
 const evidenceText=JSON.stringify(evidence,null,2)+'\n';await privateWrite(operation+'/booking-compatibility-evidence.json',evidenceText);
 const checks=Object.fromEntries(['actualProductionMetadataClone','metadataOnlyNoBusinessRows','postgres15ExactImage','originalSourcesInOneTransaction','inactiveAfterInstall','legacyBookingWriteStillWorks','privateTablesAndRpcAcls','outsideBookingMetadataUnchanged','productionUnchanged'].map(k=>[k,true]));
 const proof={schemaVersion:1,target,baseline,sourceSha256,databaseSystemIdentifier:production.systemIdentifier,serverVersionNum:production.serverVersionNum,checks,evidenceSha256:hash(evidenceText),completedAt:evidence.completedAt};
 assertBookingCompatibilityProof(proof,{target,baseline,sourceSha256});await privateWrite(operation+'/booking-compatibility.json',proof);return proof;
}
