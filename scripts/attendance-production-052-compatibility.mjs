// Bounded SQL compatibility acceptance, not HTTP login or a production restore.
// Only the existing owned, network-none pilot container may create one NEW DB.
// Original 149 source bytes/guards are retained. Only the ACTUAL formal052
// schema-only metadata is read, not historical bootstrap/042 compensation.
// No production rows or roles init,
// DROP/rebuild, broad owner repair, maintenance, entitlement or role backfill.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runMigrationCommand} from './apply-production-database-migrations.mjs';
import {loadAttendanceProductionScope,attendanceProductionScopeSha256,attendanceProductionIdentity,
 attendanceProductionLegacy052SourceSha256,validateAttendanceRegistry,protectedAttendanceMigrationSql,
 attendance052CompatibilityPlan,validateAttendanceCompatibilityProof,attendanceReadOnlyStateSql,validateAttendanceProductionState} from './attendance-production-database-migrations.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const PILOT='/opt/faolla-attendance-pilot',OWNER='attendance-pilot-20261009';
const IMAGE='sha256:8613ba8eab946dff6674a2db6aab75b80aa101da39035fe20f62b0c7591ab35d';
const BASELINE='b1304d5d58841c2247b93229b90bb7adcfd64965';
const sha=x=>createHash('sha256').update(x).digest('hex'),hex=/^[a-f0-9]{64}$/,git=/^[a-f0-9]{40}$/;
const need=(x,c)=>{if(!x)throw Error(c);},eq=(a,b,c)=>{try{assert.deepEqual(a,b);}catch{throw Error(c);}};
const literal=x=>"'"+String(x).replaceAll("'","''")+"'",identifier=x=>'"'+String(x).replaceAll('"','""')+'"';
const pgText=x=>x===null?'null':`convert_from(decode('${Buffer.from(x,'utf8').toString('hex')}','hex'),'UTF8')`;
const FN=Object.keys(attendanceProductionLegacy052SourceSha256);
export const attendanceCompatibilityUtcCases=Object.freeze([null,'','UTC','utc','Utc',' UTC','UTC ','UTC\n','UTC\t','Etc/UTC','Etc/GMT','GMT','Europe/Madrid','America/New_York','Asia/Shanghai','Pacific/Auckland','Europe/Paris','Asia/Kathmandu','Africa/Cairo','Australia/Sydney','NOT_A_TIME_ZONE','UTC'.repeat(40),'\u0001','\u200bUTC','UTC\u00a0']);
export const attendanceCompatibilityPermissionCases=Object.freeze([null,[],['enterprise.view'],['enterprise.view','tasks.view'],['enterprise.view','roles.view','employees.view','employees.manage'],['enterprise.view','enterprise.view'],['tasks.view'],['not-a-permission']]);
function paths(target){const directory=`/var/lib/faolla-online-release/${target}`;return {directory,attempt:`${directory}/attendance-compatibility-attempt.json`,proof:`${directory}/attendance-database-compatibility.json`,metadata:`${directory}/attendance-compatibility-metadata.sql`};}
function inputs(input){need(git.test(input.target??'')&&input.baseline===BASELINE,'attendance_compatibility_target');need(hex.test(input.sourcePilotContainerId??'')&&input.sourcePilotContainerId!==attendanceProductionIdentity.containerId,'attendance_compatibility_pilot');return `faolla_attendance_compat_${input.target.slice(0,12)}`;}
async function owned(file,{directory=false,testOnly=false}={}){
 const info=await lstat(file);need(!info.isSymbolicLink()&&(directory?info.isDirectory():info.isFile()),'attendance_compatibility_evidence_type');
 if(!testOnly)need(info.uid===0&&(info.mode&0o022)===0,'attendance_compatibility_evidence_owner');
 need(await realpath(file)===file,'attendance_compatibility_evidence_path');return info;
}
async function privateWrite(file,value){const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');await writeFile(file,bytes,{flag:'wx',mode:0o600});return sha(bytes);}
async function run(input,args,sql,limit=1000000){
 const r=await(input.runCommand??runMigrationCommand)('docker',['--host','unix:///var/run/docker.sock',...args],{input:sql,timeoutMs:150000,outputLimitBytes:limit});
 need(r?.status===0&&!r.timedOut,'attendance_compatibility_command_failed');return String(r.stdout??'').trim();
}
function psql(input,database,readOnly=false){need(/^[a-z0-9_]{1,63}$/.test(database),'attendance_compatibility_db_name');return ['exec','-i',input.sourcePilotContainerId,'sh','-lc',
 `set -eu; : "\${POSTGRES_PASSWORD:?required}"; export PGPASSWORD="$POSTGRES_PASSWORD"; export PGOPTIONS='-c lock_timeout=3s -c statement_timeout=${readOnly?8000:120000} -c idle_in_transaction_session_timeout=15000 -c timezone=UTC -c DateStyle=ISO,YMD -c extra_float_digits=3'; exec psql -h 127.0.0.1 -U supabase_admin -d ${database} --no-password --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate`];}
async function sql(input,database,source,{json=false,readOnly=false}={}){const output=await run(input,psql(input,database,readOnly),source);return json?JSON.parse(output):output;}
async function inspect(input){
 const v=JSON.parse(await run(input,['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"privileged":{{json .HostConfig.Privileged}},"mounts":{{json .Mounts}},"running":{{json .State.Running}}}',input.sourcePilotContainerId]));
 need(v.id===input.sourcePilotContainerId&&v.id!==attendanceProductionIdentity.containerId&&v.name==='/faolla-attendance-pilot-db'&&v.image===IMAGE&&v.running===true&&v.network==='none'&&v.privileged===false&&!Object.keys(v.ports??{}).length,'attendance_compatibility_container');
 need(v.labels?.['com.docker.compose.project']==='faolla-attendance-pilot'&&v.labels?.['io.faolla.isolated-pilot']===OWNER,'attendance_compatibility_container_owner');
 need(v.mounts?.length>0&&v.mounts.every(m=>m.Type==='bind'&&m.Source.startsWith(PILOT+'/')&&!m.Source.includes('/../'))&&v.mounts.some(m=>m.Source===PILOT+'/runtime/db/data'&&m.RW===true),'attendance_compatibility_mount');return v;
}
export async function loadAttendance052CompatibilitySources({rootDir=ROOT,...input}={}){const scope=await loadAttendanceProductionScope({rootDir,...input});return {...scope,baseline:scope.manifest.baseline};}
async function productionMetadataState(input,manifest){
 const v=JSON.parse(await run(input,['inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',attendanceProductionIdentity.containerId]));
 need(v.id===attendanceProductionIdentity.containerId&&v.name==='/supabase-db'&&v.running===true&&v.mounts?.some(m=>m.Type==='bind'&&m.Source===attendanceProductionIdentity.dataSource&&m.RW===true),'attendance_compatibility_formal_container');
 const readonly=source=>run(input,psql({...input,sourcePilotContainerId:attendanceProductionIdentity.containerId},'postgres',true),source,4000000);
 const state=JSON.parse(await readonly(attendanceReadOnlyStateSql()));validateAttendanceProductionState(state,manifest,{fresh:true});
 const contract=JSON.parse(await readonly(attendanceCompatibilityMetadataContractSql()));return {state,contract};
}
function schemaOnlyTruncateMask(source){
 const permitted=[],statement=[];
 const finish=()=>{
  if(!statement.some(t=>t.kind==='word'&&t.value==='truncate')){statement.length=0;return;}
  let i=0;const allowed=[];
  const word=value=>statement[i]?.kind==='word'&&statement[i]?.value===value&&Boolean(++i);
  const symbol=value=>statement[i]?.kind==='symbol'&&statement[i]?.value===value&&Boolean(++i);
  const name=()=>{if(!['word','identifier'].includes(statement[i]?.kind))return false;i++;return true;};
  const qualified=()=>{if(!name())return false;while(symbol('.'))if(!name())return false;return true;};
  const names=()=>{if(!name())return false;while(symbol(','))if(!name())return false;return true;};
  const trigger=()=>{
   if(!word('create'))return false;
   if(word('or')&&!(word('replace')))return false;
   if(!word('trigger')||!name()||!(word('before')||word('after')))return false;
   do{
    const event=statement[i];
    if(event?.kind!=='word'||!['insert','delete','update','truncate'].includes(event.value))return false;i++;
    if(event.value==='truncate')allowed.push(event);
    if(event.value==='update'&&word('of')&&!names())return false;
   }while(word('or'));
   if(!word('on')||!qualified()||!word('for')||!word('each')||!word('statement')||!word('execute')||!(word('function')||word('procedure'))||!qualified()||!symbol('('))return false;
   if(!symbol(')')){
    do{if(!['word','identifier','literal','number'].includes(statement[i]?.kind))return false;i++;}while(symbol(','));
    if(!symbol(')'))return false;
   }
   return i===statement.length;
  };
  const grant=()=>{
   if(!word('grant'))return false;
   do{
    const privilege=statement[i];
    if(privilege?.kind!=='word'||!['select','insert','update','delete','truncate','references','trigger'].includes(privilege.value))return false;i++;
    if(privilege.value==='truncate')allowed.push(privilege);
    if(symbol('(')&&(!['select','insert','update','references'].includes(privilege.value)||!names()||!symbol(')')))return false;
   }while(symbol(','));
   if(!word('on'))return false;word('table');
   if(!qualified())return false;while(symbol(','))if(!qualified())return false;
   if(!word('to')||!names())return false;
   if(word('with')&&!(word('grant')&&word('option')))return false;
   if(word('granted')&&!(word('by')&&name()))return false;
   return i===statement.length;
  };
  let valid=trigger();
  if(!valid){i=0;allowed.length=0;valid=grant();}
  need(valid&&statement.every(t=>t.kind!=='word'||t.value!=='truncate'||allowed.includes(t)),'attendance_compatibility_metadata_not_schema_only');
  permitted.push(...allowed);statement.length=0;
 };
 // Inspect each statement without treating comment/string semicolons as boundaries.
 // Only the specific event/privilege tokens are masked, never a complete statement.
 for(let i=0;i<source.length;){
  const start=i,c=source[i];
  if(/\s/.test(c)){i++;continue;}
  if(source.startsWith('--',i)){i+=2;while(i<source.length&&!['\r','\n'].includes(source[i]))i++;continue;}
  if(source.startsWith('/*',i)){
   i+=2;let depth=1;while(i<source.length&&depth){if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else i++;}
   need(depth===0,'attendance_compatibility_metadata_not_schema_only');continue;
  }
  if(c==='"'||c==="'"){
   const escaped=c==="'"&&/[eE]/.test(source[i-1]??'')&&!/[a-z0-9_$]/i.test(source[i-2]??'');
   i++;let closed=false;while(i<source.length){if(escaped&&source[i]==='\\'){i+=2;continue;}if(source[i]===c){if(source[i+1]===c){i+=2;continue;}i++;closed=true;break;}i++;}
   need(closed,'attendance_compatibility_metadata_not_schema_only');statement.push({kind:c==='"'?'identifier':'literal',start,end:i});continue;
  }
  const token=source.slice(i).match(/^[a-z_][a-z0-9_$]*|^[0-9]+(?:\.[0-9]+)?/i);
  if(token){i+=token[0].length;statement.push({kind:/^[0-9]/.test(token[0])?'number':'word',value:token[0].toLowerCase(),start,end:i});continue;}
  i++;if(c===';')finish();else statement.push({kind:'symbol',value:c,start,end:i});
 }
 finish();
 let result=source;for(const t of permitted.toReversed())result=result.slice(0,t.start)+' '.repeat(t.end-t.start)+result.slice(t.end);
 return result;
}
export function validateAttendance052SchemaOnlySql(source){
 need(typeof source==='string'&&source.length>0&&source.length<16000000,'attendance_compatibility_metadata_size');let masked=source,match;
 const bodies=/\bCREATE(?:\s+OR\s+REPLACE)?\s+(?:FUNCTION|PROCEDURE)\b[\s\S]*?\bAS\s+(\$(?:[a-z_][a-z0-9_]*)?\$)/gi;
 while((match=bodies.exec(source))){const start=bodies.lastIndex,end=source.indexOf(match[1],start);need(end>=start,'attendance_compatibility_metadata_delimiter');masked=masked.slice(0,start)+masked.slice(start,end).replace(/[^\r\n]/g,' ')+masked.slice(end);bodies.lastIndex=end+match[1].length;}
 masked=schemaOnlyTruncateMask(masked);
 // No data commands, globals, database selection or production credentials.
 // Preserve ALL actual052 public/Auth triggers/owners/grants/RLS/definitions.
 need(!/(?:^|\n)\s*\\|\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|DATABASE)\b|\b(?:INSERT\s+INTO|COPY\s+[^;\n]+\s+FROM|TRUNCATE\s+|DELETE\s+FROM|SELECT\s+pg_catalog\.setval)\b/i.test(masked),'attendance_compatibility_metadata_not_schema_only');
 return {sql:source,sha256:sha(source)};
}

