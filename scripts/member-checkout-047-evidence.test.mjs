import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createCheckout047InstallationBundle,observeCheckout047Installation,prepareCheckout047InstallationSeal,seal047RegistryVersion,checkout047SealRegistryName} from './member-checkout-047-installation.mjs';
import {beginCheckout047Evidence,appendCheckout047Prepared,reopenCheckout047Evidence,confirmCheckout047Evidence} from './member-checkout-047-evidence.mjs';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const bundle=await createCheckout047InstallationBundle(),entries=rows=>rows.map(({version,name})=>({version,nameSha256:sha(name)})).sort((a,b)=>a.version.localeCompare(b.version));
const fixture=()=>({core:{context:{backendPid:100,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
 target:{clusterSha256:'1'.repeat(64),databaseOid:'12345',databaseName:'owned_test',databaseOwner:'owned_admin',databaseEncoding:'UTF8',serverVersion:'150008',serverAddress:'127.0.0.1',serverPort:5432,sessionUser:'owned_admin',currentRole:'owned_admin',actor:{oid:'1234',rolname:'owned_admin',rolsuper:true}},
 registry:{count:6,entries:entries(bundle.material.prerequisites.registry)},roles:[{oid:'1234',rolname:'owned_admin',rolsuper:true}],memberships:[],defaultAcls:[],schemas:[{name:'public',owner:'owned_admin'}],relations:[],columns:[],constraints:[],indexes:[],functions:[],extensions:[]},triggers:[],policies:[]});
const observe=raw=>observeCheckout047Installation(async()=>({rows:[{metadata:raw}]}),bundle);
const before=await observe(fixture()),afterRaw=fixture();afterRaw.core.schemas.push({name:'faolla_checkout_design',owner:'owned_admin'});
const seal=prepareCheckout047InstallationSeal(before,await observe(afterRaw),bundle);
const committed=()=>{const raw=structuredClone(afterRaw);raw.core.context.backendPid=101;raw.core.registry={count:8,entries:entries([...bundle.material.prerequisites.registry,bundle.receipt,{version:seal047RegistryVersion,name:checkout047SealRegistryName(seal.digest)}])};return raw;};
// Explicit memory double for adapter logic only. Real persistence is tested by
// the separate Linux storage contracts and PG acceptance, never claimed here.
const memory=()=>{const saved=new Map();let mutations=0;return {get mutations(){return mutations;},
 begin({bindingWire,sourceWire,baselineWire}){const locator={stage:'initial',binding:JSON.parse(bindingWire)},wire=canonical(locator);saved.set(wire,{locator,artifacts:{source:sourceWire,baseline:baselineWire}});mutations++;return wire;},
 append(previous,kind,body){const old=this.read(previous),locator={...old.locator,stage:kind==='prepared'?'prepared':'confirmed'},wire=canonical(locator);saved.set(wire,{locator,artifacts:{...old.artifacts,[kind]:body}});mutations++;return wire;},
 read(wire){assert.ok(saved.has(wire),'test independent locator missing');return structuredClone(saved.get(wire));}};};
test('six-source evidence is branded, source-bound and cannot confirm an uncommitted result',async()=>{
 const store=memory(),context=beginCheckout047Evidence(store,bundle,before);assert.equal(store.mutations,1);
 assert.throws(()=>appendCheckout047Prepared({...context},seal),/context_unverified/);assert.throws(()=>appendCheckout047Prepared(context,{...seal}),/not_prepared/);
 const wire=appendCheckout047Prepared(context,seal),reopened=await reopenCheckout047Evidence(store,wire),count=store.mutations;
 assert.throws(()=>confirmCheckout047Evidence(reopened,before),/new_connection_required/);
 const uncommitted=structuredClone(afterRaw);uncommitted.core.context.backendPid=102;
 assert.throws(()=>confirmCheckout047Evidence(reopened,awaitValue(uncommitted)),/not_observed/);
 assert.throws(()=>confirmCheckout047Evidence(reopened,context.before),/new_connection_required/);
 const unconfirmed=await observe(uncommitted);assert.throws(()=>confirmCheckout047Evidence(reopened,unconfirmed),/seal_unconfirmed/);assert.equal(store.mutations,count);
});
// A copied raw object cannot acquire an observation brand.
const awaitValue=raw=>({data:raw});
test('fresh read-only committed receipt pair confirms once and reopens without SQL or reapplication',async()=>{
 const store=memory(),context=beginCheckout047Evidence(store,bundle,before),wire=appendCheckout047Prepared(context,seal);
 const reopened=await reopenCheckout047Evidence(store,wire),current=await observe(committed()),result=confirmCheckout047Evidence(reopened,current);
 assert.equal(result.alreadyConfirmed,false);assert.equal(result.databaseStatementsExecuted,0);assert.equal(result.productionAuthorized,false);assert.equal(result.deploymentReady,false);assert.equal(result.sealSha256,seal.digest);
 const again=await reopenCheckout047Evidence(store,result.locatorWire),count=store.mutations;
 assert.deepEqual(confirmCheckout047Evidence(again,current),{...result,alreadyConfirmed:true});assert.equal(store.mutations,count);
 for(const change of [raw=>raw.core.registry.entries[0].nameSha256='0'.repeat(64),raw=>raw.core.target.databaseOid='99999',raw=>raw.core.schemas.push({name:'extra'}),raw=>raw.core.context.readOnly=false]){
  const raw=committed();change(raw);const changed=await observe(raw);assert.throws(()=>confirmCheckout047Evidence(again,changed));assert.equal(store.mutations,count);
 }
});
test('invalid six-source baseline or copied brands are refused before any storage write',async()=>{
 for(const value of [{...before},await observe(committed()),await observe({...fixture(),core:{...fixture().core,registry:{count:6,entries:entries(bundle.material.prerequisites.registry).map((v,i)=>i===0?{...v,nameSha256:'0'.repeat(64)}:v)}}})]){
  const store=memory();assert.throws(()=>beginCheckout047Evidence(store,bundle,value));assert.equal(store.mutations,0);
 }
 const store=memory();assert.throws(()=>beginCheckout047Evidence(store,{...bundle},before),/unverified/);assert.equal(store.mutations,0);
});
test('adapter adds no connection, SQL mutation, hidden environment or production authority',()=>{
 const source=readFileSync(new URL('./member-checkout-047-evidence.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/process\.env|child_process|\bfetch\s*\(|from ['"](?:pg|node:net|node:https?)['"]|\b(?:BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|ALTER|INSERT|UPDATE|DELETE|CREATE|DROP)\s|productionAuthorized:\s*true|deploymentReady:\s*true/);
 assert.match(source,/verifyCheckout047InstallationSeal/);assert.match(source,/registry\.entries,expected/);
});
