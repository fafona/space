// Exact completed 6e closure and known pre-window/read-only refusal. Never a
// generic exception for an active, pending, partially controlled or old source.
import {isDeepStrictEqual} from 'node:util';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
export const PROC_WITNESS_PRIOR=Object.freeze({
 toolRevision:'6e39312b5698e1e7182e5dad8602d4ab6b91e4a1',
 inventorySha256:'a6106111413e1c1c80177e6bec3908493976de6b8fa29c58776a57bfc2965083',
 closedDirectory:'/var/lib/faolla-booking-pre-intent-closures/a9ef45af-ddaa-4154-95bd-dd4fe1915383/dfce83eb-8e76-4894-984a-7f69d91d89b0',
 closedSha256:'7524874cf47794df80eab801899fc36e66ac322a6d2340f69f42e62b3433d6ca',
 qualificationSha256:'41ec6ae894807f175045d11029b1a9f0e5628e1c8a19e708e4fafa884b86584f',
 refusedBackup:'/var/lib/faolla-booking-handoff/f274ad615550c83717aa7af2ad32339608e6f8aa/toolchain-admission/1793327426984-70496edc-baec-4fea-8cee-a103750bb214',
 refusalSha256:'698d9bb1e2bf5fcc4a7ca660616f8e930b67659b67c7886e4766ada0c24f2968',
 errorSha256:'22697938e78956ffcc5973e8aa5225235b4229a189cc6ff077385db30880643d'
});
export const procWitnessHistoricalBinding=()=>({priorToolRevision:PROC_WITNESS_PRIOR.toolRevision,priorInventorySha256:PROC_WITNESS_PRIOR.inventorySha256,priorPreIntentClosedDirectory:PROC_WITNESS_PRIOR.closedDirectory,priorPreIntentClosureSha256:PROC_WITNESS_PRIOR.closedSha256,priorPreIntentQualificationSha256:PROC_WITNESS_PRIOR.qualificationSha256,priorRefusedBackup:PROC_WITNESS_PRIOR.refusedBackup,priorRefusalSha256:PROC_WITNESS_PRIOR.refusalSha256,originalFreshProcessIdentityGuardUnchanged:true,publicationAuthority:false});
export function assertProcWitnessHistoricalBinding(binding,currentRevision){need(/^[a-f0-9]{40}$/.test(currentRevision??'')&&currentRevision!==PROC_WITNESS_PRIOR.toolRevision&&isDeepStrictEqual(binding,procWitnessHistoricalBinding()),'evidence_invalid');return true;}
export function assertPinnedProcWitnessRefusal(value){
 need(value?.kind==='active-booking-controller-exit-unconfirmed'&&value.stage==='freshRollbackReadiness'&&value.window===null&&value.mutationPossible===false&&value.independentSupervisorMayBeActive===false&&value.automaticRetryAllowed===false&&value.mailEnabled===false&&value.publicationAuthority===false&&value.diagnostic?.toolRevision===PROC_WITNESS_PRIOR.toolRevision&&value.diagnostic.code==='operation_unconfirmed'&&value.diagnostic.exceptionMessageSha256===PROC_WITNESS_PRIOR.errorSha256,'attempt_unknown');return true;
}
export function assertOwnedProcDirectoryWitnessProof(value,{toolRevision}){
 need(/^[a-f0-9]{40}$/.test(toolRevision??'')&&isDeepStrictEqual(value,{kind:'owned-pm2-proc-directory-witness-verified',toolRevision,actualDirectoryDescriptorHeld:true,actualIdentityStable:true,descriptorReleased:true,originalFreshChecksUnchanged:true,registryRead:true,dumpCapture:true,dumpVerify:true,additionalSavePerformed:false,processControlPerformed:false,formalHostTouched:false,publicationAuthority:false}),'evidence_invalid');return true;
}
