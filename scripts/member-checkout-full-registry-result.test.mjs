import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createOwnedProductionSourceInputs,bundle,inventory,excluded} from './fixtures/member-checkout-production-source-draft-fixture.mjs';
import {createCheckoutProductionSourceDraft} from './member-checkout-production-source-draft.mjs';
import {observeCheckout047Installation,prepareCheckout047InstallationSeal} from './member-checkout-047-installation.mjs';
import {prepareCheckoutFullRegistryResult,checkoutFullRegistryOwnedReceipts,reconcileCheckoutFullRegistryResult,checkoutFullRegistryResultSummary} from './member-checkout-full-registry-result.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const input=await createOwnedProductionSourceInputs(),sourceDraft=await createCheckoutProductionSourceDraft(input),before=input.observation.seal;
const observe=raw=>observeCheckout047Installation(async()=>({rows:[{metadata:raw}]}),bundle);
const afterRaw=structuredClone(before.data);
afterRaw.core.context={...afterRaw.core.context,readOnly:false,backendPid:101};
afterRaw.core.schemas.push({name:'owned_test_new_schema',owner:'owned_admin'});
const after=await observe(afterRaw),operationId=randomUUID(),args={sourceDraft,bundle,before,after,operationId};
const prepared=prepareCheckoutFullRegistryResult(args),receipts=checkoutFullRegistryOwnedReceipts(prepared);
function committedRaw(){
 const r=structuredClone(afterRaw);r.core.context={...r.core.context,readOnly:true,backendPid:102};
 r.core.registry={count:216,entries:[...structuredClone(before.data.core.registry.entries),...receipts.map(({version,name})=>({version,nameSha256:sha(name)}))].sort((a,b)=>a.version.localeCompare(b.version))};
 return r;
}
const current=await observe(committedRaw());
const reconcile=(overrides={})=>reconcileCheckoutFullRegistryResult({sourceDraft,bundle,before,current,operationId,preparedWire:prepared.wire,expectedSha256:prepared.digest,...overrides});
const refuses=fn=>assert.throws(fn,e=>e.message==='checkout_full_registry_result_refused'&&Object.keys(e).length===0&&!e.stack.includes('private-canary'));

