// OFFLINE preparation only. No SQL bodies, connector, installer, credential,
// registration reservation or production authority is created by this module.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {checkout047InstallationBundleSummary} from './member-checkout-047-installation.mjs';
import {checkout047PreinstallReviewSummary,inspectCheckout047Preinstall} from './member-checkout-047-preinstall-review.mjs';
import {loadCredentialCandidateSources} from './member-checkout-credential-candidate.mjs';
import {loadCredentialRenewalRevision} from './member-checkout-credential-renewal-revision.mjs';
// This v1 draft refers only to the already reviewed historical c4 acceptance.
// New current tests must acquire their own proof; never refresh this old pin.
import {loadArchivedGroupNextRevision as loadGroupNextRevision} from './member-checkout-group-next-archive.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const exact=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
const hash=value=>{assert.match(value,/^[a-f0-9]{64}$/);return value;};
const verified=new WeakSet();
const excluded='scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql';
const blocked=Object.freeze(['formal-source-approval-and-version-reservation','fresh-installation-window-baseline','formal-installer-and-gateway-grant-approval',
 'effective-kong-routes-and-authentication-bindings','formal-issuer-crypto-identity-and-service-configuration','full-production-topology-isolated-acceptance',
 'persistent-production-evidence-and-independent-backup','checkout-specific-candidate-and-compatible-rollback','explicit-merchant-pricing-policy-and-pilot-approval']);

function decodeReference(wire,expectedSha256){
 hash(expectedSha256);assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)>0&&Buffer.byteLength(wire)<=1024*1024);
 assert.equal(sha(wire),expectedSha256,new Error('checkout_source_draft_reference_changed'));
 return JSON.parse(wire);
}

