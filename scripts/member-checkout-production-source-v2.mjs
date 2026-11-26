// Independent OFFLINE preparation. Old v1 source/result/installers stay intact.
// No SQL bodies, promotion, version reservation, connector or formal authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {checkoutProductionSourceDraftSummary} from './member-checkout-production-source-draft.mjs';
import {reviewedCheckoutAcceptanceSummary} from './member-checkout-reviewed-acceptance.mjs';
import {loadCredentialCandidateSources} from './member-checkout-credential-candidate.mjs';
import {loadCredentialRenewalRevision} from './member-checkout-credential-renewal-revision.mjs';
import {loadGroupNextRevision} from './member-checkout-group-next-revision.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const verified=new WeakSet();
export const sourceV2HistoricalIdentity=freeze({sha256:'b80fe4d38210806f349cf2215ce6118b351b616acba68aabd49d16c76135debc',
 wireSha256:'be7665b02bd00ea5bcf7e59c94f4b3d0ef2f473b63e6bd727799b72489e183f1'});
export async function createCheckoutProductionSourceV2(input){
 try{
  assert.ok(input&&Object.getPrototypeOf(input)===Object.prototype);assert.deepEqual(Object.keys(input).sort(),['acceptance','baseDraft']);const {baseDraft,acceptance}=input;
  const base=checkoutProductionSourceDraftSummary(baseDraft),proof=reviewedCheckoutAcceptanceSummary(acceptance),old=baseDraft.material;
  assert.equal(base.status,'draft-unapproved-not-executable');assert.equal(base.productionAuthorized,false);assert.equal(base.productionSourcePromoted,false);
  // A reference-kind label is NOT provenance. Saved preparation must retain
  // the exact independently held historical draft, never a self-classified
  // synthetic or newly selected target, even with genuine owned-CI proof.
  if(base.referenceKind==='saved-production-evidence'){
   assert.equal(base.sha256,sourceV2HistoricalIdentity.sha256);assert.equal(sha(baseDraft.wire),sourceV2HistoricalIdentity.wireSha256);
  }
  assert.equal(proof.referenceKind,base.referenceKind==='saved-production-evidence'?'saved-reviewed-owned-ci-evidence':'owned-synthetic-evidence');
  assert.equal(old.sources.combinedRevisionSha256,'a476794f63fec4151027e416b410d0bb94b971f08edc1fa0882654eae0f774f2');
  const {revision:candidate}=await loadCredentialCandidateSources(),renewal=await loadCredentialRenewalRevision(),group=await loadGroupNextRevision();
  assert.equal(candidate.sha256,proof.candidateRevisionSha256);assert.equal(renewal.sha256,proof.renewalRevisionSha256);assert.equal(group.sha256,proof.combinedRevisionSha256);
  assert.deepEqual(proof.candidateApplication,candidate.material.application);assert.deepEqual(proof.frozenApplication,candidate.material.baseApplication);
  assert.deepEqual(old.sources.candidateApplication,proof.candidateApplication);assert.deepEqual(old.sources.frozenApplication,proof.frozenApplication);assert.deepEqual(old.sources.overlays,candidate.material.overlay);
  assert.equal(old.sources.steps.length,38);assert.equal(old.baseline.registry.count,214);assert.equal(old.baseline.ciPrerequisiteRegistry.count,6);assert.equal(old.unresolved.length,9);assert.ok(Object.values(old.authority).every(v=>v===false));
  const validators=[];for(const file of ['member-checkout-production-source-v2.mjs','member-checkout-reviewed-acceptance.mjs'])validators.push({file:'scripts/'+file,sha256:sha(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(new URL('./'+file,import.meta.url))).replace(/\r\n/g,'\n'))});
  const material={version:2,kind:'member-checkout-production-source-draft-v2',status:'draft-unapproved-not-executable',scope:'offline-current-source-preparation-not-installer-or-approval',
   historicalDraft:{sha256:base.sha256,wireSha256:sha(baseDraft.wire),version:1,historicalCombinedRevisionSha256:old.sources.combinedRevisionSha256,unmodified:true},
   evidence:{referenceKind:base.referenceKind,acceptanceReferenceKind:proof.referenceKind,externallyPinnedIntegrityIsNotAuthority:true,
    preinstallCaptureSha256:old.evidence.preinstallCaptureSha256,preinstallReviewSha256:old.evidence.preinstallReviewSha256,reviewedAcceptanceSha256:proof.sha256,
    rawPrivateEvidenceIncluded:false,freshInstallationBaselineProved:false,readPermissionReusable:false},
   sources:{independent047BundleSha256:old.sources.independent047BundleSha256,sqlRevisionSha256:old.sources.sqlRevisionSha256,frozenApplication:proof.frozenApplication,candidateApplication:proof.candidateApplication,
    candidateRevisionSha256:candidate.sha256,overlays:candidate.material.overlay,renewalRevisionSha256:renewal.sha256,renewalSources:renewal.material.sources,
    combinedRevisionSha256:group.sha256,combinedSources:group.material.sources,expiryObservationPolicy:group.material.expiryObservationPolicy,preparationSources:validators,
    steps:old.sources.steps,legacyPrerequisites:old.sources.legacyPrerequisites,legacySourcesToExecute:[],unregisteredSourcesToExecute:[],sqlBodiesIncluded:false,productionSourcePromoted:false},
   baseline:old.baseline,gateway:old.gateway,installedContractReference:old.installedContractReference,
   acceptance:{...proof,scope:'reviewed-owned-ci-not-production-authorization',nativeAndBuiltNextInOneProductionTopology:false},
   registration:old.registration,installer:old.installer,rollout:old.rollout,unresolved:old.unresolved,authority:old.authority};
  const digest=sha(canonical(material)),wire=canonical({sha256:digest,material});assert.ok(Buffer.byteLength(wire)<=512*1024);const result=freeze({digest,wire,material});verified.add(result);return result;
 }catch{throw Error('checkout_production_source_v2_unavailable');}
}
export async function verifyCheckoutProductionSourceV2(wire,input){
 try{assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)<=512*1024);const decoded=JSON.parse(wire);assert.deepEqual(Object.keys(decoded).sort(),['material','sha256']);assert.equal(canonical(decoded),wire);assert.equal(decoded.sha256,sha(canonical(decoded.material)));const expected=await createCheckoutProductionSourceV2(input);assert.equal(wire,expected.wire);return expected;}
 catch{throw Error('checkout_production_source_v2_unverified');}
}
export function checkoutProductionSourceV2Summary(value){
 assert.ok(verified.has(value),'checkout_production_source_v2_unverified');const m=value.material;
 return freeze({sha256:value.digest,version:2,status:m.status,referenceKind:m.evidence.referenceKind,acceptanceReferenceKind:m.evidence.acceptanceReferenceKind,
  historicalDraftSha256:m.historicalDraft.sha256,candidateRevisionSha256:m.sources.candidateRevisionSha256,candidateApplication:m.sources.candidateApplication,
  combinedRevisionSha256:m.sources.combinedRevisionSha256,ownedAcceptanceCommit:m.acceptance.commit,ownedJobs:m.acceptance.jobs,ownedScenarioChecks:m.acceptance.scenarioChecks,
  savedOwnedCiReportBytesVerified:m.acceptance.savedOwnedCiReportBytesVerified,nativeFullRegistryInstallationValidated:m.acceptance.nativeFullRegistryInstallationValidated,completeProductionTopologyValidated:false,priorRegisteredSources:m.baseline.registry.count,newSourceSteps:m.sources.steps.length,
  unresolved:m.unresolved.length,freshInstallationBaselineProved:false,productionSourcePromoted:false,productionAuthorized:false,deploymentReady:false,stripeEnabled:false});
}
