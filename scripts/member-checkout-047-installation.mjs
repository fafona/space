// Independent, UNAPPROVED 047 installation evidence. No connector, environment,
// production migration reservation, credential issuance or activation.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {loadInstallationPlan,installationBody} from './member-checkout-installation-plan.mjs';
import {createInstallationSourceBundle} from './member-checkout-installation-bundle.mjs';
import {loadCheckout047Compatibility} from './member-checkout-047-compatibility.mjs';
import {installationSealSql} from './member-checkout-installation-seal.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const bundles=new WeakSet(),observations=new WeakSet(),seals=new WeakSet();
export const source047RegistryVersion='999999990047',seal047RegistryVersion='999999990048'; // Synthetic CI ONLY.
const sourcePrefix='ci_only_checkout_047_bundle_',sealPrefix='ci_only_checkout_047_seal_v1:';
const sections=['roles','memberships','defaultAcls','schemas','relations','columns','constraints','indexes','functions','extensions'];
const entries=rows=>rows.map(({version,name})=>({version,nameSha256:sha(name)})).sort((a,b)=>a.version.localeCompare(b.version));

export async function createCheckout047InstallationBundle(){
 const plan=await loadInstallationPlan(),base=await createInstallationSourceBundle(),contract=await loadCheckout047Compatibility();
 assert.equal(base.digest,'8f4cb6b006d464c2f20ddad7cacc68f169f7a80885dae3749ad3abb934453f72');
 const revision=contract.revision,registry=[...plan.registry,{version:'202609080047',name:'redemption_checkout_context'}].sort((a,b)=>a.version.localeCompare(b.version));
 const functions=new Map(plan.prerequisites.functions.map(fn=>[fn.signature,fn]));
 const previous=functions.get('public.faolla_commit_redemption_v1(text,jsonb)');assert.ok(previous);
 functions.set('public.faolla_commit_redemption_internal_v1(text,jsonb)',{...previous,name:'faolla_commit_redemption_internal_v1',signature:'public.faolla_commit_redemption_internal_v1(text,jsonb)'});
 for(const fn of contract.legacy)functions.set(fn.signature,fn);
 const prerequisites={...plan.prerequisites,functions:[...functions.values()]};
 const steps=[...base.material.steps.map(step=>({id:step.file,...step})),
  {id:revision.material.adapter.file,file:revision.material.adapter.file,sourceSha256:revision.material.adapter.sha256,body:installationBody(revision.adapterSql),bodySha256:sha(installationBody(revision.adapterSql))},
  ...revision.patches.map(patch=>({id:'047-overlay:'+patch.function,file:patch.file,sourceSha256:plan.steps.find(step=>step.file===patch.file).sha256,
   originalFunctionSha256:patch.beforeSha256,bodySha256:patch.sha256,body:patch.sql}))];
 assert.equal(steps.length,38);assert.equal(new Set(steps.map(v=>v.id)).size,38);
 const material={version:1,kind:'member-checkout-047-independent-source-v1',scope:'owned-ci-only-not-production',
  application:plan.material.application,frozenBaseBundleSha256:base.digest,frozenBasePlanSha256:plan.digest,revisionSha256:revision.sha256,
  prerequisites:{sources:[...base.material.prerequisites.sources,revision.material.legacy],registry,
   protocolSha256:sha(canonical(prerequisites)),legacySourcesToExecute:0,newRolesMustBeAbsent:['faolla_checkout_executor','faolla_checkout_runtime']},
  installedContract:{protocolSha256:sha(canonical(contract.expected)),functions:93,tables:24,guards:28,
   entry:'public.faolla_checkout_runtime_v1(text,jsonb)',runtime:{name:'faolla_checkout_runtime',login:false,inherit:false,bypassRls:false,dispatcherOnly:true},
   executor:{name:'faolla_checkout_executor',login:false,inherit:false,bypassRls:true},roleMemberships:'none',unexpectedGrantees:'refuse-not-repair'},
  registration:{sourceVersion:source047RegistryVersion,sealVersion:seal047RegistryVersion,sourcePrefix,sealPrefix,productionReservation:false},
  transaction:{mode:'one-transaction',lockTimeoutMs:1000,statementTimeoutMs:15000,advisoryLock:[20261125,6064]},
  authority:{productionExecution:false,credentials:false,authenticatorGrant:false,pilotActivation:false,businessDataChanges:false,stripe:false,mail:false,backgroundWorkers:false},steps};
 assert.equal(contract.expected.functions.length,material.installedContract.functions);assert.equal(contract.expected.tables.length,material.installedContract.tables);assert.equal(contract.expected.triggers.length,material.installedContract.guards);
 const digest=sha(canonical(material)),wire=canonical({sha256:digest,material});assert.ok(Buffer.byteLength(wire)<=2*1024*1024);
 const result=freeze({digest,wire,material,contract,prerequisites,receipt:{version:source047RegistryVersion,name:sourcePrefix+digest}});bundles.add(result);return result;
}
export async function verifyCheckout047InstallationBundle(wire){
 try{assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)<=2*1024*1024);const value=JSON.parse(wire);
  assert.deepEqual(Object.keys(value).sort(),['material','sha256']);assert.equal(canonical(value),wire);assert.equal(value.sha256,sha(canonical(value.material)));
  const expected=await createCheckout047InstallationBundle();assert.equal(wire,expected.wire);return expected;
 }catch{throw Error('checkout_047_installation_bundle_unapproved');}
}
export function checkout047InstallationBundleSummary(bundle){
 assert.ok(bundles.has(bundle),'checkout_047_installation_bundle_unverified');
 return {sha256:bundle.digest,baseBundleSha256:bundle.material.frozenBaseBundleSha256,revisionSha256:bundle.material.revisionSha256,
  application:bundle.material.application,steps:bundle.material.steps.length,legacySources:bundle.material.prerequisites.sources.length,
  functions:bundle.material.installedContract.functions,tables:bundle.material.installedContract.tables,guards:bundle.material.installedContract.guards,
  productionAuthorized:false,deploymentReady:false};
}

