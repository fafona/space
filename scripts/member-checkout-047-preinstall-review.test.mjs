import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {splitInstallationSql} from './member-checkout-installation-plan.mjs';
import {readReviewedMigrationInventory} from './member-checkout-installation-review.mjs';
import {createCheckout047InstallationBundle} from './member-checkout-047-installation.mjs';
import {loadCheckout047PreinstallContract,checkout047PreinstallQuery,observeCheckout047Preinstall,inspectCheckout047Preinstall,
 createCheckout047PreinstallReview,verifyCheckout047PreinstallReview,checkout047PreinstallReviewSummary} from './member-checkout-047-preinstall-review.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const bundle=await createCheckout047InstallationBundle(),contract=await loadCheckout047PreinstallContract(bundle),inventory=await readReviewedMigrationInventory(),addresses=['127.0.0.1'];
const excluded='scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql';
const exposed=new Set(['faolla_commit_redemption_v1','faolla_stage_redemption_checkout_v1','faolla_get_redemption_checkout_v1','faolla_cancel_redemption_checkout_v1','faolla_ack_redemption_checkout_v1','faolla_commit_redemption_v2']);
const reference={captureSha256:'9'.repeat(64),publicBuild:'a'.repeat(40)};
const fixture=()=>{
 const functions=contract.expected.functions.map((v,i)=>({...v,oid:String(6000+i),definitionSha256:sha('function-'+i),owner:'owned_admin',ownerBypassesRls:true,sqlBody:false,
  defaults:v.defaults??0,publicExecute:false,apiExecutors:exposed.has(v.name)?['service_role']:[]}));
 const triggers=contract.expected.triggers.map((v,i)=>({...v,oid:String(7000+i),relation:'3456',definitionSha256:sha('trigger-'+i),enabled:'O',args:0,qualified:false,columns:''}));
 return {seal:{core:{context:{backendPid:100,readOnly:true,isolation:'repeatable read',searchPath:'pg_catalog, public'},
  target:{clusterSha256:'1'.repeat(64),databaseOid:'12345',databaseName:'owned_review',databaseOwner:'owned_admin',databaseEncoding:'UTF8',serverVersion:'150008',serverAddress:'127.0.0.1',serverPort:5432,sessionUser:'owned_admin',currentRole:'owned_admin',actor:{oid:'1234',rolname:'owned_admin',rolsuper:true}},
  registry:{count:214,entries:inventory.entries.filter(v=>v.file!==excluded).map(({version,nameSha256})=>({version,nameSha256}))},
  roles:[{oid:'1234',rolname:'owned_admin',rolcanlogin:true}],memberships:[],defaultAcls:[],schemas:[{name:'public'}],
  relations:[{oid:'3456',namespace:'public',name:'pages',kind:'r'},...['faolla_redemption_operations','faolla_redemption_checkouts'].map((name,i)=>({oid:String(3457+i),namespace:'public',name,kind:'r'}))],
  columns:[],constraints:[],indexes:[],extensions:[],functions:functions.map(v=>({oid:v.oid,namespace:v.namespace,name:v.name,owner:v.owner,definition_sha256:v.definitionSha256}))},
  triggers:triggers.map(v=>({oid:v.oid,relation:v.relation,enabled:v.enabled,definition_sha256:v.definitionSha256})),policies:[]},
  legacyFunctions:functions,legacyTriggers:triggers,gatewayLogins:[{roleOid:'1234',role:'owned_admin',connections:2}]};
};
const observe=value=>observeCheckout047Preinstall(async(sql,args)=>{assert.equal(sql,contract.sql);assert.deepEqual(args,[addresses]);return {rows:[{metadata:value}]};},contract,bundle,addresses);
const observed=await observe(fixture()),review=await createCheckout047PreinstallReview(contract,observed,bundle,reference);

