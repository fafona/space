// Separately authorized, exact additive migration. No drop, reset, retry or repair entrypoint.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {acquireProductionMigrationLock} from './apply-production-database-migrations.mjs';
import {sourceGit,parseSourceTree,ownedReleasePath} from './release-toolchain-source.mjs';
import {assertBookingAtomicWorkerEnvironment} from './booking-atomic-worker.mjs';
import {assertApplicationReleaseManifest,APPLICATION_RELEASE_MANIFEST} from './application-release-compatibility.mjs';
import {TEMPLATE_SCHEMA,TEMPLATE_BASELINE,templateNeed as need,templateHash,assertTemplateSql,assertTemplateTable} from './application-release-template-contract.mjs';
import {TEMPLATE_HEAD,templateOriginalEvidence,templatePrivateJson,templateQuery,templateStateSql,assertTemplateDatabaseObservation} from './application-release-template-database.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),AUDIT='/var/lib/faolla-template-schema';
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const same=(a,b,reason)=>need(isDeepStrictEqual(a,b),reason);
export function templateMigrationSql(bytes,registry){
 assertTemplateSql(bytes);need(Array.isArray(registry)&&registry.length===212&&registry.at(-1)?.version==='202611050213','old_registry');
 const guard=`set local lock_timeout='2s';set local statement_timeout='10s';
select pg_advisory_xact_lock(20260731,1);
do $template_guard$ begin
 if to_regclass('public.website_templates') is not null or
  (select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations) is distinct from ${q(JSON.stringify(registry))}::jsonb
 then raise exception 'website_template_precondition';end if;
end;$template_guard$;
`;
 const sql=bytes.toString('utf8');need(sql.split('\nbegin;\n').length===2,'transaction');return sql.replace('\nbegin;\n','\nbegin;\n'+guard);
}
function source(){
 const revision=sourceGit(ROOT,['rev-parse','HEAD']).toString().trim();need(/^[a-f0-9]{40}$/.test(revision),'revision');
 need(fs.realpathSync(ROOT)===ROOT&&!sourceGit(ROOT,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'source');
 const bytes=fs.readFileSync(ROOT+'/'+TEMPLATE_SCHEMA.file);assertTemplateSql(bytes);
 const manifest=JSON.parse(sourceGit(ROOT,['show',revision+':'+APPLICATION_RELEASE_MANIFEST]));
 need(manifest.baseline===TEMPLATE_BASELINE&&manifest.schemaVersion===3,'manifest_baseline');
 assertApplicationReleaseManifest(manifest,{baseline:TEMPLATE_BASELINE,baselineRows:parseSourceTree(sourceGit(ROOT,['ls-tree','-r','-z',TEMPLATE_BASELINE])),
  targetRows:parseSourceTree(sourceGit(ROOT,['ls-tree','-r','-z',revision]))});return {revision,bytes};
}
function syncDirectory(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,value){
 ownedReleasePath(path.dirname(file),{directory:true,privateMode:true});
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(path.dirname(file));
}
function ensure(dir){if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});ownedReleasePath(dir,{directory:true,privateMode:true});}
function audit(revision,report){
 need(/^\/tmp\/faolla-database-migrate-report-[1-9][0-9]*-[1-9][0-9]*$/.test(report??''),'report_path');
 return AUDIT+'/'+revision+'/'+path.basename(report).slice('faolla-database-migrate-report-'.length);
}
function runtime(){
 need(fs.statSync('/root/.pm2/rpc.sock').isSocket(),'pm2');
 const result=spawnSync('pm2',['jlist'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024**2});need(result.status===0&&!result.error,'pm2_read');
 const rows=JSON.parse(result.stdout).map(row=>{
  const p=row.pid;const ticks=p>0?fs.readFileSync('/proc/'+p+'/stat','utf8').split(')').slice(1).join(')').trim().split(/\s+/)[19]:null;
  const bytes=p>0?fs.readFileSync('/proc/'+p+'/environ'):null;
  if(bytes&&(row.name==='merchant-space-online-'+TEMPLATE_BASELINE.slice(0,12)||row.name==='merchant-space-booking-atomic-f274ad615550')){
   const env=Object.fromEntries(bytes.toString().split('\0').filter(Boolean).map(v=>{const at=v.indexOf('=');return[v.slice(0,at),v.slice(at+1)];}));
   need(!env.RESEND_API_KEY&&!env.BOOKING_CONFIRMATION_EMAIL_FROM,'mail_not_disabled');
   if(row.name.startsWith('merchant-space-booking-atomic-'))assertBookingAtomicWorkerEnvironment(env);
   else need(env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED==='0','web_worker_not_paused');
  }
  return {name:row.name,id:row.pm_id,pid:p,status:row.pm2_env.status,ticks,environmentSha256:bytes?templateHash(bytes):null};
 }).sort((a,b)=>a.id-b.id);
 need(rows.some(r=>r.name==='merchant-space-online-'+TEMPLATE_BASELINE.slice(0,12)&&r.status==='online'&&r.pid>0),'live_process');return rows;
}
async function locked(work){
 const file='/www/wwwroot/merchant-space.deploy.lock';ownedReleasePath(file,{privateMode:true});
 const fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);let migration;
 try{
  const r=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],timeout:10000});need(r.status===0&&!r.error,'deployment_busy');
  need(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'operation_busy');
  migration=await acquireProductionMigrationLock();return await work();
 }finally{if(migration)await migration.release();fs.closeSync(fd);}
}
function baseline(){const active=templatePrivateJson('/var/lib/faolla-online-release/active.json');need(active.target===TEMPLATE_BASELINE,'live_baseline');return active;}
function reportFor(state,applied=false){
 const migration={version:TEMPLATE_SCHEMA.version,name:TEMPLATE_SCHEMA.name,fileName:path.basename(TEMPLATE_SCHEMA.file)};
 const old=state.registry.filter(r=>r.version!==TEMPLATE_SCHEMA.version).map(r=>({...r,fileName:r.version+'_'+r.name+'.sql'}));
 return {ok:true,schemaVersion:1,lane:'website_template_table_online',mode:applied?'apply':'dry_run',status:applied?'applied':'dry_run',databaseContainer:'supabase-db',
  through:TEMPLATE_SCHEMA.version,effectiveThrough:TEMPLATE_SCHEMA.version,registryExists:true,discovered:[...old,migration],selected:[...old,migration],
  registered:state.registry,registeredVersions:state.registry.map(r=>r.version),pending:applied?[]:[migration],executed:applied?[migration]:[]};
}
export function assertTemplateDryRun(value){need(value?.ok===true&&value.lane==='website_template_table_online'&&value.status==='dry_run'&&value.mode==='dry_run'&&
 value.through===TEMPLATE_SCHEMA.version&&value.databaseContainer==='supabase-db'&&value.executed?.length===0&&value.registeredVersions?.length===212&&
 value.pending?.length===1&&value.pending[0].version===TEMPLATE_SCHEMA.version&&value.pending[0].name===TEMPLATE_SCHEMA.name,'dry_run');}
