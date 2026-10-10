// Explicit, bounded production attendance upgrade. No pilot repair, initial
// schema installation, maintenance, role backfill, or automatic feature enable.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {acquireProductionMigrationLock,discoverProductionDatabaseMigrations,runMigrationCommand} from './apply-production-database-migrations.mjs';
import {sha256File,validateDatabaseBackupSourceIdentity} from './database-backup-contract.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
// Full, exact manifest file bytes (not a second semantic/canonical digest).
export const attendanceProductionScopeSha256='3518a971c62c0f9a074b94c873078729e3ebe79adb0bd661793d07063d057ce3';
export const attendanceProductionIdentity=Object.freeze({containerId:'0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416',containerName:'supabase-db',databaseName:'postgres',databaseOid:'5',systemIdentifier:'7612049595342295079',serverVersionNum:'150008',dataSource:'/opt/supabase/docker/volumes/db/data'});
const SHA=/^[0-9a-f]{40}$/;
const HEX=/^[0-9a-f]{64}$/;
const STAGED_TOOL_REPAIR_TARGET='a535a308e21f121e7cf410a6f7d84c974eb370a6';
const FUNCTIONS=['faolla_valid_merchant_enterprise_permissions_v1(text[])','faolla_update_merchant_enterprise_employee_v1(jsonb)','faolla_update_merchant_enterprise_employee_v1_preaudit_019(jsonb)','faolla_attendance_valid_zone_v1(text)'];
export const attendanceProductionLegacy052SourceSha256=Object.freeze({
 [FUNCTIONS[0]]:'58fd1ff5d0d5b310d156de06a61cc86f344c86b5ea82b9fcff9b7b154e89539d',
 [FUNCTIONS[1]]:'2737fb7e266f325140ba6823d681557c3e933da5630ca2d84291fa3f2c2aca5d',
 [FUNCTIONS[2]]:'08610cb18f96dfe955a3b0e1f60ceb58cc08647844db1f0647e34ab0612f23f8',
});
const PROTECTED=['merchants','merchant_enterprise_roles','merchant_enterprise_employees'];
const COMPAT_CHECKS=['metadataCloneWithoutData','publicDefaultAclCloned','baseline052Exact','original149SourcesExact','originalMigrationGuardsPassed','legacyRowsUnchanged','legacyPermissionInputsValid','legacyEmployeeUpdateWithoutAttendanceInput','legacyFunctionMetadataCompatible','utc25CasesEquivalent','utcOidMetadataAclPreserved','outsideCatalogUnchanged','clusterRolesUnchanged','noFeatureOrOldRoleAutoGrant'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value);
function require_(condition,code){if(!condition)throw new Error(code);}
function same(a,b,code){try{assert.deepEqual(a,b);}catch{throw new Error(code);}}
function ref(value,code){require_(typeof value==='string'&&SHA.test(value),code);return value;}
function runtimePaths(target){ref(target,'attendance_target_invalid');const directory=`/var/lib/faolla-online-release/${target}`;return {directory,ready:`${directory}/attendance-database-ready.json`,progress:`${directory}/attendance-database-progress.json`,compatibility:`${directory}/attendance-database-compatibility.json`};}

export async function attendanceOwnedSourcePath(file,{rootOwned=process.platform==='linux'}={}){
 const resolved=path.resolve(file);require_(await realpath(resolved)===resolved,'attendance_source_symlink');let current=resolved;
 for(;;){const info=await lstat(current);require_(!info.isSymbolicLink()&&(current===resolved?info.isFile():info.isDirectory()),'attendance_source_type');if(rootOwned)require_(info.uid===0&&(info.mode&0o022)===0,'attendance_source_not_root_owned');const parent=path.dirname(current);if(!rootOwned||parent===current)break;current=parent;}
 return resolved;
}
export async function loadAttendanceProductionScope({rootDir=ROOT,rootOwned=process.platform==='linux'}={}){
 const root=await realpath(rootDir),manifestPath=path.join(root,'scripts','attendance-production-database-migrations.manifest.json');
 require_(root===path.resolve(rootDir),'attendance_source_root_symlink');await attendanceOwnedSourcePath(manifestPath,{rootOwned});
 const stat=await lstat(manifestPath);require_(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<100000,'attendance_manifest_type');
 const manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes.toString('utf8'));
 require_(digest(manifestBytes)===attendanceProductionScopeSha256,'attendance_manifest_pin');
 require_(manifest.baseline.length===60&&manifest.migrations.length===149,'attendance_scope_count');
 same(manifest.migrations.map(x=>Number(x.version.slice(-4))),Array.from({length:150},(_,i)=>i+61).filter(x=>x!==165),'attendance_scope_order');
 require_(manifest.migrations.at(-1).version==='202610090210','attendance_210_must_be_last');
 const discovery=await discoverProductionDatabaseMigrations({rootDir:root,through:'202610090210'});
 const sources=[];
 for(const item of manifest.migrations){
  const migration=discovery.migrations.find(x=>x.fileName===item.fileName);require_(migration?.version===item.version&&migration.name===item.name,'attendance_scope_source_missing');
  const file=await attendanceOwnedSourcePath(path.join(discovery.directory,item.fileName),{rootOwned}),bytes=await readFile(file);
  require_(bytes.length===item.bytes&&digest(bytes)===item.sha256,'attendance_source_pin');
  // Execute the SAME buffer that passed the reviewed hash, never discovery's
  // earlier read. Root-owned ancestors prohibit an untrusted source swap.
  sources.push({...item,source:bytes.toString('utf8')});
 }
 same(discovery.migrations.filter(x=>x.version<='202609240052').map(({version,name})=>({version,name})),manifest.baseline,'attendance_baseline_manifest');
 return {manifest,sources,scopeSha256:attendanceProductionScopeSha256};
}

export function validateAttendanceRegistry(registry,manifest,{complete=false}={}){
 const all=[...manifest.baseline,...manifest.migrations.map(({version,name})=>({version,name}))];
 require_(Array.isArray(registry)&&registry.length>=60&&registry.length<=209,'attendance_registry_count');
 same(registry,all.slice(0,registry.length),'attendance_registry_not_exact_prefix');
 if(complete)require_(registry.length===209,'attendance_registry_incomplete');
 return registry.length-60;
}

