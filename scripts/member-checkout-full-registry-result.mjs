// Local/owned rehearsal protocol only. No connector, SQL execution, filesystem
// persistence, source approval or migration reservation is provided here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkoutProductionSourceDraftSummary} from './member-checkout-production-source-draft.mjs';
import {checkout047InstallationBundleSummary,assertCheckout047InstallationTarget} from './member-checkout-047-installation.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const hash=value=>{assert.equal(typeof value,'string');assert.match(value,/^[a-f0-9]{64}$/);return value;};
const uuid=value=>{assert.equal(typeof value,'string');assert.match(value,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);return value;};
const sourceVersion='999999990049',resultVersion='999999990050'; // Synthetic OWNED tests, never formal versions.
const preparedResults=new WeakSet(),reconciledResults=new WeakSet();

function baseline(sourceDraft,bundle,before){
 const source=checkoutProductionSourceDraftSummary(sourceDraft),sql=checkout047InstallationBundleSummary(bundle),m=sourceDraft.material;
 // Saved production facts alone may not mint installation/result evidence.
 assert.equal(source.referenceKind,'owned-synthetic-evidence');
 assertCheckout047InstallationTarget(before,before);
 assert.equal(m.status,'draft-unapproved-not-executable');assert.ok(Object.values(m.authority).every(v=>v===false));
 assert.equal(m.registration.status,'unreserved');assert.equal(m.registration.sourceVersion,null);assert.equal(m.registration.sealVersion,null);
 assert.equal(sql.sha256,m.sources.independent047BundleSha256);assert.equal(before.sourceBundleSha256,sql.sha256);
 assert.equal(before.targetSha256,m.baseline.targetSha256);assert.equal(before.registrySha256,m.baseline.registrySha256);assert.equal(before.catalogSha256,m.baseline.catalogSha256);
 assert.equal(before.data.core.context.readOnly,true);assert.equal(before.data.core.context.isolation,'repeatable read');
 assert.equal(before.data.core.registry.count,214);assert.deepEqual(before.data.core.registry,m.baseline.registry);
 assert.ok(before.data.core.registry.entries.every(v=>!/^99999999/.test(v.version)));
 return {sourceDraftSha256:source.sha256,sourceBundleSha256:sql.sha256,candidateRevisionSha256:m.sources.candidateRevisionSha256,
  installedContractSha256:m.installedContractReference.protocolSha256,preinstallQuerySha256:m.evidence.querySha256,querySha256:before.querySha256,
  targetSha256:before.targetSha256,beforeSha256:before.sha256,priorRegistrySha256:before.registrySha256};
}
function material(binding,operationId,afterCatalogSha256,preparedBackendPid){
 assert.ok(Number.isSafeInteger(preparedBackendPid)&&preparedBackendPid>0);
 return {version:1,kind:'checkout-full-registry-owned-prepared-result-v1',scope:'owned-reconciliation-protocol-not-installation-proof',
  operationId:uuid(operationId),...binding,afterCatalogSha256:hash(afterCatalogSha256),preparedBackendPid,
  registration:{sourceVersion,resultVersion,productionReservation:false},priorRegistryCount:214,expectedCommittedRegistryCount:216,
  installedPrivilegesValidated:false,persistentEvidenceValidated:false,productionAuthorized:false,deploymentReady:false};
}
function receipts(prepared){
 return [{version:sourceVersion,name:'ci_only_checkout_full_registry_source_v1:'+prepared.material.sourceDraftSha256},
  {version:resultVersion,name:'ci_only_checkout_full_registry_prepared_v1:'+prepared.digest}];
}
function registryRows(rows){return rows.map(({version,name})=>({version,nameSha256:sha(name)}));}
const safe=fn=>{try{return fn();}catch{throw Error('checkout_full_registry_result_refused');}};

/** The caller must persist and independently retain this exact wire/digest
 * BEFORE committing both receipts. This component does not provide that store,
 * execute the 38 migrations or attest their installed privileges. */
