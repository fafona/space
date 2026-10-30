// One legacy interruption whose independent recovery completed, but whose old
// supervisor could not seal its journal. No old lease/certificate is renewed.
import {isDeepStrictEqual} from 'node:util';
import {INTERRUPTED_RECOVERY as H} from './release-toolchain-interrupted-recovery-contract.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
export const RECOVERED_PUBLICATION=Object.freeze({
 recoveryTool:'fdd943d2c055cf8f793cbbb76c73f3e792f7d001',
 recoveryInventorySha256:'8d5c6cf37bba0f2aea4e6ebaa3ad3949d65d9acfc53226f2e218857523826c9f',
 recoverySha256:'fc4a94225229328327912dc57cc53aea2222931fec8282b6587763847d0b4983',
 recoveredStateSha256:'b1d10e9a44ef8296d46fa195359fe9bab2b1563595bae1e2fee5d0da75583e68',
 originalStateSha256:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3',
 activeSha256:'30320959bcbd693f46e61c68a4345ed1d996094616320e867432c52f8f594cb8',
 root:'/var/lib/faolla-booking-recovered-publications/'+H.operationId,
});
export const recoveredPublicationBinding=()=>({kind:'independently-recovered-publication-disposition',
 operationId:H.operationId,operationInode:H.operationInode,publicationManifestSha256:H.manifestSha256,
 pendingInode:H.pendingInode,pendingFiles:H.pendingFiles,headSha256:H.headSha256,...RECOVERED_PUBLICATION,
 businessDataWritten:false,activationReplayed:false,legacyRestarted:false,mailEnabled:false,publicationAuthority:false});
export const recoveredPublicationBindingSha256=()=>sha256(canonicalJson(recoveredPublicationBinding()));
export function assertRecoveredPublicationMetadataDelta(recoveredText,originalText){
 need(sha256(recoveredText)===RECOVERED_PUBLICATION.recoveredStateSha256&&sha256(originalText)===RECOVERED_PUBLICATION.originalStateSha256,'evidence_invalid');
 const recovered=JSON.parse(recoveredText),original=JSON.parse(originalText);
 // Completed publication metadata differs from its original staged state.
 // Its full exact original bytes, not this structural delta, are the CAS target.
 need(original.target===recovered.target&&original.name===recovered.name&&original.port===recovered.port&&original.directory===recovered.directory&&original.status==='database-ready'&&recovered.status==='booking-active-generation-cutover-failed'&&recovered.bookingRecoveryOperationId===H.operationId,'evidence_invalid');
 return{beforeSha256:sha256(recoveredText),afterSha256:sha256(originalText),businessDataWritten:false,publicationAuthority:false};
}
export const RECOVERED_PUBLICATION_CLOSE_STEPS=Object.freeze(['inspect','preserve','resetMetadata','preservePartialJournal','preservePublication','sealClosure','archiveOperation','complete']);
export const RECOVERED_DISPOSITION_SEALED_FILES=Object.freeze(['intent.json','before-observation.json','recovered-state-before.json','original-staged-state.json','retention-head-before.json','preservation-plan.json','metadata-reset-intent.json','metadata-reset-completed.json','partial-retention-preserved.json','publication-preserved.json','after-observation.json']);
export const RECOVERED_DISPOSITION_CLOSED_NAMES=Object.freeze([...RECOVERED_DISPOSITION_SEALED_FILES,'closure-sealed.json','operation-archive-attempt.json','operation-archived.json','reconciliation-completed.json','replacement-release-attempt.json','replacement-released.json','closed.json','operation.lock','partial-retention','publication']);
export async function executeRecoveredPublicationDisposition(operations){
 let stage='startup';try{for(const name of RECOVERED_PUBLICATION_CLOSE_STEPS){stage=name;await operations.assertHeld();await operations[name]();await operations.assertHeld();}}
 catch(error){try{await operations.failure(error,stage);}catch{}throw error;}
}
export function assertRecoveredPublicationStable(before,after){
 const strip=value=>{const copy=structuredClone(value);for(const key of ['at','stateSha256','publicProof'])delete copy[key];delete copy.database;return copy;};
 need(isDeepStrictEqual(strip(before),strip(after)),'observation_mismatch');return true;
}
export const RECOVERED_DISPOSITION_NATIVE_CASES=Object.freeze(['normal','wrong-state','unknown-after-partial','unknown-after-publication','unknown-after-archive','operation-drift','wrong-completion']);
export function assertRecoveredDispositionKernelProof(value){
 need(value?.kind==='recovered-publication-disposition-kernel-accepted'&&isDeepStrictEqual(value.cases?.map(row=>row.outcome),RECOVERED_DISPOSITION_NATIVE_CASES),'evidence_invalid');
 for(const key of['actualFlock','actualCas','actualInodePreservingRenames','productionTokensRejected'])need(value[key]===true,'evidence_invalid');
 need(value.formalHostTouched===false&&value.publicationAuthority===false,'evidence_invalid');for(const row of value.cases)need(row.completed===(row.outcome==='normal')&&row.allOriginalInodesRetained===true&&row.allOriginalBytesRetained===true&&row.oldCertificateFabricated===false&&row.productionAuthority===false,'evidence_invalid');return true;
}