export function attendanceReadOnlyStateSql(){return `begin read only;
set local statement_timeout='8s';set local lock_timeout='3s';
select jsonb_build_object(
 'databaseName',current_database(),'databaseOid',(select oid::text from pg_database where datname=current_database()),
 'systemIdentifier',(select system_identifier::text from pg_control_system()),'serverVersionNum',current_setting('server_version_num'),
 'currentUser',current_user,'adminSuperuser',(select rolsuper from pg_roles where rolname='supabase_admin'),
 'postgresSuperuser',(select rolsuper from pg_roles where rolname='postgres'),'primary',not pg_is_in_recovery(),
 'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations),
 'owners',(select jsonb_object_agg(c.relname,pg_get_userbyid(c.relowner)) from pg_class c where c.oid=any(array[${PROTECTED.map(x=>`'public.${x}'::regclass`).join(',')}])),
 'attendanceRelations',(select count(*) from pg_class where relnamespace='public'::regnamespace and relname like 'merchant_attendance_%'),
 'attendanceFunctions',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'faolla_attendance_%'),
 'functions',(select jsonb_object_agg(n,jsonb_build_object('oid',p.oid,'owner',pg_get_userbyid(p.proowner),'kind',p.prokind,
 'securityDefiner',p.prosecdef,'config',p.proconfig,'returnType',format_type(p.prorettype,null),'args',oidvectortypes(p.proargtypes),
 'sourceSha256',encode(sha256(convert_to(replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex'),'acl',p.proacl::text,'metadata',to_jsonb(p)-'prosrc'))
 from unnest(array[${FUNCTIONS.map(x=>`'${x}'`).join(',')}]) n join pg_proc p on p.oid=to_regprocedure('public.'||n))
)::text;
commit;\n`;}

function psqlArgs(sql,{database='postgres',readOnly=true}={}){
 require_(/^[a-z0-9_]{1,63}$/.test(database),'attendance_database_name');
 const script=['set -eu',': "${POSTGRES_PASSWORD:?required}"','export PGPASSWORD="$POSTGRES_PASSWORD"',`export PGOPTIONS='-c lock_timeout=3s -c statement_timeout=${readOnly?'8000':'120000'} -c idle_in_transaction_session_timeout=15000 -c timezone=UTC -c DateStyle=ISO,YMD -c extra_float_digits=3'`,
  `exec psql -h 127.0.0.1 -U supabase_admin -d ${database} --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate`].join('\n');
 return {args:['exec','-i',attendanceProductionIdentity.containerId,'sh','-lc',script],sql};
}
async function command(run,args,options={}){
 const result=await run('docker',args,{timeoutMs:options.timeoutMs??150000,outputLimitBytes:1000000,...options});
 require_(result?.status===0&&!result.timedOut,'attendance_command_failed');return String(result.stdout??'').trim();
}
async function inspectDatabase(run){
 const output=await command(run,['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',attendanceProductionIdentity.containerId],{timeoutMs:10000});
 const value=JSON.parse(output);require_(value.id===attendanceProductionIdentity.containerId&&value.name==='/supabase-db'&&value.running===true,'attendance_database_container_mismatch');
 require_(Array.isArray(value.mounts)&&value.mounts.some(x=>x.Type==='bind'&&x.Source===attendanceProductionIdentity.dataSource&&x.RW===true),'attendance_database_mount_mismatch');
 return value;
}
async function state(run){await inspectDatabase(run);const psql=psqlArgs(attendanceReadOnlyStateSql());return JSON.parse(await command(run,psql.args,{input:psql.sql,timeoutMs:12000}));}
export function validateAttendanceProductionState(value,manifest,{fresh=false,complete=false}={}){
 for(const key of ['databaseName','databaseOid','systemIdentifier','serverVersionNum'])require_(value?.[key]===attendanceProductionIdentity[key],'attendance_database_identity_mismatch');
 require_(value.currentUser==='supabase_admin'&&value.adminSuperuser===true&&value.postgresSuperuser===false&&value.primary===true,'attendance_database_migrator_invalid');
 same(value.owners,Object.fromEntries(PROTECTED.map(x=>[x,'supabase_admin'])),'attendance_legacy_owner_mismatch');
 const installed=validateAttendanceRegistry(value.registry,manifest,{complete});
 if(fresh)require_(installed===0&&value.attendanceRelations===0&&value.attendanceFunctions===0,'attendance_fresh_052_required');
 for(const fn of FUNCTIONS.slice(0,3))require_(value.functions?.[fn]?.owner==='supabase_admin'&&value.functions[fn].kind==='f'&&HEX.test(value.functions[fn].sourceSha256),'attendance_legacy_function_missing');
 for(const fn of FUNCTIONS.slice(0,3)){const f=value.functions[fn],m=f.metadata;require_(m&&typeof m==='object'&&m.oid===f.oid&&['proowner','prolang','provolatile','proisstrict','proparallel','proleakproof','proretset','pronargdefaults','proargdefaults','proargnames','proargmodes','proallargtypes','proargtypes','proconfig','proacl','procost','prorows','prosecdef','prokind','prorettype','prosupport','prosqlbody'].every(k=>Object.hasOwn(m,k))&&!Object.hasOwn(m,'prosrc'),'attendance_legacy_function_metadata_missing');}
 for(const fn of FUNCTIONS.slice(0,3))if(fn===FUNCTIONS[2]||(fn===FUNCTIONS[0]&&installed<2)||(fn===FUNCTIONS[1]&&installed<104))require_(value.functions[fn].sourceSha256===attendanceProductionLegacy052SourceSha256[fn],'attendance_legacy_052_function_drift');
 if(complete)require_(value.functions?.[FUNCTIONS[3]]?.sourceSha256==='03b6beb68f9e439e7d1761f2970f8520d80c28491ec1ddc1891c496774eb1ac6','attendance_utc210_source_mismatch');
 return installed;
}

