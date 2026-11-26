// Independent owned-only adapter over the unchanged Linux storage primitive.
// No connector, DDL, production grant, source promotion or filesystem repair.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {checkoutProductionSourceDraftSummary} from './member-checkout-production-source-draft.mjs';
import {observeCheckout047Installation} from './member-checkout-047-installation.mjs';
import {checkoutFullRegistryBaselineBinding,checkoutFullRegistryOwnedReceipts,verifyCheckoutFullRegistryPrepared,
 reconcileCheckoutFullRegistryResult,checkoutFullRegistryResultSummary} from './member-checkout-full-registry-result.mjs';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const contexts=new WeakSet();
const safe=fn=>{try{return fn();}catch{throw Error('checkout_full_registry_evidence_refused');}};
function sourceCheck(sourceDraft){assert.equal(checkoutProductionSourceDraftSummary(sourceDraft).referenceKind,'owned-synthetic-evidence');}
function binding(sourceDraft,bundle,before,operationId){
 const b=checkoutFullRegistryBaselineBinding({sourceDraft,bundle,before});
 // Bind the COMPLETE source draft, not just the older 38-step CI SQL bundle.
 return {version:1,kind:'checkout-installation-storage-binding-v1',operationId,sourceBundleSha256:b.sourceDraftSha256,
  targetSha256:b.targetSha256,beforeSha256:b.beforeSha256,priorRegistrySha256:b.priorRegistrySha256};
}
function bound(store,locatorWire,sourceDraft,bundle,before){
 sourceCheck(sourceDraft);const data=store.read(locatorWire),expected=binding(sourceDraft,bundle,before,data.locator.binding.operationId);
 assert.equal(canonical(data.locator.binding),canonical(expected));assert.equal(data.artifacts.source,sourceDraft.wire);
 assert.equal(data.artifacts.baseline,canonical(before.data));assert.ok(['initial','prepared','confirmed'].includes(data.locator.stage));
 let prepared;
 if(data.locator.stage!=='initial'){
  // This digest comes from the protected file verified by the independently
  // retained locator chain, NEVER from database receipt text or an error reply.
  const preparedWire=data.artifacts.prepared;assert.equal(typeof preparedWire,'string');
  const entry=data.locator.artifacts.find(v=>v.kind==='prepared');assert.ok(entry);assert.equal(entry.sha256,sha(preparedWire));assert.equal(entry.bytes,Buffer.byteLength(preparedWire));
  prepared=verifyCheckoutFullRegistryPrepared({sourceDraft,bundle,before,operationId:expected.operationId,preparedWire,expectedSha256:JSON.parse(preparedWire).sha256});
 }
 const result=Object.freeze({store,locatorWire,sourceDraft,bundle,before,data,prepared});contexts.add(result);return result;
}
export function beginCheckoutFullRegistryEvidence(store,{sourceDraft,bundle,before,operationId=randomUUID()}){
 return safe(()=>{
  sourceCheck(sourceDraft);const b=binding(sourceDraft,bundle,before,operationId);
  assert.match(operationId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const locatorWire=store.begin({bindingWire:canonical(b),sourceWire:sourceDraft.wire,baselineWire:canonical(before.data)});
  return bound(store,locatorWire,sourceDraft,bundle,before);
 });
}
export function appendCheckoutFullRegistryPrepared(context,prepared){
 return safe(()=>{
  assert.ok(contexts.has(context));checkoutFullRegistryOwnedReceipts(prepared);
  const {sourceDraft,bundle,before,store}=context,data=bound(store,context.locatorWire,sourceDraft,bundle,before).data;
  assert.equal(data.locator.stage,'initial');
  verifyCheckoutFullRegistryPrepared({sourceDraft,bundle,before,operationId:data.locator.binding.operationId,preparedWire:prepared.wire,expectedSha256:prepared.digest});
  return store.append(context.locatorWire,'prepared',prepared.wire);
 });
}
export async function reopenCheckoutFullRegistryEvidence(store,locatorWire,{sourceDraft,bundle}){
 try{
  sourceCheck(sourceDraft);const data=store.read(locatorWire);assert.equal(data.artifacts.source,sourceDraft.wire);
  const before=await observeCheckout047Installation(async()=>({rows:[{metadata:JSON.parse(data.artifacts.baseline)}]}),bundle);
  return bound(store,locatorWire,sourceDraft,bundle,before);
 }catch{throw Error('checkout_full_registry_evidence_refused');}
}
export function confirmCheckoutFullRegistryEvidence(context,current){
 return safe(()=>{
  assert.ok(contexts.has(context));const {sourceDraft,bundle,before,store}=context;
  // Re-read the independent chain even for an idempotent confirmation. A
  // cached context is not permission to ignore subsequently missing files.
  const {data,prepared}=bound(store,context.locatorWire,sourceDraft,bundle,before);
  assert.ok(['prepared','confirmed'].includes(data.locator.stage));assert.ok(prepared);
  const decision=reconcileCheckoutFullRegistryResult({sourceDraft,bundle,before,current,operationId:data.locator.binding.operationId,
   preparedWire:prepared.wire,expectedSha256:prepared.digest}),summary=checkoutFullRegistryResultSummary(decision);
  const alreadyConfirmed=data.locator.stage==='confirmed';let locatorWire=context.locatorWire;
  if(summary.status==='committed-original'){
   const wire=canonical({version:1,kind:'checkout-full-registry-owned-confirmation-v1',decision});
   if(alreadyConfirmed)assert.equal(data.artifacts.confirmation,wire);
   else locatorWire=store.append(locatorWire,'confirmation',wire);
  }else assert.equal(alreadyConfirmed,false,'checkout_original_confirmed_state_changed');
  return Object.freeze({status:summary.status,locatorWire,preparedSha256:prepared.digest,sourceDraftSha256:summary.sourceDraftSha256,
   alreadyConfirmed,confirmationAppended:summary.status==='committed-original'&&!alreadyConfirmed,
   databaseStatementsExecuted:0,ddlReplayAllowed:false,evidenceRegenerationAllowed:false,persistentProductionEvidenceValidated:false,
   productionAuthorized:false,deploymentReady:false});
 });
}
