// Pure OFFLINE/source-bound normalization of captured legacy relation metadata.
// No connection, SQL execution, baseline promotion, production authority or data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {checkout047InstallationBundleSummary,assertCheckout047InstallationTarget} from './member-checkout-047-installation.mjs';
import {readReviewedMigrationInventory} from './member-checkout-installation-review.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const contracts=new WeakSet(),projections=new WeakSet();
const files=['scripts/supabase-migrations/202609080046_redemption_atomic_mutation.sql','scripts/supabase-migrations/202609080047_redemption_checkout_context.sql'];
const names=['faolla_redemption_checkouts','faolla_redemption_operations'];
const hash=value=>{assert.match(value,/^[a-f0-9]{64}$/);return value;};
const keys=(value,wanted)=>assert.deepEqual(Object.keys(value).sort(),[...wanted].sort(),'checkout_047_relation_metadata_shape');

export async function loadCheckout047LegacyRelationSources(bundle){
 const source=checkout047InstallationBundleSummary(bundle),inventory=await readReviewedMigrationInventory(),references=[],creations=[];
 for(const item of inventory.entries){
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(new URL('../'+item.file,import.meta.url))).replace(/\r\n/g,'\n');
  assert.equal(sha(text),item.sourceSha256,'checkout_047_relation_source_changed');
  if(names.some(name=>new RegExp('\\b'+name+'\\b').test(text)))references.push(item.file);
  for(const match of text.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(faolla_redemption_(?:checkouts|operations))\s*\(/gi))creations.push({name:match[1],file:item.file});
 }
 assert.deepEqual(references,files,'checkout_047_relation_reference_scope_changed');
 assert.deepEqual(creations.sort((a,b)=>a.name.localeCompare(b.name)),[{name:names[0],file:files[1]},{name:names[1],file:files[0]}]);
 const sources=files.map(file=>{const expected=bundle.material.prerequisites.sources.find(v=>v.file===file),actual=inventory.entries.find(v=>v.file===file);
  assert.ok(expected&&actual&&expected.sha256===actual.sourceSha256,'checkout_047_relation_prerequisite_source_changed');return {file,version:actual.version,sha256:actual.sourceSha256};});
 const material={version:1,kind:'checkout-047-legacy-relation-source-scope-v1',sourceBundleSha256:source.sha256,serverVersion:'150008',inventory:{files:inventory.files,sha256:inventory.sha256},
  sources,relations:names.map(name=>'public.'+name),ownerNormalization:'same-observed-actor-owner-only-arwdDxt',scope:'captured-catalog-fields-only-not-complete-ddl-or-execution-authority'};
 const result=freeze({material,sha256:sha(canonical(material))});contracts.add(result);return result;
}

