// Exact approved failure AFTER gated-worker preparation but BEFORE supervisor
// lease/spawn or ingress. No caller-selectable predecessor, recovery or bypass.
import{isDeepStrictEqual}from'node:util';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
export const PRE_SUPERVISOR=Object.freeze({
 priorTool:'4208f44fb16e6eecf6ec99c69b4f66fa79375191',priorInventory:'8aeade0bc1734e66212569c393db83badb57b74f000372741e909cc1c3821b8d',
 operationId:'b1bd706f-ea38-4d48-a8cd-8c239bbb99c5',operationInode:2624966,
 publication:'/var/lib/faolla-booking-active-publications/f274ad615550c83717aa7af2ad32339608e6f8aa/b1bd706f-ea38-4d48-a8cd-8c239bbb99c5',
 root:'/var/lib/faolla-booking-pre-supervisor/b1bd706f-ea38-4d48-a8cd-8c239bbb99c5',
 manifestSha256:'86a1aa4b1d116dc1ce9d41b4b88243a3bbd5fe9e4be4a7462f9087ec40291dd7',
 exceptionMessageSha256:'d4e5fed033778d6131c0b79cbf062472dace33fc48f692ce0873eff0dd8d1418',
 priorClosureSha256:'aad9a82e614ee2125b2d1028e19b468f7530226a2f1189e643487fd2fbb00f5b',
 stagedStateSha256:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3',
 activeSha256:'30320959bcbd693f46e61c68a4345ed1d996094616320e867432c52f8f594cb8',
 workerPid:2437948,workerRestarts:9,
});
export const preSupervisorBindingSha256=()=>sha256(canonicalJson(PRE_SUPERVISOR));
export const PRE_SUPERVISOR_STEPS=Object.freeze(['inspect','preserve','verifyUnchanged','preservePublication','sealClosure','archiveOperation','complete']);
export const PRE_SUPERVISOR_NATIVE_CASES=Object.freeze(['normal','wrong-state','unknown-after-publication','unknown-after-seal','unknown-after-archive','operation-drift','wrong-completion']);
export async function executePreSupervisorDisposition(operations){let stage='startup';try{for(const name of PRE_SUPERVISOR_STEPS){stage=name;await operations.assertHeld();await operations[name]();await operations.assertHeld();}}catch(error){try{await operations.failure(error,stage);}catch{}throw error;}}
export function assertPreSupervisorStable(before,after){const strip=value=>{const{at,database,publicProof,...rest}=value;void at;void database;void publicProof;return rest;};need(isDeepStrictEqual(strip(before),strip(after)),'observation_mismatch');return true;}
export function assertPreSupervisorKernelProof(value){need(value?.kind==='pre-supervisor-kernel-accepted'&&isDeepStrictEqual(value.cases?.map(row=>row.outcome),PRE_SUPERVISOR_NATIVE_CASES),'evidence_invalid');for(const key of['actualFlock','actualInodePreservingRenames','productionTokensRejected','metadataNeverWritten','allAdvertisedSupervisorProfilesRecognized'])need(value[key]===true,'evidence_invalid');need(value.formalHostTouched===false&&value.publicationAuthority===false,'evidence_invalid');for(const row of value.cases)need(row.completed===(row.outcome==='normal')&&row.allOriginalInodesRetained===true&&row.allOriginalBytesRetained===true&&row.oldCertificateFabricated===false&&row.productionAuthority===false,'evidence_invalid');return true;}
