// CI-only native-file worker. Never a production installation process.
import assert from 'node:assert/strict';
import {assertIsolatedCi} from '../member-checkout-real-auth-support.mjs';
const owned=assertIsolatedCi();assert.equal(owned.profileName,'current-auth');
assert.equal(process.env.FAOLLA_CHECKOUT_FULL_REGISTRY_EVIDENCE_ACCEPTANCE,'1');
assert.ok(process.send,'owned_worker_ipc_required');
// Guard above precedes request parsing and all owned filesystem access.
try{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {createHash}=await import('node:crypto');
 const requestWire=process.argv[2];assert.equal(typeof requestWire,'string');assert.ok(Buffer.byteLength(requestWire)<=262144);
 const request=JSON.parse(requestWire),{roots,operationId,action,stage,hold}=request;
 assert.ok(['prepare','reconcile'].includes(action));assert.equal(typeof hold,'boolean');
 assert.match(operationId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(path.dirname(roots.dataRoot),path.dirname(roots.locatorRoot));assert.equal(path.basename(roots.dataRoot),'data');assert.equal(path.basename(roots.locatorRoot),'locators');
 const parent=path.dirname(roots.dataRoot);assert.equal(fs.realpathSync(parent),parent);
 assert.equal(path.dirname(parent),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(parent).startsWith('faolla-checkout-evidence-test-full-registry-'));
 const st=fs.lstatSync(parent);assert.equal(st.uid,process.getuid());assert.equal(st.mode&0o7777,0o700);
 const {ownedFullRegistryEvidenceFixture}=await import('./member-checkout-full-registry-evidence-fixture.mjs');
 const fixture=await ownedFullRegistryEvidenceFixture(),{sourceDraft,bundle,before,after}=fixture;
 const {openCheckoutEvidenceStorage}=await import('../member-checkout-evidence-storage.mjs');
 const {prepareCheckoutFullRegistryResult,checkoutFullRegistryOwnedReceipts}=await import('../member-checkout-full-registry-result.mjs');
 const {beginCheckoutFullRegistryEvidence,appendCheckoutFullRegistryPrepared,reopenCheckoutFullRegistryEvidence,confirmCheckoutFullRegistryEvidence}=await import('../member-checkout-full-registry-evidence.mjs');
 const store=openCheckoutEvidenceStorage(roots);let result;
 try{
  if(action==='prepare'){
   const ctx=beginCheckoutFullRegistryEvidence(store,{sourceDraft,bundle,before,operationId});
   const prepared=prepareCheckoutFullRegistryResult({sourceDraft,bundle,before,after,operationId});
   const locatorWire=appendCheckoutFullRegistryPrepared(ctx,prepared);
   result={operationId,preparedSha256:prepared.digest,locatorSha256:createHash('sha256').update(locatorWire).digest('hex'),receipts:checkoutFullRegistryOwnedReceipts(prepared),stage:'prepared'};
  }else{
   assert.ok(['prepared','confirmed'].includes(stage));
   const locatorWire=store.locate(operationId,stage),ctx=await reopenCheckoutFullRegistryEvidence(store,locatorWire,{sourceDraft,bundle});
   const current=await fixture.observe(request.currentRaw),decision=confirmCheckoutFullRegistryEvidence(ctx,current);
   result={operationId,status:decision.status,preparedSha256:decision.preparedSha256,alreadyConfirmed:decision.alreadyConfirmed,confirmationAppended:decision.confirmationAppended,
    locatorSha256:createHash('sha256').update(decision.locatorWire).digest('hex'),databaseStatementsExecuted:decision.databaseStatementsExecuted,ddlReplayAllowed:decision.ddlReplayAllowed};
  }
 }finally{store.close();}
 process.send({kind:'owned-full-registry-file-worker-complete',result});
 if(hold)setInterval(()=>{},1000);else process.disconnect();
}catch{
 process.send({kind:'owned-full-registry-file-worker-refused'});process.exitCode=1;process.disconnect();
}
