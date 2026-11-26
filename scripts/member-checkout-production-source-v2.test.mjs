import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createOwnedProductionSourceInputs} from './fixtures/member-checkout-production-source-draft-fixture.mjs';
import {ownedReviewedAcceptanceInputs} from './fixtures/member-checkout-reviewed-acceptance-fixture.mjs';
import {createCheckoutProductionSourceDraft,checkoutProductionSourceDraftSummary} from './member-checkout-production-source-draft.mjs';
import {verifyReviewedCheckoutAcceptance} from './member-checkout-reviewed-acceptance.mjs';
import {createCheckoutProductionSourceV2,verifyCheckoutProductionSourceV2,checkoutProductionSourceV2Summary} from './member-checkout-production-source-v2.mjs';
import {checkoutFullRegistryBaselineBinding} from './member-checkout-full-registry-result.mjs';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x),sha=v=>createHash('sha256').update(v).digest('hex');
const baseInputs=await createOwnedProductionSourceInputs(),baseDraft=await createCheckoutProductionSourceDraft(baseInputs),acceptance=await verifyReviewedCheckoutAcceptance(ownedReviewedAcceptanceInputs()),input={baseDraft,acceptance},draft=await createCheckoutProductionSourceV2(input);

test('independent v2 binds exact current candidate, renewal, 524-scene claims and unchanged v1 history without changing old pins',()=>{
 const m=draft.material,s=checkoutProductionSourceV2Summary(draft);assert.equal(m.version,2);assert.equal(m.historicalDraft.sha256,baseDraft.digest);assert.equal(m.historicalDraft.wireSha256,sha(baseDraft.wire));
 assert.equal(m.sources.combinedRevisionSha256,'728ba93d53200b0ae9c7791c726988b4b56189d7c96208b563a3b965428a3849');assert.equal(m.historicalDraft.historicalCombinedRevisionSha256,'a476794f63fec4151027e416b410d0bb94b971f08edc1fa0882654eae0f774f2');
 assert.equal(baseDraft.material.sources.combinedRevisionSha256,m.historicalDraft.historicalCombinedRevisionSha256);assert.equal(checkoutProductionSourceDraftSummary(baseDraft).ownedApplicationAcceptanceChecks,489);
 assert.equal(s.ownedJobs,18);assert.equal(s.ownedScenarioChecks,524);assert.equal(s.candidateApplication.files,2974);assert.equal(s.savedOwnedCiReportBytesVerified,false);assert.equal(s.nativeFullRegistryInstallationValidated,false);
 assert.equal(m.acceptance.nativeAndBuiltNextInOneProductionTopology,false);assert.equal(m.acceptance.sameCommitSeparateOwnedFixtures,true);
});

test('complete saved baseline, SQL metadata, unknown gateway facts and all nine unresolved prerequisites are retained exactly',()=>{
 const m=draft.material,old=baseDraft.material;for(const key of ['baseline','gateway','installedContractReference','registration','installer','rollout','unresolved','authority'])assert.deepEqual(m[key],old[key]);
 assert.equal(m.baseline.registry.count,214);assert.equal(m.baseline.ciPrerequisiteRegistry.count,6);assert.deepEqual(m.sources.steps,old.sources.steps);assert.equal(m.sources.steps.length,38);assert.deepEqual(m.sources.overlays,old.sources.overlays);assert.equal(m.unresolved.length,9);
 assert.equal(m.gateway.effectiveKongRoutesProved,false);assert.equal(m.gateway.cryptoIssuerProved,false);assert.equal(m.evidence.freshInstallationBaselineProved,false);assert.equal(m.evidence.readPermissionReusable,false);
});

test('preparation cannot grant, reserve, install, execute SQL, enable merchants, Stripe/mail or silently rewrite existing app sources',()=>{
 const m=draft.material;assert.ok(Object.values(m.authority).every(v=>v===false));assert.equal(m.sources.productionSourcePromoted,false);assert.equal(m.sources.sqlBodiesIncluded,false);assert.deepEqual(m.sources.legacySourcesToExecute,[]);assert.deepEqual(m.sources.unregisteredSourcesToExecute,[]);
 assert.equal(m.registration.sourceVersion,null);assert.equal(m.registration.sealVersion,null);assert.deepEqual(m.installer.sqlToExecute,[]);assert.equal(m.installer.implementedForProduction,false);assert.equal(m.installer.persistentStore,null);assert.equal(m.installer.formalSigner,null);assert.equal(m.installer.backupProvider,null);assert.deepEqual(m.rollout.merchantSites,[]);assert.equal(m.rollout.stripeEnabled,false);assert.equal(m.rollout.mailEnabled,false);
 assert.doesNotMatch(draft.wire,/"wire":|"body":|"serverAddress":|"password":|"backendPid":|private-canary|owned_admin|CREATE OR REPLACE FUNCTION/);
});

