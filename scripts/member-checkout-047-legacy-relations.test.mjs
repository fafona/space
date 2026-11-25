import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createCheckout047InstallationBundle,observeCheckout047Installation} from './member-checkout-047-installation.mjs';
import {loadCheckout047LegacyRelationSources,projectCheckout047LegacyRelations,checkout047LegacyRelationProfile,compareCheckout047LegacyRelations} from './member-checkout-047-legacy-relations.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const bundle=await createCheckout047InstallationBundle(),contract=await loadCheckout047LegacyRelationSources(bundle);
// Synthetic catalogue fixtures ONLY. PostgreSQL 15.8 source-derived profiles
// are produced by the separate owned CI installation runner, not this fixture.
const fixture=(actor='owned_admin',offset=0)=>{
 const names=['faolla_redemption_checkouts','faolla_redemption_operations'],ids=names.map((_,i)=>String(4000+offset+i));
 const relations=names.map((name,i)=>({oid:ids[i],namespace:'public',name,kind:'r',persistence:'p',owner:actor,rls:true,forced:false,acl:[actor+'=arwdDxt/'+actor]}));
 const columns=[['merchant_id','operator_id','operation_id','fingerprint','membership_id','request','status','result','created_at','updated_at','acknowledged_at'],['merchant_id','operation_id','membership_id','fingerprint','committed_at']].flatMap((fields,i)=>fields.map((name,j)=>({relation:ids[i],ordinal:j+1,name,
  type:/_at$/.test(name)?'timestamp with time zone':['request','result'].includes(name)?'jsonb':'text',not_null:!['result','acknowledged_at'].includes(name),identity:'',generated:'',collation:/_at$/.test(name)||['request','result'].includes(name)?'0':'100',default_sha256:['created_at','updated_at','committed_at'].includes(name)?sha('clock_timestamp()'):null,acl:[]})));
 const constraints=relations.flatMap((v,i)=>Array.from({length:i===0?12:5},(_,j)=>({relation:v.oid,oid:String(5000+offset+i*100+j),name:v.name+'_constraint_'+j,kind:j===0?'p':'c',validated:true,deferrable:false,deferred:false,definition_sha256:sha(v.name+'-constraint-'+j)})));
 const indexes=relations.flatMap((v,i)=>Array.from({length:i===0?2:1},(_,j)=>({relation:v.oid,oid:String(6000+offset+i*100+j),valid:true,ready:true,live:true,definition_sha256:sha(v.name+'-index-'+j)})));
 return {core:{context:{backendPid:100+offset,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
  target:{clusterSha256:sha('cluster'+offset),databaseOid:'1234',databaseName:'owned_test',databaseOwner:actor,databaseEncoding:'UTF8',serverVersion:'150008',serverAddress:'127.0.0.1',serverPort:5432,sessionUser:actor,currentRole:actor,actor:{oid:'10',rolname:actor,rolsuper:true}},
  registry:{count:6,entries:bundle.material.prerequisites.registry.map(({version,name})=>({version,nameSha256:sha(name)}))},roles:[{oid:'10',rolname:actor,rolsuper:true,rolbypassrls:false}],memberships:[],defaultAcls:[],schemas:[],relations,columns,constraints,indexes,functions:[],extensions:[]},triggers:[],policies:[]};
};
const project=async raw=>projectCheckout047LegacyRelations(contract,await observeCheckout047Installation(async()=>({rows:[{metadata:raw}]}),bundle),bundle);
const baseline=await project(fixture());

test('source scope rechecks all 215 fixed migrations and only the exact two registered prerequisite declarations',()=>{
 assert.equal(contract.material.inventory.files,215);assert.equal(contract.material.sources.length,2);assert.deepEqual(contract.material.sources.map(v=>v.version),['202609080046','202609080047']);
 assert.equal(contract.material.sourceBundleSha256,'f34249f74c0311323fac2f7779fe14ea3151ffacc74d3b5cacf75de8d41d839e');assert.equal(contract.material.serverVersion,'150008');
 assert.ok(Object.isFrozen(contract.material.sources));assert.throws(()=>contract.material.sources.pop(),TypeError);
});
test('only instance OIDs and the verified owner spelling normalize; complete captured columns, checks, indexes and ACL boundary remain',async()=>{
 const other=await project(fixture('another_owned_admin',10000)),result=compareCheckout047LegacyRelations(baseline,other);assert.equal(result.capturedMetadataMatches,true);assert.equal(result.expectedSha256,result.actualSha256);
 const profile=checkout047LegacyRelationProfile(baseline);assert.deepEqual(profile.material.relations.map(v=>[v.columns.length,v.constraints.length,v.indexes.length]),[[11,12,2],[5,5,1]]);
 assert.doesNotMatch(JSON.stringify(profile),/owned_admin|4000|relationOid|roleOid|backendPid|clusterSha256/);assert.equal(profile.material.productionAuthorized,false);assert.equal(profile.material.deploymentReady,false);
 assert.equal(result.completeDdlCompatibilityProved,false);assert.equal(result.productionAuthorized,false);assert.ok(profile.material.notCovered.includes('database-collation-definition'));
 assert.throws(()=>profile.material.relations[0].columns.pop(),TypeError);
});
test('each captured column property, constraint semantics and index validity/definition drift changes the profile',async()=>{
 const changes=[v=>v.core.columns[0].type='varchar(64)',v=>v.core.columns[0].not_null=false,v=>v.core.columns[0].ordinal=99,
  v=>v.core.columns[0].default_sha256='1'.repeat(64),v=>v.core.columns[0].identity='a',v=>v.core.columns[0].generated='s',v=>v.core.columns[0].collation='0',
  v=>v.core.constraints[0].definition_sha256='2'.repeat(64),v=>v.core.constraints[0].validated=false,v=>v.core.constraints[0].deferrable=true,v=>v.core.constraints[0].deferred=true,
  v=>v.core.indexes[0].ready=false,v=>v.core.indexes[0].valid=false,v=>v.core.indexes[0].live=false,v=>v.core.indexes[0].definition_sha256='3'.repeat(64),
  v=>v.core.relations[0].rls=false,v=>v.core.relations[0].forced=true,v=>v.core.columns.shift(),v=>v.core.constraints.shift(),v=>v.core.indexes.shift()];
 for(const change of changes){const raw=fixture();change(raw);const result=compareCheckout047LegacyRelations(baseline,await project(raw));assert.equal(result.capturedMetadataMatches,false);assert.deepEqual(result.issues,['captured_relation_metadata_changed:public.faolla_redemption_checkouts']);assert.equal(result.productionAuthorized,false);}
});
test('unexpected public, API, unrelated-role or column grants and another table owner cannot be normalized away',async()=>{
 for(const change of [v=>v.core.relations[0].acl.push('=r/owned_admin'),v=>v.core.relations[0].acl.push('service_role=r/owned_admin'),
  v=>v.core.relations[0].acl.push('pg_read_all_data=r/owned_admin'),v=>v.core.columns[0].acl.push('service_role=r/owned_admin'),v=>v.core.relations[0].owner='other',
  v=>v.core.roles[0].rolsuper=false,v=>v.core.target.sessionUser='other']){const raw=fixture();change(raw);await assert.rejects(project(raw));}
});
test('extra triggers/policies, duplicate or missing relations/columns/indexes and unknown collation refuse',async()=>{
 for(const change of [v=>v.triggers.push({relation:'4000'}),v=>v.policies.push({relation:'4000'}),v=>v.core.relations.push(v.core.relations[0]),v=>v.core.relations.pop(),
  v=>v.core.columns.push(v.core.columns[0]),v=>v.core.indexes.push(v.core.indexes[0]),v=>v.core.columns[0].collation='9000',v=>v.core.constraints[0].extra=true,
  v=>v.core.relations[0].persistence='u',v=>v.core.relations[0].kind='p']){const raw=fixture();change(raw);await assert.rejects(project(raw));}
});
test('version, encoding, read-only and repeatable-read boundaries refuse without database fallback',async()=>{
 for(const change of [v=>v.core.target.serverVersion='170010',v=>v.core.target.databaseEncoding='LATIN1',v=>v.core.context.readOnly=false,v=>v.core.context.isolation='read committed']){
  const raw=fixture();change(raw);await assert.rejects(project(raw));
 }
 assert.throws(()=>projectCheckout047LegacyRelations({...contract},{},bundle),/contract_unverified/);
 assert.throws(()=>projectCheckout047LegacyRelations(contract,{...baseline},bundle),/not_observed/);
 assert.throws(()=>checkout047LegacyRelationProfile({...baseline}),/projection_unverified/);
 assert.throws(()=>compareCheckout047LegacyRelations(baseline,{...baseline}),/comparison_unverified/);
});
test('normalizer has no transport, secret/production configuration, authority approval or SQL mutation path',async()=>{
 const source=await readFile(new URL('./member-checkout-047-legacy-relations.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/node:child_process|process\.env|fetch\(|\.query\(|\.exec\(|writeFile|createConnection|readFile\([^\n]*(?:\.env|private\.json|id_ed25519)/);
 assert.doesNotMatch(source,/productionAuthorized:\s*true|deploymentReady:\s*true|completeDdlCompatibilityProved:\s*true/);
});
test('only the new owned PG 15.8 workflow exports a synthetic source profile before installation and restores every real drift',async()=>{
 const runner=await readFile(new URL('./member-checkout-047-installation-acceptance.mjs',import.meta.url),'utf8'),workflow=await readFile(new URL('../.github/workflows/member-checkout-047-real-auth.yml',import.meta.url),'utf8');
 const creation=runner.indexOf("await check('only six exact legacy prerequisites"),profile=runner.indexOf("await check('PG 15.8 legacy relation profile"),install=runner.indexOf("await check('failure after the private adapter");
 assert.ok(creation>0&&creation<profile&&profile<install);assert.match(workflow,/node --test scripts\/member-checkout-047-legacy-relations\.test\.mjs/);
 const section=runner.slice(profile,runner.indexOf("await check('read-only 047 preinstall query",profile));
 assert.match(section,/finally\{await observer\.query\(restore\);\}/);assert.match(section,/assert\.deepEqual\(await state\(observer\),baseline\)/);
 assert.match(section,/GRANT SELECT \(request\).*pg_read_all_data/);assert.match(section,/report\.legacyRelations=checkout047LegacyRelationProfile\(expected\)/);
 assert.doesNotMatch(section,/productionAuthorized:\s*true|deploymentReady:\s*true|ssh|fetch\(/);
});