function gatewayReference(wire,digest,observation,priorCapture,priorCaptureSha256){
 const r=decodeReference(wire,digest),v=r.remote;
 assert.equal(r.previousCaptureSha256,priorCaptureSha256,new Error('checkout_source_draft_capture_chain_changed'));
 assert.equal(r.scope,'user-approved-once-gateway-nonsecret-repeat-20261126');
 assert.equal(r.exactApprovedDelta,true);assert.equal(r.previousApprovalReused,false);assert.equal(r.oneShotPermissionConsumed,true);assert.equal(r.repeatProductionReadAuthorized,false);
 assert.equal(r.transport.code,0);assert.equal(r.transport.signal,null);assert.equal(r.transport.stderrBytes,0);assert.equal(r.transport.oversize,false);
 for(const k of ['businessRowsRead','productionMutations','installationAuthorized','deploymentAuthorized','stripeEnabled'])assert.equal(r[k],false);
 assert.equal(v.scope,'user-approved-once-gateway-nonsecret-readonly-20261126');
 for(const k of ['businessRowsRead','fullEnvironmentRead','fullPluginConfigRead','credentialValuesRead','productionMutations','installationAuthorized','deploymentAuthorized','stripeEnabled'])assert.equal(v[k],false);
 assert.match(v.observedAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);assert.equal(new Date(v.observedAt).toISOString(),v.observedAt);
 const images=[['supabase-db','supabase/postgres:15.8.1.085'],['supabase-rest','postgrest/postgrest:v14.5'],['supabase-auth','supabase/gotrue:v2.186.0'],['supabase-kong','kong:2.8.1']];
 assert.deepEqual(v.containers.map(c=>[c.name,c.image]),images);
 for(const c of v.containers){hash(c.identitySha256);assert.match(c.imageId,/^sha256:[a-f0-9]{64}$/);assert.equal(c.state,'running');}
 for(const c of priorCapture.remote.containers){const next=v.containers.filter(n=>n.name===c.name);assert.equal(next.length,1);assert.equal(next[0].image,c.image);assert.equal(next[0].identitySha256,c.identitySha256,new Error('checkout_source_draft_container_chain_changed'));}
 assert.equal(v.database.readOnly,true);assert.equal(v.database.isolation,'repeatable read');assert.equal(v.database.database,'postgres');assert.equal(v.database.currentRole,'supabase_admin');assert.equal(v.database.serverVersionNum,150008);
 assert.equal(observation.seal.data.core.target.serverVersion,'150008');assert.deepEqual(v.database.settings,[]);
 for(const [component,role] of [['supabase-rest','authenticator'],['supabase-auth','supabase_auth_admin']]){
  assert.equal(v.roleSources[component].state,'observed');assert.equal(v.roleSources[component].role,role);
  assert.equal(v.roleSources[component].source,component==='supabase-rest'?'container.env:PGRST_DB_URI:username-only':'container.env:GOTRUE_DB_DATABASE_URL:username-only');
  const current=v.database.configuredRoles.filter(c=>c.component===component),prior=observation.seal.data.core.roles.filter(c=>c.rolname===role);
  assert.equal(current.length,1);assert.equal(prior.length,1);assert.equal(current[0].role,role);assert.equal(current[0].present,true);
  for(const [key,oldKey,wanted]of [['login','rolcanlogin',true],['inherit','rolinherit',false],['superuser','rolsuper',false],['bypassRls','rolbypassrls',false]]){assert.equal(current[0][key],wanted);assert.equal(prior[0][oldKey],wanted,new Error('checkout_source_draft_saved_role_changed'));}
 }
 assert.equal(v.database.configuredRoles.length,2);
 const sessions=v.database.sessions.filter(s=>s.component==='supabase-rest');assert.equal(sessions.length,1);assert.equal(sessions[0].role,'authenticator');assert.ok(Number.isSafeInteger(sessions[0].connections)&&sessions[0].connections>0);
 assert.ok(v.database.sessions.every(s=>['supabase-rest','supabase-auth'].includes(s.component)&&['authenticator','supabase_auth_admin'].includes(s.role)&&Number.isSafeInteger(s.connections)&&s.connections>0));
 assert.deepEqual(v.environment['supabase-rest'].PGRST_DB_SCHEMAS,{state:'set',value:'public,storage,graphql_public'});assert.deepEqual(v.environment['supabase-rest'].PGRST_DB_ANON_ROLE,{state:'set',value:'anon'});
 assert.deepEqual(v.environment['supabase-kong'].KONG_DATABASE,{state:'set',value:'off'});assert.deepEqual(v.environment['supabase-kong'].KONG_ADMIN_LISTEN,{state:'unset'});
 for(const k of ['services','routes','loadedPlugins'])assert.deepEqual(v.kong[k],{state:'unknown',reason:'admin_listener_not_confirmed_at_fixed_port'});
 assert.deepEqual(v.kong.activePlugins,{state:'unknown',reason:'full_plugin_configuration_not_read'});for(const k of ['jwtAlgorithm','jwtKeyId'])assert.deepEqual(v.kong[k],{state:'unknown',reason:'signing_material_not_read'});
 return {captureSha256:digest,observedAt:v.observedAt,containerSourceMetadataSha256:sha(canonical(v.containers)),environmentMetadataSha256:sha(canonical(v.environment)),
  components:v.containers.map(c=>({name:c.name,image:c.image,imageId:c.imageId,identitySha256:c.identitySha256,imageIdIsRegistryOrCiArtifactPin:false})),
  databaseVersionNum:150008,configuredRestLogin:'authenticator',restContainerSessionLoginMatches:true,restSessionCount:sessions[0].connections,
  configuredAuthLogin:'supabase_auth_admin',authRuntimeLoginProved:false,kongDatabaseEnvironment:'off',effectiveKongRoutesProved:false,effectiveKongAuthenticationProved:false,
  cryptoIssuerProved:false,cryptoAudienceProved:false,cryptoAlgorithmProved:false,cryptoKidProved:false,configurationDefaultsAssumed:false,
  serviceContainerProvenanceMatched:true,databaseTargetRechecked:false,snapshotIsNotFreshInstallationWindow:true,readAuthorizationConferred:false};
}

