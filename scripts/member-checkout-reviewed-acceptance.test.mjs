import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ownedReviewedAcceptanceInputs as inputs} from './fixtures/member-checkout-reviewed-acceptance-fixture.mjs';
import {verifyReviewedCheckoutAcceptance,reviewedCheckoutAcceptanceSummary,reviewedCheckoutAcceptanceIdentity,reviewedCheckoutAcceptanceSpec} from './member-checkout-reviewed-acceptance.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const verify=change=>verifyReviewedCheckoutAcceptance(inputs(change));
const refuses=e=>e.message==='checkout_reviewed_acceptance_unverified'&&/^CHECKOUT_ACCEPTANCE_(INPUT|IDENTITY|SOURCES|RUNS|REPORTS|GROUP|NATIVE|LOGS|SUMMARY)$/.test(e.code);

test('all 18 exact run/artifact slots and 524 scenarios bind one revision without counting duplicate unit tests',async()=>{
 const result=await verify(),s=reviewedCheckoutAcceptanceSummary(result);
 assert.equal(s.jobs,18);assert.equal(s.scenarioChecks,524);assert.equal(s.retainedScenarioChecks,496);assert.equal(s.nativeScenarioChecks,28);assert.equal(s.references.length,18);
 assert.equal(new Set(s.references.map(r=>r.artifact)).size,18);assert.equal(s.combinedRevisionSha256,'728ba93d53200b0ae9c7791c726988b4b56189d7c96208b563a3b965428a3849');
 assert.equal(s.candidateApplication.files,2974);assert.equal(s.frozenApplication.files,2971);assert.equal(s.referenceKind,'owned-synthetic-evidence');assert.equal(s.savedOwnedCiReportBytesVerified,false);assert.equal(s.syntheticClaimsOnly,true);assert.equal(s.nativeFullRegistryInstallationValidated,false);
 assert.equal(s.sameCommitSeparateOwnedFixtures,true);assert.equal(s.completeProductionTopologyValidated,false);assert.equal(s.productionAuthorized,false);
});

test('saved kind refuses self-selected or self-rehashed synthetic review/run bytes instead of trusting claimed CI identity',async()=>{
 const input=inputs();input.kind='saved-reviewed-owned-ci-evidence';await assert.rejects(verifyReviewedCheckoutAcceptance(input),refuses);
 const expected=reviewedCheckoutAcceptanceIdentity;assert.equal(expected.commit,'9892019811a06593c35e9a5e889c946a6184624b');assert.equal(expected.reviewSha256,'f673f5af517d89cc63e232ad3c660f36aa8002341209025ffabfc409a04bcca1');assert.equal(Object.isFrozen(expected.runs),true);
 const r=JSON.parse(input.reviewWire);r.commit=expected.commit;r.runs=expected.runs;input.reviewWire=JSON.stringify(r);await assert.rejects(verifyReviewedCheckoutAcceptance(input),refuses);
});

test('missing, duplicate or altered raw report/log bytes refuse even when the summary says all passed',async()=>{
 for(const change of [v=>v.reports.pop(),v=>v.reports.push(v.reports[0]),v=>v.reports[1]=v.reports[0],v=>v.reports[0].wire+=' ',v=>v.logs.pop(),v=>v.logs[1]=v.logs[0],v=>v.logs[0].wire+='changed']){
  const input=inputs();change(input);await assert.rejects(verifyReviewedCheckoutAcceptance(input),refuses);
 }
});

test('jobs must be completed successful, unique, exact branch/event and same commit; copied job IDs or names are rejected',async()=>{
 for(const change of [v=>v.runs.baseline.headSha='b'.repeat(40),v=>v.runs.revision.headBranch='main',v=>v.runs.files.event='workflow_dispatch',v=>v.runs.native.status='in_progress',v=>v.runs.baseline.jobs[0].conclusion='skipped',v=>v.runs.baseline.jobs[1].databaseId=v.runs.baseline.jobs[0].databaseId,v=>v.runs.baseline.jobs[1].name=v.runs.baseline.jobs[0].name,v=>v.runs.files.jobs.pop()])await assert.rejects(verify(change),refuses);
});

test('claimed totals, partial cleanup, report failure, skipped scenario and formal authority cannot be promoted by recomputing hashes',async()=>{
 for(const change of [v=>v.review.jobs=17,v=>v.review.totalScenarioChecks=525,v=>v.review.retainedScenarioChecks=489,v=>v.review.fullCiPassed=false,v=>v.review.productionAuthorized=true,v=>v.review.fullHistoricalDdlReplay=true,v=>v.reports[0].value.passed=false,v=>v.reports[0].value.cleanupPassed=false,v=>v.reports[0].value.failure={message:'private-canary'},v=>v.reports[0].value.checks[0].passed=false,v=>v.reports[0].value.checks.pop()])await assert.rejects(verify(change),refuses);
});

