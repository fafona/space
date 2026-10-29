// Actual active-generation collector and append-only five-file journal. It
// cannot activate SQL, control a process, save PM2 a second time, or open the
// booking worker gate. A completed certificate is not inferred from a receipt.
import * as fs from 'node:fs';import {isDeepStrictEqual} from 'node:util';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {assertActiveBookingPublicationLockBinding,activeBookingPublicationEvidence} from './release-toolchain-active-generation-publication-scope.mjs';
import {verifyActiveBookingPublicationMetadata,activeBookingPublicationMetadataEvidence} from './release-toolchain-active-generation-publication-metadata-host.mjs';
import {observeActiveBookingPublicationAfterMetadata} from './release-toolchain-active-generation-publication-observation.mjs';
import {verifyActiveBookingPublicationPersistenceAfterMetadata} from './release-toolchain-active-generation-persistence.mjs';
import {collectActiveBookingLegacyHost} from './release-toolchain-pm2-observation.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {createOnlineRetentionJournal,executeOnlineRetention} from './online-release-retention-writer.mjs';
import {ONLINE_RETENTION_POLICY,retentionHash,assertOnlineRetentionPlan} from './online-release-retention-policy.mjs';
import {parseRetirementSockets} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY,WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
import {runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {bookingHostRead,bookingHostRun,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const RELEASE='/var/lib/faolla-online-release',APP='/www/wwwroot/merchant-space',contexts=new WeakMap(),same=(a,b)=>need(isDeepStrictEqual(a,b),'observation_mismatch');
const read=(file,privateMode=true)=>bookingHostRead(file,{privateMode}),digest=(file,privateMode=true)=>sha256(read(file,privateMode));
function context(options){const admission=assertActiveBookingPublicationLockBinding(options.scope,options);const s=contexts.get(options.scope);if(s){need(s.lock===options.lock&&s.toolRevision===options.toolRevision,'invalid_contract');same(s.window,options.window);same(s.directory,admission.directory);need(!s.failed,'attempt_unknown');}return s;}
// Only a journal created by THIS in-memory factory may hide its own unfinished
// tail. Public history readers remain strict and cannot accept allowPending.
export function activeBookingPublicationPriorHistory(options){
 const s=context(options),metadata=activeBookingPublicationMetadataEvidence(options),prior=metadata.priorHistory;
 if(!s){same(readOnlineRetentionHistory(),prior);return prior;}
 if(s.completed){same(readOnlineRetentionHistory(),s.completed);return prior;}
 const current=s.journal?s.journal.prefix():readOnlineRetentionHistory();same(current,prior);return current;
}
export function assembleActiveBookingRetentionObservation({history,handoff,toolRevision,inventorySha256,cohort,stateText,maintenanceText,markerSha256,baseDirectory,proxyHashes,nginxConfig,releaseProofs,identityProofs,sockets}){
 need(/^[a-f0-9]{64}$/.test(inventorySha256??''),'evidence_invalid');
 const activeState=JSON.parse(stateText),value={version:2,policy:ONLINE_RETENTION_POLICY,kind:'booking-handoff',toolRevision,sequence:history.entries.length+1,previousSha256:history.headSha256,legacySha256:history.rollingHistory.legacySha256,rollingHeadSha256:history.rollingHistory.headSha256,rollingHistorySha256:retentionHash(history.rollingHistory),active:cohort.active,rollback:cohort.rollback,victim:null,activeFile:Object.fromEntries(['target','name','directory','port'].map(key=>[key,cohort.active[key]])),activeState,activeSha256:sha256(stateText),processes:cohort.processes,sourceClean:true,sourceInventorySha256:inventorySha256,maintenanceEnded:JSON.parse(maintenanceText).phase==='ended',maintenanceSha256:sha256(maintenanceText),markerSha256,baseDirectory,proxyHashes,nginxConfig,releaseProofs,identityProofs,ancestry:[{older:P.compatibleRollback,newer:P.candidate,verified:true}],bookingHandoff:handoff,...sockets};
 assertOnlineRetentionPlan(value,history);return value;
}
async function localVersion(anchor){
 const response=await fetch('http://127.0.0.1:'+anchor.port+'/api/app-web-version',{headers:{Host:'www.faolla.com',Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(3000)});need(response.status===200,'public_recovery_unconfirmed');
 const reader=response.body?.getReader();need(reader,'evidence_invalid');const chunks=[];let bytes=0;try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;need(bytes<=4096,'evidence_invalid');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));need(v.ok===true&&v.buildId===anchor.target,'build_binding_mismatch');return{status:response.status,ok:v.ok,buildId:v.buildId};
}
export async function observeActiveBookingRetention(options){
 context(options);const metadata=activeBookingPublicationMetadataEvidence(options),evidence=activeBookingPublicationEvidence(options.scope),live=await observeActiveBookingPublicationAfterMetadata(options),history=activeBookingPublicationPriorHistory(options),physical=collectActiveBookingLegacyHost();same(sha256(canonicalJson(physical.processes)),live.observation.processesSha256);same(sha256(canonicalJson(physical.identityProofs)),live.observation.identitiesSha256);
 const releaseProofs=[];for(const anchor of [live.cohort.active,live.cohort.rollback]){const root=RELEASE+'/'+anchor.target,stateText=read(root+'/state.json');need(runOnlineToolGit(anchor.directory,['rev-parse','HEAD']).toString().trim()===anchor.target&&!runOnlineToolGit(anchor.directory,['status','--porcelain=v1','--untracked-files=all']).toString().trim(),'source_changed');
  releaseProofs.push({target:anchor.target,sourceHead:anchor.target,sourceClean:true,resolvedInterpreter:fs.realpathSync(anchor.process.interpreter),state:JSON.parse(stateText),stateText,stateSha256:sha256(stateText),buildSha256:digest(anchor.directory+'/.next/BUILD_ID',false),runtimeSha256:digest(root+'/atomic-runtime.json'),environmentSha256:digest(anchor.directory+'/.env.local'),http:await localVersion(anchor)});
 }
 runOnlineToolGit(APP,['merge-base','--is-ancestor',P.compatibleRollback,P.candidate]);
 const value=assembleActiveBookingRetentionObservation({history,handoff:metadata.handoff,toolRevision:options.toolRevision,inventorySha256:evidence.inventorySha256,cohort:live.cohort,stateText:metadata.stateText,maintenanceText:read('/var/lib/faolla-maintenance/merchant-space/state.json'),markerSha256:digest(WEB_RELEASE_MARKER,false),baseDirectory:fs.realpathSync(APP+'.current'),proxyHashes:Object.fromEntries(WEB_RELEASE_FILES.map(file=>[file,digest(WEB_RELEASE_PROXY+'/'+file,false)])),nginxConfig:bookingHostRun('/www/server/nginx/sbin/nginx',['-T']),releaseProofs,identityProofs:physical.identityProofs,sockets:parseRetirementSockets(bookingHostRun('ss',['-ltnpH']),bookingHostRun('ss',['-tnpH']))});
 same(collectActiveBookingLegacyHost().processes,physical.processes);same(collectActiveBookingLegacyHost().identityProofs,physical.identityProofs);verifyActiveBookingPublicationMetadata(options);activeBookingPublicationPriorHistory(options);return value;
}
export async function commitActiveBookingPublicationCertificate(options){
 const admission=assertActiveBookingPublicationLockBinding(options.scope,options);need(!contexts.has(options.scope),'attempt_replay_forbidden');const prior=activeBookingPublicationMetadataEvidence(options).priorHistory;
 const s={lock:options.lock,toolRevision:options.toolRevision,window:structuredClone(options.window),directory:admission.directory,prior,journal:null,completed:null,failed:false,certificate:null};contexts.set(options.scope,s);
 try{await verifyActiveBookingPublicationPersistenceAfterMetadata(options);const first=await observeActiveBookingRetention(options);
  const certificate=await executeOnlineRetention({observe:()=>observeActiveBookingRetention(options),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),now:()=>new Date().toISOString(),recovery:()=>({version:2,process:null}),begin:(_before,prefix)=>{context(options);same(prefix,prior);need(!s.journal,'attempt_replay_forbidden');s.journal=createOnlineRetentionJournal(prior);s.journal.begin();},write:(file,text)=>{context(options);need(s.journal,'invalid_contract');s.journal.write(file,text);},finalCheck:()=>observeActiveBookingRetention(options),complete:certificate=>{context(options);s.completed=s.journal.complete(certificate);s.certificate=structuredClone(certificate);}},first,prior);
  same(certificate,s.certificate);bookingHostWriteOnce(s.directory+'/publication-certificate-completed.json',canonicalJson({kind:'active-booking-publication-certificate-completed',toolRevision:options.toolRevision,window:options.window,certificateSha256:retentionHash(certificate),historyHeadSha256:s.completed.headSha256,journalDirectory:s.journal.location,workerGateOpened:false,activationPerformed:false,businessDataWritten:false,publicationAuthority:false,completedAt:new Date().toISOString()})+'\n');return verifyActiveBookingPublicationCertificate(options);
 }catch(error){s.failed=true;try{bookingHostWriteOnce(s.directory+'/publication-unconfirmed.json',canonicalJson({kind:'active-booking-publication-unconfirmed',stage:'certificate',errorSha256:sha256(String(error?.message??'unknown')),automaticRetryAllowed:false,publicationAuthority:false})+'\n');}catch{}throw error;}
}
export function verifyActiveBookingPublicationCertificate(options){
 const s=context(options);need(s?.completed&&s.certificate,'invalid_contract');verifyActiveBookingPublicationMetadata(options);same(readOnlineRetentionHistory(),s.completed);same(s.completed.entries.at(-1),s.certificate);const value=JSON.parse(read(s.directory+'/publication-certificate-completed.json'));need(value.kind==='active-booking-publication-certificate-completed'&&value.certificateSha256===retentionHash(s.certificate)&&value.historyHeadSha256===s.completed.headSha256&&value.journalDirectory===s.journal.location&&value.workerGateOpened===false&&value.activationPerformed===false&&value.businessDataWritten===false&&value.publicationAuthority===false,'evidence_invalid');same(value.window,options.window);same(value.toolRevision,options.toolRevision);return{certificate:structuredClone(s.certificate),history:structuredClone(s.completed),directory:s.directory,certificateSha256:retentionHash(s.certificate),publicationAuthority:false};
}