test('214 original registrations and exact new receipt pair bind the original operation, source and post-catalogue',()=>{
 const result=reconcile(),s=checkoutFullRegistryResultSummary(result);
 assert.equal(result.status,'committed-original');assert.equal(result.registryCount,216);assert.equal(result.preparedSha256,prepared.digest);
 assert.equal(result.sourceDraftSha256,sourceDraft.digest);assert.equal(result.beforeSha256,before.sha256);assert.equal(result.afterCatalogSha256,after.catalogSha256);
 assert.notEqual(result.querySha256,result.preinstallQuerySha256);
 assert.deepEqual(receipts.map(v=>v.version),['999999990049','999999990050']);
 assert.equal(s.registryCount,216);assert.equal(result.databaseStatementsExecuted,0);assert.throws(()=>s.registryCount=6,TypeError);
 for(const k of ['ddlReplayAllowed','receiptRepairAllowed','evidenceRegenerationAllowed','installedPrivilegesValidated','persistentEvidenceValidated','productionAuthorized','deploymentReady'])assert.equal(result[k],false);
 assert.doesNotMatch(JSON.stringify(s),/owned_admin|owned_review|operationId|backendPid|CREATE|body/);
});
test('full-registry protocol never changes or silently expands the old six-source installer',()=>{
 refuses(()=>prepareCheckoutFullRegistryResult({...args,before:{...before}}));
 assert.throws(()=>prepareCheckout047InstallationSeal(before,after,bundle),/not_six_source_baseline/);
 assert.equal(bundle.material.prerequisites.registry.length,6);assert.equal(bundle.material.registration.sourceVersion,'999999990047');assert.equal(bundle.material.registration.sealVersion,'999999990048');
 assert.equal(sourceDraft.material.registration.sourceVersion,null);assert.equal(sourceDraft.material.registration.sealVersion,null);
});
test('source/baseline brands and exact saved full metadata cannot be replaced with copied or smaller snapshots',async()=>{
 refuses(()=>prepareCheckoutFullRegistryResult({...args,sourceDraft:{...sourceDraft}}));refuses(()=>reconcile({current:{...current}}));
 for(const change of [r=>{r.core.registry.entries=r.core.registry.entries.slice(0,6);r.core.registry.count=6;},r=>r.core.registry.entries[0].nameSha256='f'.repeat(64),r=>r.core.columns.push({name:'private-canary'}),r=>r.core.target.clusterSha256='f'.repeat(64)]){
  const raw=structuredClone(before.data);change(raw);const changed=await observe(raw);refuses(()=>prepareCheckoutFullRegistryResult({...args,before:changed}));
 }
});
test('saved production evidence alone cannot create or reconcile an installation receipt',async()=>{
 const realLabel=await createCheckoutProductionSourceDraft({...input,references:{...input.references,kind:'saved-production-evidence'}});
 refuses(()=>prepareCheckoutFullRegistryResult({...args,sourceDraft:realLabel}));refuses(()=>reconcile({sourceDraft:realLabel}));
 assert.equal(realLabel.material.installer.implementedForProduction,false);
});
test('preparation requires a writable repeatable transaction with unchanged full registry and an actual catalogue delta',async()=>{
 for(const change of [r=>r.core.context.readOnly=true,r=>r.core.context.isolation='read committed',r=>{r.core.registry.entries.pop();r.core.registry.count--;},r=>r.core.target.databaseOid='98765']){
  const raw=structuredClone(afterRaw);change(raw);const changed=await observe(raw);refuses(()=>prepareCheckoutFullRegistryResult({...args,after:changed}));
 }
 const raw=structuredClone(before.data);raw.core.context.readOnly=false;
 const noop=await observe(raw);refuses(()=>prepareCheckoutFullRegistryResult({...args,after:noop}));
});
test('operation ID is independently required and cannot be selected from database receipt strings',()=>{
 for(const operationId of [undefined,'',randomUUID(),'../../private-canary','00000000-0000-0000-0000-000000000000'])refuses(()=>reconcile({operationId}));
 refuses(()=>prepareCheckoutFullRegistryResult({...args,operationId:'not-a-uuid'}));
});
test('missing prepared bytes or trusted digest refuse rather than reconstructing evidence from both database receipts',()=>{
 for(const preparedWire of [undefined,null,'','{',prepared.wire+'\n','x'.repeat(65537)])refuses(()=>reconcile({preparedWire}));
 for(const expectedSha256 of [undefined,'',sha(prepared.wire),'0'.repeat(64)])refuses(()=>reconcile({expectedSha256}));
 refuses(()=>checkoutFullRegistryOwnedReceipts({...prepared}));refuses(()=>checkoutFullRegistryResultSummary({...reconcile()}));
});
test('self-rehashed prepared edits still refuse against the independently retained original digest',()=>{
 for(const change of [m=>m.operationId=randomUUID(),m=>m.productionAuthorized=true,m=>m.beforeSha256='0'.repeat(64),m=>m.registration.sourceVersion='202611269999',m=>m.installedPrivilegesValidated=true,m=>m.afterCatalogSha256='0'.repeat(64),m=>m.privateField='private-canary']){
  const v=JSON.parse(prepared.wire);change(v.material);v.sha256=sha(canonical(v.material));refuses(()=>reconcile({preparedWire:canonical(v)}));
 }
 const extra=JSON.parse(prepared.wire);extra.extra=true;refuses(()=>reconcile({preparedWire:canonical(extra)}));
});
test('one missing, duplicate-source, wrong-seal or extra registration is not repaired or treated as committed',async()=>{
 for(const change of [r=>{r.core.registry.entries.pop();r.core.registry.count--;},r=>{r.core.registry.entries=r.core.registry.entries.filter(v=>v.version!==receipts[0].version);r.core.registry.count--;},r=>r.core.registry.entries.at(-1).nameSha256='f'.repeat(64),r=>r.core.registry.entries.at(-2).nameSha256='f'.repeat(64),r=>{r.core.registry.entries.push({version:'999999990051',nameSha256:'f'.repeat(64)});r.core.registry.count++;},r=>r.core.registry.entries[0].nameSha256='f'.repeat(64)]){
  const raw=committedRaw();change(raw);const changed=await observe(raw);refuses(()=>reconcile({current:changed}));
 }
});
test('exactly unchanged original 214-row state means not committed but never authorizes an automatic reapply',async()=>{
 const raw=structuredClone(before.data);raw.core.context.backendPid=103;const uncommitted=await observe(raw);
 const result=reconcile({current:uncommitted});assert.equal(result.status,'not-committed-original');assert.equal(result.registryCount,214);
 assert.equal(result.ddlReplayAllowed,false);assert.equal(result.receiptRepairAllowed,false);assert.equal(result.evidenceRegenerationAllowed,false);
 const delta=structuredClone(afterRaw);delta.core.context={...delta.core.context,readOnly:true,backendPid:103};const unregisteredDelta=await observe(delta);
 refuses(()=>reconcile({current:unregisteredDelta}));
});
test('reconciliation requires a new read-only repeatable connection, not either earlier snapshot or a writable view',async()=>{
 for(const change of [r=>r.core.context.backendPid=100,r=>r.core.context.backendPid=101,r=>r.core.context.readOnly=false,r=>r.core.context.isolation='read committed']){
  const raw=committedRaw();change(raw);const changed=await observe(raw);refuses(()=>reconcile({current:changed}));
 }
});
test('committed catalogue, target, ACL/default ACL, trigger, policy, constraint and function drift all refuse',async()=>{
 for(const change of [r=>r.core.schemas.pop(),r=>r.core.target.serverPort=9876,r=>r.core.roles[0].rolcanlogin=false,r=>r.core.defaultAcls.push({grantee:'PUBLIC'}),r=>r.core.memberships.push({role:'faolla_checkout_executor'}),r=>r.triggers[0].enabled='D',r=>r.policies.push({name:'unexpected'}),r=>r.core.constraints.push({name:'unexpected'}),r=>r.core.functions[0].definition_sha256='0'.repeat(64)]){
  const raw=committedRaw();change(raw);const changed=await observe(raw);refuses(()=>reconcile({current:changed}));
 }
});
test('repeated original confirmation is stable, zero-write and cannot claim full DDL or installed privilege validation',async()=>{
 const raw=committedRaw();raw.core.context.backendPid=104;const newer=await observe(raw);
 assert.deepEqual(reconcile({current:newer}),reconcile());assert.equal(prepared.material.installedPrivilegesValidated,false);assert.equal(prepared.material.persistentEvidenceValidated,false);
 const module=await readFile('scripts/member-checkout-full-registry-result.mjs','utf8');
 assert.doesNotMatch(module,/process\.env|child_process|writeFile|appendFile|\bfetch\s*\(|from ['"](?:pg|node:net|node:https?)['"]|productionAuthorized:\s*true|deploymentReady:\s*true/);
});

test('real owned PGlite transaction makes both receipts atomic; lost acknowledgment only reconciles without new inserts',async t=>{
 const db=new PGlite();let receiptInserts=0;
 const original=inventory.entries.filter(v=>v.file!==excluded).map(v=>({version:v.version,name:v.file.match(/^[\s\S]*?\/[0-9]+_(.+)\.sql$/)[1]}));
 async function insert(rows){for(const r of rows)await db.query('INSERT INTO owned_migrations(version,name) VALUES($1,$2)',[r.version,r.name]);}
 async function snapshot(installed){
  const {rows}=await db.query('SELECT version,name FROM owned_migrations ORDER BY version');
  const raw=structuredClone(installed?afterRaw:before.data);raw.core.context={...raw.core.context,readOnly:true,backendPid:110};
  raw.core.registry={count:rows.length,entries:rows.map(({version,name})=>({version,nameSha256:sha(name)}))};return observe(raw);
 }
 try{
  await db.exec('CREATE TABLE owned_migrations(version text PRIMARY KEY,name text NOT NULL)');await insert(original);
  await t.test('failure after first receipt rolls back to all original 214 entries',async()=>{
   await db.exec('BEGIN');await insert([receipts[0]]);receiptInserts++;await assert.rejects(db.exec('SELECT 1/0'));await db.exec('ROLLBACK');
   const r=reconcile({current:await snapshot(false)});assert.equal(r.status,'not-committed-original');assert.equal(r.ddlReplayAllowed,false);
  });
  await t.test('failure after both receipts but before COMMIT also rolls back the entire pair',async()=>{
   await db.exec('BEGIN');await insert(receipts);receiptInserts+=2;await db.exec('ROLLBACK');
   assert.equal(reconcile({current:await snapshot(false)}).status,'not-committed-original');
  });
  await t.test('COMMIT succeeds but caller observes an error; only original committed pair is confirmed',async()=>{
   await db.exec('BEGIN');await insert(receipts);receiptInserts+=2;await assert.rejects(db.exec('COMMIT; SELECT 1/0'));
   const count=receiptInserts,r=reconcile({current:await snapshot(true)});assert.equal(r.status,'committed-original');assert.equal(r.registryCount,216);
   assert.deepEqual(reconcile({current:await snapshot(true)}),r);assert.equal(receiptInserts,count);assert.equal(r.databaseStatementsExecuted,0);
  });
  await t.test('deleting the independently held prepared bytes cannot be recovered from database state',async()=>{
   const current=await snapshot(true);refuses(()=>reconcile({current,preparedWire:undefined}));assert.equal((await db.query('SELECT count(*)::int AS n FROM owned_migrations')).rows[0].n,216);
  });
 }finally{await db.close();assert.equal(db.closed,true);}
});