export function prepareCheckoutFullRegistryResult({sourceDraft,bundle,before,after,operationId}){
 return safe(()=>{
  const binding=baseline(sourceDraft,bundle,before);assertCheckout047InstallationTarget(before,after);
  assert.equal(after.querySha256,before.querySha256);assert.deepEqual(after.data.core.registry,before.data.core.registry);
  assert.equal(after.data.core.context.readOnly,false);assert.ok(['repeatable read','serializable'].includes(after.data.core.context.isolation));
  assert.notEqual(after.catalogSha256,before.catalogSha256);
  const m=material(binding,operationId,after.catalogSha256,after.data.core.context.backendPid),digest=sha(canonical(m));
  const result=freeze({material:m,digest,wire:canonical({material:m,sha256:digest})});preparedResults.add(result);return result;
 });
}

export function checkoutFullRegistryOwnedReceipts(prepared){
 return safe(()=>{assert.ok(preparedResults.has(prepared));return freeze(receipts(prepared));});
}

/** Read-only decision after an unknown COMMIT. expectedSha256 and operationId
 * must come from independently retained evidence, NOT current database rows.
 * Even 'not-committed-original' never authorizes automatic installation replay. */
export function reconcileCheckoutFullRegistryResult({sourceDraft,bundle,before,current,preparedWire,expectedSha256,operationId}){
 return safe(()=>{
  const binding=baseline(sourceDraft,bundle,before);hash(expectedSha256);uuid(operationId);
  assert.equal(typeof preparedWire,'string');assert.ok(Buffer.byteLength(preparedWire)>0&&Buffer.byteLength(preparedWire)<=65536);
  const v=JSON.parse(preparedWire);assert.deepEqual(Object.keys(v).sort(),['material','sha256']);
  assert.equal(canonical(v),preparedWire);assert.equal(v.sha256,expectedSha256);assert.equal(sha(canonical(v.material)),expectedSha256);
  assert.deepEqual(v.material,material(binding,operationId,v.material.afterCatalogSha256,v.material.preparedBackendPid));
  assert.notEqual(v.material.afterCatalogSha256,before.catalogSha256);
  assertCheckout047InstallationTarget(before,current);assert.equal(current.querySha256,before.querySha256);
  const context=current.data.core.context;assert.equal(context.readOnly,true);assert.equal(context.isolation,'repeatable read');
  assert.notEqual(context.backendPid,before.data.core.context.backendPid);assert.notEqual(context.backendPid,v.material.preparedBackendPid);
  const prepared={material:v.material,digest:expectedSha256};
  const expected={count:216,entries:[...before.data.core.registry.entries,...registryRows(receipts(prepared))].sort((a,b)=>a.version.localeCompare(b.version))};
  let status;
  if(current.data.core.registry.count===214){
   assert.deepEqual(current.data.core.registry,before.data.core.registry);assert.equal(current.sha256,before.sha256);
   status='not-committed-original';
  }else{
   assert.deepEqual(current.data.core.registry,expected);assert.equal(current.catalogSha256,v.material.afterCatalogSha256);
   status='committed-original';
  }
  const result=freeze({version:1,kind:'checkout-full-registry-owned-reconciliation-v1',status,operationId,
   preparedSha256:expectedSha256,...binding,currentMetadataSha256:current.sha256,currentRegistrySha256:current.registrySha256,
   afterCatalogSha256:v.material.afterCatalogSha256,registryCount:current.data.core.registry.count,
   databaseStatementsExecuted:0,ddlReplayAllowed:false,receiptRepairAllowed:false,evidenceRegenerationAllowed:false,
   installedPrivilegesValidated:false,persistentEvidenceValidated:false,productionAuthorized:false,deploymentReady:false});
  reconciledResults.add(result);return result;
 });
}

export function checkoutFullRegistryResultSummary(result){
 return safe(()=>{assert.ok(reconciledResults.has(result));return freeze({status:result.status,registryCount:result.registryCount,
  sourceDraftSha256:result.sourceDraftSha256,preparedSha256:result.preparedSha256,ddlReplayAllowed:false,receiptRepairAllowed:false,
  evidenceRegenerationAllowed:false,installedPrivilegesValidated:false,persistentEvidenceValidated:false,productionAuthorized:false,deploymentReady:false});});
}