export async function templateMigrationMain(mode,report){
 need(['source','plan','dry-run','prepare','apply','verify'].includes(mode),'action');const {revision,bytes}=source();
 if(mode==='source')return {sourceVerified:true,target:revision,version:TEMPLATE_SCHEMA.version};
 if(mode==='dry-run'){assertTemplateDryRun(JSON.parse(fs.readFileSync(report,'utf8')));return {dryRunVerified:true};}
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node','runtime');
 const evidence=templateOriginalEvidence();
 const observe=()=>JSON.parse(templateQuery(templateStateSql));
 if(mode==='plan'){baseline();const state=observe();assertTemplateDatabaseObservation(state,evidence);return reportFor(state);}
 const directory=audit(revision,report);
 if(mode==='prepare'){
  baseline();const state=observe();assertTemplateDatabaseObservation(state,evidence);
  ensure(AUDIT);ensure(AUDIT+'/'+revision);fs.mkdirSync(directory,{mode:0o700});
  write(directory+'/before.json',{target:revision,at:new Date().toISOString(),state,processes:runtime(),active:baseline(),bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8')});
  return {prepared:true,target:revision,auditDirectory:directory};
 }
 return locked(async()=>{
  source();const before=templatePrivateJson(directory+'/before.json');need(before.target===revision,'target');
  need(fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8')===before.bootId,'boot_changed');same(baseline(),before.active,'active_changed');same(runtime(),before.processes,'processes_changed');
  if(mode==='apply'){
   const current=observe();assertTemplateDatabaseObservation(current,evidence);
   same(current.registry,before.state.registry,'registry_changed');same(current.function,before.state.function,'function_changed');
   // O_EXCL intent prevents replay even if commit acknowledgement is lost.
   write(directory+'/apply-attempt.json',{target:revision,migrationSha256:TEMPLATE_SCHEMA.sha256,at:new Date().toISOString()});
   templateQuery(templateMigrationSql(bytes,current.registry));
  }
  const intent=templatePrivateJson(directory+'/apply-attempt.json');
  need(intent.target===revision&&intent.migrationSha256===TEMPLATE_SCHEMA.sha256&&Number.isFinite(Date.parse(intent.at)),'intent');
  const state=observe();assertTemplateTable(state.templateTable);
  const receipt={kind:'website-template-schema-installed',target:revision,version:TEMPLATE_SCHEMA.version,migrationSha256:TEMPLATE_SCHEMA.sha256,
   table:state.templateTable,createdRowCount:0,businessDataWritten:false,mailEnabled:false,processesUnchanged:true,at:new Date().toISOString()};
  assertTemplateDatabaseObservation(state,evidence,receipt);
  need(templateQuery('begin read only;select count(*) from public.website_templates;commit;')==='0','new_table_not_empty');
  same(runtime(),before.processes,'processes_changed');same(baseline(),before.active,'active_changed');
  const applyFile=directory+'/applied.json';
  if(!fs.existsSync(applyFile))write(applyFile,receipt);
  else {const saved=templatePrivateJson(applyFile);same({...saved,at:receipt.at},receipt,'receipt_conflict');}
  const head={kind:'website-template-schema-head',target:revision,receipt:applyFile,sha256:templateHash(fs.readFileSync(applyFile))};
  const temp=directory+'/head.json';
  if(fs.existsSync(TEMPLATE_HEAD)&&fs.existsSync(temp)){
   // Reconcile only this exact completed hard-link publication, never a partial
   // file, another operation, a replaced inode or an unconfirmed SQL outcome.
   const a=fs.lstatSync(temp),b=fs.lstatSync(TEMPLATE_HEAD);
   need(a.isFile()&&b.isFile()&&!a.isSymbolicLink()&&!b.isSymbolicLink()&&a.uid===0&&b.uid===0&&
    a.mode===0o100600&&b.mode===a.mode&&a.dev===b.dev&&a.ino===b.ino&&a.nlink===2&&b.nlink===2,'head_link');
   need(fs.readFileSync(temp,'utf8')===JSON.stringify(head,null,2)+'\n','head_conflict');fs.unlinkSync(temp);syncDirectory(AUDIT);
  }
  if(!fs.existsSync(TEMPLATE_HEAD)){
   if(!fs.existsSync(temp))write(temp,head);else same(templatePrivateJson(temp),head,'head_conflict');
   fs.linkSync(temp,TEMPLATE_HEAD);fs.unlinkSync(temp);syncDirectory(AUDIT);
  }else same(templatePrivateJson(TEMPLATE_HEAD),head,'head_conflict');
  return mode==='apply'?reportFor(state,true):{applied:true,target:revision,version:TEMPLATE_SCHEMA.version,processesUnchanged:true,mailEnabled:false,auditDirectory:directory};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [mode,report,...extra]=process.argv.slice(2);
 Promise.resolve().then(()=>{need(extra.length===0,'arguments');return templateMigrationMain(mode,report);}).then(v=>console.log(JSON.stringify(v)),e=>{
  console.error(/^application_template_[a-z_]+$/.test(e?.message??'')?e.message:'application_template_unconfirmed');process.exitCode=1;
 });
}