// Hash rows before aggregation: no raw business rows leave the transaction and
// the aggregate stays bounded by fixed-size hashes, including duplicates.
export const attendanceLegacyRowFingerprintSql=(table,columns)=>{
 require_(PROTECTED.includes(table),'attendance_protected_table_invalid');
 const row=columns?`(select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(t)) e(k,v) where k=any(${columns}))`:'to_jsonb(t)';
 return `(select encode(sha256(convert_to(count(*)::text||':'||coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') from (select encode(sha256(convert_to(${row}::text,'UTF8')),'hex') h from public.${table} t) r)`;
};
// Force scalar-array ANY, not ANY(subquery), whose rows have type text[].
// The same frozen pre-migration columns are projected before and after DDL.
const oldColumns=table=>`((select cols from pg_temp.faolla_attendance_protected_rows_guard where k='${table}'))::text[]`;
const columnMetadata=table=>`(select jsonb_agg(jsonb_build_object('name',attname,'type',atttypid,'modifier',atttypmod,'collation',attcollation) order by attnum) from pg_attribute where attrelid='public.${table}'::regclass and attnum>0 and not attisdropped)`;
// These are reviewed offsets in eight EXACT original source buffers, not a SQL
// parser or a regex that could mistake a DO/function body for a transaction.
// No original transaction, concurrent-index statement, or source byte changes.
export const attendanceProtectedMultiphaseMigrations=Object.freeze([
 ['202610050136_merchant_attendance_schedule_publication_evidence.sql','cf91fc898430420c7ec44e7ffb5c1ec71aa946aeb462600a5039530b813d2ca3',25202,[[232,3743],[4132,25194]],[[3982,4130]]],
 ['202610050139_merchant_attendance_plan_coverage.sql','38a0ef219e7b9fc274a5b6c27d80d47034d51149b76e43f2cc6259df4b88f934',15848,[[237,4083],[4441,15840]],[[4245,4439]]],
 ['202610050142_merchant_attendance_onsite_schedule.sql','b326eff5eac90cf46cf2f87418d0ae4262a859f4fe5b0234753009779f7f447d',41515,[[382,4850],[5009,5818],[5827,41507]],[]],
 ['202610050143_merchant_attendance_pin_schedule.sql','aa25c56ea37640d4e13f5a4942c7f433944f00f2a2a30d5f143d3d1aca06d586',67731,[[370,4459],[4542,5356],[5365,67723]],[]],
 ['202610050144_merchant_attendance_self_schedule_adoption.sql','ac31308eca5ea71d6bc6d2e7dc44d73eebd3859389be04b7f28706f1ba9aab3f',34443,[[231,4488],[4571,5430],[5439,34435]],[]],
 ['202610050151_merchant_attendance_period_source_ranges.sql','b56dcc84de193356ffd6be08741c5d7ba9f2fe3e7d2b7b8b712a8f2703571ae4',44944,[[544,5451],[6274,44935]],[[5614,5933],[5934,6272]]],
 ['202610060160_merchant_attendance_missing_delegation.sql','ae255256ceaec8a1a56fff5176a00702fd20669c52cab2871ad3648a8b2a5137',58827,[[309,4721],[5040,58819]],[[4810,5038]]],
 ['202610080198_merchant_attendance_review_routing.sql','84a0fce6130c5b35f116e29fc56950549c9db459b3c1fe8408ec00a2f7f5e9be',170210,[[146,29814],[30565,170202]],[[29822,30067],[30068,30307],[30308,30564]]],
].map(([fileName,sha256,bytes,transactions,concurrentIndexes])=>Object.freeze({fileName,sha256,bytes,
 transactions:Object.freeze(transactions.map(([begin,commit])=>Object.freeze({begin,commit}))),
 concurrentIndexes:Object.freeze(concurrentIndexes.map(([start,end])=>Object.freeze({start,end}))),
})));
function protectedAttendanceMultiphaseSql(migration,plan,entry,exit,rows,manifest,prior){
 const source=migration.source;
 require_(digest(source)===plan.sha256&&Buffer.byteLength(source)===plan.bytes,'attendance_multiphase_source_pin');
 require_(migration.sha256===plan.sha256&&migration.bytes===plan.bytes&&manifest.migrations[prior].sha256===plan.sha256&&manifest.migrations[prior].bytes===plan.bytes,'attendance_multiphase_manifest_pin');
 const finalRows=canonical([...manifest.baseline,...manifest.migrations.slice(0,prior+1).map(({version,name})=>({version,name}))]).replaceAll("'","''");
 const registration=` if not exists(select 1 from public.faolla_schema_migrations where version=${migration.version} and name='${migration.name}') then raise exception 'attendance_production_registration_missing';end if;`;
 // Equality of a complete prefix must reject the empty/NULL aggregate too.
 // This closes the NEW phase gates only; the141 legacy outputs stay exact.
 const registry=value=>` if (select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations) is distinct from '${value}'::jsonb then raise exception 'attendance_production_registry_changed';end if;`;
 const phaseEntry=entry.replace(`<>'${rows}'::jsonb`,` is distinct from '${rows}'::jsonb`);
 const earlyExit=exit.replace(registration,registry(rows)),finalExit=exit.replace(registration,registration+'\n'+registry(finalRows));
 require_(phaseEntry!==entry&&earlyExit!==exit&&finalExit!==exit,'attendance_multiphase_registry_guard');
 let cursor=0,result='';
 for(let index=0;index<plan.transactions.length;index++){
  const {begin,commit}=plan.transactions[index];
  require_(begin>=cursor&&commit>begin+6&&source.slice(begin,begin+6)==='begin;'&&source.slice(commit,commit+7)==='commit;'&&source[begin-1]==='\n'&&source[commit-1]==='\n','attendance_multiphase_transaction_shape');
  result+=source.slice(cursor,begin+6)+phaseEntry+source.slice(begin+6,commit)+(index===plan.transactions.length-1?finalExit:earlyExit)+source.slice(commit,commit+7);
  cursor=commit+7;
 }
 for(const {start,end} of plan.concurrentIndexes){
  require_(source.slice(start,end).startsWith('create index concurrently ')&&source[end-1]===';'&&
   plan.transactions.some((transaction,index)=>index+1<plan.transactions.length&&start>=transaction.commit+7&&end<=plan.transactions[index+1].begin),'attendance_multiphase_concurrent_index_shape');
 }
 result+=source.slice(cursor);
 require_(result.replaceAll(phaseEntry,'').replaceAll(earlyExit,'').replaceAll(finalExit,'')===source,'attendance_original_sql_changed');
 return result;
}
export function protectedAttendanceMigrationSql(migration,prior,manifest){
 require_(manifest.migrations[prior]?.fileName===migration.fileName,'attendance_migration_out_of_order');
 const source=migration.source,begin=source.match(/(?:^|\r?\n)begin;/i);require_(begin&&/commit;\s*$/i.test(source),'attendance_migration_transaction_shape');
 const rows=canonical([...manifest.baseline,...manifest.migrations.slice(0,prior).map(({version,name})=>({version,name}))]).replaceAll("'","''");
 const entry=`\nset transaction isolation level repeatable read;\nset local lock_timeout='3s';set local statement_timeout='120s';
do $attendance_production_prestate$ begin
 if current_user<>'supabase_admin' or not pg_try_advisory_xact_lock(20260731,1) then raise exception 'attendance_production_lock_or_owner';end if;
 if (select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations)<>'${rows}'::jsonb then raise exception 'attendance_production_registry_changed';end if;
end;$attendance_production_prestate$;
create temp table faolla_attendance_protected_rows_guard(k text primary key,cols text[] not null,metadata jsonb not null,v text) on commit drop;
insert into pg_temp.faolla_attendance_protected_rows_guard(k,cols,metadata) values ${PROTECTED.map(t=>`('${t}',array(select attname::text from pg_attribute where attrelid='public.${t}'::regclass and attnum>0 and not attisdropped order by attnum),${columnMetadata(t)})`).join(',')};
update pg_temp.faolla_attendance_protected_rows_guard set v=case k ${PROTECTED.map(t=>`when '${t}' then ${attendanceLegacyRowFingerprintSql(t,oldColumns(t))}`).join(' ')} end;\n`;
 const exit=`\ndo $attendance_production_poststate$ begin
 if exists(select 1 from pg_temp.faolla_attendance_protected_rows_guard g where not(g.metadata<@case g.k ${PROTECTED.map(t=>`when '${t}' then ${columnMetadata(t)}`).join(' ')} end)) then raise exception 'attendance_production_legacy_columns_changed';end if;
 if exists(select 1 from pg_temp.faolla_attendance_protected_rows_guard g where g.v<>case g.k ${PROTECTED.map(t=>`when '${t}' then ${attendanceLegacyRowFingerprintSql(t,oldColumns(t))}`).join(' ')} end) then raise exception 'attendance_production_legacy_rows_changed';end if;
 if not exists(select 1 from public.faolla_schema_migrations where version=${migration.version} and name='${migration.name}') then raise exception 'attendance_production_registration_missing';end if;
end;$attendance_production_poststate$;\n`;
 const phases=attendanceProtectedMultiphaseMigrations.find(plan=>plan.fileName===migration.fileName);
 if(phases)return protectedAttendanceMultiphaseSql(migration,phases,entry,exit,rows,manifest,prior);
 const first=begin.index+begin[0].length,last=source.search(/commit;\s*$/i);
 const result=source.slice(0,first)+entry+source.slice(first,last)+exit+source.slice(last);
 require_(result.replace(entry,'').replace(exit,'')===source,'attendance_original_sql_changed');
 return result;
}