function acceptanceReference(wire,digest,candidate,group){
 const r=decodeReference(wire,digest);assert.equal(r.version,1);assert.equal(r.scope,'offline-reviewed-owned-combined-automatic-renewal-next-not-production');
 exact(r.runs,['baseline','revision']);assert.ok(Object.values(r.runs).every(v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)));
 assert.match(r.commit,/^[a-f0-9]{40}$/);assert.equal(r.reports.length,15);assert.equal(r.totalChecks,489);assert.equal(r.reports.reduce((n,v)=>n+v.checks,0),489);
 assert.ok(r.reports.every(v=>v.passed===true&&v.cleanupPassed===true&&Number.isSafeInteger(v.checks)&&v.checks>0));
 for(const k of ['productionReadPerformed','persistentProductionStorageVerified','hostBackupRestoreTested','powerLossTested','productionAuthorized','deploymentReady','fullProductionGatewayValidated'])assert.equal(r[k],false);
 for(const k of ['frozenApplicationUnchanged','oldJournalUnchanged','nextCredentialIntegrationValidated','realPostgrestCredentialGatewayValidated','distinctUidGroupReadValidated','autoRenewalComponentValidated','autoRenewalBuiltNextValidated'])assert.equal(r[k],true);
 const combined=r.reports.filter(v=>v.runtime?.automaticRenewal===true);assert.equal(combined.length,1);const c=combined[0];assert.equal(c.sourceRevision,group.sha256);assert.equal(c.checks,38);
 for(const [k,v]of Object.entries({sameNextProcess:true,differentUid:true,automaticRenewal:true,reloadOrRestart:false,financialCommitDispatches:1,financialDebitCount:1,financialPostRetries:0,envFallback:false,signingMaterialPassedToNext:false,formalIssuerProvisioned:false,kongValidated:false,fullProductionGatewayValidated:false,productionReadPerformed:false,productionAuthorized:false,deploymentReady:false}))assert.equal(c.runtime[k],v);
 for(const k of ['nextSigningKeyReadDenied','nextCredentialWriteDenied','nextRequestReadDenied','issuerOutageAndRecovery'])assert.equal(c.runtime[k],true);
 assert.equal(c.runtime.actualWallClockGatewayExpirations,3);assert.ok(Number.isSafeInteger(c.runtime.nextUid)&&c.runtime.nextUid>0);assert.ok(Number.isSafeInteger(c.runtime.issuerUid)&&c.runtime.issuerUid>0);assert.notEqual(c.runtime.nextUid,c.runtime.issuerUid);
 assert.equal(c.generations.length,3);assert.equal(new Set(c.generations.map(g=>g.generation)).size,3);assert.ok(c.generations.every(g=>g.waitedPastExpiryMs>=31000&&g.postgrestExpiredStatus===401));assert.ok(c.continuousReplies>=3&&c.publishedGenerations>=3);
 assert.equal(c.outage.originalBytesRetained,true);assert.equal(c.outage.dispatchesAfterCutoff,0);assert.equal(c.outage.realExpiredStatus,401);assert.ok(c.outage.stillValidReplies>0);assert.equal(c.groupShutdown.code,0);assert.equal(c.groupShutdown.signal,null);assert.equal(c.groupShutdown.complete.passed,true);assert.equal(c.groupShutdown.complete.processes.length,2);assert.ok(c.groupShutdown.complete.processes.every(p=>p.code===0&&p.signal===null&&p.forced===false));
 const previous=r.reports.filter(v=>v.candidateApplication);assert.ok(previous.length>0);assert.ok(previous.every(v=>canonical(v.candidateApplication)===canonical(candidate.material.application)));
 return {reviewSha256:digest,commit:r.commit,runs:r.runs,reportCount:15,checks:489,groupRevisionSha256:group.sha256,combinedChecks:38,automaticRenewalDistinctUidBuiltNextValidated:true,
  originalCommitDispatches:1,originalFinancialDebits:1,financialPostRetries:0,formalIssuerProved:false,completeProductionGatewayProved:false,productionReadAuthorized:false};
}

/** References are externally pinned integrity inputs, never proof of authority.
 * The caller retains the raw private evidence; it is not embedded in the draft. */
