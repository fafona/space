import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,rmdirSync,realpathSync,lstatSync,readdirSync,copyFileSync,constants,statfsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {webReleaseRuntimeEnvironment,WEB_RELEASE_FILES,WEB_RELEASE_PROXY as proxy,WEB_RELEASE_MARKER as marker} from './web-presentation-release-policy.mjs';
import {ONLINE_ROOT as root,onlineReleaseLane,onlineReleaseStageStatus,onlineReleaseActivationStatus,assertOnlineReleaseDatabaseAllowed,onlineReleaseMigrationTarget,assertPendingOnlineReleaseMigrations,assertOrderAttentionReleaseProof,onlineProxy,hasExpectedCardWebsite} from './online-traffic-release-policy.mjs';
import {applyProductionDatabaseMigrations} from './apply-production-database-migrations.mjs';
import {createProductionDatabaseBackup} from './create-production-database-backup.mjs';
import {verifyProductionDatabaseBackup} from './verify-production-database-backup.mjs';

const app='/www/wwwroot/merchant-space', nginx='/www/server/nginx/sbin/nginx';
const [action,target,baseline]=process.argv.slice(2);
const envBase={...process.env,PM2_HOME:'/root/.pm2'};
const read=p=>readFileSync(p,'utf8'),hash=v=>createHash('sha256').update(v).digest('hex');
const fail=m=>{throw Error(m);};
function run(command,args,options={}) {
 const r=spawnSync(command,args,{encoding:'utf8',env:envBase,timeout:60000,maxBuffer:4*1024*1024,...options});
 if(r.status!==0)fail(`online_command_failed:${command}:${r.status}:${r.signal??r.error?.code??'exit'}`);return r.stdout;
}
function privateDirectory(path){mkdirSync(path,{recursive:true,mode:0o700});const s=lstatSync(path);if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==0||(s.mode&0o077))fail('unsafe_state_directory');}
function safeFile(path){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())fail('unexpected_file_type');return read(path);}
function atomic(path,value){const tmp=`${path}.${process.pid}.tmp`;writeFileSync(tmp,value,{mode:0o600,flag:'wx'});renameSync(tmp,path);}
const pm=()=>JSON.parse(run('pm2',['jlist']));
const operation=`${root}/${target}`,stateFile=`${operation}/state.json`,activeFile=`${root}/active.json`;
const save=s=>atomic(stateFile,JSON.stringify(s,null,2));
async function request(url,statuses=[200],host='www.faolla.com',headers={}){
 const r=await fetch(url,{redirect:'manual',headers:{Host:host,...headers},signal:AbortSignal.timeout(20000)});
 if(!statuses.includes(r.status))fail(`online_http:${r.status}:${new URL(url).pathname}`);return r;
}
async function verifyBase(s){
 if(hash(safeFile('/var/lib/faolla-maintenance/merchant-space/state.json'))!==s.maintenanceHash||JSON.parse(read('/var/lib/faolla-maintenance/merchant-space/state.json')).phase!=='ended')fail('maintenance_state_changed');
 if(hash(safeFile(marker))!==s.markerHash)fail('legacy_guard_changed');
 if(realpathSync(`${app}.current`)!==s.baseDirectory)fail('baseline_link_changed');
 const all=pm();for(const saved of s.processes){const p=all.find(p=>p.name===saved.name);if(!p||p.pid!==saved.pid||p.pm2_env.pm_cwd!==saved.cwd||p.pm2_env.status!=='online')fail('existing_process_changed');}
 if((await(await request(`http://127.0.0.1:${s.oldPort}/api/app-web-version`)).json()).buildId!==s.baseline)fail('baseline_version_changed');
}
function configUnchanged(s,active=false){for(const file of WEB_RELEASE_FILES)if(hash(safeFile(`${proxy}/${file}`))!==s.configs[file][active?'newHash':'oldHash'])fail('proxy_configuration_changed');}
function verifyCandidate(s){const p=pm().find(p=>p.name===s.name);if(!p||p.pm2_env.status!=='online'||p.pm2_env.pm_cwd!==s.directory||p.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED!=='1'||p.pm2_env.FAOLLA_SUPER_ADMIN_ORIGIN!=='https://console.faolla.com')fail('candidate_identity_invalid');if(s.lane==='order-attention'&&p.pm2_env.FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID!==(s.orderAttentionEnabled?'10000000':'0'))fail('order_attention_candidate_flag_invalid');if(s.lane==='bounded-lists'&&(p.pm2_env.FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID!=='10000000'||p.pm2_env.FAOLLA_TRAFFIC_ENABLED!=='1'||p.pm2_env.FAOLLA_TRAFFIC_SIGNING_SECRET!==candidateEnvironment(s).FAOLLA_TRAFFIC_SIGNING_SECRET))fail('bounded_lists_baseline_features_changed');return p;}
function publishStatic(source,destination){
 const files=[];function walk(dir,rel=''){for(const e of readdirSync(dir,{withFileTypes:true})){const key=rel?`${rel}/${e.name}`:e.name;if(e.isSymbolicLink())fail('static_symlink');if(e.isDirectory())walk(`${dir}/${e.name}`,key);else if(e.isFile())files.push(key);else fail('static_type_invalid');}}
 walk(source);
 for(const key of files){const path=`${destination}/${key}`;if(existsSync(path)&&(lstatSync(path).isSymbolicLink()||hash(readFileSync(path))!==hash(readFileSync(`${source}/${key}`))))fail('static_collision');}
 for(const key of files){const path=`${destination}/${key}`;if(!existsSync(path)){mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true,mode:0o755});copyFileSync(`${source}/${key}`,path,constants.COPYFILE_EXCL);}}
 return files.length;
}
async function smoke(s,publicMode=false){
 const origin=publicMode?'https://www.faolla.com':`http://127.0.0.1:${s.port}`;
 if((await(await request(`${origin}/api/app-web-version?release=${s.target}`)).json()).buildId!==s.target)fail('candidate_version_mismatch');
 for(const path of ['/','/login','/admin','/super-admin'])await request(origin+path,[200,301,302,303,307,308]);
 const card=await(await request(`${origin}/card/luis-gpyv6u`)).text();
 if(!hasExpectedCardWebsite(card))fail('card_website_regression');
 if(!(await(await request(`${origin}/card/luis-gpyv6u/contact`)).text()).includes('URL:https://www.haoyouduosevilla.com/'))fail('vcard_website_regression');
 await request(`${origin}/traffic-card-v1.js`);
 await request(`${origin}/api/super-admin/platform-merchant-snapshot`,[401]);
 await request(`${publicMode?'https://console.faolla.com':origin}/api/super-admin/traffic?siteId=10000000`,[401],'console.faolla.com');
 // In-progress requests and existing assets remain served by the previous process.
 const html=await(await request(origin+'/')).text();const assets=[...new Set(html.match(/\/_next\/static\/[^"\s<>]+\.(?:js|css)/g)||[])];
 for(const path of assets)await request(origin+path);return assets.length;
}
function restoreConfigs(s){
 for(const file of WEB_RELEASE_FILES){const h=hash(safeFile(`${proxy}/${file}`));if(h!==s.configs[file].oldHash&&h!==s.configs[file].newHash)fail('rollback_proxy_not_owned');}
 for(const file of WEB_RELEASE_FILES)atomic(`${proxy}/${file}`,safeFile(`${operation}/before-${file}`));
 run(nginx,['-t']);run(nginx,['-s','reload']);
 s.status='rolled-back';s.rolledBackAt=new Date().toISOString();save(s);
 // Preserve all schema/data, background processes, marker and candidate artifacts.
 if(existsSync(activeFile)&&JSON.parse(safeFile(activeFile)).target===s.target)atomic(activeFile,JSON.stringify(s.previousActive??{target:s.baseline,port:s.oldPort,directory:s.oldDirectory,name:s.oldName}));
}
function candidateEnvironment(s){return JSON.parse(safeFile(`${operation}/runtime.json`));}
function verifyOrderAttentionSource(s){
 if(s.lane!=='order-attention')return;
 if(run('git',['rev-parse','HEAD'],{cwd:s.directory}).trim()!==s.target||run('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:s.directory}).trim())fail('order_attention_candidate_source_changed');
}
function verifyOrderAttention(s,command){
 if(s.lane!=='order-attention')return;
 verifyOrderAttentionSource(s);
 const output=run('node',['--import','tsx','scripts/order-attention-pilot.ts',command],{cwd:s.directory,env:{...candidateEnvironment(s),FAOLLA_ORDER_ATTENTION_OPERATION_TARGET:s.target},timeout:180000});
 let proof;try{proof=assertOrderAttentionReleaseProof(JSON.parse(output),command);}catch{fail('order_attention_verification_invalid');}
 atomic(`${operation}/order-attention-${command}-proof.json`,JSON.stringify(proof));return proof;
}
function setOrderAttentionCandidateFlag(s,value){
 if(s.lane!=='order-attention'||!['0','10000000'].includes(value))fail('order_attention_candidate_flag_invalid');
 verifyCandidate(s);
 const env=candidateEnvironment(s),content=safeFile(`${s.directory}/.env.local`);
 if((content.match(/^FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID=(?:0|10000000)$/gm)||[]).length!==1)fail('order_attention_candidate_env_invalid');
 env.FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID=value;
 atomic(`${operation}/runtime.json`,JSON.stringify(env));
 atomic(`${s.directory}/.env.local`,content.replace(/^FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID=(?:0|10000000)$/m,`FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID=${value}`));
 s.orderAttentionEnabled=value==='10000000';save(s);
 run('pm2',['restart',s.name,'--update-env'],{env});
}
function restoreOrderAttentionConfigs(s){
 // Public traffic returns to the owned baseline before any optional candidate
 // restart. A database/CLI fault must never prevent this web rollback.
 restoreConfigs(s);
 if(s.lane==='order-attention')setOrderAttentionCandidateFlag(s,'0');
}
if(process.platform!=='linux'||process.getuid?.()!==0||!['stage','finish-stage','database','activate','rollback','status'].includes(action)||!/^[a-f0-9]{40}$/.test(target??''))fail('invalid_online_invocation');
if(!process.env.FAOLLA_ONLINE_RELEASE_LOCKED){
 const lock=`${app}.deploy.lock`;if(existsSync(lock)&&lstatSync(lock).isSymbolicLink())fail('unsafe_deploy_lock');
 const r=spawnSync('flock',['--nonblock',lock,process.execPath,fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit',env:{...envBase,FAOLLA_ONLINE_RELEASE_LOCKED:'1'}});process.exit(r.status??1);
}
privateDirectory(root);
const operationLock='/var/lib/faolla-maintenance/merchant-space/operation.lock';mkdirSync(operationLock,{mode:0o700});
try{
 if(action==='stage'){
  if(!/^[a-f0-9]{40}$/.test(baseline??'')||existsSync(stateFile))fail('existing_or_invalid_stage');
  if(run('git',['rev-parse','origin/main'],{cwd:app}).trim()!==target)fail('target_not_main');
  run('git',['merge-base','--is-ancestor',baseline,target],{cwd:app});
  const lane=onlineReleaseLane(run('git',['diff','--name-only',baseline,target],{cwd:app}).trim().split('\n'));
  const previousActive=existsSync(activeFile)?JSON.parse(safeFile(activeFile)):null;
  const legacy=JSON.parse(safeFile('/var/lib/faolla-web-presentation-release/state.json'));
  const old=previousActive??{...legacy,port:3102,name:'merchant-space-web-live'};
  if(old.target!==baseline||(!previousActive&&legacy.status!=='active'))fail('live_baseline_not_owned');
  const all=pm(),prior=all.find(p=>p.name===old.name);if(!prior||prior.pm2_env.pm_cwd!==old.directory)fail('live_process_mismatch');
  if(hash(run('git',['show',`${target}:package-lock.json`],{cwd:app}))!==hash(safeFile(`${old.directory}/package-lock.json`)))fail('dependencies_changed');
  const disk=statfsSync('/www');if(disk.bavail*disk.bsize<12*1024**3)fail('insufficient_disk_reserve');
  const sockets=run('ss',['-ltnH']);const port=[3103,3104,3105,3106,3107,3108,3109,3110].find(p=>!sockets.includes(`:${p} `));if(!port)fail('no_candidate_port');
  privateDirectory(operation);
  const s={target,baseline,oldPort:old.port,oldDirectory:old.directory,oldName:old.name,previousActive,port,name:`merchant-space-online-${target.slice(0,12)}`,directory:`${app}.web-releases/${target.slice(0,12)}-online`,baseDirectory:realpathSync(`${app}.current`),processes:all.map(p=>({name:p.name,pid:p.pid,cwd:p.pm2_env.pm_cwd})),configs:{},maintenanceHash:hash(safeFile('/var/lib/faolla-maintenance/merchant-space/state.json')),markerHash:hash(safeFile(marker)),status:'preparing',startedAt:new Date().toISOString()};
  await verifyBase(s);
  for(const file of WEB_RELEASE_FILES){const before=safeFile(`${proxy}/${file}`),after=onlineProxy(before,s.oldPort,port,target);s.configs[file]={oldHash:hash(before),newHash:hash(after)};writeFileSync(`${operation}/before-${file}`,before,{mode:0o600,flag:'wx'});writeFileSync(`${operation}/after-${file}`,after,{mode:0o600,flag:'wx'});}
  s.lane=lane;
  save(s);run('git',['worktree','add','--detach',s.directory,target],{cwd:app});
  run('cp',['-a','--reflink=auto',`${old.directory}/node_modules`,`${s.directory}/node_modules`],{timeout:180000});
  const env=webReleaseRuntimeEnvironment(read(`/proc/${prior.pid}/environ`));
  if(lane==='qr-export'&&(env.FAOLLA_TRAFFIC_ENABLED!=='1'||!env.FAOLLA_TRAFFIC_SIGNING_SECRET))fail('qr_export_analytics_baseline_invalid');
  if(lane==='performance'&&(env.FAOLLA_TRAFFIC_ENABLED!=='1'||!env.FAOLLA_TRAFFIC_SIGNING_SECRET))fail('performance_analytics_baseline_invalid');
  if(lane==='order-attention'&&(env.FAOLLA_TRAFFIC_ENABLED!=='1'||!env.FAOLLA_TRAFFIC_SIGNING_SECRET))fail('order_attention_analytics_baseline_invalid');
  if(lane==='bounded-lists'&&(env.FAOLLA_TRAFFIC_ENABLED!=='1'||!env.FAOLLA_TRAFFIC_SIGNING_SECRET||env.FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID!=='10000000'))fail('bounded_lists_baseline_features_invalid');
  const changes={FAOLLA_WEB_BUILD_ID:target,NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID:target,FAOLLA_WEB_RELEASED_AT:new Date().toISOString(),FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',...(lane==='order-attention'?{FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID:'0'}:{}),...(lane==='traffic'?{FAOLLA_TRAFFIC_ENABLED:'0',FAOLLA_TRAFFIC_RETENTION_ENABLED:'0',FAOLLA_TRAFFIC_SIGNING_SECRET:env.FAOLLA_TRAFFIC_SIGNING_SECRET||randomBytes(48).toString('base64url')}:{}),PORT:String(port)};
  const envText=safeFile(`${old.directory}/.env.local`).split('\n').filter(line=>!Object.keys(changes).some(k=>line.startsWith(`${k}=`))).join('\n');
  writeFileSync(`${s.directory}/.env.local`,envText+'\n'+Object.entries(changes).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  Object.assign(env,changes,{PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'});atomic(`${operation}/runtime.json`,JSON.stringify(env));
  console.log('online_focused_tests');
  const tests=lane==='qr-export'
   ? ['src/lib/merchantBusinessCardQrExport.test.ts','src/lib/merchantBusinessCardDestination.test.ts','src/lib/merchantBusinessCardQrColorSelection.test.ts','src/lib/merchantBusinessCardQrText.test.ts']
   : lane==='bounded-lists'
   ? ['src/components/admin/MerchantCatalogProductList.test.ts','src/components/admin/MerchantCatalogManagerPanel.test.ts','src/components/admin/MerchantCustomerManager.behavior.test.ts','src/components/admin/MerchantCustomerManager.contract.test.ts','src/lib/merchantCustomerPagination.test.ts','src/lib/merchantCustomerListViewport.test.ts','src/lib/merchantOrdersStore.test.ts','src/lib/merchantOrdersStore.metadata.test.ts','src/lib/merchantOrdersV1Read.server.test.ts','src/lib/merchantOrdersAtomic.server.test.ts','src/lib/merchantOrderAttention.server.test.ts','src/app/api/orders/route.test.ts','src/app/api/orders/workbench/route.test.ts','src/app/api/orders/export/route.test.ts','scripts/run-ci-tests.test.mjs','scripts/ci-workflow-contract.test.mjs']
   : lane==='order-attention'
   ? ['src/lib/merchantOrderAttention.test.ts','src/lib/merchantOrderAttentionProjection.test.ts','src/lib/merchantOrderAttention.server.test.ts','src/app/api/orders/route.attention.test.ts','src/app/api/orders/route.test.ts','src/app/admin/AdminClient.attention.test.ts','scripts/order-attention-pilot.test.ts','scripts/order-attention-pilot-migration-contract.test.mjs','scripts/order-attention-integration/run.test.mjs','scripts/ci-workflow-contract.test.mjs']
   : lane==='performance'
   ? ['src/lib/performanceTelemetry.test.ts','src/lib/visiblePolling.test.ts','src/lib/merchantCustomers.test.ts','src/lib/merchantCustomerListViewport.test.ts','src/lib/merchantCustomerImport.test.ts','src/lib/merchantCustomerDirectoryStore.test.ts','src/app/api/merchant-customers/route.test.ts','src/app/admin/AdminClient.attention.test.ts','src/app/admin/AdminClient.contract.test.ts','src/components/admin/MerchantCustomerManager.behavior.test.ts','src/components/admin/MerchantCustomerManager.contract.test.ts','scripts/repair-unlaunched-transport.test.mjs','src/lib/merchantBusinessCardWebsiteRoute.test.ts']
   : [...run('git',['ls-files','src/lib/accountTraffic*.test.ts','src/app/api/traffic/**/route.test.ts','src/app/api/super-admin/traffic/**/route.test.ts','src/app/api/super-admin/traffic/route.test.ts'],{cwd:s.directory}).trim().split('\n'),'src/app/api/orders/route.test.ts','src/app/api/memberships/route.test.ts','scripts/account-traffic-analytics-contract.test.mjs','scripts/account-traffic-card-script.test.mjs'];
  run('node',['--import','tsx','--test',...tests,'src/lib/merchantBusinessCardQrPreview.test.ts','src/lib/canonicalSuperAdminRequest.test.ts','scripts/online-traffic-release.test.mjs'],{cwd:s.directory,env,timeout:180000,stdio:'inherit'});
  console.log('online_build_started');run('nice',['-n','10','npm','run','build'],{cwd:s.directory,env,timeout:1200000,stdio:'inherit'});
  if(!existsSync(`${s.directory}/.next/BUILD_ID`))fail('build_missing');await verifyBase(s);configUnchanged(s);
  run('pm2',['start',`${s.directory}/node_modules/next/dist/bin/next`,'--name',s.name,'--cwd',s.directory,'--interpreter',process.execPath,'--','start','-H','127.0.0.1','-p',String(port)],{env});
  let ready=false;for(let i=0;i<25;i++){try{await smoke(s);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)fail('candidate_not_ready');
  verifyCandidate(s);s.status=onlineReleaseStageStatus(lane);save(s);
 }else{
  const s=JSON.parse(safeFile(stateFile));await verifyBase(s);
  if(action==='finish-stage'){
   // Re-run acceptance on the exact already-built candidate after a probe-only
   // controller correction. Never rewrite build identity or mark it ready blind.
   if(s.status!=='preparing'||run('git',['rev-parse','HEAD'],{cwd:s.directory}).trim()!==s.target||run('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:s.directory}).trim())fail('resume_candidate_source_changed');
   if(!existsSync(`${s.directory}/.next/BUILD_ID`))fail('resume_build_missing');
   run('node',['scripts/check-admin-bundle-budget.mjs'],{cwd:s.directory});
   configUnchanged(s);verifyCandidate(s);await smoke(s);s.status=onlineReleaseStageStatus(s.lane);save(s);
  }else if(action==='database'){
   assertOnlineReleaseDatabaseAllowed(s.lane);
   if(s.status!=='staged')fail('database_not_staged');configUnchanged(s);verifyCandidate(s);
   verifyOrderAttentionSource(s);
   const through=onlineReleaseMigrationTarget(s.lane);
   const preview=await applyProductionDatabaseMigrations({rootDir:s.directory,through,dryRun:true});assertPendingOnlineReleaseMigrations(s.lane,preview.pending);
   atomic(`${operation}/migration-preview.json`,JSON.stringify(preview));
   if(preview.pending.length){
    console.log('online_encrypted_backup_started');const passphrase=randomBytes(48).toString('base64url');writeFileSync(`${operation}/backup.key`,passphrase,{mode:0o600,flag:'wx'});
    const backupSource=fileURLToPath(new URL('..',import.meta.url));
    const backupSha=run('git',['rev-parse','HEAD'],{cwd:backupSource}).trim();
    const backup=await createProductionDatabaseBackup({outputPath:`${operation}/database.tar.enc`,passphrase,appDirectory:s.oldDirectory,sourceDirectory:backupSource,sourceRepository:'fafona/space',sourceSha:backupSha});
    const checked=await verifyProductionDatabaseBackup({inputPath:`${operation}/database.tar.enc`,passphrase});atomic(`${operation}/backup-report.json`,JSON.stringify({backup,checked}));
    await verifyBase(s);configUnchanged(s);console.log('online_additive_migrations_started');
    const report=await applyProductionDatabaseMigrations({rootDir:s.directory,through,apply:true});atomic(`${operation}/migration-report.json`,JSON.stringify(report));
   }
   const after=await applyProductionDatabaseMigrations({rootDir:s.directory,through,dryRun:true});if(after.pending.length)fail('migration_incomplete');
   // Enable only the non-public candidate after all compatible migrations succeed.
   if(s.lane==='order-attention'){
    verifyOrderAttention(s,'enable');setOrderAttentionCandidateFlag(s,'10000000');
   }else{
    const env=candidateEnvironment(s);env.FAOLLA_TRAFFIC_ENABLED='1';atomic(`${operation}/runtime.json`,JSON.stringify(env));
    atomic(`${s.directory}/.env.local`,safeFile(`${s.directory}/.env.local`).replace(/^FAOLLA_TRAFFIC_ENABLED=0$/m,'FAOLLA_TRAFFIC_ENABLED=1'));
    run('pm2',['restart',s.name,'--update-env'],{env});
   }
   let ready=false;for(let i=0;i<20;i++){try{await smoke(s);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)fail('enabled_candidate_not_ready');
   verifyCandidate(s);s.status='database-ready';save(s);
  }else if(action==='activate'){
   if(s.status!==onlineReleaseActivationStatus(s.lane))fail('not_ready');verifyCandidate(s);configUnchanged(s);await smoke(s);
   verifyOrderAttention(s,'verify');
   const staticDir=realpathSync(`${app}/.next/static`);if(!staticDir.startsWith('/www/wwwroot/merchant-space'))fail('unexpected_static_directory');s.staticFiles=publishStatic(`${s.directory}/.next/static`,staticDir);
   s.status='activating';save(s);
   try{
    for(const file of WEB_RELEASE_FILES)atomic(`${proxy}/${file}`,safeFile(`${operation}/after-${file}`));run(nginx,['-t']);run(nginx,['-s','reload']);
    let verified=false;for(let i=0;i<8;i++){try{s.checkedAssets=await smoke(s,true);verified=true;break;}catch{await new Promise(r=>setTimeout(r,1500));}}if(!verified)fail('public_verification_failed');
    await request('https://launch.faolla.com/login');await verifyBase(s);verifyCandidate(s);configUnchanged(s,true);run('pm2',['save']);
    s.status='active';s.activatedAt=new Date().toISOString();save(s);atomic(activeFile,JSON.stringify({target:s.target,port:s.port,directory:s.directory,name:s.name}));
   }catch(error){if(s.lane==='order-attention')restoreOrderAttentionConfigs(s);else restoreConfigs(s);throw error;}
  }else if(action==='rollback'){
   if(!['active','activating'].includes(s.status)||!existsSync(activeFile)||JSON.parse(safeFile(activeFile)).target!==s.target)fail('rollback_not_current');configUnchanged(s,true);if(s.lane==='order-attention')restoreOrderAttentionConfigs(s);else restoreConfigs(s);
  }
 }
 const result=JSON.parse(safeFile(stateFile));console.log(JSON.stringify({status:result.status,target:result.target,port:result.port,directory:result.directory}));
}catch(error){console.error(error.message);process.exitCode=1;}finally{rmdirSync(operationLock);}