export function projectCheckout047LegacyRelations(contract,observation,bundle){
 assert.ok(contracts.has(contract),'checkout_047_relation_contract_unverified');assertCheckout047InstallationTarget(observation,observation);
 assert.equal(checkout047InstallationBundleSummary(bundle).sha256,contract.material.sourceBundleSha256);assert.equal(observation.sourceBundleSha256,contract.material.sourceBundleSha256);
 const {core,triggers,policies}=observation.data;assert.equal(core.context.readOnly,true);assert.equal(core.context.isolation,'repeatable read');
 assert.equal(core.target.serverVersion,contract.material.serverVersion,'checkout_047_relation_server_version_changed');
 assert.equal(core.target.databaseEncoding,'UTF8');const actor=core.target.currentRole;assert.match(actor,/^[a-z_][a-z0-9_]{0,62}$/);
 assert.equal(core.target.sessionUser,actor);assert.equal(core.target.actor.rolname,actor);
 const owners=core.roles.filter(v=>v.rolname===actor&&v.oid===core.target.actor.oid);assert.equal(owners.length,1);
 assert.ok(owners[0].rolsuper===true||owners[0].rolbypassrls===true,'checkout_047_relation_owner_boundary_invalid');
 const selected=core.relations.filter(v=>v.namespace==='public'&&names.includes(v.name));assert.equal(selected.length,2);
 assert.equal(new Set(selected.map(v=>v.oid)).size,2);assert.deepEqual(selected.map(v=>v.name).sort(),names);
 const relations=selected.map(table=>{
  keys(table,['oid','namespace','name','kind','persistence','owner','rls','forced','acl']);assert.match(table.oid,/^[1-9][0-9]*$/);
  assert.equal(table.owner,actor,'checkout_047_relation_owner_changed');assert.deepEqual(table.acl,[actor+'=arwdDxt/'+actor],'checkout_047_relation_acl_not_owner_only');
  assert.ok(typeof table.rls==='boolean'&&typeof table.forced==='boolean');assert.equal(table.kind,'r');assert.equal(table.persistence,'p');
  assert.equal(triggers.filter(v=>v.relation===table.oid).length,0,'checkout_047_relation_unexpected_trigger');
  assert.equal(policies.filter(v=>v.relation===table.oid).length,0,'checkout_047_relation_unexpected_policy');
  const columns=core.columns.filter(v=>v.relation===table.oid).map(v=>{
   keys(v,['relation','ordinal','name','type','not_null','identity','generated','collation','default_sha256','acl']);
   assert.ok(Number.isSafeInteger(v.ordinal)&&v.ordinal>0&&v.ordinal<=100);assert.match(v.name,/^[a-z_][a-z0-9_]*$/);assert.equal(typeof v.type,'string');
   assert.equal(typeof v.not_null,'boolean');assert.ok(['','a','d'].includes(v.identity));assert.ok(['','s'].includes(v.generated));
   // Only built-in uncollatable/default collation OIDs occur in these exact sources.
   assert.ok(['0','100'].includes(v.collation),'checkout_047_relation_collation_unmapped');assert.deepEqual(v.acl,[],'checkout_047_relation_column_acl_present');
   return {ordinal:v.ordinal,name:v.name,type:v.type,notNull:v.not_null,identity:v.identity,generated:v.generated,collation:v.collation,defaultSha256:v.default_sha256===null?null:hash(v.default_sha256)};
  }).sort((a,b)=>a.ordinal-b.ordinal);
  assert.ok(columns.length>0&&columns.length<=100);assert.equal(new Set(columns.map(v=>v.name)).size,columns.length);assert.equal(new Set(columns.map(v=>v.ordinal)).size,columns.length);
  const constraints=core.constraints.filter(v=>v.relation===table.oid).map(v=>{
   keys(v,['relation','oid','name','kind','validated','deferrable','deferred','definition_sha256']);assert.match(v.name,/^[a-z_][a-z0-9_]*$/);
   assert.ok(['c','p','u','f','x'].includes(v.kind));for(const key of ['validated','deferrable','deferred'])assert.equal(typeof v[key],'boolean');
   return {name:v.name,kind:v.kind,validated:v.validated,deferrable:v.deferrable,deferred:v.deferred,definitionSha256:hash(v.definition_sha256)};
  }).sort((a,b)=>a.name.localeCompare(b.name));assert.equal(new Set(constraints.map(v=>v.name)).size,constraints.length);
  const indexes=core.indexes.filter(v=>v.relation===table.oid).map(v=>{
   keys(v,['relation','oid','valid','ready','live','definition_sha256']);for(const key of ['valid','ready','live'])assert.equal(typeof v[key],'boolean');
   return {valid:v.valid,ready:v.ready,live:v.live,definitionSha256:hash(v.definition_sha256)};
  }).sort((a,b)=>a.definitionSha256.localeCompare(b.definitionSha256));assert.equal(new Set(indexes.map(v=>v.definitionSha256)).size,indexes.length);
  return {name:'public.'+table.name,kind:table.kind,persistence:table.persistence,owner:'same-observed-actor',acl:'owner-only-arwdDxt',rls:table.rls,forced:table.forced,columns,constraints,indexes,triggers:[],policies:[]};
 }).sort((a,b)=>a.name.localeCompare(b.name));
 const material={version:1,kind:'checkout-047-captured-legacy-relation-profile-v1',sourceContractSha256:contract.sha256,sourceBundleSha256:contract.material.sourceBundleSha256,
  serverVersion:core.target.serverVersion,relations,scope:'captured-catalog-fields-only-not-complete-ddl-or-execution-authority',
  notCovered:['database-collation-definition','table-access-method-options-tablespace-inheritance','full-migration-history-effects','full-supabase-kong-and-financial-execution'],productionAuthorized:false,deploymentReady:false};
 const result=freeze({material,sha256:sha(canonical(material))});projections.add(result);return result;
}

export function checkout047LegacyRelationProfile(projection){
 assert.ok(projections.has(projection),'checkout_047_relation_projection_unverified');return freeze(JSON.parse(canonical(projection)));
}
export function compareCheckout047LegacyRelations(expected,actual){
 assert.ok(projections.has(expected)&&projections.has(actual),'checkout_047_relation_comparison_unverified');
 assert.equal(expected.material.sourceContractSha256,actual.material.sourceContractSha256,'checkout_047_relation_source_changed');
 const issues=expected.material.relations.filter((value,index)=>canonical(value)!==canonical(actual.material.relations[index])).map(value=>'captured_relation_metadata_changed:'+value.name);
 return freeze({capturedMetadataMatches:issues.length===0,issues,expectedSha256:expected.sha256,actualSha256:actual.sha256,relations:2,
  completeDdlCompatibilityProved:false,productionAuthorized:false,deploymentReady:false});
}