async function prepareSourceDraft(input){
 const {bundle,contract,observation,review,preinstallCaptureWire,gatewayCaptureWire,acceptanceReviewWire,references}=input;
 exact(references,['kind','preinstallReviewSha256','preinstallCaptureSha256','gatewayCaptureSha256','acceptanceReviewSha256']);assert.ok(['saved-production-evidence','owned-synthetic-evidence'].includes(references.kind));
 const source=checkout047InstallationBundleSummary(bundle),prior=checkout047PreinstallReviewSummary(review),inspection=inspectCheckout047Preinstall(contract,observation);
 assert.equal(prior.sha256,hash(references.preinstallReviewSha256));assert.deepEqual(inspection.issues,[]);assert.equal(inspection.legacyDefinitionsMatch,true);
 assert.equal(source.sha256,'f34249f74c0311323fac2f7779fe14ea3151ffacc74d3b5cacf75de8d41d839e');
 assert.equal(review.material.evidence.observationSha256,observation.sha256);assert.equal(review.material.evidence.targetSha256,observation.seal.targetSha256);assert.equal(prior.sourceBundleSha256,source.sha256);
 assert.equal(prior.registeredSources,214,new Error('checkout_source_draft_requires_full_registry'));assert.equal(prior.unregisteredSources,1);assert.equal(prior.proposedSteps,38);
 assert.equal(review.material.status,'draft-unapproved-not-executable');assert.ok(Object.values(review.material.authority).every(v=>v===false));
 for(const k of ['legacySourcesToExecute','unregisteredSourcesToExecute'])assert.deepEqual(review.material.sourceReview[k],[]);assert.deepEqual(review.material.sourceReview.unregisteredSources.map(v=>v.file),[excluded]);
 const core=observation.seal.data.core;assert.equal(core.context.readOnly,true);assert.equal(core.context.isolation,'repeatable read');assert.equal(core.registry.count,214);
 const entries=review.material.sourceReview.registeredSources.map(({version,nameSha256})=>({version,nameSha256})).sort((a,b)=>a.version.localeCompare(b.version));
 assert.deepEqual(core.registry.entries,entries);assert.equal(new Set(entries.map(v=>v.version)).size,214);assert.ok(entries.every(v=>!/^99999999/.test(v.version)));
 assert.equal(sha(canonical(core.registry)),observation.seal.registrySha256);assert.equal(bundle.material.prerequisites.registry.length,6);
 const priorCapture=decodeReference(preinstallCaptureWire,references.preinstallCaptureSha256);
 for(const k of ['productionMutations','businessRowsRead','installationAuthorized','deploymentAuthorized','originalApprovalReused'])assert.equal(priorCapture[k],false);
 assert.equal(priorCapture.transport.code,0);assert.equal(priorCapture.transport.signal,null);assert.equal(priorCapture.transport.stderrBytes,0);assert.equal(priorCapture.transport.oversize,false);
 assert.equal(priorCapture.remote.mode,'metadata_read_only_047_preinstall');assert.equal(canonical(priorCapture.remote.metadata),canonical(observation.data),new Error('checkout_source_draft_baseline_capture_changed'));
 assert.equal(sha(JSON.stringify(priorCapture.remote)),review.material.evidence.captureSha256);assert.equal(priorCapture.remote.containers.length,3);
 assert.equal(priorCapture.publicVersion.after.buildId,review.material.evidence.publicBuild);assert.deepEqual(priorCapture.publicVersion.before,priorCapture.publicVersion.after);
 const {revision:candidate}=await loadCredentialCandidateSources(),renewal=await loadCredentialRenewalRevision(),group=await loadGroupNextRevision();
 assert.equal(candidate.sha256,'b089e6595e8ed06e5e0a38da0edfb701a264be571878e4a5ac0bfee8b5b77603');assert.equal(renewal.sha256,'5a7381a219f5c6f2c359610b740dff40c861407c6d32fb899eebbbae026b2d3d');assert.equal(group.sha256,'a476794f63fec4151027e416b410d0bb94b971f08edc1fa0882654eae0f774f2');
 assert.deepEqual(candidate.material.baseApplication,source.application);assert.notDeepEqual(candidate.material.application,source.application);assert.equal(candidate.material.application.files,2974);assert.equal(source.application.files,2971);
 const gateway=gatewayReference(gatewayCaptureWire,references.gatewayCaptureSha256,observation,priorCapture,references.preinstallCaptureSha256),acceptance=acceptanceReference(acceptanceReviewWire,references.acceptanceReviewSha256,candidate,group);
 const steps=bundle.material.steps.map(({id,file,sourceSha256,bodySha256,originalFunctionSha256})=>({id,file,sourceSha256,bodySha256,...(originalFunctionSha256?{originalFunctionSha256}:{})}));
 assert.equal(steps.length,38);assert.deepEqual(steps.map(({id,file,sourceSha256,bodySha256})=>({id,file,sourceSha256,bodySha256})),review.material.sourceReview.proposedSources);assert.equal(new Set(steps.map(v=>v.id)).size,38);
 const material={version:1,kind:'member-checkout-production-source-draft-v1',status:'draft-unapproved-not-executable',scope:'offline-source-binding-not-installer-or-approval',
  evidence:{referenceKind:references.kind,externallyPinnedIntegrityIsNotAuthority:true,preinstallReviewSha256:prior.sha256,preinstallObservationSha256:observation.sha256,
   preinstallCaptureSha256:references.preinstallCaptureSha256,preinstallRemoteProjectionSha256:review.material.evidence.captureSha256,querySha256:review.material.evidence.querySha256,rawMetadataIncluded:false,freshInstallationBaselineProved:false,readPermissionReusable:false},
  sources:{independent047BundleSha256:source.sha256,frozenBaseBundleSha256:source.baseBundleSha256,sqlRevisionSha256:source.revisionSha256,
   frozenApplication:source.application,candidateApplication:candidate.material.application,candidateRevisionSha256:candidate.sha256,overlays:candidate.material.overlay,
   credentialFileRevisionSha256:candidate.material.componentSha256,renewalRevisionSha256:renewal.sha256,renewalSources:renewal.material.sources,combinedRevisionSha256:group.sha256,
   builderSourceSha256:sha((await readFile(new URL('./member-checkout-production-source-draft.mjs',import.meta.url),'utf8')).replace(/\r\n/g,'\n')),steps,
   legacyPrerequisites:bundle.material.prerequisites.sources,legacySourcesToExecute:[],unregisteredSourcesToExecute:[],sqlBodiesIncluded:false,productionSourcePromoted:false},
  baseline:{kind:'saved-complete-registry-not-fresh-installation-window',targetSha256:observation.seal.targetSha256,registrySha256:observation.seal.registrySha256,catalogSha256:observation.seal.catalogSha256,
   registry:{count:214,entries},inventory:review.material.sourceReview.inventory,unrelatedUnregisteredSources:review.material.sourceReview.unregisteredSources,
   legacyDefinitionsMatched:{functions:26,guards:3},completeLegacyDdlProved:false,automaticRefreshAllowed:false,
   ciPrerequisiteRegistry:{count:6,entries:bundle.material.prerequisites.registry,reusableAsProductionBaseline:false}},
  gateway,acceptance,
  installedContractReference:{protocolSha256:bundle.material.installedContract.protocolSha256,functions:93,tables:24,guards:28,dispatcher:bundle.material.installedContract.entry,
   runtime:bundle.material.installedContract.runtime,executor:bundle.material.installedContract.executor,grantStatementsIncluded:false,gatewayMembershipApproved:false,executorMembershipAllowed:false,automaticAclRepair:false},
  registration:{status:'unreserved',sourceVersion:null,sealVersion:null,sourceName:null,sealName:null,syntheticCiVersionsReusable:false},
  installer:{implementedForProduction:false,sqlToExecute:[],persistentStore:null,locator:null,backupProvider:null,formalSigner:null,signerOwner:null,credentialDeliveryPath:null,missingEvidencePolicy:'refuse-no-regeneration',unknownCommitPolicy:'confirm-original-never-blind-reapply'},
  rollout:{merchantSites:[],flagsToWrite:[],businessRowsToWrite:[],candidate:null,compatibleRollback:null,stripeEnabled:false,mailEnabled:false},
  unresolved:[...blocked],authority:{installation:false,migrationReservation:false,roleGrants:false,credentialIssuance:false,deployment:false,pilotActivation:false,businessDataChanges:false,stripe:false,mail:false,backgroundWorkers:false}};
 const digest=sha(canonical(material)),wire=canonical({sha256:digest,material});assert.ok(Buffer.byteLength(wire)<=512*1024);const result=freeze({digest,wire,material});verified.add(result);return result;
}