async function ownedJson(file,{rootOwned=true}={}){
 const info=await lstat(file);require_(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<2000000,'attendance_evidence_file_invalid');
 if(rootOwned)require_(info.uid===0&&(info.mode&0o022)===0,'attendance_evidence_not_root_owned');
 const bytes=await readFile(file);return {value:JSON.parse(bytes.toString('utf8')),sha256:digest(bytes)};
}
async function ownedRuntime(directory,{rootOwned=true}={}){
 require_(await realpath(directory)===directory,'attendance_runtime_path_mismatch');
 let current=directory;
 for(;;){const info=await lstat(current);require_(info.isDirectory()&&!info.isSymbolicLink(),'attendance_runtime_invalid');if(rootOwned)require_(info.uid===0&&(info.mode&0o022)===0,'attendance_runtime_not_root_owned');const parent=path.dirname(current);if(!rootOwned||parent===current)break;current=parent;}
}
async function saveEvidence(file,value,{replace=false}={}){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(!replace){await writeFile(file,bytes,{flag:'wx',mode:0o600});return digest(bytes);}
 const temporary=file+'.next';await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,file);return digest(bytes);
}
export function validateAttendanceCompatibilityProof(proof,{target,baseline,scopeSha256}){
 require_(proof?.schemaVersion===1&&proof.kind==='attendance-052-upgrade-compatibility'&&proof.target===target&&proof.baseline===baseline&&proof.scopeSha256===scopeSha256,'attendance_compatibility_identity');
 require_(/^faolla_attendance_compat_[a-f0-9]{12}$/.test(proof.databaseName)&&proof.databaseName===`faolla_attendance_compat_${target.slice(0,12)}`,'attendance_compatibility_database');
 require_(HEX.test(proof.sourcePilotContainerId)&&proof.sourcePilotContainerId!==attendanceProductionIdentity.containerId&&proof.productionDataCopied===false,'attendance_compatibility_not_isolated');
 require_(proof.baselineRegistryCount===60&&proof.baselineRegistryMaximum==='202609240052'&&proof.initialAttendanceRelations===0&&proof.initialAttendanceFunctions===0&&proof.finalRegistryCount===209&&proof.finalRegistryMaximum==='202610090210','attendance_compatibility_registry');
 for(const key of COMPAT_CHECKS)require_(proof.checks?.[key]===true,'attendance_compatibility_check_missing');
 require_(proof.owner==='supabase_admin'&&HEX.test(proof.transcriptSha256)&&HEX.test(proof.legacyFingerprintBefore)&&proof.legacyFingerprintBefore===proof.legacyFingerprintAfter,'attendance_compatibility_receipt_invalid');
 require_(/^[1-9][0-9]{0,9}$/.test(proof.databaseOid)&&proof.databaseOid!=='5'&&Number.isSafeInteger(proof.backendPid)&&proof.backendPid>0&&/^[0-9]{10,24}$/.test(proof.sourcePilotSystemIdentifier)&&proof.sourcePilotSystemIdentifier!==attendanceProductionIdentity.systemIdentifier,'attendance_compatibility_database_identity');
 for(const key of ['outsideCatalog','clusterRoles'])require_(HEX.test(proof[`${key}Sha256Before`])&&proof[`${key}Sha256Before`]===proof[`${key}Sha256After`],'attendance_compatibility_catalog_drift');
 const source=proof.productionMetadataSource;require_(source?.schemaOnly===true&&source.productionDataCopied===false&&source.registryCount===60&&source.registryMaximum==='202609240052'&&HEX.test(source.metadataSourceSha256)&&HEX.test(source.normalizedContractSha256)&&HEX.test(source.formalStateSha256Before)&&source.formalStateSha256Before===source.formalStateSha256After&&proof.historicalBootstrapReplayed===false&&proof.originalAttendanceSourcesInstalled===149,'attendance_compatibility_actual_052_source');same(source.identity,attendanceProductionIdentity,'attendance_compatibility_actual_052_identity');
 if(target===STAGED_TOOL_REPAIR_TARGET&&hasToolRepairAudit(proof))validateToolRepairAuditShape(proof,'attendance_compatibility_tool_repair_audit_invalid');
 return proof;
}
export async function validateAttendanceBackupEvidence(input){
 const {value:create}=await ownedJson(input.createReport,input);const {value:verify}=await ownedJson(input.verifyReport,input);
 const source=validateDatabaseBackupSourceIdentity(create.source,{requireRecoveryContent:true});require_(source.valid,'attendance_backup_source_invalid');
 if(input.target)require_(source.source.sha===input.target,'attendance_backup_source_not_target');
 same(verify.source,create.source,'attendance_backup_sources_differ');
 for(const key of ['containerId','containerName','databaseName','databaseOid','systemIdentifier','serverVersionNum'])require_(source.source.database[key]===attendanceProductionIdentity[key],'attendance_backup_database_mismatch');
 require_(create.schemaVersion===2&&create.status==='created'&&verify.schemaVersion===2&&verify.status==='verified'&&verify.manifestSchemaVersion===2&&create.format==='self-hosted-supabase-dr-v2'&&verify.format===create.format,'attendance_backup_not_verified');
 require_(create.outputBytes===verify.inputBytes&&create.outputFile===verify.inputFile&&HEX.test(create.outputSha256)&&verify.inputSha256===create.outputSha256&&create.createdAt===verify.backupCreatedAt,'attendance_backup_report_mismatch');
 require_(Array.isArray(create.dumpFiles)&&create.dumpFiles.length>0,'attendance_backup_dump_inventory_missing');same(create.dumpFiles,verify.dumpFiles,'attendance_backup_dump_inventory_mismatch');
 const archive=await lstat(input.backup);require_(archive.isFile()&&!archive.isSymbolicLink()&&archive.size===create.outputBytes&&input.backup.endsWith('.enc'),'attendance_backup_archive_invalid');
 if(input.rootOwned!==false)require_(archive.uid===0&&(archive.mode&0o077)===0,'attendance_backup_archive_not_private');
 require_(await sha256File(input.backup)===create.outputSha256,'attendance_backup_archive_changed');
 const age=(input.nowMs??Date.now())-Date.parse(create.createdAt);require_(age>=-60000&&age<=24*60*60*1000,'attendance_backup_stale');
 return {archiveSha256:create.outputSha256,archiveBytes:create.outputBytes,createdAt:create.createdAt,source:source.source,restoreRehearsed:false};
}

