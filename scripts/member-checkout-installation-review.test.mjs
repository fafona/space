import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createInstallationSourceBundle} from './member-checkout-installation-bundle.mjs';
import {readInstallationPreflight} from './member-checkout-installation-preflight.mjs';
import {readReviewedMigrationInventory,createInstallationReview,verifyInstallationReview,installationReviewSummary} from './member-checkout-installation-review.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const bundle=await createInstallationSourceBundle(),inventory=await readReviewedMigrationInventory();
const excluded='scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql';
const reference={captureSha256:'9'.repeat(64),publicBuild:'a'.repeat(40)};
const fixture=()=>({
 context:{backendPid:100,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
 target:{clusterSha256:'1'.repeat(64),databaseOid:'12345',databaseName:'owned_review_test',databaseOwner:'owned_admin',databaseEncoding:'UTF8',
  serverVersion:'150008',serverAddress:'127.0.0.1',serverPort:5432,sessionUser:'owned_admin',currentRole:'owned_admin',
  actor:{oid:'1234',rolname:'owned_admin',rolsuper:true,rolcreaterole:true,rolbypassrls:true}},
 registry:{count:214,entries:inventory.entries.filter(v=>v.file!==excluded).map(({version,nameSha256})=>({version,nameSha256}))},
 roles:[{oid:'1234',rolname:'owned_admin',rolsuper:true}],memberships:[],defaultAcls:[],schemas:[{name:'public',owner:'owned_admin'}],
 relations:[{oid:'3456',namespace:'public',name:'pages'}],columns:[{relation:'3456',ordinal:1,name:'id',type:'uuid',not_null:true}],
 constraints:[],indexes:[],functions:[],extensions:[],
});
const observe=value=>readInstallationPreflight(async()=>({rows:[{metadata:value}]}),bundle);
const observed=await observe(fixture()),review=await createInstallationReview(observed,bundle,reference);
const rewrite=change=>{const value=JSON.parse(review.wire);change(value.material);value.sha256=sha(canonical(value.material));return canonical(value);};

test('migration inventory independently re-reads all 215 fixed source bodies without refreshing its pin',async()=>{
 assert.equal(inventory.files,215);assert.equal(inventory.sha256,'9b875d9bb2a688acc585437629ee3813646211f682b27929fa0e5868b12fe77b');
 assert.equal(new Set(inventory.entries.map(v=>v.version)).size,215);assert.ok(Object.isFrozen(inventory.entries[0]));
 assert.equal(sha(canonical(inventory.entries)),inventory.sha256);
 for(const row of inventory.entries)assert.match(row.sourceSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(await readReviewedMigrationInventory(),inventory);
});
test('214 synthetic registered sources produce a complete draft but never approval or an executable package',()=>{
 const material=review.material,summary=installationReviewSummary(review);
 assert.equal(summary.registeredSources,214);assert.equal(summary.unregisteredSources,1);assert.equal(summary.proposedSources,33);
 assert.deepEqual(material.sourceReview.unregisteredSources.map(v=>v.file),[excluded]);
 assert.deepEqual(material.sourceReview.legacySourcesToExecute,[]);assert.deepEqual(material.sourceReview.unregisteredSourcesToExecute,[]);
 assert.equal(material.sourceReview.namesAreNotInstalledDdlProof,true);assert.equal(material.sourceReview.sqlBodiesIncluded,false);
 assert.equal(material.sourceReview.productionArtifactPromoted,false);assert.equal(material.sourceReview.candidate.scope,'owned-ci-only-not-production');
 assert.equal(summary.productionAuthorized,false);assert.equal(summary.deploymentReady,false);assert.equal(summary.status,'draft-unapproved-not-executable');
 assert.ok(Object.values(material.authority).every(value=>value===false));
 assert.equal(material.registration.version,null);assert.equal(material.registration.name,null);assert.equal(material.registration.syntheticReceiptReusable,false);
});
test('five-entry minimal CI baseline cannot masquerade as 214 registered production migrations',async()=>{
 const raw=fixture(),versions=new Set(bundle.material.prerequisites.registry.map(v=>v.version));
 raw.registry.entries=raw.registry.entries.filter(v=>versions.has(v.version));raw.registry.count=5;
 const result=await createInstallationReview(await observe(raw),bundle,reference),summary=installationReviewSummary(result);
 assert.equal(summary.registeredSources,5);assert.equal(summary.unregisteredSources,210);assert.equal(summary.productionAuthorized,false);
 assert.equal(result.material.unresolved.length,12);assert.equal(result.material.evidence.freshnessProved,false);
});
test('canonical draft verifies only against independently reloaded sources and its original observation/reference',async()=>{
 const result=await verifyInstallationReview(review.wire,observed,bundle,reference);assert.equal(result.digest,review.digest);assert.notEqual(result,review);
 for(const next of [{...reference,captureSha256:'8'.repeat(64)},{...reference,publicBuild:'b'.repeat(40)}])
  await assert.rejects(verifyInstallationReview(review.wire,observed,bundle,next),/^Error: installation_review_unapproved$/);
 const raw=fixture();raw.target.databaseOid='54321';
 await assert.rejects(verifyInstallationReview(review.wire,await observe(raw),bundle,reference),/unapproved/);
});
test('self-rehashed grants, production flags, migration reservations, source swaps and removal of blockers are refused',async()=>{
 for(const change of [v=>v.authority.installation=true,v=>v.authority.deployment=true,v=>v.authority.credentialIssuance=true,
  v=>v.privileges.gatewayMembershipApproved=true,v=>v.privileges.executorMembershipAllowed=true,v=>v.privileges.automaticAclRepair=true,
  v=>v.registration.version='202611250100',v=>v.sourceReview.candidate.scope='production-approved',
  v=>v.sourceReview.proposedSources[0].bodySha256='0'.repeat(64),v=>v.sourceReview.registeredSources.pop(),v=>v.unresolved=[],
  v=>v.resultEvidence.ciTempJournalIsProductionStore=true,v=>v.credentials.serviceRoleFallback=true,
  v=>v.sourceReview.unregisteredSourcesToExecute.push(excluded),v=>v.rollout.merchantSites.push('10909095')])
  await assert.rejects(verifyInstallationReview(rewrite(change),observed,bundle,reference),/^Error: installation_review_unapproved$/);
});
test('a name-only registry mismatch, unknown local version or missing legacy prerequisite never receives implicit approval',async()=>{
 for(const change of [v=>v.registry.entries[0].nameSha256='0'.repeat(64),v=>v.registry.entries[0].version='202611259999',
  v=>{v.registry.entries=v.registry.entries.filter(row=>row.version!==bundle.material.prerequisites.registry[0].version);v.registry.count--;}]){
  const raw=fixture();change(raw);await assert.rejects(createInstallationReview(await observe(raw),bundle,reference),/installation_review_(?:registry_source|legacy_prerequisite)_mismatch/);
 }
});
test('checkout roles, schema, relation, public function or synthetic registration already present refuse pre-install review',async()=>{
 for(const change of [v=>v.roles.push({rolname:'faolla_checkout_runtime'}),v=>v.roles.push({rolname:'faolla_checkout_executor'}),
  v=>v.schemas.push({name:'faolla_checkout_design'}),v=>v.relations.push({namespace:'faolla_checkout_design'}),
  v=>v.functions.push({namespace:'public',name:'faolla_checkout_runtime_v1'}),
  v=>{v.registry.entries.push({version:'999999990003',nameSha256:'1'.repeat(64)});v.registry.count++;}]){
  const raw=fixture();change(raw);await assert.rejects(createInstallationReview(await observe(raw),bundle,reference),/installation_review_(?:role_collision|schema_collision|relation_collision|function_collision|synthetic_registration)/);
 }
});
test('read-write observation, unverified object copies and reference fields cannot expand the old read-only approval',async()=>{
 for(const change of [v=>v.context.readOnly=false,v=>v.context.isolation='read committed']){
  const raw=fixture();change(raw);await assert.rejects(createInstallationReview(await observe(raw),bundle,reference),/installation_review_not_/);
 }
 await assert.rejects(createInstallationReview({...observed},bundle,reference),/not_observed/);
 await assert.rejects(createInstallationReview(observed,{...bundle},reference),/not_verified/);
 await assert.rejects(createInstallationReview(observed,bundle,{...reference,installationAuthorized:true}));
 await assert.rejects(createInstallationReview(observed,bundle,{...reference,captureSha256:'invalid'}));
});
test('permissions, actual gateway role, runtime issuance/delivery/renewal and durable locator remain explicitly unresolved',()=>{
 const {privileges,credentials,resultEvidence,rollout}=review.material;
 assert.equal(privileges.installerPermissionApproved,false);assert.equal(privileges.gatewayDatabaseLogin,null);
 assert.equal(privileges.executor.bypassRls,true);assert.equal(privileges.executor.login,false);assert.equal(privileges.executorMembershipAllowed,false);
 assert.equal(privileges.runtime.bypassRls,false);assert.equal(privileges.runtime.dispatcherOnly,true);assert.equal(privileges.ordinaryApiPrivateAccessAllowed,false);
 for(const key of ['issuer','delivery','renewal','revocation'])assert.equal(credentials[key],null);
 assert.equal(credentials.serverOnly,true);assert.equal(credentials.userAuthenticationStillRequired,true);
 assert.equal(credentials.minimumDispatchValidityMs,12000);assert.equal(credentials.globalSigningKeyRotation,false);assert.equal(credentials.projectSigningKeyExported,false);
 assert.equal(resultEvidence.persistentPrivateStore,null);assert.equal(resultEvidence.locatorDelivery,null);
 assert.equal(rollout.emergencyCapabilityRevocationIsNormalPause,false);assert.equal(rollout.oldQrReleaseReusable,false);
 assert.deepEqual(rollout.featureFlagsToWrite,[]);assert.deepEqual(rollout.businessRowsToWrite,[]);
});
test('malformed, duplicate/extra envelope fields, noncanonical and oversized drafts are rejected',async()=>{
 for(const wire of [review.wire+'\n',review.wire.slice(0,-1),'x'.repeat(262145),
  canonical({...JSON.parse(review.wire),extra:true}),review.wire.replace('{','{"sha256":"ignored",')])
  await assert.rejects(verifyInstallationReview(wire,observed,bundle,reference),/^Error: installation_review_unapproved$/);
});
test('immutable summaries exclude raw target, capture reference, registry names, ACLs and private operational metadata',()=>{
 assert.throws(()=>review.material.authority.installation=true,TypeError);
 assert.throws(()=>review.material.sourceReview.registeredSources.pop(),TypeError);
 assert.throws(()=>installationReviewSummary({...review}),/not_verified/);
 assert.doesNotMatch(JSON.stringify(installationReviewSummary(review)),/owned_admin|owned_review_test|127\.0\.0\.1|captureSha256|publicBuild|nameSha256|sourceSha256|roles|acl|wire|customer_membership/i);
 assert.equal(review.material.evidence.originalReadOnlyScopeExpanded,false);assert.equal(review.material.evidence.rawMetadataIncluded,false);
});
test('review module and CI have no secret, transport, filesystem mutation, deployment or implicit approval entry point',async()=>{
 const source=await readFile('scripts/member-checkout-installation-review.mjs','utf8');
 assert.doesNotMatch(source,/process\.env|child_process|fetch\(|\.query\(|writeFile\(|mkdir\(|spawn\(|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
 const workflow=await readFile('.github/workflows/member-checkout-real-auth.yml','utf8');
 assert.match(workflow,/member-checkout-installation-review\.test\.mjs/);
 assert.doesNotMatch(workflow,/workflow_dispatch:|secrets\.|environment:|ssh |scp /);
});
