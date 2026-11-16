// Separately authorized additive installation. No reset, rollback, replay or arbitrary SQL mode.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import {isDeepStrictEqual} from 'node:util';
import {acquireProductionMigrationLock} from './apply-production-database-migrations.mjs';
import {sourceGit,parseSourceTree,ownedReleasePath} from './release-toolchain-source.mjs';
import {assertApplicationReleaseManifest,APPLICATION_RELEASE_MANIFEST} from './application-release-compatibility.mjs';
import {templateQuery,templateOriginalEvidence,templateInstalledReceipt} from './application-release-template-database.mjs';
import {templateProcessIdentity,templateProcessPid} from './application-release-template-migrate.mjs';
import {assertBookingAtomicWorkerEnvironment} from './booking-atomic-worker.mjs';
import {GUEST_BASELINE,GUEST_SCHEMA,GUEST_TABLES,guestNeed as need,guestSqlBytes,guestHash,assertGuestSchema} from './application-release-guest-chat-contract.mjs';
import {GUEST_HEAD,guestStateSql,assertGuestDatabaseObservation} from './application-release-guest-chat-database.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),AUDIT='/var/lib/faolla-guest-chat-schema';
const q=v=>"'"+String(v).replaceAll("'","''")+"'",same=(a,b,reason)=>need(isDeepStrictEqual(a,b),reason);
export function guestMigrationSql(bytes,registry){
 need(guestHash(bytes)===GUEST_SCHEMA.sha256,'sql_changed');
 need(Array.isArray(registry)&&registry.length===213&&isDeepStrictEqual(registry.at(-1),{version:'202611100214',name:'website_template_library'}),'old_registry');
 const sql=bytes.toString('utf8');need(sql.split('\nbegin;\n').length===2,'transaction');
 return sql.replace('\nbegin;\n',`\nbegin;\nset local lock_timeout='2s';set local statement_timeout='10s';
select pg_advisory_xact_lock(20260731,1);
do $guest_guard$ begin
 if ${GUEST_TABLES.map(n=>`to_regclass('public.${n}') is not null`).join(' or ')} or
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'merchant_guest_chat_%') or
  to_regclass('public.merchant_guest_chat_messages_sequence_seq') is not null or
  (select jsonb_agg(jsonb_build_object('version',version::text,'name',name) order by version) from public.faolla_schema_migrations) is distinct from ${q(JSON.stringify(registry))}::jsonb or
  (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.faolla_booking_atomic_commit_v1(text,text,text,jsonb)'::regprocedure) is distinct from '09fa13e69856221d61b6eaa544927b2a' or
  not exists(select 1 from public.faolla_booking_atomic_control where singleton and active and protocol=2)
 then raise exception 'merchant_guest_chat_precondition';end if;
end;$guest_guard$;\n`);
}
function source(){
 const revision=sourceGit(ROOT,['rev-parse','HEAD']).toString().trim();need(/^[a-f0-9]{40}$/.test(revision),'revision');
 need(fs.realpathSync(ROOT)===ROOT&&!sourceGit(ROOT,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'source');
 const bytes=guestSqlBytes(),manifest=JSON.parse(sourceGit(ROOT,['show',revision+':'+APPLICATION_RELEASE_MANIFEST]));
 need(manifest.baseline===GUEST_BASELINE&&manifest.schemaVersion===5,'manifest_baseline');
 assertApplicationReleaseManifest(manifest,{baseline:GUEST_BASELINE,baselineRows:parseSourceTree(sourceGit(ROOT,['ls-tree','-r','-z',GUEST_BASELINE])),targetRows:parseSourceTree(sourceGit(ROOT,['ls-tree','-r','-z',revision]))});return{revision,bytes};
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,value){
 ownedReleasePath(path.dirname(file),{directory:true,privateMode:true});const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));
}
function ensure(dir){if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});ownedReleasePath(dir,{directory:true,privateMode:true});}
function read(file){ownedReleasePath(file,{privateMode:true});return JSON.parse(fs.readFileSync(file));}
function audit(revision,report){need(/^\/tmp\/faolla-database-migrate-report-[1-9][0-9]*-[1-9][0-9]*$/.test(report??''),'report_path');return AUDIT+'/'+revision+'/'+path.basename(report).slice('faolla-database-migrate-report-'.length);}
function baseline(){const value=read('/var/lib/faolla-online-release/active.json');need(value.target===GUEST_BASELINE,'live_baseline');return value;}
function runtime(){
 need(fs.statSync('/root/.pm2/rpc.sock').isSocket(),'pm2');const r=spawnSync('pm2',['jlist'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024**2});need(r.status===0&&!r.error&&!r.signal,'pm2_read');
 const rows=JSON.parse(r.stdout).map(row=>{
  const pid=templateProcessPid(row),stat=pid>0?fs.readFileSync('/proc/'+pid+'/stat','utf8'):null,ticks=stat?stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19]:null;
  const bytes=pid>0?fs.readFileSync('/proc/'+pid+'/environ'):null;
  if(bytes&&(row.name==='merchant-space-online-'+GUEST_BASELINE.slice(0,12)||row.name==='merchant-space-booking-atomic-f274ad615550')){
   const env=Object.fromEntries(bytes.toString().split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));need(!env.RESEND_API_KEY&&!env.BOOKING_CONFIRMATION_EMAIL_FROM,'mail_not_disabled');
   if(row.name.startsWith('merchant-space-booking-atomic-'))assertBookingAtomicWorkerEnvironment(env);else need(env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED==='0','web_worker_not_paused');
  }
  return templateProcessIdentity(row,{ticks,environmentSha256:bytes?guestHash(bytes):null});
 }).sort((a,b)=>a.id-b.id);
 need(rows.some(r=>r.name==='merchant-space-online-'+GUEST_BASELINE.slice(0,12)&&r.status==='online'&&r.pid>0),'live_process');return rows;
}
async function locked(work){
 const file='/www/wwwroot/merchant-space.deploy.lock';ownedReleasePath(file,{privateMode:true});const fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);let migration;
 try{const r=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],timeout:10000});need(r.status===0&&!r.error&&!r.signal,'deployment_busy');need(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'operation_busy');migration=await acquireProductionMigrationLock();return await work();}
 finally{if(migration)await migration.release();fs.closeSync(fd);}
}
function reportFor(state,applied=false){
 const migration={version:GUEST_SCHEMA.version,name:GUEST_SCHEMA.name,fileName:path.basename(GUEST_SCHEMA.file)},old=state.registry.filter(r=>r.version!==GUEST_SCHEMA.version).map(r=>({...r,fileName:r.version+'_'+r.name+'.sql'}));
 return{ok:true,schemaVersion:1,lane:'merchant_guest_chat_online',mode:applied?'apply':'dry_run',status:applied?'applied':'dry_run',databaseContainer:'supabase-db',through:GUEST_SCHEMA.version,effectiveThrough:GUEST_SCHEMA.version,registryExists:true,discovered:[...old,migration],selected:[...old,migration],registered:state.registry,registeredVersions:state.registry.map(r=>r.version),pending:applied?[]:[migration],executed:applied?[migration]:[]};
}
export function assertGuestDryRun(value){need(value?.ok===true&&value.lane==='merchant_guest_chat_online'&&value.mode==='dry_run'&&value.status==='dry_run'&&value.through===GUEST_SCHEMA.version&&value.databaseContainer==='supabase-db'&&value.executed?.length===0&&value.registeredVersions?.length===213&&isDeepStrictEqual(value.pending,[{version:GUEST_SCHEMA.version,name:GUEST_SCHEMA.name,fileName:path.basename(GUEST_SCHEMA.file)}]),'dry_run');}
export async function guestMigrationMain(mode,report){
 need(['source','plan','dry-run','prepare','apply','verify'].includes(mode),'action');const{revision,bytes}=source();
 if(mode==='source')return{sourceVerified:true,target:revision,version:GUEST_SCHEMA.version};
 if(mode==='dry-run'){assertGuestDryRun(JSON.parse(fs.readFileSync(report)));return{dryRunVerified:true};}
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node','runtime');
 const evidence=templateOriginalEvidence(),template=templateInstalledReceipt(),observe=()=>JSON.parse(templateQuery(guestStateSql)),validate=(state,receipt=null)=>assertGuestDatabaseObservation(state,evidence,template,receipt);
 if(mode==='plan'){baseline();const state=observe();validate(state);return reportFor(state);}
 const directory=audit(revision,report);
 if(mode==='prepare'){
  baseline();const state=observe();validate(state);ensure(AUDIT);ensure(AUDIT+'/'+revision);fs.mkdirSync(directory,{mode:0o700});
  write(directory+'/before.json',{target:revision,state,processes:runtime(),active:baseline(),bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8'),at:new Date().toISOString()});return{prepared:true,target:revision,auditDirectory:directory};
 }
 return locked(async()=>{
  source();const before=read(directory+'/before.json');need(before.target===revision,'target');same(baseline(),before.active,'active_changed');need(fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8')===before.bootId,'boot_changed');same(runtime(),before.processes,'processes_changed');
  if(mode==='apply'){
   const state=observe();validate(state);for(const field of ['registry','function','templateTable'])same(state[field],before.state[field],'before_changed');
   write(directory+'/apply-attempt.json',{target:revision,migrationSha256:GUEST_SCHEMA.sha256,at:new Date().toISOString()});templateQuery(guestMigrationSql(bytes,state.registry));
  }
  const intent=read(directory+'/apply-attempt.json');need(intent.target===revision&&intent.migrationSha256===GUEST_SCHEMA.sha256&&Number.isFinite(Date.parse(intent.at)),'intent');
  const state=observe();assertGuestSchema(state.guestSchema);const receipt={kind:'merchant-guest-chat-schema-installed',target:revision,version:GUEST_SCHEMA.version,migrationSha256:GUEST_SCHEMA.sha256,schema:state.guestSchema,createdRowCount:0,businessDataWritten:false,processesUnchanged:true,mailEnabled:false,at:new Date().toISOString()};
  validate(state,receipt);need(templateQuery('begin read only;select '+GUEST_TABLES.map(n=>`(select count(*) from public.${n})`).join('+')+';commit;')==='0','new_tables_not_empty');same(runtime(),before.processes,'processes_changed');same(baseline(),before.active,'active_changed');
  const receiptFile=directory+'/applied.json';if(!fs.existsSync(receiptFile))write(receiptFile,receipt);else same({...read(receiptFile),at:receipt.at},receipt,'receipt_conflict');
  const head={kind:'merchant-guest-chat-schema-head',target:revision,receipt:receiptFile,sha256:guestHash(fs.readFileSync(receiptFile))},temp=directory+'/head.json';
  if(!fs.existsSync(GUEST_HEAD)){
   if(!fs.existsSync(temp))write(temp,head);else same(read(temp),head,'head_conflict');fs.linkSync(temp,GUEST_HEAD);sync(AUDIT);fs.unlinkSync(temp);sync(directory);
  }else{
   if(fs.existsSync(temp)){
    const a=fs.lstatSync(temp),b=fs.lstatSync(GUEST_HEAD);need(a.isFile()&&b.isFile()&&!a.isSymbolicLink()&&!b.isSymbolicLink()&&a.uid===0&&b.uid===0&&a.mode===0o100600&&b.mode===a.mode&&a.dev===b.dev&&a.ino===b.ino&&a.nlink===2&&b.nlink===2,'head_link');
    same(JSON.parse(fs.readFileSync(temp)),head,'head_conflict');fs.unlinkSync(temp);sync(directory);
   }
   same(read(GUEST_HEAD),head,'head_conflict');
  }
  return mode==='apply'?reportFor(state,true):{applied:true,target:revision,version:GUEST_SCHEMA.version,mailEnabled:false,processesUnchanged:true,auditDirectory:directory};
 });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const[mode,report,...extra]=process.argv.slice(2);Promise.resolve().then(()=>{need(extra.length===0,'arguments');return guestMigrationMain(mode,report);}).then(v=>console.log(JSON.stringify(v)),e=>{console.error(/^application_(?:guest_chat|template)_[a-z_]+$/.test(e?.message??'')?e.message:'application_guest_chat_unconfirmed');process.exitCode=1;});
}