const jsonHash=expression=>`encode(sha256(convert_to(coalesce((${expression})::text,'null'),'UTF8')),'hex')`;
// No password, connection setting, Config.Env, real identity or raw row output.
const roleHash=()=>jsonHash("jsonb_build_object('roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by oid) from pg_roles r),'members',(select jsonb_agg(to_jsonb(m) order by roleid,member) from pg_auth_members m))");
function catalogHash(schemaCondition){return jsonHash(`jsonb_build_object(
 'namespaces',(select jsonb_agg(to_jsonb(n) order by oid) from pg_namespace n where ${schemaCondition.replaceAll('s.', 'n.')}),
 'relations',(select jsonb_agg(to_jsonb(c)-array['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'] order by c.oid) from pg_class c join pg_namespace s on s.oid=c.relnamespace where ${schemaCondition}),
 'attributes',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace where ${schemaCondition}),
 'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where ${schemaCondition}),
 'types',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_type t join pg_namespace s on s.oid=t.typnamespace where ${schemaCondition}),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace s on s.oid=c.relnamespace where ${schemaCondition}),
 'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace s on s.oid=c.relnamespace where ${schemaCondition}),
 'constraints',(select jsonb_agg(to_jsonb(k) order by k.oid) from pg_constraint k join pg_namespace s on s.oid=k.connamespace where ${schemaCondition}),
 'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d left join pg_namespace s on s.oid=d.defaclnamespace where s.oid is null or ${schemaCondition}))`);}