// Extend BOTH relation selections in the unchanged old metadata SELECT. The
// new query/seal has its own digest; never label its response as the old query.
const originalRelations="('pages','faolla_schema_migrations','faolla_booking_atomic_control','faolla_booking_atomic_commands')";
assert.equal(installationSealSql.split(originalRelations).length,3,'checkout_047_seal_query_boundary_changed');
export const checkout047InstallationSealSql=installationSealSql.replaceAll(originalRelations,
 "('pages','faolla_schema_migrations','faolla_booking_atomic_control','faolla_booking_atomic_commands','faolla_redemption_operations','faolla_redemption_checkouts')");
export async function observeCheckout047Installation(query,bundle){
 try{
  checkout047InstallationBundleSummary(bundle);const result=await query(checkout047InstallationSealSql);assert.equal(result.rows.length,1);
  const wire=canonical(result.rows[0].metadata);assert.ok(Buffer.byteLength(wire)<=3*1024*1024);const data=JSON.parse(wire);
  assert.deepEqual(Object.keys(data).sort(),['core','policies','triggers']);
  const core=data.core;assert.deepEqual(Object.keys(core).sort(),['context','target','registry',...sections].sort());
  assert.equal(core.context.searchPath.replace(/\s/g,''),'pg_catalog,public');assert.equal(typeof core.context.readOnly,'boolean');
  assert.ok(Number.isInteger(core.context.backendPid)&&core.context.backendPid>0);assert.ok(['read committed','repeatable read','serializable'].includes(core.context.isolation));
  const target=core.target;assert.match(target.clusterSha256,/^[a-f0-9]{64}$/);assert.match(target.databaseOid,/^[1-9][0-9]*$/);assert.match(target.serverVersion,/^1[5-7][0-9]{4}$/);
  assert.ok([target.databaseName,target.databaseOwner,target.sessionUser,target.currentRole].every(v=>typeof v==='string'&&v.length>0&&v.length<=63));
  assert.equal(target.actor.rolname,target.currentRole);assert.match(target.actor.oid,/^[1-9][0-9]*$/);assert.equal(typeof target.actor.rolsuper,'boolean');
  assert.ok(Number.isSafeInteger(core.registry.count)&&core.registry.count>=0&&core.registry.count<=1000);assert.equal(core.registry.entries.length,core.registry.count);
  assert.equal(new Set(core.registry.entries.map(v=>v.version)).size,core.registry.count);
  for(const row of core.registry.entries){assert.deepEqual(Object.keys(row).sort(),['nameSha256','version']);assert.match(row.version,/^[0-9]{12,14}$/);assert.match(row.nameSha256,/^[a-f0-9]{64}$/);}
  for(const key of sections)assert.ok(Array.isArray(core[key])&&core[key].length<=5000&&core[key].every(v=>v&&typeof v==='object'&&!Array.isArray(v)));
  for(const key of ['triggers','policies'])assert.ok(Array.isArray(data[key])&&data[key].length<=5000&&data[key].every(v=>v&&typeof v==='object'&&!Array.isArray(v)));
  const catalog={...Object.fromEntries(sections.map(k=>[k,core[k]])),triggers:data.triggers,policies:data.policies};
  const material={sourceBundleSha256:bundle.digest,querySha256:sha(checkout047InstallationSealSql),target,registry:core.registry,catalog};
  const value=freeze({data,sourceBundleSha256:bundle.digest,querySha256:material.querySha256,targetSha256:sha(canonical(target)),
   registrySha256:sha(canonical(core.registry)),catalogSha256:sha(canonical(catalog)),sha256:sha(canonical(material))});observations.add(value);return value;
 }catch(error){const code=/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:'CHECKOUT_047_OBSERVATION_INVALID';throw Object.assign(Error('checkout_047_observation_unavailable'),{code});}
}
export function assertCheckout047InstallationTarget(before,current){
 assert.ok(observations.has(before)&&observations.has(current),'checkout_047_installation_not_observed');
 assert.equal(current.sourceBundleSha256,before.sourceBundleSha256,'checkout_047_installation_source_changed');
 assert.equal(current.targetSha256,before.targetSha256,'checkout_047_installation_target_changed');
}
export function assertCheckout047InstallationObservation(before,current){
 assertCheckout047InstallationTarget(before,current);assert.equal(current.sha256,before.sha256,'checkout_047_installation_metadata_changed');
}
function sealMaterial(before,current,bundle,attemptId){
 const source=checkout047InstallationBundleSummary(bundle);assertCheckout047InstallationTarget(before,current);assert.equal(source.sha256,before.sourceBundleSha256);
 assert.deepEqual(before.data.core.registry.entries,entries(bundle.material.prerequisites.registry),'checkout_047_installation_not_six_source_baseline');
 assert.match(attemptId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 return {version:1,scope:'owned-ci-047-prepared-result-not-installation-authority',attemptId,sourceBundleSha256:source.sha256,
  frozenBaseBundleSha256:source.baseBundleSha256,revisionSha256:source.revisionSha256,querySha256:sha(checkout047InstallationSealSql),
  beforeSha256:before.sha256,priorRegistrySha256:before.registrySha256,targetSha256:current.targetSha256,catalogSha256:current.catalogSha256,productionAuthorized:false};
}
export function prepareCheckout047InstallationSeal(before,after,bundle){
 assert.ok(observations.has(before)&&observations.has(after),'checkout_047_installation_not_observed');
 assert.deepEqual(after.data.core.registry,before.data.core.registry,'checkout_047_installation_registry_changed_before_prepare');
 const material=sealMaterial(before,after,bundle,randomUUID()),digest=sha(canonical(material));
 const value=freeze({digest,wire:canonical({sha256:digest,material}),material});seals.add(value);return value;
}
export function checkout047SealRegistryName(digest){assert.match(digest,/^[a-f0-9]{64}$/);return sealPrefix+digest;}
export function checkout047SealRegistryDigest(name){assert.equal(typeof name,'string');assert.ok(name.startsWith(sealPrefix));const digest=name.slice(sealPrefix.length);assert.match(digest,/^[a-f0-9]{64}$/);return digest;}
export function verifyCheckout047InstallationSeal(wire,{expectedSha256,before,current,bundle}){
 try{
  assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)<=65536);assert.match(expectedSha256,/^[a-f0-9]{64}$/);const value=JSON.parse(wire);
  assert.deepEqual(Object.keys(value).sort(),['material','sha256']);assert.equal(canonical(value),wire);assert.equal(value.sha256,expectedSha256);assert.equal(sha(canonical(value.material)),expectedSha256);
  assert.deepEqual(value.material,JSON.parse(canonical(sealMaterial(before,current,bundle,value.material.attemptId))));
  const expectedRegistry=entries([...bundle.material.prerequisites.registry,bundle.receipt,{version:seal047RegistryVersion,name:checkout047SealRegistryName(expectedSha256)}]);
  assert.deepEqual(current.data.core.registry.entries,expectedRegistry);assert.equal(current.data.core.registry.count,expectedRegistry.length);
  const result=freeze({digest:expectedSha256,wire,material:value.material});seals.add(result);return result;
 }catch{throw Error('checkout_047_installation_seal_unconfirmed');}
}
export function checkout047InstallationSealSummary(seal){
 assert.ok(seals.has(seal),'checkout_047_installation_seal_not_prepared');
 return {sha256:seal.digest,sourceBundleSha256:seal.material.sourceBundleSha256,revisionSha256:seal.material.revisionSha256,
  targetSha256:seal.material.targetSha256,catalogSha256:seal.material.catalogSha256,productionAuthorized:false,deploymentReady:false};
}
