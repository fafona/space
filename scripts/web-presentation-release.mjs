import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,rmdirSync,realpathSync,lstatSync,openSync,closeSync,unlinkSync,readdirSync,copyFileSync,constants,statfsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assertWebPresentationReleaseScope,webPresentationProxy,webReleaseRuntimeEnvironment,WEB_RELEASE_FILES,WEB_RELEASE_ROOT as root,WEB_RELEASE_MARKER as marker,WEB_RELEASE_PROXY as proxy} from './web-presentation-release-policy.mjs';
const app='/www/wwwroot/merchant-space', name='merchant-space-web-live', port=3102, nginx='/www/server/nginx/sbin/nginx';
const [action,target,baseline]=process.argv.slice(2), stateFile=`${root}/state.json`;
const envBase={...process.env,HOME:'/root',PM2_HOME:'/root/.pm2'};
const read=p=>readFileSync(p,'utf8'), hash=v=>createHash('sha256').update(v).digest('hex');
const fail=m=>{throw Error(m);};
function run(command,args,options={}) { const r=spawnSync(command,args,{encoding:'utf8',env:envBase,timeout:60000,maxBuffer:4*1024*1024,...options});if(r.status!==0)fail(`web_release_command_failed:${command}:${r.status}:${r.signal??r.error?.code??'exit'}`);return r.stdout; }
function atomic(path,value){const tmp=`${path}.${process.pid}.tmp`;writeFileSync(tmp,value,{mode:0o600,flag:'wx'});renameSync(tmp,path);}
const save=s=>atomic(stateFile,JSON.stringify(s,null,2));
const pm=()=>JSON.parse(run('pm2',['jlist']));
function safeFile(path){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())fail('unexpected_file_type');return read(path);}
async function request(url,statuses=[200],host){const r=await fetch(url,{redirect:'manual',headers:host?{Host:host}:undefined,signal:AbortSignal.timeout(20000)});if(!statuses.includes(r.status))fail(`web_release_http:${r.status}:${new URL(url).pathname}`);return r;}
async function verifyBase(state){
 const maintenance=JSON.parse(read('/var/lib/faolla-maintenance/merchant-space/state.json'));
 if(maintenance.phase!=='ended'||maintenance.targetSha!==state.baseline)fail('maintenance_not_ended');
 const all=pm();
 for(const saved of state.processes){const p=all.find(p=>p.name===saved.name);if(!p||p.pid!==saved.pid||p.pm2_env.pm_cwd!==saved.cwd||p.pm2_env.status!=='online')fail('baseline_process_changed');}
 if(realpathSync(`${app}.current`)!==state.baseDirectory)fail('baseline_link_changed');
 if((await(await request('http://127.0.0.1:3000/api/app-web-version')).json()).buildId!==state.baseline)fail('baseline_version_changed');
}
function verifyCandidate(state){const p=pm().find(p=>p.name===name);if(!p||p.pm2_env.status!=='online'||p.pm2_env.pm_cwd!==state.directory||p.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED!=='1')fail('web_candidate_identity_invalid');}
function configUnchanged(state,active=false){for(const file of WEB_RELEASE_FILES){if(hash(safeFile(`${proxy}/${file}`))!==state.configs[file][active?'newHash':'oldHash'])fail('proxy_configuration_changed');}}
function restoreConfigs(state){
 for(const file of WEB_RELEASE_FILES){const actual=hash(safeFile(`${proxy}/${file}`)), entry=state.configs[file];if(actual!==entry.oldHash&&actual!==entry.newHash)fail('rollback_proxy_not_owned');}
 for(const file of WEB_RELEASE_FILES)atomic(`${proxy}/${file}`,safeFile(`${root}/before-${file}`));
 run(nginx,['-t']);run(nginx,['-s','reload']);
 if(existsSync(marker)){if(hash(safeFile(marker))!==state.markerHash)fail('rollback_marker_not_owned');renameSync(marker,`${root}/marker-rolled-back-${Date.now()}.conf`);}
 state.status='rolled-back';state.rolledBackAt=new Date().toISOString();save(state);
}
// Publish immutable assets additively for both old open tabs and the new build.
// A same-name/different-content collision stops BEFORE any traffic switch.
function publishStatic(source,destination){
 const entries=[];
 function walk(dir,rel=''){for(const entry of readdirSync(dir,{withFileTypes:true})){const key=rel?`${rel}/${entry.name}`:entry.name, path=`${dir}/${entry.name}`;if(entry.isSymbolicLink())fail('static_symlink');if(entry.isDirectory())walk(path,key);else if(entry.isFile())entries.push(key);else fail('static_type_invalid');}}
 walk(source);
 for(const key of entries){const path=`${destination}/${key}`;if(existsSync(path)&&(lstatSync(path).isSymbolicLink()||hash(readFileSync(path))!==hash(readFileSync(`${source}/${key}`))))fail('static_collision');}
 for(const key of entries){const path=`${destination}/${key}`;if(!existsSync(path)){mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true,mode:0o755});copyFileSync(`${source}/${key}`,path,constants.COPYFILE_EXCL);}}
 return entries.length;
}
async function smoke(state,publicMode=false){
 const origin=publicMode?'https://www.faolla.com':`http://127.0.0.1:${port}`;
 const version=await(await request(`${origin}/api/app-web-version?live_release=${state.target}`,[200],'www.faolla.com')).json();if(version.buildId!==state.target)fail('candidate_version_mismatch');
 for(const path of ['/','/login','/admin','/super-admin'])await request(origin+path,[200,301,302,303,307,308],'www.faolla.com');
 const card=await(await request(`${origin}/card/luis-gpyv6u`,[200],'www.faolla.com')).text();
 if(!card.includes('class="button secondary" href="https://www.haoyouduosevilla.com/"'))fail('card_website_regression');
 const contact=await(await request(`${origin}/card/luis-gpyv6u/contact`,[200],'www.faolla.com')).text();if(!contact.includes('URL:https://www.haoyouduosevilla.com/'))fail('vcard_website_regression');
 // Authentication remains enforced without making any mutation request.
 await request(`${origin}/api/super-admin/platform-merchant-snapshot`,[401],'www.faolla.com');
}
if(process.platform!=='linux'||process.getuid?.()!==0||!['stage','activate','rollback','status'].includes(action))fail('invalid_web_release_invocation');
if(!process.env.FAOLLA_WEB_PRESENTATION_LOCKED){
 const lock=`${app}.deploy.lock`;if(existsSync(lock)&&lstatSync(lock).isSymbolicLink())fail('unsafe_deploy_lock');
 const r=spawnSync('flock',['--nonblock',lock,process.execPath,fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit',env:{...envBase,FAOLLA_WEB_PRESENTATION_LOCKED:'1'}});process.exit(r.status??1);
}
mkdirSync(root,{recursive:true,mode:0o700});if(lstatSync(root).isSymbolicLink()||(lstatSync(root).mode&0o077))fail('unsafe_state_directory');
const operationLock='/var/lib/faolla-maintenance/merchant-space/operation.lock';mkdirSync(operationLock,{mode:0o700});
try {
 if(action==='stage'){
  if(!/^[a-f0-9]{40}$/.test(target??'')||!/^[a-f0-9]{40}$/.test(baseline??''))fail('invalid_commit');
  if(existsSync(stateFile)||existsSync(marker)||pm().some(p=>p.name===name))fail('existing_web_release_requires_review');
  if(run('git',['rev-parse','origin/main'],{cwd:app}).trim()!==target)fail('target_not_main');
  run('git',['merge-base','--is-ancestor',baseline,target],{cwd:app});
  assertWebPresentationReleaseScope(run('git',['diff','--name-only',baseline,target],{cwd:app}).trim().split('\n'));
  const all=pm(), baseDirectory=realpathSync(`${app}.current`), base=all.find(p=>p.name==='merchant-space');
  const processes=['merchant-space','merchant-space-enterprise-automation-worker','merchant-space-contact-card'].map(n=>{const p=all.find(p=>p.name===n);if(!p)fail('baseline_process_missing');return{name:n,pid:p.pid,cwd:p.pm2_env.pm_cwd};});
  const cardState=JSON.parse(read('/var/lib/faolla-contact-card-release/state.json'));
  if(cardState.status!=='active'||hash(safeFile(`${proxy}/faolla_contact_card_release.conf`))!==cardState.configHash)fail('card_overlay_not_owned');
  if(hash(run('git',['show',`${target}:package-lock.json`],{cwd:app}))!==hash(read(`${baseDirectory}/package-lock.json`)))fail('dependencies_changed');
  const disk=statfsSync('/www');if(disk.bavail*disk.bsize<10*1024**3)fail('insufficient_disk_reserve');
  const state={target,baseline,baseDirectory,processes,status:'preparing',startedAt:new Date().toISOString(),configs:{}};
  await verifyBase(state);
  for(const file of WEB_RELEASE_FILES){const old=safeFile(`${proxy}/${file}`),next=webPresentationProxy(old,file,target);state.configs[file]={oldHash:hash(old),newHash:hash(next)};writeFileSync(`${root}/before-${file}`,old,{mode:0o600,flag:'wx'});writeFileSync(`${root}/after-${file}`,next,{mode:0o600,flag:'wx'});}
  state.directory=`${app}.web-releases/${target.slice(0,12)}-${Date.now()}`;mkdirSync(state.directory,{recursive:true,mode:0o700});save(state);
  const archive=`${state.directory}/.source.tar`,fd=openSync(archive,'wx',0o600);
  try{run('git',['archive','--format=tar',target],{cwd:app,stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
  run('tar',['--no-same-owner','--no-same-permissions','-xf',archive,'-C',state.directory]);unlinkSync(archive);
  run('cp',['-a','--reflink=auto',`${baseDirectory}/node_modules`,`${state.directory}/node_modules`],{timeout:180000});
  // Runtime IPC descriptors belong to the original PM2 child, not tests/builds.
  const env=webReleaseRuntimeEnvironment(read(`/proc/${base.pid}/environ`));
  const changes={FAOLLA_WEB_BUILD_ID:target,NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID:target,FAOLLA_WEB_RELEASED_AT:new Date().toISOString(),FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',PORT:String(port)};
  const envText=read(`${baseDirectory}/.env.local`).split('\n').filter(line=>!Object.keys(changes).some(k=>line.startsWith(`${k}=`))).join('\n');writeFileSync(`${state.directory}/.env.local`,envText+'\n'+Object.entries(changes).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  Object.assign(env,changes,{HOME:'/root',PM2_HOME:'/root/.pm2',NODE_OPTIONS:'--max-old-space-size=4096',NEXT_TELEMETRY_DISABLED:'1'});
  console.log('web_release_focused_tests');
  run('node',['--import','tsx','--test','src/lib/merchantBusinessCardBackground.test.ts','src/lib/merchantBusinessCardQrText.test.ts','src/lib/merchantBusinessCards.test.ts','src/lib/platformMerchantSnapshot.test.ts','src/lib/platformAdminBackupValidation.test.ts','src/lib/platformMerchantSnapshotStore.test.ts','src/lib/merchantBusinessCardDestination.test.ts','scripts/web-presentation-release.test.mjs'],{cwd:state.directory,env,timeout:180000,stdio:'inherit'});
  console.log('web_release_build_started');run('nice',['-n','10','npm','run','build'],{cwd:state.directory,env,timeout:900000,stdio:'inherit'});
  if(!existsSync(`${state.directory}/.next/BUILD_ID`))fail('build_missing');await verifyBase(state);configUnchanged(state);
  run('pm2',['start',`${state.directory}/node_modules/next/dist/bin/next`,'--name',name,'--cwd',state.directory,'--interpreter',process.execPath,'--','start','-H','127.0.0.1','-p',String(port)],{env});
  let ready=false;for(let i=0;i<25;i++){try{if((await(await request(`http://127.0.0.1:${port}/api/app-web-version`)).json()).buildId===target){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)fail('candidate_not_ready');
  verifyCandidate(state);await smoke(state);state.status='staged';save(state);console.log(JSON.stringify({status:state.status,target}));
 }else{
  const state=JSON.parse(read(stateFile));await verifyBase(state);
  if(action==='activate'){
   if(state.status!=='staged'||existsSync(marker))fail('not_staged');verifyCandidate(state);configUnchanged(state);await smoke(state);
   const staticDir=realpathSync(`${app}/.next/static`);if(!staticDir.startsWith('/www/wwwroot/merchant-space'))fail('unexpected_static_directory');
   state.staticFiles=publishStatic(`${state.directory}/.next/static`,staticDir);
   const content=`# Managed live web release ${state.target}. Roll back with web-presentation-release.mjs before other deployment.\n`;
   state.markerHash=hash(content);state.status='activating';save(state);
   try{
    writeFileSync(marker,content,{mode:0o600,flag:'wx'});
    for(const file of WEB_RELEASE_FILES)atomic(`${proxy}/${file}`,safeFile(`${root}/after-${file}`));
    run(nginx,['-t']);run(nginx,['-s','reload']);
    let verified=false;for(let i=0;i<8;i++){try{await smoke(state,true);verified=true;break;}catch{await new Promise(r=>setTimeout(r,1500));}}if(!verified)fail('public_verification_failed');
    await request('https://launch.faolla.com/login');await verifyBase(state);verifyCandidate(state);configUnchanged(state,true);
    run('pm2',['save']);state.status='active';state.activatedAt=new Date().toISOString();save(state);
   }catch(error){restoreConfigs(state);throw error;}
  }else if(action==='rollback'){if(!['active','activating'].includes(state.status))fail('not_active');restoreConfigs(state);}
  console.log(JSON.stringify({status:state.status,target:state.target,baseline:state.baseline,processes:state.processes}));
 }
}catch(error){console.error(error.message);process.exitCode=1;}finally{rmdirSync(operationLock);}