export function guardedAttendanceCompatibilitySourceSql(source,database){
 need(/^[a-z0-9_]{1,63}$/.test(database),'attendance_compatibility_db_name');
 const transactions=[...source.matchAll(/(?:^|\r?\n)begin;/gi)],commits=[...source.matchAll(/(?:^|\r?\n)commit;/gi)];need(transactions.length>0&&transactions.length===commits.length&&transactions.length<=2,'attendance_compatibility_source_transaction');
 const lineOffset=m=>m.index+(m[0].startsWith('\r\n')?2:m[0].startsWith('\n')?1:0),last=lineOffset(commits.at(-1));
 // No executable tail can escape the controlled new-database transaction.
 need(!source.slice(last+'commit;'.length).trim(),'attendance_compatibility_source_tail');
 const entry=`\nset local lock_timeout='3s';\ndo $attendance_compatibility_database_guard$ begin if current_database()<>${literal(database)} or current_user<>'supabase_admin' then raise exception 'attendance_compatibility_database_guard';end if;end;$attendance_compatibility_database_guard$;\ncreate temp table attendance_compatibility_roles_guard(h text not null) on commit drop;insert into attendance_compatibility_roles_guard values(${roleHash()});\n`;
 const exit=`\ndo $attendance_compatibility_roles_guard$ begin if (select h from pg_temp.attendance_compatibility_roles_guard)<>${roleHash()} then raise exception 'attendance_compatibility_roles_changed';end if;end;$attendance_compatibility_roles_guard$;\n`;
 // The constructed schema-only clone has one controlled transaction.
 let result=source;
 for(let i=transactions.length-1;i>=0;i--){const begin=transactions[i],end=lineOffset(commits[i]);need(begin.index<end&&(i===0||commits[i-1].index<begin.index),'attendance_compatibility_source_transaction');const segment=source.slice(begin.index,end),isolation=segment.match(/(?:^|\r?\n)set transaction isolation level [a-z ]+;/i),at=isolation?begin.index+isolation.index+isolation[0].length:begin.index+begin[0].length;result=result.slice(0,at)+entry+result.slice(at,end)+exit+result.slice(end);}
 need(result.split(entry).join('').split(exit).join('')===source,'attendance_compatibility_original_changed');return result;
}
const aclEntries=expr=>`(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type) from aclexplode(${expr}) a)`;
// Cross-database metadata contract uses names, resolved type/DDL definitions
// and normalized ACL roles, never database-local OIDs or physical row stats.
// Full pg_proc/OID guards are compared separately within the new database.
export function attendanceCompatibilityMetadataContractSql(){const user="s.nspname<>'information_schema' and s.nspname!~'^pg_'";return `-- attendance_compatibility_metadata_contract
begin read only;set local statement_timeout='8s';set local search_path=pg_catalog,public;
select to_jsonb(${jsonHash(`jsonb_build_object(
 'schemas',(select jsonb_agg(jsonb_build_array(s.nspname,pg_get_userbyid(s.nspowner),${aclEntries("coalesce(s.nspacl,acldefault('n',s.nspowner))")}) order by s.nspname) from pg_namespace s where ${user}),
 'relations',(select jsonb_agg(jsonb_build_array(s.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,${aclEntries("coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::\"char\" else 'r'::\"char\" end,c.relowner))")},
  (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,(select n.nspname||'.'||collname from pg_collation col join pg_namespace n on n.oid=col.collnamespace where col.oid=a.attcollation),pg_get_expr(d.adbin,d.adrelid),${aclEntries('a.attacl')}) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  case when c.relkind in('v','m') then pg_get_viewdef(c.oid,true) else null end) order by s.nspname,c.relname) from pg_class c join pg_namespace s on s.oid=c.relnamespace where ${user} and c.relkind in('r','p','v','m','S')),
 'functions',(select jsonb_agg(jsonb_build_array(s.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),pg_get_userbyid(p.proowner),l.lanname,p.provolatile,p.prosecdef,p.proisstrict,p.proparallel,p.proleakproof,p.proretset,p.procost,p.prorows,p.proargnames,p.proargmodes,p.proconfig,p.pronargdefaults,pg_get_expr(p.proargdefaults,0),replace(p.prosrc,E'\\r\\n',E'\\n'),${aclEntries("coalesce(p.proacl,acldefault('f',p.proowner))")}) order by s.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace s on s.oid=p.pronamespace join pg_language l on l.oid=p.prolang where ${user}),
 'constraints',(select jsonb_agg(jsonb_build_array(s.nspname,c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)) order by s.nspname,c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace s on s.oid=c.relnamespace where ${user}),
 'triggers',(select jsonb_agg(jsonb_build_array(s.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) order by s.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace s on s.oid=c.relnamespace where ${user} and not t.tgisinternal),
 'policies',(select jsonb_agg(jsonb_build_array(s.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,(select array_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by s.nspname,c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace s on s.oid=c.relnamespace where ${user}),
 'defaults',(select jsonb_agg(jsonb_build_array(pg_get_userbyid(d.defaclrole),s.nspname,d.defaclobjtype,${aclEntries('d.defaclacl')}) order by pg_get_userbyid(d.defaclrole),s.nspname,d.defaclobjtype) from pg_default_acl d left join pg_namespace s on s.oid=d.defaclnamespace),
 'extensions',(select jsonb_agg(jsonb_build_array(e.extname,e.extversion,s.nspname,pg_get_userbyid(e.extowner)) order by e.extname) from pg_extension e join pg_namespace s on s.oid=e.extnamespace))`)})::text;commit;\n`;}
export function attendanceCompatibilitySourceProbeSql(databaseName){need(/^[a-z0-9_]{1,63}$/.test(databaseName),'attendance_compatibility_db_name');return `-- attendance_compatibility_source_probe
begin read only;set local statement_timeout='8s';
select jsonb_build_object('databaseOid',(select oid::text from pg_database where datname=current_database()),'databaseName',current_database(),
 'systemIdentifier',(select system_identifier::text from pg_control_system()),'serverVersionNum',current_setting('server_version_num'),'currentUser',current_user,
 'adminSuperuser',(select rolsuper from pg_roles where rolname='supabase_admin'),'postgresSuperuser',(select rolsuper from pg_roles where rolname='postgres'),
 'legacyAdminEdge',exists(select 1 from pg_auth_members where roleid=to_regrole('supabase_admin') and member=to_regrole('authenticator')),
 'existingCompatibilityDatabase',exists(select 1 from pg_database where datname=${literal(databaseName)}),'authUsers',(select count(*) from auth.users),
 'merchants',(select count(*) from public.merchants),'staff',(select count(*) from public.merchant_enterprise_employees),'storageObjects',(select count(*) from storage.objects),
 'rolesSha256',${roleHash()},'catalogSha256',${catalogHash("s.nspname in ('public','auth','storage','extensions')")},
 'publicAcl',(select jsonb_build_object('owner',pg_get_userbyid(nspowner),'entries',${aclEntries("coalesce(nspacl,acldefault('n',nspowner))")}) from pg_namespace where nspname='public'),
 'defaultAcls',(select coalesce(jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',s.nspname,'type',d.defaclobjtype,'entries',${aclEntries('d.defaclacl')}) order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb) from pg_default_acl d left join pg_namespace s on s.oid=d.defaclnamespace)
)::text;commit;\n`;}
function validateSource(v){need(v.databaseName==='postgres'&&v.databaseOid==='5'&&v.currentUser==='supabase_admin'&&v.serverVersionNum==='150008'&&v.adminSuperuser===true&&v.postgresSuperuser===false&&v.legacyAdminEdge===false,'attendance_compatibility_source_roles');
 need(v.systemIdentifier!==attendanceProductionIdentity.systemIdentifier&&/^[0-9]{10,24}$/.test(v.systemIdentifier)&&hex.test(v.rolesSha256)&&hex.test(v.catalogSha256),'attendance_compatibility_source_identity');
 need(v.authUsers===0&&v.merchants===0&&v.staff===0&&v.storageObjects===0,'attendance_compatibility_source_not_empty');}

// Default ACLs are DATABASE metadata. Never ALTER ROLE or grant memberships.
// Source grantor/ACL entries are retained, including the legitimate postgres
// bootstrap TABLE defaults which motivated the reviewed conditional REVOKEs.
export function attendanceCompatibilityPublicAclSql(source){
 const quoteRole=r=>r==='PUBLIC'?'PUBLIC':identifier(r),types={r:'TABLES',S:'SEQUENCES',f:'FUNCTIONS',T:'TYPES',n:'SCHEMAS'};
 const entry=(e,object,scope='')=>{need(typeof e.grantor==='string'&&typeof e.grantee==='string'&&/^[A-Z ]+$/.test(e.privilege)&&typeof e.grantable==='boolean','attendance_compatibility_acl_entry');return `set local role ${identifier(e.grantor)};${scope}grant ${e.privilege} on ${object} to ${quoteRole(e.grantee)}${e.grantable?' with grant option':''};reset role;`;};
 need(source.publicAcl?.owner&&Array.isArray(source.publicAcl.entries)&&Array.isArray(source.defaultAcls),'attendance_compatibility_acl_missing');
 let out=`-- attendance_compatibility_public_acl\nbegin;alter schema public owner to ${identifier(source.publicAcl.owner)};revoke all privileges on schema public from public;\n`;
 for(const e of source.publicAcl.entries)out+=entry(e,'schema public')+'\n';
 for(const d of source.defaultAcls){need(types[d.type]&&d.owner&&Array.isArray(d.entries)&&(!d.schema||/^[a-z0-9_]+$/.test(d.schema)),'attendance_compatibility_acl_scope');const prefix=`alter default privileges for role ${identifier(d.owner)}${d.schema?` in schema ${identifier(d.schema)}`:''} `;
  const grantees=new Set(['PUBLIC',d.owner,...d.entries.map(e=>e.grantee)]);
  for(const r of grantees)out+=`${prefix}revoke all privileges on ${types[d.type]} from ${quoteRole(r)};\n`;
  for(const e of d.entries)out+=entry(e,types[d.type],prefix)+'\n';
 }
 return out+'commit;\n';
}

export function attendanceCompatibilityFixturesSql(){return `-- attendance_compatibility_synthetic_fixtures
begin;
insert into public.merchants(id,name,user_id,email) values('99999001','SYNTHETIC COMPATIBILITY ONLY','90000000-0000-4000-8000-000000000001','compat-owner@example.invalid');
insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
 ('90000000-0000-4000-8000-000000000011','99999001','Synthetic manager',array['enterprise.view','tasks.view','roles.view','employees.view','employees.manage']),
 ('90000000-0000-4000-8000-000000000012','99999001','Synthetic worker',array['enterprise.view','tasks.view']);
insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,initial_password_policy,accepted_at) values
 ('90000000-0000-4000-8000-000000000021','99999001','90000000-0000-4000-8000-000000000031','compat-manager@example.invalid','Synthetic manager','90000000-0000-4000-8000-000000000011','active','waived','2026-10-09T00:00:00Z'),
 ('90000000-0000-4000-8000-000000000022','99999001','90000000-0000-4000-8000-000000000032','compat-worker@example.invalid','Synthetic worker','90000000-0000-4000-8000-000000000012','active','waived','2026-10-09T00:00:00Z');
insert into public.pages(merchant_id,slug,blocks) values('99999001','compatibility',jsonb_build_array(jsonb_build_object('type','text','text','SYNTHETIC ONLY')));
commit;\n`;}
export function attendanceCompatibilityEmployeeSql(actor='owner',disable=false){need(['owner','employee'].includes(actor),'attendance_compatibility_actor');const payload={merchant_id:'99999001',employee_id:'90000000-0000-4000-8000-000000000022',expected_version:1,actor_type:actor,actor_id:actor==='owner'?'90000000-0000-4000-8000-000000000001':'90000000-0000-4000-8000-000000000021',...(disable?{status:'disabled',offboarding_mode:'unassign'}:{display_name:'Synthetic changed'})};
 return `-- attendance_compatibility_employee_legacy_${actor}_${disable?'disable':'rename'}
begin;set local lock_timeout='3s';set local statement_timeout='10s';
create temp table compat_employee_result(r jsonb) on commit drop;
grant insert on table pg_temp.compat_employee_result to service_role;
set local role service_role;
insert into pg_temp.compat_employee_result values(public.faolla_update_merchant_enterprise_employee_v1(${literal(JSON.stringify(payload))}::jsonb));
reset role;
do $compat_employee_legacy$ begin
 if not exists(select 1 from public.merchant_enterprise_employees where id='90000000-0000-4000-8000-000000000022' and version=2 and status='${disable?'disabled':'active'}' and display_name='${disable?'Synthetic worker':'Synthetic changed'}') then raise exception 'attendance_compatibility_employee_legacy_result';end if;
 if (select count(*) from public.merchant_enterprise_audit_events where merchant_id='99999001' and event_type like 'employee.%')<1 then raise exception 'attendance_compatibility_employee_audit_missing';end if;
end;$compat_employee_legacy$;
select jsonb_build_object('result',(select r from pg_temp.compat_employee_result)-'employee','employee',(select (r->'employee')-'updated_at'-'created_at' from pg_temp.compat_employee_result),'legacyInput',true)::text;
rollback;\n`;
}
const permissionsSql=()=>`-- attendance_compatibility_permission_inputs\nbegin read only;select jsonb_agg(jsonb_build_object('input',p,'accepted',public.faolla_valid_merchant_enterprise_permissions_v1(p)) order by n)::text from (values ${attendanceCompatibilityPermissionCases.map((a,i)=>`(${i},${a===null?'null::text[]':`array[${a.map(literal).join(',')}]::text[]`})`).join(',')}) x(n,p);commit;\n`;
function snapshotSql(){return `-- attendance_compatibility_snapshot
begin read only;set local statement_timeout='8s';select jsonb_build_object(
 'databaseOid',(select oid::text from pg_database where datname=current_database()),'backendPid',pg_backend_pid(),'owner',current_user,
 'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations),
 'attendanceRelations',(select count(*) from pg_class where relnamespace='public'::regnamespace and relname like 'merchant_attendance_%'),
 'attendanceFunctions',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'faolla_attendance_%'),
 'authUsers',(select count(*) from auth.users),'outsideSha256',${catalogHash("s.nspname in ('auth','storage','extensions')")},'rolesSha256',${roleHash()},
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'columns',(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') and c.relname<>'faolla_schema_migrations'),
 'functions',(select jsonb_object_agg(x.name,jsonb_build_object('metadata',to_jsonb(p)-'prosrc','sourceSha256',encode(sha256(convert_to(replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex'))) from unnest(array[${FN.map(literal).join(',')}]) x(name) join pg_proc p on p.oid=to_regprocedure('public.'||x.name))
)::text;commit;\n`;}
export function attendanceCompatibilityFactsSql(tables){need(Array.isArray(tables)&&tables.length>3&&tables.length<300,'attendance_compatibility_tables');return `-- attendance_compatibility_baseline_facts\nbegin read only;set local statement_timeout='10s';select to_jsonb(${jsonHash(`jsonb_build_array(${tables.map(t=>{need(/^[a-z0-9_]+$/.test(t.name)&&Array.isArray(t.columns)&&t.columns.length>0&&t.columns.every(x=>/^[a-z0-9_]+$/.test(x)),'attendance_compatibility_columns');return `jsonb_build_array(${literal(t.name)},(select count(*) from public.${identifier(t.name)}),${jsonHash(`(select jsonb_agg(v order by v) from (select ${jsonHash(`to_jsonb(t)-array(select key from jsonb_object_keys(to_jsonb(t)) key where key<>all(array[${t.columns.map(literal).join(',')}]::text[]))`)} v from public.${identifier(t.name)} t) r)`)})`;}).join(',')})`)})::text;commit;\n`;}
export function attendanceCompatibilityUtcSql(expression){need(typeof expression==='string'&&expression.includes('pg_timezone_names')&&!expression.includes(';'),'attendance_compatibility_utc_expression');return `-- attendance_compatibility_utc_25\nbegin read only;select jsonb_build_object('metadata',(select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='public.faolla_attendance_valid_zone_v1(text)'::regprocedure),'sourceSha256',(select encode(sha256(convert_to(replace(prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex') from pg_proc where oid='public.faolla_attendance_valid_zone_v1(text)'::regprocedure),'cases',(select jsonb_agg(jsonb_build_object('input',p_zone,'old',(${expression}),'current',public.faolla_attendance_valid_zone_v1(p_zone)) order by n) from (values ${attendanceCompatibilityUtcCases.map((x,i)=>`(${i},${pgText(x)}::text)`).join(',')}) x(n,p_zone)))::text;commit;\n`;}
function originalUtcExpression(foundation){const body=foundation.match(/create or replace function public\.faolla_attendance_valid_zone_v1\(p_zone text\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1]?.replaceAll('\r\n','\n');need(body&&sha(body)==='3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d','attendance_compatibility_utc_source');const expression=body.match(/^\n  select ([\s\S]*);\n$/)?.[1];need(expression,'attendance_compatibility_utc_source');return expression;}

export async function runAttendance052Compatibility(input={}){
 const database=inputs(input),assets=await loadAttendance052CompatibilitySources(input),p=input.paths??paths(input.target);
 if(input.testOnly!==true)need(process.platform==='linux'&&process.getuid?.()===0,'attendance_compatibility_linux_root');
 // Only the separately approved, already-built application may use a reviewed
 // source-only tool revision. A mock/test flag cannot provide this real proof.
 let repair=null;
 if(input.target==='a535a308e21f121e7cf410a6f7d84c974eb370a6'){
  const {verifyAttendanceStagedToolRepairReceipt}=await import('./attendance-staged-tool-repair.mjs');
  repair=verifyAttendanceStagedToolRepairReceipt({target:input.target,rootDir:input.rootDir??ROOT,phase:'staged'});
 }
 const audit=repair?{toolRevision:repair.toolRevision,stagedToolRepairReceiptSha256:repair.receiptSha256}:{};
 await owned(p.directory,{directory:true,testOnly:input.testOnly});if(input.testOnly!==true){let ancestor=path.dirname(p.directory);for(;;){await owned(ancestor,{directory:true});const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}}
 if(input.testOnly!==true){await owned(PILOT,{directory:true});await owned(PILOT+'/.pilot-owner.json');const marker=JSON.parse(await readFile(PILOT+'/.pilot-owner.json','utf8'));need(marker.owner===OWNER&&marker.root===PILOT&&marker.project==='faolla-attendance-pilot','attendance_compatibility_owner_marker');}
 await inspect(input);const beforeSource=await sql(input,'postgres',attendanceCompatibilitySourceProbeSql(database),{json:true,readOnly:true});validateSource(beforeSource);
 need(beforeSource.existingCompatibilityDatabase===false,'attendance_compatibility_database_already_exists');
 const formalBefore=await productionMetadataState(input,assets.manifest);
 if(input.apply!==true)return {schemaVersion:1,kind:'attendance-052-upgrade-compatibility-dry-run',target:input.target,baseline:input.baseline,...audit,databaseName:database,sourcePilotContainerId:input.sourcePilotContainerId,scopeSha256:assets.scopeSha256,baselineCount:60,migrationCount:149,productionDataCopied:false,executed:false};
 need(input.confirm==='approved-isolated-052-210-compatibility','attendance_compatibility_explicit_approval');
 const dump=await run(input,['exec',attendanceProductionIdentity.containerId,'sh','-lc','set -eu; : "${POSTGRES_PASSWORD:?required}"; export PGPASSWORD="$POSTGRES_PASSWORD"; export PGOPTIONS="-c default_transaction_read_only=on -c lock_timeout=3s -c statement_timeout=120000"; exec pg_dump -h 127.0.0.1 -U supabase_admin -d postgres --schema-only --no-comments --no-security-labels --no-publications --no-subscriptions'],undefined,16000000);
 const metadata=validateAttendance052SchemaOnlySql(dump+'\n'),transcript=[];
 const formalAfterDump=await productionMetadataState(input,assets.manifest);eq(formalAfterDump,formalBefore,'attendance_compatibility_formal_metadata_drift');
 await privateWrite(p.metadata,metadata.sql);await privateWrite(p.attempt,{schemaVersion:1,kind:'attendance-052-upgrade-compatibility-attempt',target:input.target,baseline:input.baseline,...audit,databaseName:database,sourcePilotContainerId:input.sourcePilotContainerId,sourceSystemIdentifier:beforeSource.systemIdentifier,scopeSha256:assets.scopeSha256,productionSchemaOnlyRead:true,productionDataCopied:false,metadataSourceSha256:metadata.sha256,formalMetadataStateSha256:sha(JSON.stringify(formalBefore)),sourceCatalogSha256:beforeSource.catalogSha256,sourceRolesSha256:beforeSource.rolesSha256});
 const exec=async(source,label)=>{await inspect(input);await sql(input,database,source);transcript.push({label,sqlSha256:sha(source),passed:true});input.onProgress?.({label});};
 // The only statement targeting pilot postgres is CREATE of this unique name.
 // Existing pilot postgres is never installed into or repaired.
 await sql(input,'postgres',`create database ${identifier(database)} with template template0 owner supabase_admin;`);
 await exec(guardedAttendanceCompatibilitySourceSql('begin;\n'+metadata.sql+'\ncommit;\n',database),'actual-formal052-schema-only-metadata');
 eq(await sql(input,database,attendanceCompatibilityMetadataContractSql(),{json:true,readOnly:true}),formalBefore.contract,'attendance_compatibility_clone_metadata_contract');
 await exec(`-- attendance_compatibility_registry_system_metadata\nbegin;insert into public.faolla_schema_migrations(version,name) values ${assets.baseline.map(x=>`(${x.version},${literal(x.name)})`).join(',')};commit;\n`,'fixed-60-registry-system-metadata');
 const empty=await sql(input,database,snapshotSql(),{json:true,readOnly:true});need(empty.owner==='supabase_admin'&&empty.authUsers===0&&empty.attendanceRelations===0&&empty.attendanceFunctions===0,'attendance_compatibility_baseline_not_empty');eq(empty.registry,assets.manifest.baseline,'attendance_compatibility_baseline_registry');
 for(const fn of FN)need(empty.functions?.[fn]?.sourceSha256===attendanceProductionLegacy052SourceSha256[fn],'attendance_compatibility_legacy_source');
 await exec(attendanceCompatibilityFixturesSql(),'synthetic-legacy-fixtures');
 const start=await sql(input,database,snapshotSql(),{json:true,readOnly:true}),factsSql=attendanceCompatibilityFactsSql(start.tables),beforeFacts=await sql(input,database,factsSql,{json:true,readOnly:true});
 const beforePermissions=await sql(input,database,permissionsSql(),{json:true,readOnly:true});
 const employeeTests=[];for(const actor of ['owner','employee'])for(const disable of [false,true])employeeTests.push(await sql(input,database,attendanceCompatibilityEmployeeSql(actor,disable),{json:true}));
 eq(await sql(input,database,factsSql,{json:true,readOnly:true}),beforeFacts,'attendance_compatibility_employee_rollback');
 const expression=originalUtcExpression(assets.sources[0].source);let utcBefore;
 for(let i=0;i<149;i++){const m=assets.sources[i];if(i===148)utcBefore=await sql(input,database,attendanceCompatibilityUtcSql(expression),{json:true,readOnly:true});await exec(protectedAttendanceMigrationSql(m,i,assets.manifest),m.version);}
 const final=await sql(input,database,snapshotSql(),{json:true,readOnly:true});validateAttendanceRegistry(final.registry,assets.manifest,{complete:true});
 const afterFacts=await sql(input,database,factsSql,{json:true,readOnly:true});eq(afterFacts,beforeFacts,'attendance_compatibility_legacy_rows_changed');
 eq(await sql(input,database,permissionsSql(),{json:true,readOnly:true}),beforePermissions,'attendance_compatibility_legacy_permission_inputs');
 let n=0;for(const actor of ['owner','employee'])for(const disable of [false,true])eq(await sql(input,database,attendanceCompatibilityEmployeeSql(actor,disable),{json:true}),employeeTests[n++],'attendance_compatibility_legacy_employee_update');
 eq(await sql(input,database,factsSql,{json:true,readOnly:true}),beforeFacts,'attendance_compatibility_final_rollback');
 // Deliberate wrapper search_path change is accounted for; its original OID,
 // owner, ACL, language/arguments/return/security and other metadata remain.
 eq(final.functions[FN[0]].metadata,start.functions[FN[0]].metadata,'attendance_compatibility_validator_metadata');
 eq(final.functions[FN[2]],start.functions[FN[2]],'attendance_compatibility_019_delegate');
 const oldMeta={...start.functions[FN[1]].metadata},newMeta={...final.functions[FN[1]].metadata};delete oldMeta.proconfig;delete newMeta.proconfig;eq(oldMeta,newMeta,'attendance_compatibility_employee_metadata');eq(final.functions[FN[1]].metadata.proconfig,['search_path=pg_catalog'],'attendance_compatibility_employee_search_path');
 const utcAfter=await sql(input,database,attendanceCompatibilityUtcSql(expression),{json:true,readOnly:true});need(utcBefore.sourceSha256==='3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d'&&utcAfter.sourceSha256==='03b6beb68f9e439e7d1761f2970f8520d80c28491ec1ddc1891c496774eb1ac6','attendance_compatibility_utc_hashes');eq(utcBefore.metadata,utcAfter.metadata,'attendance_compatibility_utc_oid_acl');eq(utcAfter.cases.map(x=>x.input),attendanceCompatibilityUtcCases,'attendance_compatibility_utc_inputs');need(utcAfter.cases.length===25&&utcAfter.cases.every(x=>x.current===x.old),'attendance_compatibility_utc_results');eq(utcBefore.cases,utcAfter.cases,'attendance_compatibility_utc_equivalence');
 eq(final.outsideSha256,start.outsideSha256,'attendance_compatibility_outside_catalog');eq(final.rolesSha256,beforeSource.rolesSha256,'attendance_compatibility_cluster_roles');
 const noBackfill=await sql(input,database,"-- attendance_compatibility_no_backfill\nbegin read only;select jsonb_build_object('settings',(select count(*) from public.merchant_attendance_settings),'workers',(select count(*) from public.merchant_attendance_workers),'newRolePermissions',exists(select 1 from public.merchant_enterprise_roles r,unnest(r.permissions) p where p like 'attendance.%'))::text;commit;\n",{json:true,readOnly:true});eq(noBackfill,{settings:0,workers:0,newRolePermissions:false},'attendance_compatibility_auto_enable');
 const afterSource=await sql(input,'postgres',attendanceCompatibilitySourceProbeSql(database),{json:true,readOnly:true});validateSource(afterSource);eq(afterSource.catalogSha256,beforeSource.catalogSha256,'attendance_compatibility_existing_pilot_catalog_changed');eq(afterSource.rolesSha256,beforeSource.rolesSha256,'attendance_compatibility_existing_roles_changed');
 const formalAfter=await productionMetadataState(input,assets.manifest);eq(formalAfter,formalBefore,'attendance_compatibility_formal_changed');
 const checks=Object.fromEntries(attendance052CompatibilityPlan(input).checks.map(x=>[x,true]));
 const proof={schemaVersion:1,kind:'attendance-052-upgrade-compatibility',target:input.target,baseline:input.baseline,...audit,scopeSha256:attendanceProductionScopeSha256,databaseName:database,sourcePilotContainerId:input.sourcePilotContainerId,sourcePilotSystemIdentifier:beforeSource.systemIdentifier,databaseOid:start.databaseOid,backendPid:start.backendPid,owner:'supabase_admin',productionDataCopied:false,
  baselineRegistryCount:60,baselineRegistryMaximum:'202609240052',initialAttendanceRelations:empty.attendanceRelations,initialAttendanceFunctions:empty.attendanceFunctions,finalRegistryCount:final.registry.length,finalRegistryMaximum:final.registry.at(-1).version,checks,
  transcriptSha256:sha(JSON.stringify({transcript,metadataSourceSha256:metadata.sha256,formalBefore,formalAfter,permissions:beforePermissions,employeeTests,utcBefore,utcAfter,noBackfill})),legacyFingerprintBefore:beforeFacts,legacyFingerprintAfter:afterFacts,outsideCatalogSha256Before:start.outsideSha256,outsideCatalogSha256After:final.outsideSha256,clusterRolesSha256Before:beforeSource.rolesSha256,clusterRolesSha256After:afterSource.rolesSha256,
  productionMetadataSource:{identity:attendanceProductionIdentity,registryCount:60,registryMaximum:'202609240052',schemaOnly:true,productionDataCopied:false,metadataSourceSha256:metadata.sha256,normalizedContractSha256:formalBefore.contract,formalStateSha256Before:sha(JSON.stringify(formalBefore)),formalStateSha256After:sha(JSON.stringify(formalAfter))},originalAttendanceSourcesInstalled:149,historicalBootstrapReplayed:false,utcCases:25,employeeLegacyCases:4,realHttpAuthAccepted:false,productionRestoreProved:false,completedAt:new Date().toISOString()};
 validateAttendanceCompatibilityProof(proof,{...input,scopeSha256:assets.scopeSha256});const proofSha256=await privateWrite(p.proof,proof);return {...proof,proofSha256};
}
export function parseAttendanceCompatibilityArguments(argv){const command=argv[0]??'dry-run';need(['dry-run','apply'].includes(command),'attendance_compatibility_command');const out={apply:command==='apply'};
 for(let i=1;i<argv.length;i++){need(['--target','--baseline','--source-pilot-container-id','--confirm'].includes(argv[i]),'attendance_compatibility_argument');const key=argv[i].slice(2).replace(/-([a-z])/g,(_,x)=>x.toUpperCase());need(!Object.hasOwn(out,key)&&argv[i+1]&&!argv[i+1].startsWith('--'),'attendance_compatibility_argument');out[key]=argv[++i];}
 inputs(out);if(!out.apply)need(!out.confirm,'attendance_compatibility_dry_run_confirm');return out;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)runAttendance052Compatibility({...parseAttendanceCompatibilityArguments(process.argv.slice(2)),onProgress:x=>process.stderr.write(JSON.stringify(x)+'\n')}).then(x=>process.stdout.write(JSON.stringify(x)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({ok:false,error:/^attendance_[a-z0-9_]+$/.test(e?.message??'')?e.message:'attendance_compatibility_failed'})+'\n');process.exitCode=1;});
