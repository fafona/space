import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCheckoutProductionSourceDraft,verifyCheckoutProductionSourceDraft,checkoutProductionSourceDraftSummary} from './member-checkout-production-source-draft.mjs';
import {bundle,contract,inventory,candidate,group,excluded,createOwnedProductionSourceInputs as inputs} from './fixtures/member-checkout-production-source-draft-fixture.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const input=await inputs(),draft=await createCheckoutProductionSourceDraft(input);
function changeWire(original,key,referenceKey,change){const next={...original,references:{...original.references}},value=JSON.parse(original[key]);change(value);next[key]=JSON.stringify(value);next.references[referenceKey]=sha(next[key]);return next;}
const refuses=code=>e=>e.message==='checkout_production_source_draft_unavailable'&&e.code==='CHECKOUT_SOURCE_DRAFT_'+code;

test('new draft binds 214 real-shape registry entries separately from six CI prerequisites and all 38 new source hashes',()=>{
 const m=draft.material;assert.equal(m.baseline.registry.count,214);assert.equal(m.baseline.ciPrerequisiteRegistry.count,6);assert.equal(m.sources.steps.length,38);assert.equal(new Set(m.sources.steps.map(s=>s.id)).size,38);assert.equal(m.baseline.unrelatedUnregisteredSources.length,1);assert.equal(m.baseline.unrelatedUnregisteredSources[0].file,excluded);assert.deepEqual(m.sources.legacySourcesToExecute,[]);assert.deepEqual(m.sources.unregisteredSourcesToExecute,[]);assert.equal(m.sources.sqlBodiesIncluded,false);assert.equal(m.sources.productionSourcePromoted,false);
});
test('original frozen app and exact independently validated candidate keep different fingerprints and fixed overlay boundaries',()=>{
 const m=draft.material;assert.equal(m.sources.frozenApplication.files,2971);assert.equal(m.sources.candidateApplication.files,2974);assert.notEqual(m.sources.frozenApplication.sha256,m.sources.candidateApplication.sha256);assert.deepEqual(m.sources.overlays,candidate.material.overlay);assert.equal(m.sources.overlays.length,4);assert.equal(m.sources.combinedRevisionSha256,group.sha256);assert.equal(m.acceptance.checks,489);assert.equal(m.acceptance.combinedChecks,38);
});
test('raw private catalogue, configuration paths, bodies and connection values are not embedded and summary is immutable',()=>{
 const s=checkoutProductionSourceDraftSummary(draft);assert.equal(s.referenceKind,'owned-synthetic-evidence');assert.equal(s.priorRegisteredSources,214);assert.equal(s.productionAuthorized,false);assert.equal(s.deploymentReady,false);assert.throws(()=>s.productionAuthorized=true,TypeError);assert.throws(()=>draft.material.authority.installation=true,TypeError);assert.throws(()=>checkoutProductionSourceDraftSummary({...draft}),/unverified/);assert.doesNotMatch(draft.wire,/private-canary-do-not-embed|owned_review|owned_admin|127\.0\.0\.1|CREATE OR REPLACE FUNCTION|"body":|"serverAddress":|"password":/);
});
test('observed REST source does not authorize GRANT, imply Auth session proof or turn unknown effective gateway facts into defaults',()=>{
 const m=draft.material;assert.equal(m.gateway.configuredRestLogin,'authenticator');assert.equal(m.gateway.restContainerSessionLoginMatches,true);assert.equal(m.gateway.authRuntimeLoginProved,false);for(const k of ['effectiveKongRoutesProved','effectiveKongAuthenticationProved','cryptoIssuerProved','cryptoAudienceProved','cryptoAlgorithmProved','cryptoKidProved','configurationDefaultsAssumed','databaseTargetRechecked','readAuthorizationConferred'])assert.equal(m.gateway[k],false);assert.equal(m.gateway.serviceContainerProvenanceMatched,true);assert.equal(m.installedContractReference.gatewayMembershipApproved,false);assert.equal(m.installedContractReference.grantStatementsIncluded,false);
});
test('all production actions, SQL execution, version reservations, formal storage/signing and merchant scope stay absent',()=>{
 const m=draft.material;assert.ok(Object.values(m.authority).every(v=>v===false));assert.equal(m.registration.status,'unreserved');for(const k of ['sourceVersion','sealVersion','sourceName','sealName'])assert.equal(m.registration[k],null);assert.deepEqual(m.installer.sqlToExecute,[]);assert.equal(m.installer.implementedForProduction,false);for(const k of ['persistentStore','locator','backupProvider','formalSigner','signerOwner','credentialDeliveryPath'])assert.equal(m.installer[k],null);for(const k of ['merchantSites','flagsToWrite','businessRowsToWrite'])assert.deepEqual(m.rollout[k],[]);assert.equal(m.unresolved.length,9);assert.equal(m.evidence.freshInstallationBaselineProved,false);assert.equal(m.evidence.readPermissionReusable,false);
});
test('six-source snapshots and self-selected unrelated or synthetic registrations cannot become the complete baseline',async()=>{
 const six=await inputs(v=>{const versions=new Set(bundle.material.prerequisites.registry.map(r=>r.version));v.seal.core.registry.entries=v.seal.core.registry.entries.filter(r=>versions.has(r.version));v.seal.core.registry.count=6;});await assert.rejects(createCheckoutProductionSourceDraft(six),refuses('REQUIRES_FULL_REGISTRY'));
 await assert.rejects(createCheckoutProductionSourceDraft({...input,review:{...input.review}}),refuses('INVALID'));await assert.rejects(createCheckoutProductionSourceDraft({...input,observation:{...input.observation}}),refuses('INVALID'));
});
test('pinned reference digests, prior metadata projection and cross-capture chain cannot be replaced even with rehashed payloads',async()=>{
 await assert.rejects(createCheckoutProductionSourceDraft({...input,references:{...input.references,preinstallReviewSha256:'0'.repeat(64)}}));
 await assert.rejects(createCheckoutProductionSourceDraft({...input,preinstallCaptureWire:input.preinstallCaptureWire+' '}),refuses('REFERENCE_CHANGED'));
 const changed=changeWire(input,'preinstallCaptureWire','preinstallCaptureSha256',v=>v.remote.metadata.seal.core.context.backendPid++);await assert.rejects(createCheckoutProductionSourceDraft(changed),refuses('BASELINE_CAPTURE_CHANGED'));
 const chain=changeWire(input,'gatewayCaptureWire','gatewayCaptureSha256',v=>v.previousCaptureSha256='0'.repeat(64));await assert.rejects(createCheckoutProductionSourceDraft(chain),refuses('CAPTURE_CHAIN_CHANGED'));
});
test('a refused private input produces only a fixed error and bounded code, never catalogue or configuration details',async()=>{
 const changed=changeWire(input,'preinstallCaptureWire','preinstallCaptureSha256',v=>v.remote.metadata.seal.core.target.databaseName='private-canary-do-not-embed');
 await assert.rejects(createCheckoutProductionSourceDraft(changed),e=>refuses('BASELINE_CAPTURE_CHANGED')(e)&&!String(e.stack).includes('private-canary')&&!JSON.stringify(e).includes('private-canary')&&Object.keys(e).join(',')==='code');
});
test('container provenance, configured role, selected settings and claimed effective gateway changes refuse rather than repair',async()=>{
 for(const change of [v=>v.remote.containers[1].identitySha256='0'.repeat(64),v=>v.remote.roleSources['supabase-rest'].role='service_role',v=>v.remote.database.settings.push({key:'pgrst.jwt_aud',value:'other'}),v=>v.remote.kong.routes={state:'observed',items:[]}])await assert.rejects(createCheckoutProductionSourceDraft(changeWire(input,'gatewayCaptureWire','gatewayCaptureSha256',change)));
});
test('failed, skipped-boundary, repeated-debit or formally promoted acceptance claims cannot be used as application proof',async()=>{
 for(const change of [v=>v.reports[0].passed=false,v=>v.reports[14].runtime.financialCommitDispatches=2,v=>v.reports[14].runtime.nextUid=v.reports[14].runtime.issuerUid,v=>v.reports[14].generations[0].postgrestExpiredStatus=200,v=>v.productionAuthorized=true,v=>v.runs={secret:'private-canary-do-not-embed'}])await assert.rejects(createCheckoutProductionSourceDraft(changeWire(input,'acceptanceReviewWire','acceptanceReviewSha256',change)));
});
test('canonical verification reconstructs sources and rejects self-rehashed authority, baseline, version, key, SQL or rollout changes',async()=>{
 assert.equal((await verifyCheckoutProductionSourceDraft(draft.wire,input)).digest,draft.digest);
 for(const change of [m=>m.authority.installation=true,m=>m.registration.sourceVersion='202611269999',m=>m.gateway.cryptoAlgorithmProved=true,m=>m.sources.steps.pop(),m=>m.installer.sqlToExecute=['GRANT role'],m=>m.baseline.registry.entries.pop(),m=>m.rollout.merchantSites.push('10909095')]){const value=JSON.parse(draft.wire);change(value.material);value.sha256=sha(canonical(value.material));await assert.rejects(verifyCheckoutProductionSourceDraft(canonical(value),input),/draft_unverified/);}
 for(const wire of [draft.wire+'\n',draft.wire.slice(0,-1),canonical({...JSON.parse(draft.wire),extra:true})])await assert.rejects(verifyCheckoutProductionSourceDraft(wire,input),/draft_unverified/);
});
test('new preparation source cannot connect, issue credentials, execute SQL, write state or weaken any prior installer',async()=>{
 const source=await readFile('scripts/member-checkout-production-source-draft.mjs','utf8');assert.doesNotMatch(source,/child_process|process\.env|\bfetch\s*\(|writeFile|appendFile|mkdir|from ['"]pg['"]|execFile|spawnSync|productionAuthorized:\s*true|deploymentReady:\s*true/);assert.equal(bundle.material.registration.sourceVersion,'999999990047');assert.equal(bundle.material.registration.sealVersion,'999999990048');assert.equal(bundle.material.scope,'owned-ci-only-not-production');assert.equal(bundle.material.application.files,2971);
});
test('all six classified refusals use fixed Error instances, not runtime-dependent assertion formatting',async()=>{
 const text=await readFile('scripts/member-checkout-production-source-draft.mjs','utf8');
 const labels=['reference_changed','capture_chain_changed','container_chain_changed','saved_role_changed','requires_full_registry','baseline_capture_changed'];
 for(const label of labels)assert.equal(text.split("new Error('checkout_source_draft_"+label+"')").length-1,1);
 assert.throws(()=>assert.equal('same-prefix-'.repeat(1000)+'A','same-prefix-'.repeat(1000)+'B',new Error('fixed-reason')),e=>e.message==='fixed-reason');
});
