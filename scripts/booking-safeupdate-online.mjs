import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {attendanceProductionIdentity as identity,attendanceProductionScopeSha256} from './attendance-production-database-migrations.mjs';
import {BOOKING_MIGRATIONS,validateBookingRegistry} from './booking-publication-database.mjs';
import {acquireProductionMigrationLock} from './apply-production-database-migrations.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const sha=value=>createHash('sha256').update(value).digest('hex');
export const bookingSafeupdateScope=Object.freeze({
  base:'fe11d715e62fe3d014492b995e94fb929b07a20d',
  live:'f274ad615550c83717aa7af2ad32339608e6f8aa',
  version:'202611050213',name:'booking_atomic_safeupdate_singleton',
  fileName:'202611050213_booking_atomic_safeupdate_singleton.sql',
  sha256:'92c413c5877bcf09b45c83085ef637a9377ef4dd10dd4e830a46f7e28f42a769',
  signature:'public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)',
  before:'310b382802e94af2997b1b9751fab0bc',after:'09fa13e69856221d61b6eaa544927b2a',
});
export const bookingSafeupdateAllowedFiles=Object.freeze([
  '.github/workflows/booking-safeupdate-online.yml','package.json',
  'scripts/booking-atomic-postgres-acceptance.mjs','scripts/booking-atomic-safeupdate-contract.test.mjs',
  'scripts/booking-safeupdate-online-workflow.mjs','scripts/booking-safeupdate-online.mjs','scripts/booking-safeupdate-online.test.mjs',
  'scripts/supabase-migrations/'+bookingSafeupdateScope.fileName,
].sort());
export function bookingSafeupdateOldRegistry(){
  const bytes=fs.readFileSync(root+'/scripts/attendance-production-database-migrations.manifest.json');
  need(sha(bytes)===attendanceProductionScopeSha256,'old_manifest_changed');
  const manifest=JSON.parse(bytes);
  const registry=[...manifest.baseline,...manifest.migrations.map(({version,name})=>({version,name})),...BOOKING_MIGRATIONS.map(({version,name})=>({version,name}))];
  validateBookingRegistry({registry,bookingTables:3},manifest,{installed:true});
  return registry;
}
function need(value,code){if(!value)throw new Error('booking_safeupdate_online_'+code);}
function run(command,args,input){
  const r=spawnSync(command,args,{input,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,windowsHide:true});
  need(!r.error&&r.status===0,'command_failed_'+path.basename(command));return r.stdout;
}
function git(args){return run('git',['-C',root,...args]).trim();}
export function assertBookingSafeupdateSource(bytes){need(sha(bytes)===bookingSafeupdateScope.sha256,'migration_source_mismatch');}
function source(){
  need(fs.realpathSync(root)===root,'source_symlink');
  need(!git(['status','--porcelain=v1','--untracked-files=all']),'dirty_source');
  need(isDeepStrictEqual(git(['diff','--name-only',bookingSafeupdateScope.base,'HEAD']).split('\n').filter(Boolean).sort(),bookingSafeupdateAllowedFiles),'source_scope_mismatch');
  const file=path.join(root,'scripts','supabase-migrations',bookingSafeupdateScope.fileName);
  need(fs.realpathSync(file)===file&&fs.lstatSync(file).isFile(),'migration_symlink');
  assertBookingSafeupdateSource(fs.readFileSync(file));
  return git(['rev-parse','HEAD']);
}
export function assertBookingSafeupdateDryRun(report){
  need(report?.ok===true&&report.mode==='dry_run'&&report.status==='dry_run'&&report.databaseContainer===identity.containerName,'dry_run_invalid');
  need(report.through===bookingSafeupdateScope.version&&report.effectiveThrough===bookingSafeupdateScope.version,'through_invalid');
  need(isDeepStrictEqual(report.pending,[{version:bookingSafeupdateScope.version,name:bookingSafeupdateScope.name,fileName:bookingSafeupdateScope.fileName}]),'pending_scope_invalid');
  need(report.executed?.length===0&&isDeepStrictEqual(report.registeredVersions,bookingSafeupdateOldRegistry().map(r=>r.version)),'registry_scope_invalid');
  need(report.lane==='booking_safeupdate_online','lane_invalid');
}
function container(){
  const c=JSON.parse(run('docker',['inspect',identity.containerId]))[0];
  need(c.Id===identity.containerId&&c.Name==='/'+identity.containerName&&c.State.Running===true,'container_identity');
  need(c.Mounts.some(m=>m.Type==='bind'&&m.Source===identity.dataSource&&m.RW===true),'container_mount');
}
function query(sql){
  container();
  const shell=['set -eu',': "${POSTGRES_PASSWORD:?}"',': "${POSTGRES_DB:?}"','export PGPASSWORD="$POSTGRES_PASSWORD"',
    "export PGOPTIONS='-c lock_timeout=2s -c statement_timeout=10s'",
    'exec psql -h localhost -U supabase_admin -d "$POSTGRES_DB" --no-password -X -qAt -v ON_ERROR_STOP=1'].join('\n');
  return run('docker',['exec','-i',identity.containerId,'sh','-lc',shell],sql).trim();
}
export const bookingSafeupdateStateSql=`begin read only;
select jsonb_build_object('actor',current_user,'database',current_database(),
  'oid',(select oid::text from pg_database where datname=current_database()),
  'systemIdentifier',(select system_identifier::text from pg_control_system()),'serverVersionNum',current_setting('server_version_num'),
  'control',(select to_jsonb(c) from public.faolla_booking_atomic_control c where singleton),
  'function',(select jsonb_build_object('oid',oid,'owner',pg_get_userbyid(proowner),'acl',proacl,'config',proconfig,'definer',prosecdef,
    'bodyMd5',md5(replace(prosrc,chr(13),''))) from pg_proc where oid=${q(bookingSafeupdateScope.signature)}::regprocedure),
  'definition',pg_get_functiondef(${q(bookingSafeupdateScope.signature)}::regprocedure),
  'access',jsonb_build_object('anon',has_function_privilege('anon',${q(bookingSafeupdateScope.signature)},'EXECUTE'),
    'authenticated',has_function_privilege('authenticated',${q(bookingSafeupdateScope.signature)},'EXECUTE'),
    'service',has_function_privilege('service_role',${q(bookingSafeupdateScope.signature)},'EXECUTE')),
  'registry',(select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations));
commit;`;
export function assertBookingSafeupdateState(value,phase,before){
  need(value.actor==='supabase_admin'&&value.database===identity.databaseName&&value.oid===identity.databaseOid&&
    value.systemIdentifier===identity.systemIdentifier&&value.serverVersionNum===identity.serverVersionNum,'database_identity');
  need(value.control?.singleton===true&&value.control.active===true&&value.control.protocol===2,'active_generation');
  need(value.function?.owner==='supabase_admin'&&value.function.definer===true&&
    isDeepStrictEqual(value.function.config,['search_path=pg_catalog, public']),'function_metadata');
  need(isDeepStrictEqual(value.access,{anon:false,authenticated:false,service:true}),'function_acl');
  need(value.function.bodyMd5===(phase==='before'?bookingSafeupdateScope.before:bookingSafeupdateScope.after),'function_body');
  const expected=bookingSafeupdateOldRegistry();
  if(phase!=='before')expected.push({version:bookingSafeupdateScope.version,name:bookingSafeupdateScope.name});
  need(isDeepStrictEqual(value.registry,expected),'registry_scope');
  need(isDeepStrictEqual(value.registry.at(-1),phase==='before'?{version:'202610250212',name:'booking_atomic_runtime'}:
    {version:bookingSafeupdateScope.version,name:bookingSafeupdateScope.name}),'registry_tail');
  if(before){
    need(value.control.generation===before.control.generation&&value.control.active===before.control.active&&value.control.protocol===before.control.protocol,'generation_changed');
    const strip=f=>Object.fromEntries(Object.entries(f).filter(([key])=>key!=='bodyMd5'));
    need(isDeepStrictEqual(strip(value.function),strip(before.function)),'function_metadata_changed');
    need(isDeepStrictEqual(value.registry.slice(0,-1),before.registry),'old_registry_changed');
  }
  return value;
}
function runtime(){
  need(fs.statSync('/root/.pm2/rpc.sock').isSocket(),'pm2_not_running');
  const list=JSON.parse(run('pm2',['jlist']));
  const names=['merchant-space-online-f274ad615550','merchant-space-online-6c5d5df31d06','merchant-space-booking-atomic-f274ad615550'];
  return names.map(name=>{
    const p=list.find(p=>p.name===name);need(p?.pid>0&&p.pm2_env.status==='online','runtime_not_online');
    const stat=fs.readFileSync('/proc/'+p.pid+'/stat','utf8');const ticks=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
    if(name===names[0]){
      const env=Object.fromEntries(fs.readFileSync('/proc/'+p.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
      need(env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED==='0','mail_not_disabled');
    }
    return {name,pid:p.pid,startTicks:ticks};
  });
}
function owned(directory){
  need(fs.realpathSync(directory)===directory,'audit_symlink');
  let current=directory;
  for(;;){const s=fs.lstatSync(current);need(s.uid===0&&!s.isSymbolicLink()&&s.isDirectory()&&!(s.mode&0o022),'audit_ownership');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
function auditDirectory(target,report){
  need(/^\/tmp\/faolla-database-migrate-report-[1-9][0-9]*-[1-9][0-9]*$/.test(report),'report_path');
  return '/var/lib/faolla-booking-safeupdate-online/'+target+'/'+path.basename(report).slice('faolla-database-migrate-report-'.length);
}
function write(file,value){
  owned(path.dirname(file));const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function read(file){owned(path.dirname(file));const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&!(s.mode&0o077)&&s.nlink===1,'audit_file');return fs.readFileSync(file,'utf8');}
export function bookingSafeupdateRollbackSql(oldFunction){
  const body=oldFunction.match(/as \$commit_booking\$([\s\S]*?)\$commit_booking\$;/)?.[1];
  need(body&&createHash('md5').update(body).digest('hex')===bookingSafeupdateScope.before,'rollback_source');
  return `begin;set local lock_timeout='2s';set local statement_timeout='10s';
select pg_advisory_xact_lock(20260731,1);
do $guard$ begin
 perform 1 from public.faolla_booking_atomic_control where singleton and active and protocol=2 for update;
 if not found or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=${q(bookingSafeupdateScope.signature)}::regprocedure)<>${q(bookingSafeupdateScope.after)}
   or (select count(*) from public.faolla_schema_migrations)<>212
   or (select max(version) from public.faolla_schema_migrations)<>202611050213
 then raise exception 'booking_safeupdate_rollback_precondition';end if;
end;$guard$;
${oldFunction}
commit;`;
}
async function cli(mode,report){
  const target=source();
  if(mode==='source')return {sourceVerified:true,target,version:bookingSafeupdateScope.version};
  if(mode==='dry-run'){assertBookingSafeupdateDryRun(JSON.parse(fs.readFileSync(report,'utf8')));return {dryRunVerified:true};}
  need(process.platform==='linux'&&process.getuid?.()===0,'host_runtime');
  const migration={version:bookingSafeupdateScope.version,name:bookingSafeupdateScope.name,fileName:bookingSafeupdateScope.fileName};
  const migrationReport=(state,applied=false)=>{
    const old=bookingSafeupdateOldRegistry().map(r=>({...r,fileName:r.version+'_'+r.name+'.sql'}));
    return {ok:true,schemaVersion:1,lane:'booking_safeupdate_online',mode:applied?'apply':'dry_run',status:applied?'applied':'dry_run',
      databaseContainer:identity.containerName,through:migration.version,effectiveThrough:migration.version,registryExists:true,
      discovered:[...old,migration],selected:[...old,migration],registered:state.registry,registeredVersions:state.registry.map(r=>r.version),
      pending:applied?[]:[migration],executed:applied?[migration]:[],
      scope:'Existing reviewed online registry plus only 202611050213; no other uninstalled migration is admitted'};
  };
  if(mode==='plan'){
    const state=assertBookingSafeupdateState(JSON.parse(query(bookingSafeupdateStateSql)),'before');
    return migrationReport(state);
  }
  const directory=auditDirectory(target,report);
  if(mode==='prepare'){
    for(const d of ['/var/lib/faolla-booking-safeupdate-online','/var/lib/faolla-booking-safeupdate-online/'+target]){
      if(!fs.existsSync(d))fs.mkdirSync(d,{mode:0o700});owned(d);
    }
    fs.mkdirSync(directory,{mode:0o700});
    const state=assertBookingSafeupdateState(JSON.parse(query(bookingSafeupdateStateSql)),'before');
    const processes=runtime();
    const oldSource=fs.readFileSync(root+'/scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql','utf8').replaceAll('\r\n','\n');
    const oldFunction=oldSource.match(/create or replace function public\.faolla_booking_atomic_commit_v1\([\s\S]*?\$commit_booking\$;/)?.[0];
    const rollback=bookingSafeupdateRollbackSql(oldFunction);
    write(directory+'/before.json',{target,at:new Date().toISOString(),state,processes,rollbackSha256:sha(rollback)});
    write(directory+'/original-function.sql',state.definition+';\n');
    write(directory+'/guarded-rollback.sql',rollback);
    return {prepared:true,target,version:bookingSafeupdateScope.version,auditDirectory:directory};
  }
  const before=JSON.parse(read(directory+'/before.json'));
  need(before.target===target,'audit_target');
  if(mode==='apply'){
    const lock=await acquireProductionMigrationLock();
    try{
      source();
      const current=assertBookingSafeupdateState(JSON.parse(query(bookingSafeupdateStateSql)),'before');
      need(isDeepStrictEqual(current.function,before.state.function)&&current.control.generation===before.state.control.generation,'prepared_state_changed');
      need(isDeepStrictEqual(runtime(),before.processes),'processes_changed');
      const bytes=fs.readFileSync(root+'/scripts/supabase-migrations/'+bookingSafeupdateScope.fileName);assertBookingSafeupdateSource(bytes);
      write(directory+'/apply-attempt.json',{target,at:new Date().toISOString(),migrationSha256:sha(bytes)});
      // Keep the shared migration advisory lock. The only admitted SQL is the
      // byte-pinned transaction, never a caller-provided file or missing older migration.
      query('select pg_advisory_lock(20260731,1);\n'+bytes.toString('utf8')+'\nselect pg_advisory_unlock(20260731,1);');
      const after=assertBookingSafeupdateState(JSON.parse(query(bookingSafeupdateStateSql)),'after',before.state);
      const result=migrationReport(after,true);write(directory+'/apply-result.json',result);return result;
    }finally{await lock.release();}
  }
  if(mode==='verify'){
    const after=assertBookingSafeupdateState(JSON.parse(query(bookingSafeupdateStateSql)),'after',before.state);
    need(isDeepStrictEqual(runtime(),before.processes),'processes_changed');
    write(directory+'/applied.json',{target,at:new Date().toISOString(),state:after,processesUnchanged:true,mailEnabled:false,
      transactionCheckedBookingRowsAndAcl:true,rollbackSha256:before.rollbackSha256});
    return {applied:true,version:bookingSafeupdateScope.version,processesUnchanged:true,mailEnabled:false,auditDirectory:directory};
  }
  need(mode==='rollback'&&process.env.FAOLLA_BOOKING_SAFEUPDATE_ROLLBACK==='ROLLBACK_BOOKING_SAFEUPDATE_202611050213','action_invalid');
  const current=assertBookingSafeupdateState(JSON.parse(query(bookingSafeupdateStateSql)),'after',before.state);
  need(isDeepStrictEqual(runtime(),before.processes),'processes_changed');
  const rollback=read(directory+'/guarded-rollback.sql');need(sha(rollback)===before.rollbackSha256,'rollback_evidence_changed');
  write(directory+'/rollback-attempt.json',{target,at:new Date().toISOString(),currentBody:current.function.bodyMd5});
  query(rollback);
  const after=JSON.parse(query(bookingSafeupdateStateSql));
  need(after.function.bodyMd5===bookingSafeupdateScope.before&&isDeepStrictEqual(after.function,before.state.function),'rollback_postcondition');
  write(directory+'/rolled-back.json',{target,at:new Date().toISOString(),functionRestored:true,migrationRegistryRetained:true});
  return {functionRestored:true,migrationRegistryRetained:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,report]=process.argv.slice(2);
  try{need(['source','plan','dry-run','prepare','apply','verify','rollback'].includes(mode),'action_invalid');console.log(JSON.stringify(await cli(mode,report)));}
  catch(error){console.error(error.message.startsWith('booking_safeupdate_online_')?error.message:'booking_safeupdate_online_unconfirmed');process.exitCode=1;}
}
