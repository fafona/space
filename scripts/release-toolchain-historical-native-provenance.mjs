// Immutable origin-qualification history ONLY. Never fresh admission, a lease,
// a backup refresh, or permission to publish. The original fresh reader stays
// unchanged. Original schema is checked at its byte-pinned qualification event.
import fs from'node:fs';
import{ORIGIN_RECOVERY as H}from'./release-toolchain-origin-recovery-contract.mjs';
import{ownedReleasePath,inspectPinnedExecutionSource}from'./release-toolchain-source.mjs';
import{bookingHostRead,bookingHostRun}from'./booking-handoff-host-io.mjs';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'evidence_invalid'),read=p=>JSON.parse(bookingHostRead(p));
const FAILED='/var/lib/faolla-booking-active-qualifications/b49808d6-1950-4cb4-b029-97086873d7a7/2e54512499b45d4d85f68c1d4081d8a55464520b/attempt_1793443023711_63af233b-5573-4351-8cca-de650f34cd67';
export function assertHistoricalNativeEvent(report,qualification,assertOriginal){
 need(typeof assertOriginal==='function'&&qualification?.kind==='active-incident-formal-qualification-completed'&&qualification.toolRevision===H.priorTool&&qualification.inventorySha256===H.inventorySha256&&qualification.productionMutated===false&&qualification.mailEnabled===false&&qualification.publicationAuthority===false,'evidence_invalid');
 const event=Date.parse(qualification.completedAt);need(Number.isFinite(event)&&new Date(event).toISOString()===qualification.completedAt&&event<=Date.now(),'evidence_invalid');
 assertOriginal(report,{toolRevision:H.priorTool,inventorySha256:H.inventorySha256,nowMs:event});
 return Object.freeze({kind:'historical-native-event-schema-verified',originalEvent:qualification.completedAt,freshAdmission:false,publicationAuthority:false});
}
export async function verifyPinnedHistoricalOriginNativeQualification(){
 need(arguments.length===0&&process.platform==='linux'&&process.getuid?.()===0,'unsupported_runtime');
 // The refused 2e545 attempt is terminal and remains exactly one failure
 // receipt. A later reviewed source may qualify afresh; it never retries it.
 ownedReleasePath(FAILED,{directory:true,privateMode:true});same(fs.readdirSync(FAILED),['failed.json']);
 same(sha256(bookingHostRead(FAILED+'/failed.json')),'ee3d0268b0b00ec0f70bea7ab5e1761d21174970678d8655583affc1afb57411');
 const old='/var/lib/faolla-online-code/'+H.priorTool,base='file://'+old+'/scripts/';same(inspectPinnedExecutionSource({revision:H.priorTool,directory:old}).inventorySha256,H.inventorySha256);
 const qText=bookingHostRead(H.qualification+'/verified.json');same(sha256(qText),H.qualificationSha256);need(!fs.existsSync(H.qualification+'/failed.json'),'attempt_unknown');const q=JSON.parse(qText);
 const admission=await import(base+'release-toolchain-booking-admission.mjs'),{FULL_REHEARSAL_SOURCES}=await import(base+'release-toolchain-native-inventory.mjs'),{validateIsolationContainer}=await import(base+'release-toolchain-isolation.mjs'),{assertOwnedRehearsalChildCloseProof}=await import(base+'release-toolchain-owned-child-close.mjs');
 const root=q.nativeRoot;need(/^\/var\/lib\/faolla-booking-full-rehearsal-[A-Za-z0-9]+$/.test(root),'invalid_path');ownedReleasePath(root,{directory:true,privateMode:true});
 const text=bookingHostRead(root+'/acceptance.json');same(sha256(text),q.nativeSha256);const report=JSON.parse(text);assertHistoricalNativeEvent(report,q,admission.assertQualificationReport);
 const owner=read(root+'/owner.json');need(owner.kind==='booking-full-native-isolated-owner'&&owner.root===root&&owner.toolRevision===H.priorTool&&owner.sourceSha256===report.sourceHashes['release-toolchain-full-rehearsal.mjs'],'evidence_invalid');
 for(const file of FULL_REHEARSAL_SOURCES)need(sha256(bookingHostRead(old+'/scripts/'+file,{privateMode:false}))===report.sourceHashes[file],'source_changed');
 for(const c of report.cases){need(c.receiptFile===root+'/cases/'+c.name+'.json'&&sha256(bookingHostRead(c.receiptFile))===c.receiptSha256,'evidence_invalid');const actual=read(c.receiptFile);
  for(const key of['name','completed','elapsedMs','inheritedKernelLock','realNginx','realPostgres','realProcesses','ownedFixturesOnly'])same(actual[key],c[key]);
  need(actual.allFixturesStopped===true&&actual.gateClosed===true&&actual.rowsPreserved===true&&actual.actualDatabase?.systemIdentifier===report.postgresSystemIdentifier,'evidence_invalid');
  const runtime=root+'/runtime-'+c.name,backup=read(runtime+'/backup-restore.json');need(backup.restoredRowsEqual===true&&backup.corruptArchiveRefused===true&&backup.productionDatabaseTouched===false&&sha256(bookingHostRead(runtime+'/backup.dump',{binary:true}))===backup.archiveSha256&&sha256(bookingHostRead(runtime+'/backup-corrupt.dump',{binary:true}))!==backup.archiveSha256,'evidence_invalid');
  if(report.observationProfile==='fixed-active-incident-connect-only'){need(!fs.existsSync(runtime+'/child-close-unconfirmed.json')&&sha256(bookingHostRead(runtime+'/direct-child-close.json'))===actual.directChildCloseSha256,'evidence_invalid');assertOwnedRehearsalChildCloseProof(read(runtime+'/direct-child-close.json'));}
 }
 need(/^\/var\/lib\/faolla-release-toolchain-isolation-[A-Za-z0-9]+$/.test(report.isolationRoot??''),'invalid_path');const dbOwner=read(report.isolationRoot+'/owner.json'),stopped=read(report.isolationRoot+'/stopped.json');need(stopped.stopped===true&&stopped.filesPreserved===true&&stopped.containerId===dbOwner.containerId,'cleanup_unconfirmed');validateIsolationContainer(JSON.parse(bookingHostRun('docker',['inspect',dbOwner.containerId]))[0],dbOwner,{running:false});
 return{root,report,sha256:sha256(text),qualificationSha256:H.qualificationSha256,historicalOnly:true,freshAdmission:false,publicationAuthority:false};
}
