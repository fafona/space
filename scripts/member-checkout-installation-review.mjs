// OFFLINE, unapproved review packet. No connection, SQL execution, production
// migration reservation, signing, secret loading, grant or release authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installationBundleSummary} from './member-checkout-installation-bundle.mjs';
import {installationPreflightSql,installationPreflightSummary} from './member-checkout-installation-preflight.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),verified=new WeakSet();
const inventoryPin=Object.freeze({files:215,sha256:'9b875d9bb2a688acc585437629ee3813646211f682b27929fa0e5868b12fe77b'});
const unresolved=Object.freeze([
 'promoted-production-sql-and-source-approval',
 'legacy-installed-ddl-compatibility',
 'complete-preinstall-trigger-and-policy-evidence',
 'reserved-production-migration-registration',
 'installer-identity-and-role-authorization',
 'durable-private-result-journal-and-locator',
 'verified-gateway-database-role-binding',
 'trusted-short-lived-runtime-issuer',
 'private-credential-delivery-renewal-and-revocation',
 'full-supabase-kong-and-runtime-validation',
 'checkout-specific-release-and-retained-rollback',
 'explicit-merchant-configuration-and-pilot-approval',
]);

/** Re-read only this fixed repository directory; changed bytes, symlinks,
 * duplicate versions and unexpected SQL names refuse, never refresh the pin. */
export async function readReviewedMigrationInventory() {
 const relative='scripts/supabase-migrations',directory=path.join(root,relative);
 assert.equal(await realpath(directory),directory,'installation_review_inventory_path');
 const entries=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(!entry.name.toLowerCase().endsWith('.sql'))continue;
  const parsed=entry.name.match(/^([0-9]{12,14})_([a-z0-9_]+)\.sql$/);
  assert.ok(parsed&&entry.isFile()&&!entry.isSymbolicLink(),'installation_review_inventory_file');
  const file=relative+'/'+entry.name,absolute=path.join(root,file);
  assert.equal(await realpath(absolute),absolute,'installation_review_inventory_path');
  const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(absolute)).replace(/\r\n/g,'\n');
  entries.push({file,version:parsed[1],nameSha256:sha(parsed[2]),sourceSha256:sha(source)});
 }
 entries.sort((a,b)=>a.file.localeCompare(b.file));
 assert.equal(new Set(entries.map(v=>v.version)).size,entries.length,'installation_review_inventory_duplicate');
 assert.equal(entries.length,inventoryPin.files,'installation_review_inventory_count');
 assert.equal(sha(canonical(entries)),inventoryPin.sha256,'installation_review_inventory_changed');
 return freeze({algorithm:'sha256-canonical-lf-migration-inventory-v1',...inventoryPin,entries});
}

function observationContext(observation,bundle,reference) {
 // A decoded observation is evidence, NOT a fresh connection or approval.
 const baseline=installationPreflightSummary(observation),source=installationBundleSummary(bundle);
 assert.equal(baseline.sourceBundleSha256,source.sha256,'installation_review_source_changed');
 assert.deepEqual(Object.keys(reference).sort(),['captureSha256','publicBuild']);
 assert.match(reference.captureSha256,/^[a-f0-9]{64}$/);assert.match(reference.publicBuild,/^[a-f0-9]{40}$/);
 assert.equal(baseline.productionAuthorized,false);
 const data=observation.data;
 assert.equal(data.context.readOnly,true,'installation_review_not_readonly');
 assert.equal(data.context.isolation,'repeatable read','installation_review_not_repeatable');
 assert.ok(data.roles.every(v=>!['faolla_checkout_runtime','faolla_checkout_executor'].includes(v.rolname)),'installation_review_role_collision');
 assert.ok(data.schemas.every(v=>v.name!=='faolla_checkout_design'),'installation_review_schema_collision');
 assert.ok(data.relations.every(v=>v.namespace!=='faolla_checkout_design'),'installation_review_relation_collision');
 assert.ok(data.functions.every(v=>v.namespace!=='faolla_checkout_design'&&!/^faolla_(?:member_)?checkout_/.test(v.name)),'installation_review_function_collision');
 assert.ok(data.registry.entries.every(v=>!/^99999999/.test(v.version)),'installation_review_synthetic_registration');
 return {baseline,source,data};
}

/** Summarize accurate provenance and unsatisfied prerequisites. Even complete
 * registry coverage does NOT prove installed bodies/DDL or authorize execution. */
