// This one source-only recovery cannot publish or re-label the rolled-back web.
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
export const REGISTRY_RECOVERY=Object.freeze({
 kind:'booking-registry-capacity-recovery-v1',maximumFrameBytes:4194304,
 target:'4963116f54bcab64ae397e06ecf323838fe2e3be',
 baseline:'dadbced2d579b991a62f83edde6cc87bc964a280',
 historyHead:'16f2864ac509dcd56652e4ea0e0c294621cac13e00d03016eb2cd1c4f27c41fb',
 verifierCertificate:'07aae44f3edd4fbd072c4142756fdaa927993dacffa4292f5dddb7c5683cd5fb',
 priorToolRevision:'37fe3c3b8220c73090ba953c7d046a63a5ab1bfc',
 priorWorkerPid:685108,priorWorkerPmId:24,priorWorkerRestarts:1,
 bootId:'c0b79e2b-f9df-4af7-ad93-787f90a5ba27',
 gateSha256:'803239b45780b35ad7c265da57f39f053764cf79d8c7d4c9e8799f1ebc9ecab6',
 failedStateSha256:'6b7c3b8513fbeb649850482260d43f505ba38fffc52ba09659176dfa0ebc14d9',
 activeSha256:'61d274086498ff094f5ff2784c6ca4ffb82273f1591e43a6de566a4138e8e399',
});
const need=v=>{if(!v)throw Error('booking_registry_recovery_binding');};
export const registryRecoveryHash=value=>createHash('sha256').update(value).digest('hex');
export const registryAdapterContext=()=>({kind:REGISTRY_RECOVERY.kind,maximumFrameBytes:4194304,
 historyHeadSha256:REGISTRY_RECOVERY.historyHead,priorVerifierCertificateSha256:REGISTRY_RECOVERY.verifierCertificate});
export function assertRegistryAdapterContext(r){
 const p=REGISTRY_RECOVERY;need(r?.version===2&&isDeepStrictEqual(r.registryAdapter,registryAdapterContext())&&
 r.priorToolRevision===p.priorToolRevision&&r.priorWorker?.pid===p.priorWorkerPid&&
 r.priorWorker.pmId===p.priorWorkerPmId&&r.priorWorker.restartCount===p.priorWorkerRestarts&&r.gateSha256===p.gateSha256);return true;
}
export function assertRegistryRecoveryHistory(history,r){
 assertRegistryAdapterContext(r);const p=REGISTRY_RECOVERY,last=history?.entries?.at(-1);
 need(history?.headSha256===p.historyHead&&history.entries.length===65&&last?.active.target===p.target&&last?.rollback.target===p.baseline);
 const verifier=history.entries.filter(c=>['host-reboot','booking-worker'].includes(c.kind)).at(-1);
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 need(verifier?.kind==='host-reboot'&&verifier.toolRevision===p.priorToolRevision&&
 registryRecoveryHash(JSON.stringify(canonical(verifier)))===p.verifierCertificate&&
 isDeepStrictEqual(verifier.processes.find(v=>v.name===r.priorWorker.name),r.priorWorker));return true;
}
export const REGISTRY_RECOVERY_FILES=Object.freeze([
 'scripts/release-toolchain-registry-capacity.py',
 'scripts/release-toolchain-registry-capacity.test.py',
 'scripts/release-toolchain-registry-capacity-adapter.mjs',
 'scripts/release-toolchain-registry-capacity-dump.py',
 'scripts/release-toolchain-registry-recovery-policy.mjs',
 'scripts/release-toolchain-registry-recovery-pm2.py',
 'scripts/release-toolchain-registry-recovery.mjs',
 'scripts/release-toolchain-registry-recovery.test.mjs',
 'scripts/release-toolchain-registry-capacity-native.test.py',
 'scripts/release-toolchain-pm2-observation.mjs',
 'scripts/release-toolchain-worker-release-contract.mjs',
 'scripts/release-toolchain-worker-release-ci.mjs',
 'scripts/release-toolchain-pm2-real-acceptance.mjs',
 'docs/booking-registry-capacity-recovery-20261117.md',
]);
export function assertRegistryRecoverySourceDelta(before,after){
 const a=new Map(before.map(v=>[v.file,v])),b=new Map(after.map(v=>[v.file,v]));
 const changed=[...new Set([...a.keys(),...b.keys()])].filter(f=>!isDeepStrictEqual(a.get(f),b.get(f)));
 need(changed.length>0&&changed.every(f=>REGISTRY_RECOVERY_FILES.includes(f)&&b.get(f)?.mode==='100644'&&(!a.has(f)||a.get(f).mode==='100644')));
 for(const f of REGISTRY_RECOVERY_FILES.filter(f=>!f.endsWith('.md')&&!f.endsWith('.test.mjs')&&!f.endsWith('.test.py')))
  need(b.has(f));
 return{kind:REGISTRY_RECOVERY.kind,changedFiles:changed.sort(),applicationChanged:false,dependenciesChanged:false,migrationsChanged:false};
}
