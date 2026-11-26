// Synthetic UNIT-TEST claims only, never downloaded CI artifacts or production
// metadata. Saved-kind pin checks must reject these even when self-rehashed.
import {createHash} from 'node:crypto';
import {loadGroupNextRevision} from '../member-checkout-group-next-revision.mjs';
import {reviewedCheckoutAcceptanceSpec} from '../member-checkout-reviewed-acceptance.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const current=await loadGroupNextRevision();
function workers(mode){
 const kills=[false,false,false,true,false,mode==='commit-unknown',false,false,false,false,false,false,false,false,false,false];
 const refuses=[true,true,true,false,false,false,false,false,true,true,true,true,true,true,true,false];
 const actions=['install','install','install','install','recover','install','recover','recover','install','recover','recover','recover','recover','recover','recover','recover'];
 const applied=[0,0,34,38,0,38,0,0,0,0,0,0,0,0,0,0];
 return actions.map((action,i)=>({action,plannedKill:kills[i],expectedRefusal:refuses[i],forced:false,stdoutBytes:0,stderrBytes:0,signal:kills[i]?'SIGKILL':null,code:kills[i]?null:refuses[i]?1:0,
  progress:{applied:applied[i],commitDispatches:i===5?1:0,opened:1,closed:kills[i]?0:1,errorCode:i===2?'22012':null}}));
}
function combined(){
 const sample=(phase,ms)=>({phase,status:401,startedPastExpiryMs:ms,endedPastExpiryMs:ms+1});
 const generations=[1,2,3].map(i=>({generation:'synthetic-'+i,expiresAt:100+i,postgrestExpiredStatus:401,observation:sample('observation',31001),expiryProof:sample('proof',34001)}));
 const outage={observation:sample('observation',31001),expiryProof:sample('proof',34001),realExpiredStatus:401,originalBytesRetained:true,dispatchesAfterCutoff:0,stillValidReplies:1};
 const expiryObservations=generations.flatMap(g=>[g.observation,g.expiryProof].map(s=>({generation:g.generation,expiresAt:g.expiresAt,...s})));
 expiryObservations.push(...[outage.observation,outage.expiryProof].map(s=>({generation:'synthetic-outage',expiresAt:104,...s})));
 return {sourceRevision:current,candidateRevision:{sha256:current.material.candidateRevisionSha256},application:current.material.application,baseApplication:current.material.frozenApplication,
  expiryPolicy:{version:1,observationAfterMs:31000,proofAfterMs:34000,reads:2},generations,expiryObservations,outage,
  runtime:{...Object.fromEntries(['sameNextProcess','differentUid','automaticRenewal','nextSigningKeyReadDenied','nextCredentialWriteDenied','nextRequestReadDenied','issuerOutageAndRecovery','ordinaryServiceIdentityRetained'].map(k=>[k,true])),
   ...Object.fromEntries(['reloadOrRestart','envFallback','signingMaterialPassedToNext','formalIssuerProvisioned','kongValidated','fullProductionGatewayValidated','productionReadPerformed','productionAuthorized','deploymentReady'].map(k=>[k,false])),
   financialCommitDispatches:1,financialDebitCount:1,financialPostRetries:0,actualWallClockGatewayExpirations:3,nextUid:65534,issuerUid:1001},
  continuousReplies:3,methods:['faolla_member_checkout_submission_commit_v2'],groupShutdown:{code:0,signal:null,complete:{passed:true,processes:[{code:0,signal:null,forced:false},{code:0,signal:null,forced:false}]}},databaseClosed:true,nextShutdown:{acknowledged:true,forbiddenFetches:0},stopped:[{forced:false}],groupDiagnostics:[]};
}
function native(mode){
 return {mode,registryEngine:'PostgreSQL',serverVersion:'150008',application:current.material.frozenApplication,bundleSha256:'f34249f74c0311323fac2f7779fe14ea3151ffacc74d3b5cacf75de8d41d839e',fixtureHistoricalRegistryRows:214,fixturePrerequisiteDdlSources:6,
  preinstall:{functions:26,guards:3,registry:214,targetSha256:(mode==='normal'?'1':'2').repeat(64)},installedContract:{functions:93,tables:24,guards:28,productionAuthorized:false,deploymentReady:false},
  ...Object.fromEntries(['nativePostgresInstallationValidated','realDatabaseConnectionIdentityValidated','wholeInstallerInterrupted','persistentFullRegistryEvidenceValidated','syntheticGatewayAndAcceptanceReferences'].map(k=>[k,true])),
  ...Object.fromEntries(['fullHistoricalDdlReplay','fullProductionGatewayValidated','persistentProductionStorageValidated','hostBackupRestoreValidated','powerLossValidated','productionReadPerformed','productionAuthorized','deploymentReady','stripeEnabled'].map(k=>[k,false])),
  workers:workers(mode),openedConnections:22,closedConnections:22,remainingConnections:0,remainingChildren:0,cleanupFailures:0};
}
export function ownedReviewedAcceptanceInputs(change=()=>{}){
 const ids={baseline:'11001',revision:'11002',files:'11003',native:'11004'},commit='a'.repeat(40),runs=Object.fromEntries(Object.entries(ids).map(([group,id])=>[group,{databaseId:Number(id),headSha:commit,headBranch:'acceptance/member-checkout-real-auth-20261125',event:'push',status:'completed',conclusion:'success',jobs:[]} ]));
 const logs=['normal','commit-unknown'].map(mode=>({mode,wire:'# tests 60\n# pass 60\n# tests 15\n# pass 15\n'})),reports=[];let job=1;
 for(const [group,prefix,count,scope,name]of reviewedCheckoutAcceptanceSpec()){
  const artifact=prefix+'-'+ids[group]+'-1',value={version:1,commit,scope,checks:Array.from({length:count},(_,i)=>({name:'synthetic-'+i,passed:true})),passed:true,cleanupPassed:true,failure:null};
  if(prefix==='member-checkout-group-next')Object.assign(value,combined());
  if(group==='native')Object.assign(value,native(prefix.endsWith('commit-unknown')?'commit-unknown':'normal'));
  if(group==='files')Object.assign(value,{registryEngine:'PGlite',receiptInsertions:2,registryCount:216,nativePostgresInstallationValidated:false,wholeInstallerInterrupted:false});
  reports.push({artifact,value:structuredClone(value)});runs[group].jobs.push({databaseId:job++,name,status:'completed',conclusion:'success'});
 }
 const review={version:1,scope:'offline-reviewed-owned-native-full-registry-installation-not-production',commit,runs:ids,jobs:18,fullCiPassed:true,totalScenarioChecks:524,retainedScenarioChecks:496,nativeFullRegistryScenarioChecks:28,
  ...Object.fromEntries(['nativeFullRegistryInstalledPrivilegesValidated','wholeInstallerDeathAndDurableRecoveryValidated','pointsCouponBookingOnRecoveredInstallationValidated','syntheticGatewayAndAcceptanceReferences'].map(k=>[k,true])),
  ...Object.fromEntries(['fullHistoricalDdlReplay','fullProductionGatewayValidated','persistentProductionStorageValidated','hostBackupRestoreValidated','powerLossValidated','productionReadPerformed','productionAuthorized','deploymentReady','stripeEnabled'].map(k=>[k,false]))};
 const value={review,runs,reports,logs};change(value);
 review.reports=reviewedCheckoutAcceptanceSpec().map(([group,prefix,count])=>{
  const artifact=prefix+'-'+review.runs[group]+'-1',entry=reports.find(r=>r.artifact===artifact);
  return {group,artifact,sha256:sha(JSON.stringify(entry?.value)),checks:count,passed:true,cleanupPassed:true,...(group==='native'?{mode:prefix.endsWith('commit-unknown')?'commit-unknown':'normal',logSha256:sha(logs.find(l=>l.mode===(prefix.endsWith('commit-unknown')?'commit-unknown':'normal')).wire)}:{})};
 });
 return {kind:'owned-synthetic-evidence',reviewWire:JSON.stringify(review),runsWire:JSON.stringify(runs),reports:reports.map(({artifact,value})=>({artifact,wire:JSON.stringify(value)})),logs};
}