test('current combined proof cannot use archived c4, different candidate, old expiry policy or a final successful expired token',async()=>{
 for(const change of [r=>r.sourceRevision.sha256='a476794f63fec4151027e416b410d0bb94b971f08edc1fa0882654eae0f774f2',r=>r.candidateRevision.sha256='0'.repeat(64),r=>r.application.files=2971,r=>r.expiryPolicy.proofAfterMs=31000,r=>r.generations[0].expiryProof.status=200,r=>r.expiryObservations[0].generation='replaced',r=>r.generations[1].generation=r.generations[0].generation])await assert.rejects(verify(v=>change(v.reports[14].value)),refuses);
});

test('renewal identity boundaries, no financial retry, issuer failure recovery and clean process shutdown remain necessary',async()=>{
 for(const change of [r=>r.runtime.nextUid=r.runtime.issuerUid,r=>r.runtime.financialCommitDispatches=2,r=>r.runtime.financialDebitCount=2,r=>r.runtime.financialPostRetries=1,r=>r.runtime.envFallback=true,r=>r.runtime.signingMaterialPassedToNext=true,r=>r.runtime.formalIssuerProvisioned=true,r=>r.outage.dispatchesAfterCutoff=1,r=>r.outage.expiryProof.status=200,r=>r.groupShutdown.complete.processes[0].forced=true,r=>r.nextShutdown.forbiddenFetches=1,r=>r.groupDiagnostics.push({message:'private-canary'})])await assert.rejects(verify(v=>change(v.reports[14].value)),refuses);
});

test('native source count and effective ACL contract may not substitute six-row installation or a full production clone claim',async()=>{
 for(const change of [r=>r.fixtureHistoricalRegistryRows=6,r=>r.fixturePrerequisiteDdlSources=214,r=>r.preinstall.functions=25,r=>r.preinstall.guards=2,r=>r.installedContract.functions=92,r=>r.installedContract.guards=27,r=>r.installedContract.productionAuthorized=true,r=>r.fullHistoricalDdlReplay=true,r=>r.persistentProductionStorageValidated=true,r=>r.bundleSha256='0'.repeat(64)])await assert.rejects(verify(v=>change(v.reports[16].value)),refuses);
});

test('native whole-installer death, no replay, refused unknown evidence and cleanup cannot be replaced by claimed success',async()=>{
 for(const change of [r=>r.wholeInstallerInterrupted=false,r=>r.workers[3].plannedKill=false,r=>r.workers[2].progress.applied=33,r=>r.workers[8].progress.applied=38,r=>r.workers[6].progress.commitDispatches=1,r=>r.workers[0].forced=true,r=>r.workers[0].stderrBytes=1,r=>r.workers[0].progress.closed=0,r=>r.remainingConnections=1,r=>r.cleanupFailures=1])await assert.rejects(verify(v=>change(v.reports[16].value)),refuses);
 await assert.rejects(verify(v=>v.reports[17].value.preinstall.targetSha256=v.reports[16].value.preinstall.targetSha256),refuses);
});

test('native logs must retain all 60 contracts, 14 child scenarios plus parent, no skips and no failed assertions',async()=>{
 for(const text of ['# tests 60\n# pass 60\n# tests 14\n# pass 14\n','# tests 60\n# pass 60\n# tests 15\n# pass 15\nnot ok 1\n','# tests 60\n# pass 60\n# tests 15\n# pass 15\n# skipped 1\n'])await assert.rejects(verify(v=>v.logs[0].wire=text),refuses);
});

test('proof summaries are branded, deeply immutable, fixed-error only, and contain no raw report or log payload',async()=>{
 const result=await verify(),s=reviewedCheckoutAcceptanceSummary(result);assert.throws(()=>reviewedCheckoutAcceptanceSummary({...result}),/unverified/);assert.throws(()=>s.runs.native='other',TypeError);assert.throws(()=>s.productionAuthorized=true,TypeError);
 const input=inputs();input.reports[0].wire='private-canary';await assert.rejects(verifyReviewedCheckoutAcceptance(input),e=>refuses(e)&&!e.stack.includes('private-canary')&&Object.keys(e).join(',')==='code');
 assert.doesNotMatch(JSON.stringify(s),/"wire":|"workers":|"checks":\[|private-canary/);assert.equal(s.readPermissionReusable,false);
});

test('verifier has no connector, path discovery, credential/production read, write, reservation, SQL or authority switch',async()=>{
 const text=await readFile(new URL('./member-checkout-reviewed-acceptance.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(text,/process\.env|\bfetch\s*\(|child_process|readFile|writeFile|appendFile|mkdir|from ['"]pg['"]|productionAuthorized:\s*true|deploymentReady:\s*true/);
 assert.equal(reviewedCheckoutAcceptanceSpec().length,18);assert.equal(reviewedCheckoutAcceptanceSpec().reduce((n,v)=>n+v[2],0),524);assert.throws(()=>reviewedCheckoutAcceptanceSpec()[0][2]=1,TypeError);
});
