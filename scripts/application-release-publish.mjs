// A durable server-owned ordinary application publication. The same reviewed
// command is reusable; only the manifest/commit changes for the next release.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {APPLICATION_RELEASE_MANIFEST} from './application-release-policy.mjs';
import {inspectPinnedExecutionSource,collectRemoteReleaseReview,assertReviewFresh,ownedReleasePath} from './release-toolchain-source.mjs';
import {withApplicationPublicationLocks,withApplicationOrphanRecoveryLocks} from './online-release-retention-writer.mjs';
import {observeApplicationRelease} from './application-release-audit.mjs';
import {bookingHostRead,bookingHostWriteOnce,bookingHostSync,bookingHostEnvironment} from './booking-handoff-host-io.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';
const ROOT='/var/lib/faolla-application-publications',RELEASE='/var/lib/faolla-online-release';
const need=(value,reason)=>{if(!value)throw Error('application_publication_'+reason);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const state=target=>{try{return JSON.parse(bookingHostRead(RELEASE+'/'+target+'/state.json'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
export function applicationPublicationServicePlan(target,baseline){
 need(/^[a-f0-9]{40}$/.test(target??'')&&/^[a-f0-9]{40}$/.test(baseline??'')&&target!==baseline,'identity');
 const source='/var/lib/faolla-online-code/'+target,entry=source+'/scripts/application-release-publish.mjs';
 return {unit:'faolla-application-publish-'+target,source,entry,
  properties:['Type=oneshot','Restart=no','TimeoutStartSec=2700','TimeoutStopSec=1500','KillMode=control-group',
   'WorkingDirectory='+source,'StandardOutput=journal','StandardError=journal',
   'ExecStopPost=/usr/bin/node '+entry+' recover '+target+' '+baseline],
  command:['/usr/bin/node',entry,'run',target,baseline]};
}
function invocation(action,target,baseline){
 const plan=applicationPublicationServicePlan(target,baseline);
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&
  process.argv.length===5&&process.argv[2]===action&&fileURLToPath(import.meta.url)===plan.entry&&process.cwd()===plan.source,'invocation');
 const source=inspectPinnedExecutionSource({revision:target,directory:plan.source});
 const manifest=JSON.parse(fs.readFileSync(plan.source+'/'+APPLICATION_RELEASE_MANIFEST,'utf8'));
 need(manifest.baseline===baseline,'baseline');return {...plan,inventorySha256:source.inventorySha256};
}
function directory(target){
 if(!fs.existsSync(ROOT)){ownedReleasePath('/var/lib',{directory:true});fs.mkdirSync(ROOT,{mode:0o700});bookingHostSync('/var/lib');}
 ownedReleasePath(ROOT,{directory:true,privateMode:true});const result=ROOT+'/'+target;
 if(!fs.existsSync(result)){fs.mkdirSync(result,{mode:0o700});bookingHostSync(ROOT);}ownedReleasePath(result,{directory:true,privateMode:true});return result;
}
function seal(root,name,value){
 const destination=root+'/'+name,temporary=destination+'.tmp-'+randomUUID();
 need(!fs.existsSync(destination),'record_exists');
 bookingHostWriteOnce(temporary,JSON.stringify(value)+'\n');
 need(!fs.existsSync(destination),'record_exists');fs.renameSync(temporary,destination);bookingHostSync(root);
 need(bookingHostRead(destination)===JSON.stringify(value)+'\n','record_readback');
}
function jobLock(root,work,{optional=false}={}){
 ownedReleasePath(root,{directory:true,privateMode:true});const file=root+'/controller.lock';
 const fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 let opened=true;const release=()=>{if(opened){opened=false;fs.closeSync(fd);}};
 try{
  const st=ownedReleasePath(file,{privateMode:true}),opened=fs.fstatSync(fd);need(st.dev===opened.dev&&st.ino===opened.ino,'job_lock_changed');
  const locked=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],env:bookingHostEnvironment(),timeout:10000});
  if(locked.status!==0||locked.signal||locked.error){release();if(optional)return null;throw Error('application_publication_already_running');}
  const result=work();if(result&&typeof result.then==='function')return result.finally(release);release();return result;
 }catch(error){try{release();}catch{}throw error;}
}
async function child(source,args,log,timeoutMs){
 const fd=fs.openSync(log,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 let actor;
 try{
  actor=spawn('/usr/bin/node',[source+'/scripts/online-traffic-release.mjs',...args],{cwd:source,env:bookingHostEnvironment(),stdio:['ignore',fd,fd]});
  const completion=new Promise((resolve,reject)=>{actor.once('error',reject);actor.once('close',(code,signal)=>resolve({code,signal}));});
  let original;
  try{original=captureProcessFact(actor.pid);}catch(error){await completion;if(!['ENOENT','ESRCH'].includes(error.code))throw error;throw Error('application_publication_controller_exited_before_witness');}
  let killer;
  const signal=value=>{try{const current=captureProcessFact(actor.pid);if(current.startTicks===original.startTicks&&current.uid===0)actor.kill(value);}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}};
  const timer=setTimeout(()=>{signal('SIGTERM');killer=setTimeout(()=>signal('SIGKILL'),15000);},timeoutMs);
  try{const result=await completion;need(result.code===0&&!result.signal,'controller_refused');return result;}
  finally{clearTimeout(timer);clearTimeout(killer);}
 }finally{fs.fsyncSync(fd);fs.closeSync(fd);}
}

export async function executeOrdinaryApplicationPublication(operations){
 await operations.admit();
 try{
  await operations.stage();await operations.activate();
  const proof=await operations.audit();await operations.complete(proof);return proof;
 }catch(error){
  await operations.failed(error);
  const recovered=await operations.recover();
  // A verified rollback is safe, but is not a successful publication.
  if(recovered.actualTarget===operations.target){const proof=await operations.audit();await operations.complete(proof);return proof;}
  throw Error('application_publication_recovered_not_published');
 }
}

export async function recoverOrdinaryApplicationPublication(target,baseline){
 const plan=invocation('recover',target,baseline),current=state(target),root=directory(target);
 const operation='/var/lib/faolla-maintenance/merchant-space/operation.lock';
 if(!fs.existsSync(operation)&&current?.applicationCompletion?.status==='completed'&&current.status==='active'){
  const proof=await observeApplicationRelease(target);
  if(!fs.existsSync(root+'/completed.json'))jobLock(root,()=>{
   if(!fs.existsSync(root+'/completed.json'))seal(root,'completed.json',{kind:'ordinary-application-publication-completed',target,baseline,proof,
    controllerReceiptRecoveredWithoutReplay:true,mailEnabled:false,at:new Date().toISOString()});
  },{optional:true});
  return{kind:'ordinary-application-complete-no-replay',target,actualTarget:target,proof};
 }
 const {recoverApplicationPublicationUnderLock}=await import('./online-traffic-release.mjs');
 const proof=fs.existsSync(operation)
  ?await withApplicationOrphanRecoveryLocks({target},lock=>recoverApplicationPublicationUnderLock(lock))
  :await withApplicationPublicationLocks({target,action:'recover'},lock=>recoverApplicationPublicationUnderLock(lock));
 const result=proof.result??proof;
 seal(root,'recovery-'+randomUUID()+'.json',{kind:'ordinary-application-recovery-verified',target,sourceInventorySha256:plan.inventorySha256,...result,at:new Date().toISOString()});
 return result;
}

export async function runOrdinaryApplicationPublication(target,baseline){
 const plan=invocation('run',target,baseline),root=directory(target),readState=()=>state(target);
 need(!fs.existsSync(root+'/admission.json'),'attempt_exists');
 return jobLock(root,()=>executeOrdinaryApplicationPublication({target,
  admit:async()=>{const review=await collectRemoteReleaseReview(target);assertReviewFresh(review,target);seal(root,'admission.json',{kind:'ordinary-application-publication-admitted',target,baseline,review,inventorySha256:plan.inventorySha256,mailEnabled:false,at:new Date().toISOString()});},
  stage:async()=>{
   await child(plan.source,['stage-application',target,baseline],root+'/stage.log',1500000);
   need(readState()?.status==='ready-no-database','stage_incomplete');
  },
  activate:()=>child(plan.source,['activate',target],root+'/activate.log',600000),
  audit:()=>observeApplicationRelease(target),
  complete:async proof=>{
   if(fs.existsSync(root+'/completed.json')){const completed=JSON.parse(bookingHostRead(root+'/completed.json'));need(completed.target===target&&completed.proof.certificateSha256===proof.certificateSha256,'completion_changed');return;}
   seal(root,'completed.json',{kind:'ordinary-application-publication-completed',target,baseline,proof,mailEnabled:false,at:new Date().toISOString()});
  },
  failed:async error=>seal(root,'controller-failure.json',{kind:'ordinary-application-controller-failed',target,errorSha256:digest(String(error?.message)),originalFailureRetained:true,at:new Date().toISOString()}),
  recover:async()=>{
   // A fresh node has the immutable recovery invocation, independent of this
   // controller's event loop, argv and failed child's operation token.
   const log=root+'/controller-recovery.log',fd=fs.openSync(log,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   try{const result=spawnSync('/usr/bin/node',[plan.entry,'recover',target,baseline],{cwd:plan.source,env:bookingHostEnvironment(),stdio:['ignore',fd,fd],timeout:1500000});need(result.status===0&&!result.signal&&!result.error,'independent_recovery_unconfirmed');}
   finally{fs.fsyncSync(fd);fs.closeSync(fd);}
   const current=JSON.parse(bookingHostRead(RELEASE+'/active.json'));return{actualTarget:current.target};
  },
 }));
}

export async function startOrdinaryApplicationPublication(target,baseline){
 const plan=invocation('start',target,baseline),review=await collectRemoteReleaseReview(target);assertReviewFresh(review,target);
 need(!fs.existsSync(ROOT+'/'+target+'/admission.json'),'attempt_exists');
 const args=['--unit',plan.unit,'--collect',...plan.properties.flatMap(value=>['--property',value]),
  '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','--setenv=HOME=/root','--setenv=PM2_HOME=/root/.pm2','--',...plan.command];
 const result=spawnSync('systemd-run',args,{cwd:plan.source,env:bookingHostEnvironment(),encoding:'utf8',timeout:20000,maxBuffer:65536});
 need(result.status===0&&!result.signal&&!result.error,'service_start_unconfirmed');
 return{kind:'ordinary-application-publication-service-started',target,baseline,unit:plan.unit,source:plan.source,sshDisconnectSafe:true,publicationCompleted:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [action,target,baseline,...extra]=process.argv.slice(2);
 const run=action==='start'?startOrdinaryApplicationPublication:action==='run'?runOrdinaryApplicationPublication:action==='recover'?recoverOrdinaryApplicationPublication:null;
 if(!run||extra.length)throw Error('application_publication_invocation');
 run(target,baseline).then(value=>console.log(JSON.stringify(value)),error=>{console.error(JSON.stringify({kind:'ordinary-application-publication-refused',code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'operation_unconfirmed',publicationCompleted:false}));process.exitCode=1;});
}
