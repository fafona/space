import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {runMigrationCommand,acquireProductionMigrationLock} from './apply-production-database-migrations.mjs';
import {attendanceProductionIdentity,loadAttendanceProductionScope,validateAttendanceRegistry,validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {BOOKING_RELEASE_BASELINE,BOOKING_SCOPE} from './booking-publication-policy.mjs';

const fail=code=>{throw Error('booking_publication_'+code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
export const BOOKING_MIGRATIONS=Object.freeze([
 {version:'202610250211',name:'booking_atomic_preparation',fileName:'202610250211_booking_atomic_preparation.sql'},
 {version:'202610250212',name:'booking_atomic_runtime',fileName:'202610250212_booking_atomic_runtime.sql'},
]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const BOOKING_PROTECTED_SLUGS=Object.freeze(['__merchant_booking_records__:v1','__merchant_booking_rules__:v1','__merchant_booking_workbench__:v1']
 .flatMap(slug=>[slug,slug+':backup']));
const sqlSlugs=BOOKING_PROTECTED_SLUGS.map(slug=>`'${slug}'`).join(',');
const fingerprint=`(select encode(sha256(convert_to(count(*)::text||':'||coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') from
 (select encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') h from public.pages p where slug in (${sqlSlugs})) saved)`;
export const bookingDatabaseStateSql=`begin read only;set local statement_timeout='8s';set local lock_timeout='2s';
select jsonb_build_object('databaseName',current_database(),'databaseOid',(select oid::text from pg_database where datname=current_database()),
 'systemIdentifier',(select system_identifier::text from pg_control_system()),'serverVersionNum',current_setting('server_version_num'),
 'currentUser',current_user,'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations),
 'pagesOwner',(select pg_get_userbyid(relowner) from pg_class where oid='public.pages'::regclass),
 'savedBookingRowsSha256',${fingerprint},
 'bookingTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('faolla_booking_atomic_control','faolla_booking_atomic_commands','faolla_booking_mail_jobs')));
rollback;`;
export function validateBookingDatabaseState(value,manifest,{installed=false}={}){
 for(const key of ['databaseName','databaseOid','systemIdentifier','serverVersionNum'])if(value?.[key]!==attendanceProductionIdentity[key])fail('database_identity_mismatch');
 if(value.currentUser!=='supabase_admin'||value.pagesOwner!=='supabase_admin'||!Array.isArray(value.registry)||!/^[a-f0-9]{64}$/.test(value.savedBookingRowsSha256))fail('database_state_invalid');
 validateBookingRegistry(value,manifest,{installed});return value;
}
export function validateBookingRegistry(value,manifest,{installed=false}={}){
 if(!Array.isArray(value?.registry))fail('database_registry_mismatch');
 const old=value.registry.filter(row=>row.version<'202610250211'),next=value.registry.filter(row=>row.version>='202610250211');
 if(old.length+next.length!==value.registry.length)fail('database_registry_mismatch');
 validateAttendanceRegistry(old,manifest,{complete:true});
 // PostgreSQL jsonb orders object keys independently of JS insertion order.
 // Only object property order is irrelevant; keys/types/values and array order
 // remain exact. Keep every other database/install guard unchanged.
 if(installed?!isDeepStrictEqual(next,BOOKING_MIGRATIONS.map(({version,name})=>({version,name})))||value.bookingTables!==3:next.length!==0||value.bookingTables!==0)fail('database_registry_mismatch');
}
export function guardedBookingMigrationSql(sources){
 if(!Array.isArray(sources)||sources.length!==2)fail('migration_scope_invalid');
 const bodies=sources.map((source,index)=>{
  const file='scripts/supabase-migrations/'+BOOKING_MIGRATIONS[index].fileName;
  if(typeof source!=='string'||hash(source)!==BOOKING_SCOPE.pins[file]||!source.startsWith('begin;\n')||!source.endsWith('commit;\n'))fail('migration_source_changed');
  return source.slice('begin;'.length,source.length-'commit;\n'.length);
 });
 // Fixed reviewed transaction delimiters only. The two ORIGINAL source bodies
 // execute verbatim in one transaction, retaining every guard and registry row.
 // A short lock blocks DML only while installing these inactive objects. No row
 // UPDATE/merge/backfill/repair, authority flip or dispatcher exists here.
 return `begin;set local lock_timeout='2s';set local statement_timeout='20s';
lock table public.pages,public.faolla_schema_migrations in share row exclusive mode;
create temporary table faolla_booking_install_saved on commit drop as select ${fingerprint} as digest;
${bodies.join('\n')}
do $booking_install_verify$ begin
 if ${fingerprint} is distinct from (select digest from pg_temp.faolla_booking_install_saved) then raise exception 'booking_install_saved_rows_changed';end if;
 if (select count(*) from public.faolla_booking_atomic_control)<>1 or exists(select 1 from public.faolla_booking_atomic_control where active or protocol<>2)
  or exists(select 1 from public.faolla_booking_atomic_commands) or exists(select 1 from public.faolla_booking_mail_jobs) then raise exception 'booking_install_not_inactive';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  and c.relname in ('faolla_booking_atomic_control','faolla_booking_atomic_commands','faolla_booking_mail_jobs') and
  (not c.relrowsecurity or pg_get_userbyid(c.relowner)<>'supabase_admin')) then raise exception 'booking_install_private_tables_invalid';end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role']) r cross join
  unnest(array['faolla_booking_atomic_control','faolla_booking_atomic_commands','faolla_booking_mail_jobs']) t
  where has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) then raise exception 'booking_install_table_acl_invalid';end if;
end;$booking_install_verify$;
commit;`;
}
async function privateFile(file){
 if(await realpath(file)!==file)fail('evidence_symlink');let current=file;
 for(;;){const info=await lstat(current);if(info.isSymbolicLink()||info.uid!==0||(info.mode&0o022)||(current===file?(!info.isFile()||info.nlink!==1||info.mode&0o077):!info.isDirectory()))fail('evidence_not_private');const parent=path.dirname(current);if(parent===current)break;current=parent;}
 const info=await lstat(file);if(info.size<=0||info.size>1024*1024)fail('evidence_size_invalid');return readFile(file,'utf8');
}
export function assertBookingCompatibilityProof(value,{target,baseline,sourceSha256}){
 const expected=['actualProductionMetadataClone','metadataOnlyNoBusinessRows','postgres15ExactImage','originalSourcesInOneTransaction',
  'inactiveAfterInstall','legacyBookingWriteStillWorks','privateTablesAndRpcAcls','outsideBookingMetadataUnchanged','productionUnchanged'];
 if(value?.schemaVersion!==1||value.target!==target||value.baseline!==baseline||!same(value.sourceSha256,sourceSha256)
  ||value.databaseSystemIdentifier!==attendanceProductionIdentity.systemIdentifier||value.serverVersionNum!==attendanceProductionIdentity.serverVersionNum
  ||!Number.isFinite(Date.parse(value.completedAt))||Date.now()-Date.parse(value.completedAt)<-60000||Date.now()-Date.parse(value.completedAt)>24*60*60*1000
  ||!same(Object.keys(value.checks??{}).sort(),[...expected].sort())||expected.some(key=>value.checks[key]!==true)
  ||!/^[a-f0-9]{64}$/.test(value.evidenceSha256))fail('compatibility_not_proved');
}
function psql(sql){return {args:['exec','-i',attendanceProductionIdentity.containerId,'sh','-lc',
 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql --username=supabase_admin --dbname=postgres --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate'],sql};}
async function command(run,args,{sql,timeoutMs=15000}={}){
 const result=await run('docker',args,{input:sql,timeoutMs,outputLimitBytes:1024*1024});
 if(result.status!==0||result.timedOut)fail('database_command_unconfirmed');return String(result.stdout||'').trim();
}
async function inspect(run){
 const raw=await command(run,['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',attendanceProductionIdentity.containerId]);
 const item=JSON.parse(raw);if(item.id!==attendanceProductionIdentity.containerId||item.name!=='/supabase-db'||item.running!==true||!item.mounts?.some(m=>m.Type==='bind'&&m.Source===attendanceProductionIdentity.dataSource&&m.RW===true))fail('database_container_changed');
}
async function state(run){await inspect(run);const query=psql(bookingDatabaseStateSql);return JSON.parse(await command(run,query.args,{sql:query.sql}));}
export async function verifyInactiveBookingSchema({rootDir,runCommand=runMigrationCommand}){
 const{manifest}=await loadAttendanceProductionScope({rootDir});const value=validateBookingDatabaseState(await state(runCommand),manifest,{installed:true});
 const query=psql(`begin read only;select count(*)=1 and bool_and(not active and protocol=2) as inactive from public.faolla_booking_atomic_control;rollback;`);
 if(await command(runCommand,query.args,{sql:query.sql})!=='t')fail('database_is_active');return value;
}
export async function installInactiveBookingSchema({target,baseline,rootDir,operation,runCommand=runMigrationCommand}){
 if(!/^[a-f0-9]{40}$/.test(target)||baseline!==BOOKING_RELEASE_BASELINE||rootDir!==`/www/wwwroot/merchant-space.web-releases/${target.slice(0,12)}-online`||operation!==`/var/lib/faolla-online-release/${target}`)fail('database_invocation_invalid');
 const{manifest}=await loadAttendanceProductionScope({rootDir});
 const sources=await Promise.all(BOOKING_MIGRATIONS.map(item=>readFile(path.join(rootDir,'scripts/supabase-migrations',item.fileName),'utf8')));
 const sql=guardedBookingMigrationSql(sources),sourceSha256=sources.map(hash);
 const compatibilityText=await privateFile(operation+'/booking-compatibility.json');assertBookingCompatibilityProof(JSON.parse(compatibilityText),{target,baseline,sourceSha256});
 const evidenceText=await privateFile(operation+'/booking-compatibility-evidence.json');
 if(hash(evidenceText)!==JSON.parse(compatibilityText).evidenceSha256)fail('compatibility_evidence_changed');
 const backup=await validateAttendanceBackupEvidence({target,backup:operation+'/database.tar.enc',createReport:operation+'/backup-create.json',verifyReport:operation+'/backup-verify.json'});
 const lock=await acquireProductionMigrationLock();
 try{
  const before=validateBookingDatabaseState(await state(runCommand),manifest);
  // Write-once admission evidence is not a success receipt. Never overwrite or
  // retry an unknown installation; a fresh read/review must resolve that result.
  await writeFile(operation+'/booking-install-attempt.json',JSON.stringify({schemaVersion:1,target,baseline,sourceSha256,before,backup,
   compatibilitySha256:hash(compatibilityText),startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
  const query=psql(sql);await command(runCommand,query.args,{sql:query.sql,timeoutMs:30000});
  const after=await verifyInactiveBookingSchema({rootDir,runCommand});
  const proof={schemaVersion:1,target,baseline,status:'installed-inactive',atomicActive:false,sourceSha256,
   compatibilitySha256:hash(compatibilityText),backupSha256:backup.archiveSha256,
   savedRowsUnchangedInsideMigrationTransaction:true,
   concurrentChangesObservedOutsideTransaction:after.savedBookingRowsSha256!==before.savedBookingRowsSha256,
   before,after,completedAt:new Date().toISOString()};
  await writeFile(operation+'/booking-database-inactive.json',JSON.stringify(proof),{flag:'wx',mode:0o600});return proof;
 }finally{await lock.release();}
}
