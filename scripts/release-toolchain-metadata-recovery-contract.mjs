// The engine is reusable; this immutable profile binds the ONE reviewed
// recovered-after-metadata-refusal attempt. It cannot adopt a partial switch/commit.
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
import{isDeepStrictEqual}from'node:util';
export const METADATA_RECOVERY=Object.freeze({
 priorTool:'002e8ce186cbed6ccb95ce79433cb03557f22262',priorInventory:'4d67c106a1a88204055656c89fca7710b9df80a8033f0168ab32e1a6af2774bf',
 operationId:'24db70cd-c4ed-4aeb-b55a-a05bdc6b6eb6',operationInode:2624971,
 publication:'/var/lib/faolla-booking-active-publications/f274ad615550c83717aa7af2ad32339608e6f8aa/24db70cd-c4ed-4aeb-b55a-a05bdc6b6eb6',
 root:'/var/lib/faolla-booking-metadata-recovery/24db70cd-c4ed-4aeb-b55a-a05bdc6b6eb6',
 manifestSha256:'3da3240df8745868eeba03d68001ee64f21bb55d3d67496d793850ed3ea2168f',
 recoverySha256:'807496ff8f8592e436276ee857ad826c84220c5cb27a532923e54f4ae5462084',
 finishedSha256:'39ee72e299fa288ceb0f76bb87bf439ad01401e1146d3260fbfd7579eba6ae10',
 failedStateSha256:'a3880feaa03921ff150a64d3a0ac43812a0998dc67553678d0122fb967319912',
 stagedStateSha256:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3',
 activeSha256:'30320959bcbd693f46e61c68a4345ed1d996094616320e867432c52f8f594cb8',
 priorClosureSha256:'e7044b06fd5f6e844d60417d5232f0d20b0757f966beb60bf2f58ed315e22f2f',
 workerPid:2657119,workerRestarts:10,
 historicalFirewallSha256:'30c402dcbbb400398e94fd278fac2f9a36c5942970ad0e8f2b2f6adc95fa6edd',
 firewallPolicySha256:'10e39f3236f8e2ed446b5fd8bdc96a181a6a73e36999127e2126bf3c8b2f26b0',
});
export const metadataRecoveryBindingSha256=()=>sha256(canonicalJson(METADATA_RECOVERY));
export function assertMetadataRecoveryStable(before,after){const strip=value=>{const{at,database,publicProof,...rest}=value;void at;void database;void publicProof;return rest;};need(isDeepStrictEqual(strip(before),strip(after)),'observation_mismatch');return true;}
export const METADATA_RECOVERY_STEPS=Object.freeze(['inspect','preserve','resetMetadata','preservePublication','sealClosure','archiveOperation','complete']);
export const METADATA_RECOVERY_NATIVE_CASES=Object.freeze(['normal','wrong-state','unknown-after-metadata','unknown-after-publication','unknown-after-archive','operation-drift','wrong-completion']);
export function assertMetadataRecoveryKernelProof(value){need(value?.kind==='metadata-recovery-kernel-accepted'&&isDeepStrictEqual(value.cases?.map(row=>row.outcome),METADATA_RECOVERY_NATIVE_CASES),'evidence_invalid');for(const key of['actualFlock','actualCas','actualInodePreservingRenames','productionTokensRejected'])need(value[key]===true,'evidence_invalid');need(value.formalHostTouched===false&&value.publicationAuthority===false,'evidence_invalid');for(const row of value.cases)need(row.completed===(row.outcome==='normal')&&row.allOriginalInodesRetained===true&&row.allOriginalBytesRetained===true&&row.oldCertificateFabricated===false&&row.productionAuthority===false,'evidence_invalid');return true;}
export async function executeMetadataRecoveryDisposition(operations){let stage='startup';try{for(const name of METADATA_RECOVERY_STEPS){stage=name;await operations.assertHeld();await operations[name]();await operations.assertHeld();}}catch(error){try{await operations.failure(error,stage);}catch{}throw error;}}
export function assertMetadataRecoveryMetadataDelta(from,to){const p=METADATA_RECOVERY;need(sha256(from)===p.failedStateSha256&&sha256(to)===p.stagedStateSha256,'evidence_invalid');const a=JSON.parse(from),b=JSON.parse(to);need(a.status==='booking-active-generation-cutover-failed'&&a.bookingRecoveryOperationId===p.operationId&&b.status==='database-ready','evidence_invalid');return{beforeSha256:p.failedStateSha256,afterSha256:p.stagedStateSha256,businessDataWritten:false,publicationAuthority:false};}