const hasToolRepairAudit=value=>Object.hasOwn(value,'toolRevision')||Object.hasOwn(value,'stagedToolRepairReceiptSha256');
function validateToolRepairAuditShape(value,code){
 require_(typeof value.toolRevision==='string'&&SHA.test(value.toolRevision)&&value.toolRevision!==STAGED_TOOL_REPAIR_TARGET&&
  typeof value.stagedToolRepairReceiptSha256==='string'&&HEX.test(value.stagedToolRepairReceiptSha256),code);
}
function bindToolRepairAudit(value,repair,code){
 validateToolRepairAuditShape(value,code);
 require_(repair&&value.toolRevision===repair.toolRevision&&value.stagedToolRepairReceiptSha256===repair.receiptSha256,code);
}
function requiresFollowOnExtensionEvidence(repair){
 if(!repair||!Object.hasOwn(repair,'receiptKind'))return false;
 require_(repair.receiptKind==='attendance-staged-tool-repair-follow-on'||repair.receiptKind==='attendance-staged-tool-repair-sequence-follow-on'||repair.receiptKind==='attendance-staged-tool-repair-acl-follow-on'||repair.receiptKind==='attendance-staged-tool-repair-schema-follow-on'||repair.receiptKind==='attendance-staged-tool-repair-guard-follow-on'||repair.receiptKind==='attendance-staged-tool-repair-phase-follow-on','attendance_tool_repair_receipt_kind_invalid');
 return true;
}
async function verifiedMigrationToolRepair(input){
 require_(input.target===STAGED_TOOL_REPAIR_TARGET,'attendance_tool_repair_target_invalid');
 // No injectable verifier or source-SHA override. The fixed runtime rechecks
 // current trusted tool/main identity, retained candidate bytes and receipt.
 const {verifyAttendanceStagedToolRepairReceipt}=await import('./attendance-staged-tool-repair.mjs');
 const result=await verifyAttendanceStagedToolRepairReceipt({target:input.target,rootDir:input.rootDir??ROOT,phase:'migration'});
 require_(result?.receipt?.target===input.target&&typeof result.toolRevision==='string'&&SHA.test(result.toolRevision)&&result.toolRevision!==input.target&&
  typeof result.receiptSha256==='string'&&HEX.test(result.receiptSha256),'attendance_tool_repair_receipt_invalid');
 requiresFollowOnExtensionEvidence(result);
 return result;
}
// This extra gate belongs only to the independently verified fixed follow-on
// repair. It does not select a source revision, accept a receipt, or alter the
// general backup contract. The original dump and both supplementary artifacts
// must reconstruct precisely the schema-only restoration used by the clone.
export async function validateAttendanceExtensionCompatibilityEvidence(proof,files,options={}){
 const optionKeys=['restoreGraphqlInitialAcl','restoreGraphqlInitialSchemaAcl'];
 require_(options&&typeof options==='object'&&!Array.isArray(options)&&Reflect.ownKeys(options).every(key=>optionKeys.includes(key))&&
  optionKeys.every(key=>!Object.hasOwn(options,key)||typeof options[key]==='boolean'),'attendance_extension_evidence_options');
 const restoreGraphqlInitialAcl=Object.hasOwn(options,'restoreGraphqlInitialAcl')&&options.restoreGraphqlInitialAcl===true;
 const restoreGraphqlInitialSchemaAcl=Object.hasOwn(options,'restoreGraphqlInitialSchemaAcl')&&options.restoreGraphqlInitialSchemaAcl===true;
 require_(proof?.target===STAGED_TOOL_REPAIR_TARGET,'attendance_extension_evidence_target');
 const source=proof.productionMetadataSource,evidence=source?.extensionMetadata;
 const keys=['sourceSha256','snapshotSha256','supplementSha256','restorationSha256','originalMetadataSourceSha256','extensionCount','memberCount','routineCount',...(restoreGraphqlInitialSchemaAcl?['schemaSnapshotSha256']:[])];
 require_(evidence&&typeof evidence==='object'&&!Array.isArray(evidence),'attendance_extension_evidence_missing');
 same(Object.keys(evidence).sort(),keys.sort(),'attendance_extension_evidence_shape');
 for(const key of keys.filter(k=>k.endsWith('Sha256')))require_(typeof evidence[key]==='string'&&HEX.test(evidence[key]),'attendance_extension_evidence_hash');
 require_(evidence.extensionCount===8&&evidence.memberCount===96&&evidence.routineCount===80&&evidence.originalMetadataSourceSha256===source.metadataSourceSha256,'attendance_extension_evidence_source');
 for(const key of ['metadata','extensionMetadata','supplement'])require_(Buffer.isBuffer(files?.[key]),'attendance_extension_evidence_bytes');
 require_(digest(files.metadata)===source.metadataSourceSha256&&digest(files.extensionMetadata)===evidence.sourceSha256&&digest(files.supplement)===evidence.supplementSha256,'attendance_extension_evidence_artifact_changed');
 const artifact=JSON.parse(files.extensionMetadata.toString('utf8'));
 same(Object.keys(artifact).sort(),['schemaVersion','kind','identity','originalMetadataSourceSha256','snapshotSha256','snapshot','operations',...(restoreGraphqlInitialSchemaAcl?['schemaSnapshot','schemaSnapshotSha256']:[])].sort(),'attendance_extension_evidence_artifact_shape');
 require_(artifact.schemaVersion===1&&artifact.kind==='attendance-actual-formal-extension-metadata'&&artifact.originalMetadataSourceSha256===source.metadataSourceSha256&&artifact.snapshotSha256===evidence.snapshotSha256,'attendance_extension_evidence_artifact_identity');
 same(artifact.identity,attendanceProductionIdentity,'attendance_extension_evidence_database');
 const {attendanceExtensionMetadataSupplement}=await import('./attendance-extension-metadata.mjs');
 const reconstructed=attendanceExtensionMetadataSupplement(files.metadata.toString('utf8'),artifact.snapshot,{restoreGraphqlInitialAcl,restoreGraphqlInitialSchemaAcl},artifact.schemaSnapshot);
 if(restoreGraphqlInitialSchemaAcl)require_(artifact.schemaSnapshotSha256===evidence.schemaSnapshotSha256&&reconstructed.schemaSnapshotSha256===evidence.schemaSnapshotSha256,'attendance_extension_evidence_schema_snapshot');
 require_(reconstructed.sourceSha256===source.metadataSourceSha256&&reconstructed.snapshotSha256===evidence.snapshotSha256&&reconstructed.supplementSha256===evidence.supplementSha256&&digest(reconstructed.sql)===evidence.restorationSha256&&files.supplement.equals(Buffer.from(reconstructed.supplementSql)),'attendance_extension_evidence_reconstruction');
 same(artifact.operations,reconstructed.operations,'attendance_extension_evidence_operations');
 return evidence;
}
async function privateExtensionEvidenceBytes(file,maximum){
 const before=await lstat(file);
 require_(before.isFile()&&!before.isSymbolicLink()&&before.uid===0&&(before.mode&0o777)===0o600&&before.nlink===1&&before.size>0&&before.size<maximum,'attendance_extension_evidence_not_private');
 const bytes=await readFile(file),after=await lstat(file);
 same([after.dev,after.ino,after.size,after.mtimeMs,after.ctimeMs,after.mode,after.uid,after.nlink],[before.dev,before.ino,before.size,before.mtimeMs,before.ctimeMs,before.mode,before.uid,before.nlink],'attendance_extension_evidence_changed_during_read');
 require_(bytes.length===before.size,'attendance_extension_evidence_changed_during_read');
 return bytes;
}
async function verifyFollowOnExtensionCompatibility(input,compatibility,repair){
 if(!requiresFollowOnExtensionEvidence(repair))return null;
 require_(input.target===STAGED_TOOL_REPAIR_TARGET,'attendance_extension_evidence_target');
 const fixed=runtimePaths(input.target);await ownedRuntime(fixed.directory);
 const proofBytes=await privateExtensionEvidenceBytes(fixed.compatibility,2000000),proof=JSON.parse(proofBytes.toString('utf8'));
 same(proof,compatibility,'attendance_extension_evidence_canonical_proof');
 validateAttendanceCompatibilityProof(proof,{target:input.target,baseline:input.baseline,scopeSha256:attendanceProductionScopeSha256});
 bindToolRepairAudit(proof,repair,'attendance_extension_evidence_tool_repair');
 const files={metadata:await privateExtensionEvidenceBytes(path.join(fixed.directory,'attendance-compatibility-metadata.sql'),16000000),extensionMetadata:await privateExtensionEvidenceBytes(path.join(fixed.directory,'attendance-compatibility-extension-metadata.json'),2000000),supplement:await privateExtensionEvidenceBytes(path.join(fixed.directory,'attendance-compatibility-extension-supplement.sql'),2000000)};
 const restoreGraphqlInitialSchemaAcl=repair.receiptKind==='attendance-staged-tool-repair-schema-follow-on'||repair.receiptKind==='attendance-staged-tool-repair-guard-follow-on'||repair.receiptKind==='attendance-staged-tool-repair-phase-follow-on';
 await validateAttendanceExtensionCompatibilityEvidence(proof,files,{restoreGraphqlInitialAcl:repair.receiptKind==='attendance-staged-tool-repair-acl-follow-on'||restoreGraphqlInitialSchemaAcl,restoreGraphqlInitialSchemaAcl});
 return digest(proofBytes);
}
async function migrationBackupEvidence(input,compatibility){
 const {value:create}=await ownedJson(input.createReport,input);
 const source=validateDatabaseBackupSourceIdentity(create.source,{requireRecoveryContent:true});require_(source.valid,'attendance_backup_source_invalid');
 let repair=null;
 if(input.target===STAGED_TOOL_REPAIR_TARGET&&source.source.sha!==input.target){
  repair=await verifiedMigrationToolRepair(input);
  requiresFollowOnExtensionEvidence(repair);
  require_(source.source.sha===repair.toolRevision,'attendance_backup_tool_repair_source_mismatch');
 }
 // The general backup contract remains unchanged. Only a real, independently
 // verified fixed-case receipt can choose its exact current tool as source.
 const backup=await validateAttendanceBackupEvidence({...input,target:repair?.toolRevision??input.target});
 if(input.target===STAGED_TOOL_REPAIR_TARGET&&(repair||hasToolRepairAudit(compatibility)))
  bindToolRepairAudit(compatibility,repair,'attendance_compatibility_tool_repair_source_mismatch');
 if(repair)require_(backup.source.sha===repair.toolRevision,'attendance_backup_tool_repair_source_mismatch');
 await verifyFollowOnExtensionCompatibility(input,compatibility,repair);
 return {backup,repair,audit:repair?{toolRevision:repair.toolRevision,stagedToolRepairReceiptSha256:repair.receiptSha256}:{}};
}