test('047 preinstall uses one fixed SELECT with parameterized IP array and hashes only metadata, not business or activity text',async()=>{
 const plan=checkout047PreinstallQuery(contract,addresses);assert.equal(splitInstallationSql(plan.sql+';').length,1);
 assert.match(plan.sql,/a.client_addr=ANY\(\$1::pg_catalog.inet\[\]\)/);assert.doesNotMatch(plan.sql,/127\.0\.0\.1/);
 assert.doesNotMatch(plan.sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|CALL|COPY|SET|COMMIT|ROLLBACK)\b/i);
 assert.doesNotMatch(plan.sql,/rolpassword|auth\.users|a\.query\b|a\.query_id|SELECT\s+\*\s+FROM\s+public\.pages/i);
 assert.equal(contract.expected.functions.length,26);assert.equal(contract.expected.triggers.length,3);
 const db=new PGlite();try{await db.exec('CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL)');
  assert.ok((await db.query('EXPLAIN '+plan.sql,plan.values)).rows.length>0);
 }finally{await db.close();}
});
test('address plans are bounded, immutable, parameterized and refuse injection, zones, CIDR, duplicates and unbranded contracts',()=>{
 for(const value of [[],['127.0.0.1','127.0.0.1'],["127.0.0.1');select 1--"],['example.invalid'],['127.0.0.1/32'],['::1/128'],['fe80::1%eth0'],Array(9).fill('::1'),[null]])assert.throws(()=>checkout047PreinstallQuery(contract,value),/addresses_invalid/);
 const input=['::1','192.0.2.2'],plan=checkout047PreinstallQuery(contract,input);input.pop();assert.deepEqual(plan.values,[['192.0.2.2','::1']]);assert.equal(plan.sql,contract.sql);
 assert.throws(()=>plan.values[0].push('127.0.0.1'),TypeError);assert.throws(()=>checkout047PreinstallQuery({...contract},addresses),/unverified/);
});
test('all 26 exact definitions, both optional defaults and three same-snapshot guards match without conferring authority',()=>{
 const result=inspectCheckout047Preinstall(contract,observed);assert.deepEqual(result.issues,[]);assert.equal(result.legacyDefinitionsMatch,true);assert.equal(result.gatewayStatus,'observed-session-login');
 assert.equal(result.gatewayIsConfiguredLoginProof,false);assert.equal(result.gatewayGrantAuthorized,false);assert.equal(result.legacyRelationSourceCompatibilityProved,false);assert.equal(result.productionAuthorized,false);assert.equal(result.deploymentReady,false);
 assert.equal(contract.expected.functions.filter(v=>v.defaults===1).length,2);
});
test('definition bodies, defaults, attributes and API exposure drift across all 26 declarations fails closed',async()=>{
 for(let i=0;i<26;i++){
  const raw=fixture();raw.legacyFunctions[i].defaults++;assert.equal(inspectCheckout047Preinstall(contract,await observe(raw)).legacyDefinitionsMatch,false);
 }
 for(const change of [v=>v.legacyFunctions[0].bodySha256='a'.repeat(64),v=>v.legacyFunctions[0].args=['other'],v=>v.legacyFunctions[0].config=['search_path=public'],v=>v.legacyFunctions[0].sqlBody=true,
  v=>v.legacyFunctions.pop(),v=>v.legacyFunctions.push(v.legacyFunctions[0]),v=>v.legacyFunctions.push({...v.legacyFunctions[0],types:['integer']}),
  v=>v.legacyFunctions.find(f=>f.name==='faolla_commit_redemption_v1').publicExecute=true,
  v=>v.legacyFunctions.find(f=>f.name==='faolla_commit_redemption_internal_v1').apiExecutors=['service_role']]){
  const raw=fixture();change(raw);assert.equal(inspectCheckout047Preinstall(contract,await observe(raw)).legacyDefinitionsMatch,false);
 }
});
test('function identity/owner and trigger identity/definition/enabled state must agree within the same metadata snapshot',async()=>{
 for(const change of [v=>v.legacyFunctions[0].owner='other',v=>v.legacyFunctions[0].definitionSha256='b'.repeat(64),v=>v.legacyTriggers[0].definitionSha256='c'.repeat(64),v=>v.legacyTriggers[0].relation='9999']){
  const raw=fixture();change(raw);assert.ok(inspectCheckout047Preinstall(contract,await observe(raw)).issues.includes('preinstall_definition_metadata_invalid'));
 }
 for(const change of [v=>v.legacyTriggers[0].enabled='D',v=>v.legacyTriggers[0].enabled='R',v=>v.legacyTriggers[0].qualified=true,v=>v.legacyTriggers[0].columns='1',v=>v.legacyTriggers.pop()]){
  const raw=fixture();change(raw);assert.equal(inspectCheckout047Preinstall(contract,await observe(raw)).legacyDefinitionsMatch,false);
 }
});
test('gateway evidence remains observed, missing, ambiguous or unconfirmed rather than configured-login or GRANT proof',async()=>{
 for(const [change,status] of [[v=>v.gatewayLogins=[],'not-observed'],[v=>v.gatewayLogins.push({...v.gatewayLogins[0],role:'other'}),'ambiguous'],[v=>v.gatewayLogins[0].role='unknown','unconfirmed'],[v=>v.seal.core.roles[0].rolcanlogin=false,'unconfirmed'],[v=>v.gatewayLogins[0].connections=0,'unconfirmed']]){
  const raw=fixture();change(raw);const result=inspectCheckout047Preinstall(contract,await observe(raw));assert.equal(result.gatewayStatus,status);assert.equal(result.gatewayGrantAuthorized,false);
 }
});
test('214/1 and six/209 review counts stay distinct, all 38 new steps are bound and no old/unregistered SQL is selected',async()=>{
 const summary=checkout047PreinstallReviewSummary(review);assert.equal(summary.registeredSources,214);assert.equal(summary.unregisteredSources,1);assert.equal(summary.proposedSteps,38);
 assert.deepEqual(review.material.sourceReview.unregisteredSources.map(v=>v.file),[excluded]);assert.deepEqual(review.material.sourceReview.legacySourcesToExecute,[]);assert.deepEqual(review.material.sourceReview.unregisteredSourcesToExecute,[]);
 assert.equal(summary.productionAuthorized,false);assert.equal(summary.deploymentReady,false);assert.equal(summary.legacyRelationSourceCompatibilityProved,false);assert.ok(Object.values(review.material.authority).every(v=>v===false));
 const raw=fixture(),versions=new Set(bundle.material.prerequisites.registry.map(v=>v.version));raw.seal.core.registry.entries=raw.seal.core.registry.entries.filter(v=>versions.has(v.version));raw.seal.core.registry.count=6;
 const six=checkout047PreinstallReviewSummary(await createCheckout047PreinstallReview(contract,await observe(raw),bundle,reference));assert.equal(six.registeredSources,6);assert.equal(six.unregisteredSources,209);assert.equal(six.productionAuthorized,false);
});
test('incomplete old evidence, read-write contexts, missing prerequisites, source mismatches and checkout collisions cannot form a review',async()=>{
 for(const change of [v=>v.seal.core.relations.pop(),v=>v.seal.core.context.readOnly=false,v=>v.seal.core.context.isolation='read committed',
  v=>v.seal.core.roles.push({rolname:'faolla_checkout_runtime'}),v=>v.seal.core.schemas.push({name:'faolla_checkout_design'}),v=>v.seal.core.functions.push({namespace:'public',name:'faolla_checkout_runtime_v1'}),
  v=>v.seal.core.registry.entries[0].nameSha256='d'.repeat(64),v=>{v.seal.core.registry.entries=v.seal.core.registry.entries.filter(r=>r.version!=='202609080047');v.seal.core.registry.count--;},
  v=>{v.seal.core.registry.entries.push({version:'999999990048',nameSha256:'e'.repeat(64)});v.seal.core.registry.count++;}]){
  const raw=fixture();change(raw);await assert.rejects(createCheckout047PreinstallReview(contract,await observe(raw),bundle,reference),/checkout_047_review_/);
 }
 await assert.rejects(createCheckout047PreinstallReview(contract,{...observed},bundle,reference),/not_observed/);
 await assert.rejects(createCheckout047PreinstallReview(contract,observed,{...bundle},reference),/unverified/);
});
test('self-rehashed approval, grant, credential, migration, site and source substitutions cannot verify an unapproved packet',async()=>{
 assert.equal((await verifyCheckout047PreinstallReview(review.wire,contract,observed,bundle,reference)).digest,review.digest);
 for(const change of [v=>v.authority.installation=true,v=>v.authority.deployment=true,v=>v.privileges.gatewayMembershipApproved=true,v=>v.credentials.serviceRoleFallback=true,
  v=>v.registration.version='202611259999',v=>v.sourceReview.candidate.sha256='0'.repeat(64),v=>v.sourceReview.proposedSources.pop(),v=>v.unresolved=[],v=>v.rollout.merchantSites.push('10909095'),v=>v.resultEvidence.ciTempJournalIsProductionStore=true]){
  const value=JSON.parse(review.wire);change(value.material);value.sha256=sha(canonical(value.material));await assert.rejects(verifyCheckout047PreinstallReview(canonical(value),contract,observed,bundle,reference),/^Error: checkout_047_preinstall_review_unapproved$/);
 }
 for(const wire of [review.wire+'\n',review.wire.slice(0,-1),canonical({...JSON.parse(review.wire),extra:true})])await assert.rejects(verifyCheckout047PreinstallReview(wire,contract,observed,bundle,reference),/unapproved/);
});
test('immutable summaries and fixed errors exclude metadata, addresses and secrets; source has no connector, mutation or authority switch',async()=>{
 assert.throws(()=>checkout047PreinstallReviewSummary({...review}),/unverified/);assert.throws(()=>review.material.authority.installation=true,TypeError);
 assert.doesNotMatch(JSON.stringify(checkout047PreinstallReviewSummary(review)),/owned_admin|owned_review|127\.0\.0\.1|captureSha256|publicBuild|roleOid|"bodySha256"|"wire"/);
 await assert.rejects(observeCheckout047Preinstall(async()=>{throw Object.assign(Error('secret sentinel'),{code:'42601'});},contract,bundle,addresses),e=>e.message==='checkout_047_preinstall_observation_unavailable'&&e.code==='42601'&&!JSON.stringify(e).includes('sentinel'));
 const source=await readFile('scripts/member-checkout-047-preinstall-review.mjs','utf8');assert.doesNotMatch(source,/process\.env|child_process|\bfetch\s*\(|writeFile|appendFile|mkdir|from ['"]pg['"]/);assert.doesNotMatch(source,/productionAuthorized:\s*true|deploymentReady:\s*true/);
});
