import fs from'node:fs';
import{ORIGIN_RECOVERY as H,originRecoveryHistoricalBinding}from'./release-toolchain-origin-recovery-contract.mjs';
import{readRecoveredOriginFixedEvidence}from'./release-toolchain-origin-recovery-evidence.mjs';
import{verifyPinnedHistoricalOriginNativeQualification}from'./release-toolchain-historical-native-provenance.mjs';
import{inspectPinnedExecutionSource,ownedReleasePath}from'./release-toolchain-source.mjs';
import{bookingHostRead}from'./booking-handoff-host-io.mjs';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'evidence_invalid'),read=p=>JSON.parse(bookingHostRead(p)),hash=p=>sha256(bookingHostRead(p,{binary:true}));
export async function verifyRecoveredOriginHistoricalProvenance(){
 const old='/var/lib/faolla-online-code/'+H.priorTool;same(inspectPinnedExecutionSource({revision:H.priorTool,directory:old}).inventorySha256,H.inventorySha256);const evidence=readRecoveredOriginFixedEvidence();
 // Earlier closures/backups are retained HISTORY, not newly issued backup or
 // current PM2 authority. Verify their immutable seals/inodes using the exact
 // original byte-pinned source readers, without extending old expiry guards.
 const base='file://'+old+'/scripts/',preRoute=await import(base+'release-toolchain-pre-route-evidence.mjs'),postSave=await import(base+'release-toolchain-post-save-evidence.mjs'),preControl=await import(base+'release-toolchain-pre-control-evidence.mjs'),preConnect=await import(base+'release-toolchain-preconnect-evidence.mjs'),preIntent=await import(base+'release-toolchain-pre-intent-evidence.mjs');
 preRoute.verifyPinnedPreRouteHistory();postSave.readPinnedPostSaveRecords();
 const anchors=[
  ['/var/lib/faolla-booking-active-closures/b49808d6-1950-4cb4-b029-97086873d7a7/28c52817-ff38-49bd-94b7-ccd570c4d71b','223c7799299cd1086e704eeae5871274fa05cb32c9ec7ce94e1b0e36a08c823a',3566178],
  ['/var/lib/faolla-booking-pre-control-closures/310ae922-d6f3-4055-a980-61ad29ee7be5/9985904a-b502-46c5-97af-9ccfba7756a1','832fc5464d284430db9ffd5e37278f2e4cf203b3ee693af91e65a79d307da9d6',2622073],
  ['/var/lib/faolla-booking-preconnect-closures/1ee7ada1-864d-4fac-a1ee-21a1adc6330a/e05de613-aa8c-4579-95ac-3a9542c9cd4d','04d60ef9627122594d58dabacb7ae636218c467cc5269a547d77574b0a9886a3',2624424],
  ['/var/lib/faolla-booking-pre-intent-closures/a9ef45af-ddaa-4154-95bd-dd4fe1915383/dfce83eb-8e76-4894-984a-7f69d91d89b0','7524874cf47794df80eab801899fc36e66ac322a6d2340f69f42e62b3433d6ca',2624956]
 ];
 for(const [directory,pin,inode] of anchors){ownedReleasePath(directory,{directory:true,privateMode:true});same(hash(directory+'/closed.json'),pin);const closed=read(directory+'/closed.json'),sealed=read(directory+'/closure-sealed.json');same(hash(directory+'/closure-sealed.json'),closed.closureSha256);for(const [name,key] of [['operation-archived.json','archiveSha256'],['reconciliation-completed.json','completionSha256'],['replacement-released.json','replacementReleasedSha256']])same(hash(directory+'/'+name),closed[key]);for(const [name,value] of Object.entries(sealed.files??{})){need(/^[a-z0-9][a-z0-9.-]{0,100}$/.test(name)&&/^[a-f0-9]{64}$/.test(value),'invalid_path');same(hash(directory+'/'+name),value);}const op=ownedReleasePath(directory+'/operation.lock',{directory:true,privateMode:true});need(op.dev===64769&&op.ino===inode&&op.uid===0&&op.mode===0o40700,'owned_resource_changed');same(fs.readdirSync(directory+'/operation.lock'),[]);}
 preControl.readPinnedPreControlFailure(anchors[1][0]+'/publication');preConnect.readPinnedPreConnectFailure(anchors[2][0]+'/publication');preIntent.readPinnedPreIntentFailure(anchors[3][0]+'/publication');
 same(hash(H.qualification+'/verified.json'),H.qualificationSha256);need(!fs.existsSync(H.qualification+'/failed.json'),'attempt_unknown');const q=read(H.qualification+'/verified.json'),started=read(H.qualification+'/started.json'),after=read(H.qualification+'/after-observation.json');
 need(q.kind==='active-incident-formal-qualification-completed'&&q.toolRevision===H.priorTool&&q.inventorySha256===H.inventorySha256&&q.productionMutated===false&&q.mailEnabled===false&&q.publicationAuthority===false,'evidence_invalid');same(q.beforeObservationSha256,sha256(canonicalJson(started.before)));same(q.afterObservationSha256,sha256(canonicalJson(after)));same(q.sourceBindingSha256,hash(H.qualification+'/source-binding.json'));
 // Native reports are interpreted by their exact original byte-checked
 // source. Historical evidence is not reissued as current qualification.
 const interrupt=await import('file://'+old+'/scripts/release-toolchain-full-interrupt.mjs'),routing=await import('file://'+old+'/scripts/release-toolchain-active-generation-routing-native.mjs');
 same((await verifyPinnedHistoricalOriginNativeQualification()).sha256,q.nativeSha256);same(interrupt.verifyFullInterruptionReport(q.interruptionRoot,{toolRevision:H.priorTool}).sha256,q.interruptionSha256);same(routing.verifyOwnedActiveRoutingAcceptance(q.activeRoutingNativeRoot,{toolRevision:H.priorTool,inventorySha256:H.inventorySha256}).sha256,q.activeRoutingNativeSha256);
 const originalText=bookingHostRead(evidence.directory+'/primary-state-before-recovery.json');same(sha256(originalText),H.originalStateSha256);
 return{...evidence,qualification:q,historicalObservation:started.before,originalText,binding:originRecoveryHistoricalBinding()};
}
