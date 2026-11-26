import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ownedFullRegistryEvidenceFixture} from './fixtures/member-checkout-full-registry-evidence-fixture.mjs';
import {createCheckoutProductionSourceDraft} from './member-checkout-production-source-draft.mjs';
import {prepareCheckoutFullRegistryResult,verifyCheckoutFullRegistryPrepared,checkoutFullRegistryBaselineBinding} from './member-checkout-full-registry-result.mjs';
import {beginCheckoutFullRegistryEvidence,appendCheckoutFullRegistryPrepared,reopenCheckoutFullRegistryEvidence,confirmCheckoutFullRegistryEvidence} from './member-checkout-full-registry-evidence.mjs';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const fixture=await ownedFullRegistryEvidenceFixture(),{sourceDraft,bundle,before,after}=fixture,base={sourceDraft,bundle,before};
const refuses=fn=>assert.throws(fn,e=>e.message==='checkout_full_registry_evidence_refused'&&Object.keys(e).length===0);
// Explicit memory double tests adapter decisions ONLY, not Linux persistence.
function memory(){
 const saved=new Map();let writes=0;
 return {get writes(){return writes;},
  begin({bindingWire,sourceWire,baselineWire}){
   const artifacts={source:sourceWire,baseline:baselineWire},locator={stage:'initial',binding:JSON.parse(bindingWire),artifacts:Object.entries(artifacts).map(([kind,body])=>({kind,sha256:sha(body),bytes:Buffer.byteLength(body)}))};
   const wire=canonical(locator);assert.ok(!saved.has(wire));saved.set(wire,{locator,artifacts});writes++;return wire;
  },
  append(previous,kind,body){
   const old=this.read(previous);assert.equal(kind,old.locator.stage==='initial'?'prepared':old.locator.stage==='prepared'?'confirmation':null);
   const locator={...old.locator,stage:kind==='prepared'?'prepared':'confirmed',artifacts:[...old.locator.artifacts,{kind,sha256:sha(body),bytes:Buffer.byteLength(body)}]},wire=canonical(locator);
   assert.ok(!saved.has(wire));saved.set(wire,{locator,artifacts:{...old.artifacts,[kind]:body}});writes++;return wire;
  },
  read(wire){assert.ok(saved.has(wire));return structuredClone(saved.get(wire));},
  corrupt(wire,change){change(saved.get(wire));}
 };
}
async function setup(){
 const store=memory(),operationId=randomUUID(),context=beginCheckoutFullRegistryEvidence(store,{...base,operationId});
 const prepared=prepareCheckoutFullRegistryResult({...base,after,operationId}),locator=appendCheckoutFullRegistryPrepared(context,prepared);
 return {store,operationId,context,prepared,locator,reopened:await reopenCheckoutFullRegistryEvidence(store,locator,{sourceDraft,bundle})};
}
test('full source and all 214 prior registrations are bound before the first storage write',()=>{
 const store=memory(),ctx=beginCheckoutFullRegistryEvidence(store,base);assert.equal(store.writes,1);assert.equal(ctx.data.artifacts.source,sourceDraft.wire);
 assert.equal(ctx.data.locator.binding.sourceBundleSha256,sourceDraft.digest);assert.notEqual(sourceDraft.digest,bundle.digest);
 assert.equal(ctx.before.data.core.registry.count,214);assert.equal(checkoutFullRegistryBaselineBinding(base).beforeSha256,before.sha256);
 assert.throws(()=>checkoutFullRegistryBaselineBinding({...base,before:{...before}}),/result_refused/);
});
test('invalid baseline/source/operation cannot touch an injected store',async()=>{
 let touched=false;const never=new Proxy({},{get(){touched=true;throw Error('store_touched_before_validation');}});
 for(const change of [{before:{...before}},{sourceDraft:{...sourceDraft}},{operationId:'../wrong'},{operationId:null}]){refuses(()=>beginCheckoutFullRegistryEvidence(never,{...base,...change}));assert.equal(touched,false);}
 const production=await createCheckoutProductionSourceDraft({...fixture.input,references:{...fixture.input.references,kind:'saved-production-evidence'}});
 const store=memory();refuses(()=>beginCheckoutFullRegistryEvidence(store,{...base,sourceDraft:production}));assert.equal(store.writes,0);
});
test('prepared bytes are source/operation bound, immutable and reconstructed through a separate read-only verifier',async()=>{
 const {store,context,prepared,locator,operationId}=await setup();assert.equal(store.writes,2);
 assert.equal(verifyCheckoutFullRegistryPrepared({...base,operationId,preparedWire:prepared.wire,expectedSha256:prepared.digest}).wire,prepared.wire);
 const count=store.writes;refuses(()=>appendCheckoutFullRegistryPrepared({...context},prepared));refuses(()=>appendCheckoutFullRegistryPrepared(context,{...prepared}));
 const other=prepareCheckoutFullRegistryResult({...base,after,operationId:randomUUID()});refuses(()=>appendCheckoutFullRegistryPrepared(context,other));assert.equal(store.writes,count);
 assert.equal(store.read(locator).artifacts.prepared,prepared.wire);
});
test('reopening uses independently supplied verified source plus saved complete baseline, with zero SQL or hidden source discovery',async()=>{
 const {store,locator}=await setup(),ctx=await reopenCheckoutFullRegistryEvidence(store,locator,{sourceDraft,bundle});
 assert.equal(ctx.before.sha256,before.sha256);assert.equal(ctx.sourceDraft.digest,sourceDraft.digest);assert.equal(ctx.prepared.material.priorRegistryCount,214);
 const count=store.writes;await assert.rejects(reopenCheckoutFullRegistryEvidence(store,locator,{sourceDraft:{...sourceDraft},bundle}),/evidence_refused/);assert.equal(store.writes,count);
});
test('missing or altered source, baseline, prepared bytes and locator commitment refuse without regenerating anything',async()=>{
 for(const change of [v=>v.artifacts.source+=' ',v=>v.artifacts.baseline='{}',v=>delete v.artifacts.prepared,v=>v.artifacts.prepared+=' ',v=>v.locator.artifacts.find(a=>a.kind==='prepared').sha256='0'.repeat(64),v=>v.locator.binding.beforeSha256='0'.repeat(64),v=>v.locator.binding.sourceBundleSha256=bundle.digest]){
  const {store,locator}=await setup();store.corrupt(locator,change);const count=store.writes;
  await assert.rejects(reopenCheckoutFullRegistryEvidence(store,locator,{sourceDraft,bundle}),e=>e.message==='checkout_full_registry_evidence_refused'&&Object.keys(e).length===0);assert.equal(store.writes,count);
 }
});
test('uncommitted original is reported without confirming, rewriting evidence or authorizing a retry',async()=>{
 const {store,prepared,reopened,locator}=await setup(),count=store.writes,current=await fixture.observe(fixture.currentRaw(prepared,false));
 const r=confirmCheckoutFullRegistryEvidence(reopened,current);assert.equal(r.status,'not-committed-original');assert.equal(r.locatorWire,locator);
 assert.equal(r.confirmationAppended,false);assert.equal(r.ddlReplayAllowed,false);assert.equal(store.writes,count);assert.equal(r.databaseStatementsExecuted,0);
});
test('committed original appends confirmation once, reopens and confirms idempotently without another storage write',async()=>{
 const {store,prepared,reopened}=await setup(),current=await fixture.observe(fixture.currentRaw(prepared)),first=confirmCheckoutFullRegistryEvidence(reopened,current);
 assert.equal(first.status,'committed-original');assert.equal(first.confirmationAppended,true);assert.equal(first.alreadyConfirmed,false);assert.equal(store.writes,3);
 const next=await reopenCheckoutFullRegistryEvidence(store,first.locatorWire,{sourceDraft,bundle}),count=store.writes;
 const second=confirmCheckoutFullRegistryEvidence(next,await fixture.observe(fixture.currentRaw(prepared,true,103)));
 assert.equal(second.alreadyConfirmed,true);assert.equal(second.confirmationAppended,false);assert.equal(second.locatorWire,first.locatorWire);assert.equal(store.writes,count);
 for(const key of ['productionAuthorized','deploymentReady','persistentProductionEvidenceValidated','ddlReplayAllowed','evidenceRegenerationAllowed'])assert.equal(second[key],false);
});
test('previously confirmed evidence cannot silently accept a database restored to the old state or a changed confirmation',async()=>{
 const {store,prepared,reopened}=await setup(),first=confirmCheckoutFullRegistryEvidence(reopened,await fixture.observe(fixture.currentRaw(prepared)));
 let ctx=await reopenCheckoutFullRegistryEvidence(store,first.locatorWire,{sourceDraft,bundle});const count=store.writes;
 refuses(()=>confirmCheckoutFullRegistryEvidence(ctx,before));refuses(()=>confirmCheckoutFullRegistryEvidence(ctx,fixture.currentRaw(prepared,false)));
 const old=await fixture.observe(fixture.currentRaw(prepared,false,104));refuses(()=>confirmCheckoutFullRegistryEvidence(ctx,old));
 store.corrupt(first.locatorWire,v=>v.artifacts.confirmation='{}');ctx=await reopenCheckoutFullRegistryEvidence(store,first.locatorWire,{sourceDraft,bundle});
 refuses(()=>confirmCheckoutFullRegistryEvidence(ctx,awaitedUnobserved()));assert.equal(store.writes,count);
 function awaitedUnobserved(){return {data:{}};}
 const current=await fixture.observe(fixture.currentRaw(prepared,true,104));refuses(()=>confirmCheckoutFullRegistryEvidence(ctx,current));assert.equal(store.writes,count);
});
test('same connection, writable snapshot, partial pair, changed target/catalogue refuse before a confirmation write',async()=>{
 const {store,prepared,reopened}=await setup(),count=store.writes;
 for(const change of [r=>r.core.context.backendPid=101,r=>r.core.context.readOnly=false,r=>{r.core.registry.entries.pop();r.core.registry.count--;},r=>r.core.target.databaseOid='98765',r=>r.core.schemas.push({name:'unexpected'})]){
  const raw=fixture.currentRaw(prepared);change(raw);const current=await fixture.observe(raw);refuses(()=>confirmCheckoutFullRegistryEvidence(reopened,current));assert.equal(store.writes,count);
 }
 refuses(()=>confirmCheckoutFullRegistryEvidence({...reopened},before));refuses(()=>confirmCheckoutFullRegistryEvidence(beginCheckoutFullRegistryEvidence(memory(),base),before));
});
test('a cached prepared or confirmed context cannot hide evidence disappearing after it was reopened',async()=>{
 for(const confirmed of [false,true]){
  const {store,prepared,locator,reopened}=await setup(),current=await fixture.observe(fixture.currentRaw(prepared));
  let ctx=reopened,wire=locator;
  if(confirmed){wire=confirmCheckoutFullRegistryEvidence(ctx,current).locatorWire;ctx=await reopenCheckoutFullRegistryEvidence(store,wire,{sourceDraft,bundle});}
  store.corrupt(wire,v=>delete v.artifacts.prepared);const count=store.writes;refuses(()=>confirmCheckoutFullRegistryEvidence(ctx,current));assert.equal(store.writes,count);
 }
});
test('new adapter has no connector, SQL execution, source promotion, credential loader or repair path',async()=>{
 const text=await readFile('scripts/member-checkout-full-registry-evidence.mjs','utf8');
 assert.doesNotMatch(text,/process\.env|child_process|\bfetch\s*\(|from ['"](?:pg|node:net|node:https?)['"]|writeFile|mkdir|chmod|rename|unlink|productionAuthorized:\s*true|deploymentReady:\s*true/);
 assert.match(text,/sourceBundleSha256:b.sourceDraftSha256/);assert.match(text,/entry.sha256,sha\(preparedWire\)/);
});