export async function createCheckoutProductionSourceDraft(input){
 try{return await prepareSourceDraft(input);}
 catch(error){
  const labels=['reference_changed','capture_chain_changed','container_chain_changed','saved_role_changed','requires_full_registry','baseline_capture_changed'];
  const label=labels.find(v=>error?.message==='checkout_source_draft_'+v||error?.message?.startsWith('checkout_source_draft_'+v+'\n'));
  throw Object.assign(Error('checkout_production_source_draft_unavailable'),{code:label?'CHECKOUT_SOURCE_DRAFT_'+label.toUpperCase():'CHECKOUT_SOURCE_DRAFT_INVALID'});
 }
}

export async function verifyCheckoutProductionSourceDraft(wire,input){
 try{assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)<=512*1024);const v=JSON.parse(wire);exact(v,['sha256','material']);assert.equal(canonical(v),wire);assert.equal(v.sha256,sha(canonical(v.material)));const expected=await createCheckoutProductionSourceDraft(input);assert.equal(expected.wire,wire);return expected;}
 catch{throw Error('checkout_production_source_draft_unverified');}
}

export function checkoutProductionSourceDraftSummary(value){
 assert.ok(verified.has(value),'checkout_production_source_draft_unverified');const m=value.material;
 return freeze({sha256:value.digest,status:m.status,referenceKind:m.evidence.referenceKind,candidateApplication:m.sources.candidateApplication,candidateRevisionSha256:m.sources.candidateRevisionSha256,
  priorRegisteredSources:m.baseline.registry.count,isolatedPrerequisiteSources:m.baseline.ciPrerequisiteRegistry.count,newSourceSteps:m.sources.steps.length,legacySourcesToExecute:0,unregisteredSourcesToExecute:0,
  ownedApplicationAcceptanceChecks:m.acceptance.checks,configuredRestLoginSourceBound:true,completeProductionGatewayValidated:false,freshInstallationBaselineProved:false,
  unresolved:m.unresolved.length,productionSourcePromoted:false,productionAuthorized:false,deploymentReady:false});
}