export async function createInstallationReview(observation,bundle,reference) {
 const {baseline,source,data}=observationContext(observation,bundle,reference),inventory=await readReviewedMigrationInventory();
 const local=new Map(inventory.entries.map(v=>[v.version,v])),registered=new Set();
 for(const row of data.registry.entries){
  const file=local.get(row.version);assert.ok(file&&file.nameSha256===row.nameSha256,'installation_review_registry_source_mismatch');
  registered.add(row.version);
 }
 for(const prerequisite of bundle.material.prerequisites.sources){
  const file=inventory.entries.find(v=>v.file===prerequisite.file);
  assert.ok(file&&file.sourceSha256===prerequisite.sha256&&registered.has(file.version),'installation_review_legacy_prerequisite_mismatch');
 }
 const pending=inventory.entries.filter(v=>!registered.has(v.version));
 const material={
  version:1,kind:'member-checkout-production-installation-review-v1',status:'draft-unapproved-not-executable',
  evidence:{captureSha256:reference.captureSha256,publicBuild:reference.publicBuild,querySha256:sha(installationPreflightSql),
   observation:baseline,freshnessProved:false,originalReadOnlyScopeExpanded:false,rawMetadataIncluded:false},
  sourceReview:{candidate:source,productionArtifactPromoted:false,sqlBodiesIncluded:false,
   proposedSources:bundle.material.steps.map(v=>({file:v.file,sourceSha256:v.sourceSha256,bodySha256:v.bodySha256})),
   legacyPrerequisites:bundle.material.prerequisites.sources,legacySourcesToExecute:[],
   inventory:{algorithm:inventory.algorithm,files:inventory.files,sha256:inventory.sha256},
   registeredSources:inventory.entries.filter(v=>registered.has(v.version)),
   unregisteredSources:pending,unregisteredSourcesToExecute:[],namesAreNotInstalledDdlProof:true},
  registration:{status:'unreserved',version:null,name:null,syntheticReceiptReusable:false,
   singleTransactionWithObjectsRequired:true,fullPriorRegistryMustMatch:true,automaticBaselineRefresh:false},
  privileges:{installerBoundToObservation:true,observedActorSha256:sha(canonical(data.target.actor)),
   observedRoleGraphSha256:sha(canonical({roles:data.roles,memberships:data.memberships,defaultAcls:data.defaultAcls})),
   installerPermissionApproved:false,gatewayDatabaseLogin:null,gatewayMembershipApproved:false,
   runtime:bundle.material.installedContract.runtime,executor:bundle.material.installedContract.executor,
   executorMembershipAllowed:false,ordinaryApiPrivateAccessAllowed:false,automaticAclRepair:false},
  credentials:{applicationVariable:'FAOLLA_CHECKOUT_RUNTIME_JWT',runtimeRole:'faolla_checkout_runtime',serverOnly:true,
   userAuthenticationStillRequired:true,minimumDispatchValidityMs:12000,issuer:null,delivery:null,renewal:null,revocation:null,
   tokensIncluded:false,projectSigningKeyExported:false,globalSigningKeyRotation:false,serviceRoleFallback:false,
   emergencyRevocationMayBlockOriginalService:true},
  resultEvidence:{required:'source-target-before-and-complete-after-with-atomic-registration',
   persistentPrivateStore:null,locatorDelivery:null,missingEvidencePolicy:'refuse-no-regeneration',
   ciTempJournalIsProductionStore:false,unknownCommitPolicy:'reconnect-confirm-original-never-blind-reapply'},
  rollout:{status:'not-configured',merchantSites:[],featureFlagsToWrite:[],businessRowsToWrite:[],
   normalPause:'deny-new-purchases-retain-original-read-replay-and-approved-cancellation',
   emergencyCapabilityRevocationIsNormalPause:false,
   retainedRollbackRequired:true,checkoutSpecificReleaseRequired:true,oldQrReleaseReusable:false,
   existingServicesUnchanged:true,mailEnabled:false,stripeEnabled:false},
  unresolved:[...unresolved],
  authority:{installation:false,migrationReservation:false,roleGrants:false,credentialIssuance:false,
   deployment:false,pilotActivation:false,businessDataChanges:false,stripe:false,mail:false,backgroundWorkers:false},
 };
 const digest=sha(canonical(material)),wire=canonical({sha256:digest,material});assert.ok(Buffer.byteLength(wire,'utf8')<=256*1024);
 const result=freeze({digest,wire,material});verified.add(result);return result;
}
export async function verifyInstallationReview(wire,observation,bundle,reference) {
 try{
  assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire,'utf8')<=256*1024);
  const value=JSON.parse(wire);assert.deepEqual(Object.keys(value).sort(),['material','sha256']);
  assert.equal(canonical(value),wire);assert.equal(value.sha256,sha(canonical(value.material)));
  const expected=await createInstallationReview(observation,bundle,reference);assert.equal(wire,expected.wire);
  return expected;
 }catch{throw Error('installation_review_unapproved');}
}
export function installationReviewSummary(review) {
 assert.ok(verified.has(review),'installation_review_not_verified');
 const {material}=review;
 return {version:1,sha256:review.digest,status:material.status,sourceBundleSha256:material.sourceReview.candidate.sha256,
  proposedSources:material.sourceReview.proposedSources.length,registeredSources:material.sourceReview.registeredSources.length,
  unregisteredSources:material.sourceReview.unregisteredSources.length,legacySourcesToExecute:0,
  unregisteredSourcesToExecute:0,unresolved:material.unresolved.length,productionAuthorized:false,deploymentReady:false};
}
