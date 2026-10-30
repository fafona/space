// The engine is reusable; this immutable profile binds the ONE reviewed
// recovered-before-ingress attempt. It cannot adopt a partial switch/commit.
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
import{isDeepStrictEqual}from'node:util';
export const SETTLED_PRE_INGRESS=Object.freeze({
 priorTool:'91ef2f197ac5376b802d505691ad69321361b3b9',priorInventory:'b22584fc07f71572949b6e168b7b3c0bf2d52ba8f3a1e465729aaebeb696cd86',
 operationId:'6866d6a1-a8b7-4377-8ad4-af6e609a506b',operationInode:2624964,
 publication:'/var/lib/faolla-booking-active-publications/f274ad615550c83717aa7af2ad32339608e6f8aa/6866d6a1-a8b7-4377-8ad4-af6e609a506b',
 root:'/var/lib/faolla-booking-settled-pre-ingress/6866d6a1-a8b7-4377-8ad4-af6e609a506b',
 manifestSha256:'4f3279e878f70ae0585f2d9df51980865491aa6610390509f8c13c80fd76cfeb',
 recoverySha256:'282aba8ce0e1ff3d7ef57666c549d1695e8878e531840190506c37804b5f2475',
 finishedSha256:'b13e8c93ebe31a04c2b19f4dabe5b6e6f9e6dfdf240241dae536240e138a8c86',
 failedStateSha256:'4ab5c6b2f3c45a65ecd4d8f92d048ac6e9e8bfd780a3f3233f31a289eb1be5f0',
 stagedStateSha256:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3',
 activeSha256:'30320959bcbd693f46e61c68a4345ed1d996094616320e867432c52f8f594cb8',
 priorClosureSha256:'8dd978ae94abf6e4dc20c9c324fc3e865cb4129fe4df5d9a1d75f4b517967717',
 workerPid:2091335,workerRestarts:8,
 historicalFirewallSha256:'30c402dcbbb400398e94fd278fac2f9a36c5942970ad0e8f2b2f6adc95fa6edd',
 firewallPolicySha256:'10e39f3236f8e2ed446b5fd8bdc96a181a6a73e36999127e2126bf3c8b2f26b0',
});
export const settledPreIngressBindingSha256=()=>sha256(canonicalJson(SETTLED_PRE_INGRESS));
export function assertSettledPreIngressStable(before,after){const strip=value=>{const{at,database,publicProof,...rest}=value;void at;void database;void publicProof;return rest;};need(isDeepStrictEqual(strip(before),strip(after)),'observation_mismatch');return true;}
export const SETTLED_PRE_INGRESS_STEPS=Object.freeze(['inspect','preserve','resetMetadata','preservePublication','sealClosure','archiveOperation','complete']);
export const SETTLED_PRE_INGRESS_NATIVE_CASES=Object.freeze(['normal','wrong-state','unknown-after-metadata','unknown-after-publication','unknown-after-archive','operation-drift','wrong-completion']);
export function assertSettledPreIngressKernelProof(value){need(value?.kind==='settled-pre-ingress-kernel-accepted'&&isDeepStrictEqual(value.cases?.map(row=>row.outcome),SETTLED_PRE_INGRESS_NATIVE_CASES),'evidence_invalid');for(const key of['actualFlock','actualCas','actualInodePreservingRenames','productionTokensRejected'])need(value[key]===true,'evidence_invalid');need(value.formalHostTouched===false&&value.publicationAuthority===false,'evidence_invalid');for(const row of value.cases)need(row.completed===(row.outcome==='normal')&&row.allOriginalInodesRetained===true&&row.allOriginalBytesRetained===true&&row.oldCertificateFabricated===false&&row.productionAuthority===false,'evidence_invalid');return true;}
export async function executeSettledPreIngressDisposition(operations){let stage='startup';try{for(const name of SETTLED_PRE_INGRESS_STEPS){stage=name;await operations.assertHeld();await operations[name]();await operations.assertHeld();}}catch(error){try{await operations.failure(error,stage);}catch{}throw error;}}
export function assertSettledPreIngressMetadataDelta(from,to){const p=SETTLED_PRE_INGRESS;need(sha256(from)===p.failedStateSha256&&sha256(to)===p.stagedStateSha256,'evidence_invalid');const a=JSON.parse(from),b=JSON.parse(to);need(a.status==='booking-active-generation-cutover-failed'&&a.bookingRecoveryOperationId===p.operationId&&b.status==='database-ready','evidence_invalid');return{beforeSha256:p.failedStateSha256,afterSha256:p.stagedStateSha256,businessDataWritten:false,publicationAuthority:false};}
