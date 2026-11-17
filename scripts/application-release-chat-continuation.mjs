// Fixed reviewed retained-build supervisor. No build/SQL/process restart path.
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {CHAT_TARGET as TARGET,CHAT_BASELINE as BASELINE,CHAT_PINS as P,completeChatRecovery} from './application-release-chat-policy.mjs';
import {inspectReviewedChatSource,assertChatPreserved,chatHash} from './application-release-chat-source.mjs';
import {withReviewedChatExecution} from './application-release-authority.mjs';
import {withChatContinuationLocks} from './online-release-retention-writer.mjs';
import {bookingHostWriteOnce,bookingHostRead,bookingHostSync,bookingHostEnvironment} from './booking-handoff-host-io.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {withApplicationCliLifetime} from './application-release-cli-lifetime.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),tool=path.basename(directory),entry=directory+'/scripts/application-release-chat-continuation.mjs';
const root='/var/lib/faolla-chat-continuation/'+TARGET+'/'+tool;
const need=(v,c)=>{if(!v)throw Error('chat_continuation_'+c);};
const ensure=()=>{for(const p of ['/var/lib/faolla-chat-continuation','/var/lib/faolla-chat-continuation/'+TARGET,root]){if(!fs.existsSync(p)){ownedReleasePath(path.dirname(p),{directory:true});fs.mkdirSync(p,{mode:0o700});bookingHostSync(path.dirname(p));}ownedReleasePath(p,{directory:true,privateMode:true});}};
export function chatContinuationServicePlan(revision){
 need(/^[a-f0-9]{40}$/.test(revision)&&revision!==TARGET,'service_revision');
 const source='/var/lib/faolla-online-code/'+revision,command=source+'/scripts/application-release-chat-continuation.mjs';
 return{unit:'faolla-chat-continuation-'+revision,properties:['Type=oneshot','Restart=no','TimeoutStartSec=600','TimeoutStopSec=1500','KillMode=control-group','WorkingDirectory='+source,'StandardOutput=journal','StandardError=journal','ExecStopPost=/usr/bin/node '+command+' recover'],command:['/usr/bin/node',command,'run']};
}
async function closeOrRun(recover){
 return withChatContinuationLocks({orphan:recover,recordRoot:root},lock=>withReviewedChatExecution({lock},async()=>{
  if(!recover)assertChatPreserved({originalState:true});
  const {runRetainedChatUnderLock}=await import('./online-traffic-release.mjs');
  return runRetainedChatUnderLock(lock,{recover});
 }));
}
async function completeRecovery(value){
 return completeChatRecovery(value,{
  audit:async()=>{
   const audit=spawnSync('/usr/bin/node',[entry,'audit'],{cwd:directory,env:bookingHostEnvironment(),encoding:'utf8',timeout:300000,maxBuffer:65536});
   need(audit.status===0&&!audit.error&&!audit.signal,'post_completion_audit');return JSON.parse(audit.stdout);
  },
  verify:()=>{assertChatPreserved({originalState:false});need(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'recovery_scope_not_closed');},
  seal:completed=>{
   const file='/var/lib/faolla-application-publications/'+TARGET+'/completed.json';
   if(!fs.existsSync(file))bookingHostWriteOnce(file,JSON.stringify({kind:'ordinary-application-publication-completed',target:TARGET,baseline:BASELINE,toolRevision:tool,proof:completed.proof,retainedBuildSha256:P.build.sha256,controllerReceiptRecoveredWithoutReplay:true,mailEnabled:false,at:new Date().toISOString()})+'\n');
   const saved=JSON.parse(bookingHostRead(file));
   need(saved.kind==='ordinary-application-publication-completed'&&saved.target===TARGET&&saved.baseline===BASELINE&&saved.toolRevision===tool&&saved.retainedBuildSha256===P.build.sha256&&saved.proof?.certificateSha256===completed.proof.certificateSha256&&saved.mailEnabled===false,'completion_receipt_changed');
  },
 });
}
export async function runChatContinuation(){
 const source=await inspectReviewedChatSource();ensure();
 if(source.action==='audit')return withReviewedChatExecution({readOnly:true},async()=>{const{observeApplicationRelease}=await import('./application-release-audit.mjs');return observeApplicationRelease(TARGET);});
 if(source.action==='start'){
  // Read-only retained-build admission completes before a durable controller
  // is queued. A changed candidate never reaches ingress or recovery writes.
  assertChatPreserved({originalState:true});
  need(JSON.parse(bookingHostRead('/var/lib/faolla-online-release/active.json')).target===BASELINE,'baseline_changed');
  const p=chatContinuationServicePlan(tool),r=spawnSync('systemd-run',['--no-block','--unit',p.unit,'--collect',...p.properties.flatMap(v=>['--property',v]),'--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','--setenv=HOME=/root','--setenv=PM2_HOME=/root/.pm2','--',...p.command],{env:bookingHostEnvironment(),encoding:'utf8',timeout:20000});
  need(r.status===0&&!r.error&&!r.signal,'service_start_unconfirmed');return{kind:'chat-continuation-started',toolRevision:tool,target:TARGET,unit:p.unit,publicationCompleted:false};
 }
 if(source.action==='recover'){
  if(!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock')){
   const state=JSON.parse(bookingHostRead('/var/lib/faolla-online-release/'+TARGET+'/state.json'));
   if(state.applicationCompletion?.status==='completed'){
    return completeRecovery({kind:'chat-continuation-already-completed',actualTarget:TARGET,replayed:false});
   }
   // No lock and no completed proof is not authority to recreate a scope.
   need(false,'recovery_scope_missing');
  }
  // Covers controller death while an operation lock still existed as well as
  // death after its archival. Neither path replays activation or writes data.
  return completeRecovery(await closeOrRun(true));
 }
 need(source.action==='run','action');
 const attempt=root+'/attempt-'+randomUUID();fs.mkdirSync(attempt,{mode:0o700});bookingHostSync(root);
 bookingHostWriteOnce(attempt+'/admission.json',JSON.stringify({toolRevision:tool,target:TARGET,baseline:BASELINE,review:source.review,sourceInputs:source.inputs,at:new Date().toISOString()})+'\n');
 if(fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock')){
  const fd=fs.openSync(attempt+'/prior-recovery.log',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  let r;try{r=spawnSync('/usr/bin/node',[entry,'recover'],{cwd:directory,env:bookingHostEnvironment(),stdio:['ignore',fd,fd],timeout:1500000});}finally{fs.fsyncSync(fd);fs.closeSync(fd);}
  need(r.status===0&&!r.error&&!r.signal&&!fs.existsSync('/var/lib/faolla-maintenance/merchant-space/operation.lock'),'prior_recovery_unconfirmed');
 }
 assertChatPreserved({originalState:true});
 if(!fs.existsSync(root+'/original-state.json'))bookingHostWriteOnce(root+'/original-state.json',bookingHostRead('/var/lib/faolla-online-release/'+TARGET+'/state.json'));
 need(chatHash(bookingHostRead(root+'/original-state.json'))===P.preserved['/var/lib/faolla-online-release/'+TARGET+'/state.json'].sha256,'original_state_changed');
 bookingHostWriteOnce(attempt+'/original-state.json',bookingHostRead('/var/lib/faolla-online-release/'+TARGET+'/state.json'));
 bookingHostWriteOnce(attempt+'/preserved.json',JSON.stringify({pins:P,build:assertChatPreserved(),sourceInventorySha256:source.tool.inventorySha256})+'\n');
 try{
  const value=await closeOrRun(false);need(value.actualTarget===TARGET&&value.proof?.kind==='ordinary-application-release-readonly-verified','not_published');
  assertChatPreserved({originalState:false});
  const receipt={kind:'ordinary-application-publication-completed',target:TARGET,baseline:BASELINE,toolRevision:tool,proof:value.proof,retainedBuildSha256:P.build.sha256,mailEnabled:false,at:new Date().toISOString()};
  bookingHostWriteOnce(attempt+'/completed.json',JSON.stringify(receipt)+'\n');
  const completed='/var/lib/faolla-application-publications/'+TARGET+'/completed.json';
  need(!fs.existsSync(completed),'completion_already_present');bookingHostWriteOnce(completed,JSON.stringify(receipt)+'\n');
  return receipt;
 }catch(error){bookingHostWriteOnce(attempt+'/failure.json',JSON.stringify({kind:'chat-continuation-failed',target:TARGET,code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'unconfirmed',errorSha256:chatHash(String(error?.message)),at:new Date().toISOString()})+'\n');throw error;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 await withApplicationCliLifetime(runChatContinuation).then(v=>console.log(JSON.stringify(v)),e=>{console.error(JSON.stringify({kind:'chat-continuation-refused',code:/^[a-z_]{1,160}$/.test(e?.message??'')?e.message:'unconfirmed',publicationCompleted:false}));process.exitCode=1;});
}