export function attendance052CompatibilityPlan({target,sourcePilotContainerId}){
 ref(target,'attendance_target_invalid');require_(HEX.test(sourcePilotContainerId)&&sourcePilotContainerId!==attendanceProductionIdentity.containerId,'attendance_compatibility_pilot_identity');
 return {schemaVersion:1,kind:'attendance-052-upgrade-compatibility-plan',target,databaseName:`faolla_attendance_compat_${target.slice(0,12)}`,owner:'supabase_admin',template:'template0',sourcePilotContainerId,
  productionDataCopied:false,rolesInit:false,automaticExecution:false,sourceScopeSha256:attendanceProductionScopeSha256,
  metadataClone:{sourceDatabase:'postgres',sourceContainerId:attendanceProductionIdentity.containerId,schemas:'all non-system database metadata',schemaOnly:true,retainOwnersAndAcl:true,clonePublicSchemaAndDefaultAcl:true,excludePublicDependencyTriggers:false,excludeAllData:true,excludeClusterGlobals:true,
   notes:'Read the actual formal052 schema only into a private600 metadata file, never business/Auth/storage records or cluster globals. Preserve all triggers/owners/ACL/RLS/constraints/defaults and compare normalized metadata before inserting only the fixed60 system registry version/name rows. No historical bootstrap or042 repair.'},
  metadataDumpCommand:{command:'docker',args:['exec',attendanceProductionIdentity.containerId,'sh','-lc','set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; export PGOPTIONS="-c default_transaction_read_only=on -c lock_timeout=3s -c statement_timeout=120000"; exec pg_dump -h 127.0.0.1 -U supabase_admin -d postgres --schema-only --no-comments --no-security-labels --no-publications --no-subscriptions']},
  publicAclReadOnlySql:"begin read only; set local statement_timeout='8s'; select jsonb_build_object('schema',to_jsonb(n),'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d where d.defaclnamespace=n.oid)) from pg_namespace n where n.nspname='public'; commit;",
  installationOrder:['actual formal052 schema-only clone into NEW pilot database','fixed60 registry system version/name metadata only','bounded synthetic legacy merchant/role/employee fixtures','original attendance 061–210 (149 files,165 unused,210 last)'],
  checks:COMPAT_CHECKS,realHttpAuthAccepted:false,productionRestoreProved:false,
  refusal:'Refuse an existing target database, unknown pilot ID, production writes, business/Auth/storage data, globals/roles init, historical bootstrap/042 repairs,060, or a final-only210 install substituted for the actual052 upgrade.'};
}

