// Adapter for the EXISTING owned-CI 047 package/seal. Does not promote them to
// production, change their six-source/receipt scope, connect or execute SQL.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {verifyCheckout047InstallationBundle,checkout047InstallationBundleSummary,
 observeCheckout047Installation,assertCheckout047InstallationTarget,checkout047InstallationSealSummary,verifyCheckout047InstallationSeal} from './member-checkout-047-installation.mjs';
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const contexts=new WeakSet();
function checkContext(context){assert.ok(contexts.has(context),'checkout_047_evidence_context_unverified');}
function bound(store,locatorWire,bundle,before){
 const data=store.read(locatorWire),source=checkout047InstallationBundleSummary(bundle);assertCheckout047InstallationTarget(before,before);
 assert.equal(before.data.core.context.readOnly,true);assert.equal(before.data.core.context.isolation,'repeatable read');
 const binding=data.locator.binding;assert.equal(binding.sourceBundleSha256,source.sha256);assert.equal(binding.targetSha256,before.targetSha256);
 assert.equal(binding.beforeSha256,before.sha256);assert.equal(binding.priorRegistrySha256,before.registrySha256);
 assert.ok(data.artifacts.source===bundle.wire,'checkout_047_evidence_source_changed');assert.ok(data.artifacts.baseline===canonical(before.data),'checkout_047_evidence_baseline_changed');
 const result=Object.freeze({store,locatorWire,bundle,before,data});contexts.add(result);return result;
}
export function beginCheckout047Evidence(store,bundle,before,operationId=randomUUID()){
 const source=checkout047InstallationBundleSummary(bundle);assertCheckout047InstallationTarget(before,before);
 assert.equal(before.data.core.context.readOnly,true);assert.equal(before.data.core.context.isolation,'repeatable read');
 const expected=bundle.material.prerequisites.registry.map(({version,name})=>({version,nameSha256:createHash('sha256').update(name).digest('hex')})).sort((a,b)=>a.version.localeCompare(b.version));
 // The source package is still CI-only. Preparing a file never changes that.
 assert.equal(expected.length,6);assert.equal(before.data.core.registry.count,6);
 assert.equal(before.sourceBundleSha256,source.sha256);assert.deepEqual(before.data.core.registry.entries,expected);
 const binding={version:1,kind:'checkout-installation-storage-binding-v1',operationId,sourceBundleSha256:source.sha256,
  targetSha256:before.targetSha256,beforeSha256:before.sha256,priorRegistrySha256:before.registrySha256};
 const locatorWire=store.begin({bindingWire:canonical(binding),sourceWire:bundle.wire,baselineWire:canonical(before.data)});
 return bound(store,locatorWire,bundle,before);
}
export function appendCheckout047Prepared(context,seal){
 checkContext(context);const summary=checkout047InstallationSealSummary(seal),{bundle,before,store}=context;
 assert.equal(context.data.locator.stage,'initial');assert.equal(summary.sourceBundleSha256,checkout047InstallationBundleSummary(bundle).sha256);
 assert.equal(summary.targetSha256,before.targetSha256);assert.equal(seal.material.beforeSha256,before.sha256);assert.equal(seal.material.priorRegistrySha256,before.registrySha256);
 return store.append(context.locatorWire,'prepared',seal.wire);
}
export async function reopenCheckout047Evidence(store,locatorWire){
 const data=store.read(locatorWire),bundle=await verifyCheckout047InstallationBundle(data.artifacts.source);
 const before=await observeCheckout047Installation(async()=>({rows:[{metadata:JSON.parse(data.artifacts.baseline)}]}),bundle);
 return bound(store,locatorWire,bundle,before);
}
export function confirmCheckout047Evidence(context,current){
 checkContext(context);const {before,bundle,store,data}=context;assert.ok(['prepared','confirmed'].includes(data.locator.stage));
 assertCheckout047InstallationTarget(before,current);
 assert.equal(current.data.core.context.readOnly,true);assert.equal(current.data.core.context.isolation,'repeatable read');
 assert.notEqual(current.data.core.context.backendPid,before.data.core.context.backendPid,'checkout_047_evidence_new_connection_required');
 const expectedSha256=JSON.parse(data.artifacts.prepared).sha256;
 const verified=verifyCheckout047InstallationSeal(data.artifacts.prepared,{expectedSha256,before,current,bundle});
 const summary=checkout047InstallationSealSummary(verified),material={version:1,kind:'checkout-047-owned-commit-confirmation-v1',operationId:data.locator.binding.operationId,
  sealSha256:summary.sha256,sourceBundleSha256:summary.sourceBundleSha256,targetSha256:summary.targetSha256,beforeSha256:before.sha256,
  priorRegistrySha256:before.registrySha256,currentMetadataSha256:current.sha256,currentRegistrySha256:current.registrySha256,catalogSha256:summary.catalogSha256,
  scope:'owned-ci-confirmed-original-not-production-authorization',productionAuthorized:false,deploymentReady:false};
 const wire=canonical(material);let locatorWire=context.locatorWire;
 if(data.locator.stage==='confirmed')assert.equal(data.artifacts.confirmation,wire,'checkout_047_evidence_confirmation_changed');
 else locatorWire=store.append(locatorWire,'confirmation',wire);
 return Object.freeze({locatorWire,sealSha256:summary.sha256,sourceBundleSha256:summary.sourceBundleSha256,alreadyConfirmed:data.locator.stage==='confirmed',
  databaseStatementsExecuted:0,productionAuthorized:false,deploymentReady:false});
}