test('branded v1 and reviewed proof are independently required; copied, swapped or synthetic claimed saved proofs refuse',async()=>{
 for(const next of [null,undefined,{...input,install:true},{...input,baseDraft:{...baseDraft}},{...input,acceptance:{...acceptance}},{baseDraft:acceptance,acceptance:baseDraft},{baseDraft:draft,acceptance}])await assert.rejects(createCheckoutProductionSourceV2(next),/source_v2_unavailable/);
 const savedBase=await createCheckoutProductionSourceDraft({...baseInputs,references:{...baseInputs.references,kind:'saved-production-evidence'}});await assert.rejects(createCheckoutProductionSourceV2({baseDraft:savedBase,acceptance}),/source_v2_unavailable/);
});

test('new v2 cannot be supplied to old v1 result/install guards or downgrade back into an execution token',()=>{
 assert.throws(()=>checkoutProductionSourceDraftSummary(draft),/unverified/);assert.throws(()=>checkoutFullRegistryBaselineBinding({sourceDraft:draft,bundle:baseInputs.bundle,before:baseInputs.observation.seal}),/result_refused/);
 assert.throws(()=>checkoutProductionSourceV2Summary({...draft}),/unverified/);assert.throws(()=>draft.material.authority.installation=true,TypeError);assert.throws(()=>draft.material.acceptance.references.pop(),TypeError);
});

test('canonical reconstruction refuses self-rehashed approval, SQL, source, target, scope and mixed old/new evidence edits',async()=>{
 assert.equal((await verifyCheckoutProductionSourceV2(draft.wire,input)).digest,draft.digest);
 for(const change of [m=>m.authority.installation=true,m=>m.registration.sourceVersion='202611269999',m=>m.sources.combinedRevisionSha256=m.historicalDraft.historicalCombinedRevisionSha256,m=>m.acceptance.scenarioChecks=525,m=>m.baseline.registry.entries.pop(),m=>m.gateway.cryptoIssuerProved=true,m=>m.installer.sqlToExecute=['GRANT role'],m=>m.rollout.merchantSites.push('10909095'),m=>m.acceptance.nativeAndBuiltNextInOneProductionTopology=true,m=>m.evidence.freshInstallationBaselineProved=true]){
  const value=JSON.parse(draft.wire);change(value.material);value.sha256=sha(canonical(value.material));await assert.rejects(verifyCheckoutProductionSourceV2(canonical(value),input),/source_v2_unverified/);
 }
 for(const wire of [draft.wire+'\n',draft.wire.slice(0,-1),canonical({...JSON.parse(draft.wire),extra:true})])await assert.rejects(verifyCheckoutProductionSourceV2(wire,input),/source_v2_unverified/);
});

test('both preparation source hashes are bound by LF and errors/summary never include raw metadata or evidence',async()=>{
 for(const item of draft.material.sources.preparationSources)assert.equal(item.sha256,sha((await readFile(item.file,'utf8')).replace(/\r\n/g,'\n')));assert.equal(draft.material.sources.preparationSources.length,2);
 const s=checkoutProductionSourceV2Summary(draft);assert.equal(s.productionAuthorized,false);assert.equal(s.deploymentReady,false);assert.throws(()=>s.status='approved',TypeError);assert.equal(s.priorRegisteredSources,214);assert.equal(s.newSourceSteps,38);
 await assert.rejects(createCheckoutProductionSourceV2({baseDraft:{private:'private-canary'},acceptance}),e=>e.message==='checkout_production_source_v2_unavailable'&&!e.stack.includes('private-canary')&&Object.keys(e).length===0);
});

test('new module only reads its two fixed local preparation sources and cannot connect, write state or expand production scope',async()=>{
 const text=await readFile(new URL('./member-checkout-production-source-v2.mjs',import.meta.url),'utf8');assert.doesNotMatch(text,/process\.env|\bfetch\s*\(|child_process|writeFile|appendFile|mkdir|from ['"]pg['"]|productionAuthorized:\s*true|deploymentReady:\s*true/);
 assert.match(text,/readFile\(new URL\('\.\/'\+file,import.meta.url\)/);assert.match(text,/member-checkout-production-source-v2.mjs','member-checkout-reviewed-acceptance.mjs/);assert.match(text,/TextDecoder\('utf-8',\{fatal:true\}\)/);
});

test('preparation CI stays on a separate evidence-only branch with no database, production secrets, deploy permission or old-workflow edits',async()=>{
 const workflow=await readFile('.github/workflows/member-checkout-source-preparation.yml','utf8');assert.match(workflow,/acceptance\/member-checkout-source-v2-20261126/);assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/node-version: 20\.20\.1/);assert.match(workflow,/set -euo pipefail/);
 for(const file of ['member-checkout-reviewed-acceptance.test.mjs','member-checkout-production-source-v2.test.mjs','member-checkout-production-source-draft.test.mjs','member-checkout-full-registry-result.test.mjs'])assert.ok(workflow.includes(file));
 assert.doesNotMatch(workflow,/secrets\.|contents: write|id-token: write|workflow_dispatch:|workflow_run:|services:|ssh |scp |production-monitor|deploy\.yml|output\//);
 for(const file of ['member-checkout-real-auth.yml','member-checkout-047-real-auth.yml','member-checkout-full-registry-evidence.yml','member-checkout-full-registry-installation.yml'])assert.doesNotMatch(await readFile('.github/workflows/'+file,'utf8'),/source-preparation|source-v2-20261126|reviewed-acceptance\.test/);
});