// pg_dump's selected schemas may include an Auth trigger calling a project
// public function. Strip only that exact trigger DDL; original052 migrations
// rebuild it. No broad SQL replacement or removal of grants/checks is allowed.
export function filterAttendanceCompatibilityMetadataSql(source){
 require_(typeof source==='string'&&source.length>0&&source.length<16000000,'attendance_metadata_dump_invalid');
 // Storage's schema-only dump legitimately contains function definitions with
 // INSERT in their bodies. They are metadata, not executed data statements.
 let safety=source,match;const functions=/\bCREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\b[\s\S]*?\bAS\s+(\$(?:[a-z_][a-z0-9_]*)?\$)/gi;
 while((match=functions.exec(source))){const start=functions.lastIndex,end=source.indexOf(match[1],start);require_(end>=start,'attendance_metadata_function_delimiter');safety=safety.slice(0,start)+safety.slice(start,end).replace(/[^\r\n]/g,' ')+safety.slice(end);functions.lastIndex=end+match[1].length;}
 require_(!/(?:^|\n)\s*\\|\b(?:create|alter|drop)\s+(?:role|user|database)\b|\b(?:insert\s+into|copy\s+[^;\n]+\s+from|truncate\s+|delete\s+from)\b/i.test(safety),'attendance_metadata_dump_not_schema_only');
 let removedProjectTriggers=0;
 const sql=source.replace(/(?:^|\n)CREATE TRIGGER [\s\S]*?;(?=\r?\n|$)/g,statement=>{
  if(/\bON auth\.[a-z_][a-z0-9_]*\b/.test(statement)&&/\bEXECUTE (?:FUNCTION|PROCEDURE) public\.[a-z_][a-z0-9_]*\(/.test(statement)){removedProjectTriggers++;return '';}
  return statement;
 });
 require_(!/(?:^|\n)(?:CREATE (?:TABLE|VIEW|FUNCTION)|ALTER TABLE|ALTER FUNCTION) public\./.test(sql),'attendance_metadata_public_objects_forbidden');
 return {sql,removedProjectTriggers,sourceSha256:digest(source),filteredSha256:digest(sql)};
}

export async function runAttendanceProductionMigrations(input={}){
 const scope=await loadAttendanceProductionScope(input);const mode=input.apply===true?'apply':'dry_run';
 ref(input.target,'attendance_target_invalid');ref(input.baseline,'attendance_baseline_invalid');
 const run=input.runCommand??runMigrationCommand;const paths=input.paths??runtimePaths(input.target);
 const lock=await acquireProductionMigrationLock(input.lockPath);
 try{
  const initial=await state(run);const count=validateAttendanceProductionState(initial,scope.manifest,{fresh:!input.resume});
  const report={schemaVersion:1,kind:'attendance-production-database-plan',mode,target:input.target,baseline:input.baseline,scopeSha256:scope.scopeSha256,dbIdentity:attendanceProductionIdentity,installed:count,pending:149-count,through:'202610090210',sources:scope.manifest.migrations,backupRequired:true,compatibilityRequired:true,executed:[]};
  if(mode==='dry_run')return report;
  require_(input.confirm==='approved-attendance-061-210','attendance_explicit_apply_approval_required');
  await ownedRuntime(paths.directory,input);
  const compatibility=await ownedJson(paths.compatibility,input);validateAttendanceCompatibilityProof(compatibility.value,{...input,scopeSha256:scope.scopeSha256});
  const {backup,repair,audit}=await migrationBackupEvidence(input,compatibility.value);
  let progress;
  if(input.resume){
   const prior=await ownedJson(paths.progress,input);require_(prior.sha256===input.resumeSha256,'attendance_resume_proof_changed');progress=prior.value;
   require_(progress.kind==='attendance-production-database-progress'&&progress.target===input.target&&progress.baseline===input.baseline&&progress.scopeSha256===scope.scopeSha256&&progress.backupArchiveSha256===backup.archiveSha256&&progress.compatibilityProofSha256===compatibility.sha256&&count<=149,'attendance_resume_not_exact');
   if(input.target===STAGED_TOOL_REPAIR_TARGET&&(repair||hasToolRepairAudit(progress)))bindToolRepairAudit(progress,repair,'attendance_resume_tool_repair_source_mismatch');
   if(count===progress.installed+1){
    // Exactly the journaled attempt may have committed before its receipt was
    // lost. Do not replay that SQL; the exact registry confirms only this step.
    require_(progress.attemptedVersion===scope.sources[progress.installed]?.version,'attendance_resume_unknown_commit');
    progress.receipts.push({version:progress.attemptedVersion,sourceSha256:scope.sources[progress.installed].sha256,protectedLegacyRowsUnchanged:true,recoveredCommittedAttempt:true});progress.installed=count;
    await saveEvidence(paths.progress,progress,{replace:true});
   }
   require_(progress.installed===count,'attendance_resume_not_exact');
  }else{
   progress={schemaVersion:1,kind:'attendance-production-database-progress',target:input.target,baseline:input.baseline,scopeSha256:scope.scopeSha256,...audit,dbIdentity:attendanceProductionIdentity,backupArchiveSha256:backup.archiveSha256,compatibilityProofSha256:compatibility.sha256,installed:0,initialFunctions:initial.functions,receipts:[]};
   await saveEvidence(paths.progress,progress);
  }
  for(let i=count;i<149;i++){
   const migration=scope.sources[i];await inspectDatabase(run);
   progress.attemptedVersion=migration.version;await saveEvidence(paths.progress,progress,{replace:true});
   const psql=psqlArgs(protectedAttendanceMigrationSql(migration,i,scope.manifest),{readOnly:false});
   try{await command(run,psql.args,{input:psql.sql,timeoutMs:150000});}catch{
    // Do not claim rollback on a transport failure. Registry inspection plus
    // an explicitly SHA-bound resume is required; never rerun committed SQL.
    throw new Error('attendance_apply_failed_inspect_registry_before_resume');
   }
   const current=await state(run);require_(validateAttendanceProductionState(current,scope.manifest)===i+1,'attendance_post_registry_mismatch');
   progress.installed=i+1;progress.receipts.push({version:migration.version,sourceSha256:migration.sha256,protectedLegacyRowsUnchanged:true});
   await saveEvidence(paths.progress,progress,{replace:true});report.executed.push(migration.version);input.onProgress?.({installed:i+1,total:149,version:migration.version});
  }
  const final=await state(run);validateAttendanceProductionState(final,scope.manifest,{complete:true});
  same(final.functions[FUNCTIONS[2]],progress.initialFunctions[FUNCTIONS[2]],'attendance_legacy_019_function_changed');
  same(final.functions[FUNCTIONS[0]].metadata,progress.initialFunctions[FUNCTIONS[0]].metadata,'attendance_legacy_validator_metadata_changed');
  const oldWrapper={...progress.initialFunctions[FUNCTIONS[1]].metadata},newWrapper={...final.functions[FUNCTIONS[1]].metadata};delete oldWrapper.proconfig;delete newWrapper.proconfig;
  same(oldWrapper,newWrapper,'attendance_legacy_employee_metadata_changed');same(final.functions[FUNCTIONS[1]].metadata.proconfig,['search_path=pg_catalog'],'attendance_legacy_employee_search_path');
  const ready={schemaVersion:1,kind:'attendance-production-database-ready',target:input.target,baseline:input.baseline,scopeSha256:scope.scopeSha256,...audit,dbIdentity:attendanceProductionIdentity,registryCount:209,registryMaximum:'202610090210',registry:final.registry,functions:final.functions,
   backupVerified:true,backupArchiveSha256:backup.archiveSha256,backupCreatedAt:backup.createdAt,compatibilityVerified:true,compatibilityProofSha256:compatibility.sha256,legacyRowsProtectedInEveryTransaction:true,oldRolePermissionsAutoGranted:false,restoreRehearsed:false,completedAt:new Date().toISOString()};
  const proofSha256=await saveEvidence(paths.ready,ready);return {...ready,proofSha256};
 }finally{await lock.release();}
}

export async function verifyAttendanceProductionDatabaseReady(input={}){
 ref(input.target,'attendance_target_invalid');ref(input.baseline,'attendance_baseline_invalid');
 const paths=input.paths??runtimePaths(input.target);await ownedRuntime(paths.directory,input);
 const {value:proof,sha256:proofSha256}=await ownedJson(paths.ready,input);
 require_(proof.schemaVersion===1&&proof.kind==='attendance-production-database-ready'&&proof.target===input.target&&proof.baseline===input.baseline&&proof.scopeSha256===attendanceProductionScopeSha256&&proof.backupVerified===true&&proof.compatibilityVerified===true&&proof.legacyRowsProtectedInEveryTransaction===true&&proof.oldRolePermissionsAutoGranted===false,'attendance_ready_proof_invalid');
 let audit={};
 if(input.target===STAGED_TOOL_REPAIR_TARGET&&hasToolRepairAudit(proof)){
  const repair=await verifiedMigrationToolRepair(input);bindToolRepairAudit(proof,repair,'attendance_ready_tool_repair_source_mismatch');
  if(requiresFollowOnExtensionEvidence(repair)){
   const compatibility=await ownedJson(runtimePaths(input.target).compatibility);
   require_(compatibility.sha256===proof.compatibilityProofSha256,'attendance_ready_compatibility_changed');
   require_(await verifyFollowOnExtensionCompatibility(input,compatibility.value,repair)===proof.compatibilityProofSha256,'attendance_ready_compatibility_changed');
  }
  audit={toolRevision:repair.toolRevision,stagedToolRepairReceiptSha256:repair.receiptSha256};
 }
 same(proof.dbIdentity,attendanceProductionIdentity,'attendance_ready_database_mismatch');
 const scope=await loadAttendanceProductionScope(input),actual=await state(input.runCommand??runMigrationCommand);validateAttendanceProductionState(actual,scope.manifest,{complete:true});
 same(actual.registry,proof.registry,'attendance_ready_registry_changed');same(actual.functions,proof.functions,'attendance_ready_functions_changed');
 return {schemaVersion:1,kind:proof.kind,target:input.target,baseline:input.baseline,scopeSha256:proof.scopeSha256,...audit,dbIdentity:proof.dbIdentity,registryCount:209,registryMaximum:'202610090210',backupVerified:true,compatibilityVerified:true,proofSha256};
}

export function parseAttendanceProductionArguments(argv){
 const command=argv[0]??'scope';require_(['scope','dry-run','apply','verify','compatibility-plan'].includes(command),'attendance_command_invalid');
 const options={command};const permitted=new Set(['target','baseline','backup','create-report','verify-report','confirm','resume-sha256','source-pilot-container-id']);
 for(let i=1;i<argv.length;i++){
  if(argv[i]==='--resume'){require_(!options.resume,'attendance_argument_duplicate');options.resume=true;continue;}
  const m=argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);require_(m&&permitted.has(m[1]),'attendance_argument_unknown');
  const key=m[1].replace(/-([a-z])/g,(_,v)=>v.toUpperCase());require_(!(key in options),'attendance_argument_duplicate');
  const value=m[2]??argv[++i];require_(typeof value==='string'&&value!==''&&!value.startsWith('--'),'attendance_argument_value_missing');options[key]=value;
 }
 if(command!=='apply')require_(!options.backup&&!options.createReport&&!options.verifyReport&&!options.confirm&&!options.resume&&!options.resumeSha256,'attendance_apply_arguments_in_read_mode');
 if(command==='apply')require_(options.backup&&options.createReport&&options.verifyReport&&options.confirm&&(!options.resume||HEX.test(options.resumeSha256??'')),'attendance_apply_evidence_required');
 return options;
}
async function main(){
 const options=parseAttendanceProductionArguments(process.argv.slice(2));let result;
 if(options.command==='scope'){const scope=await loadAttendanceProductionScope();result={schemaVersion:1,kind:'attendance-production-migration-scope',scopeSha256:scope.scopeSha256,baselineCount:60,count:149,from:scope.manifest.from,through:scope.manifest.through,totalBytes:scope.sources.reduce((n,x)=>n+x.bytes,0)};}
 else if(options.command==='compatibility-plan')result=attendance052CompatibilityPlan(options);
 else if(options.command==='verify')result=await verifyAttendanceProductionDatabaseReady(options);
 else result=await runAttendanceProductionMigrations({...options,apply:options.command==='apply',onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')});
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{const code=/^attendance_[a-z0-9_]+$/.test(error?.message??'')?error.message:'attendance_production_database_failed';process.stderr.write(JSON.stringify({ok:false,error:code})+'\n');process.exitCode=1;});
