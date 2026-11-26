// OFFLINE evidence verification only. Caller supplies saved bytes; no GitHub,
// database, filesystem discovery, secret, authority or approval is provided.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadGroupNextRevision} from './member-checkout-group-next-revision.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const exact=(v,keys)=>assert.deepEqual(Object.keys(v).sort(),[...keys].sort());
const verified=new WeakSet();
export const reviewedCheckoutAcceptanceIdentity=freeze({commit:'9892019811a06593c35e9a5e889c946a6184624b',
 reviewSha256:'f673f5af517d89cc63e232ad3c660f36aa8002341209025ffabfc409a04bcca1',
 runsSha256:'a9e90a6a9c90695f2ef7ce4fba97ae0ce9aeab9da17da0e3150e4e0e73eef1b8',
 runs:{baseline:'45769266768',revision:'45769266756',files:'45769266795',native:'45769266758'}});
const specification=Object.freeze([
 ['baseline','member-checkout-installation-commit-unknown',30,'owned-ci-atomic-installation-not-production','Atomic Installation (isolated PG 15.8) - commit-unknown'],
 ['baseline','member-checkout-installation-normal',30,'owned-ci-atomic-installation-not-production','Atomic Installation (isolated PG 15.8) - normal'],
 ...[['current-auth',47],['legacy',34],['modern',34]].map(([p,n])=>['baseline','member-checkout-real-auth-'+p,n,'isolated-real-auth-not-production','Real Auth ('+p+')']),
 ...['commit-unknown','normal'].map(p=>['revision','member-checkout-047-installation-'+p,29,'owned-ci-047-atomic-installation-not-production','Atomic Installation 047 (isolated PG 15.8) - '+p]),
 ['revision','member-checkout-047-interruption',11,'owned-ci-full-installer-interruption-not-production','Full Installer Interruption 047 (isolated PG 15.8)'],
 ...[['current-auth',53],['legacy',40],['modern',40]].map(([p,n])=>['revision','member-checkout-047-real-auth-'+p,n,'isolated-real-auth-not-production','Real Auth 047 ('+p+')']),
 ['revision','member-checkout-credential-file',26,'owned-ci-file-delivery-component-not-next-or-gateway','Credential File Delivery Component (isolated Linux)'],
 ['revision','member-checkout-credential-next',43,'owned-built-next-credential-delivery-not-production','Credential Delivery Built Next (real PG Auth PostgREST)'],
 ['revision','member-checkout-credential-renewal',5,'owned-ci-automatic-renewal-distinct-uid-component','Credential Renewal And Read-only UID Boundary (isolated Linux)'],
 ['revision','member-checkout-group-next',38,'owned-built-next-automatic-renewal-distinct-uid-not-production','Automatic Renewal Different UID Built Next (real PG Auth PostgREST)'],
 ['files','member-checkout-full-registry-files',7,'owned-linux-files-and-embedded-registry-not-production','Full Registry Native Files and Embedded SQL'],
 ...['normal','commit-unknown'].map(p=>['native','member-checkout-full-registry-native-'+p,14,'owned-native-full-registry-installer-not-production','Full Registry PG15.8 Installation ('+p+')']),
]);
export function reviewedCheckoutAcceptanceSpec(){return freeze(specification.map(v=>[...v]));}
function decode(wire,limit){assert.equal(typeof wire,'string');assert.ok(Buffer.byteLength(wire)>0&&Buffer.byteLength(wire)<=limit);return JSON.parse(wire);}
function workerChecks(workers,killKey,expected){
 assert.equal(workers.length,expected.length);
 assert.deepEqual(workers.map(w=>[w[killKey],w.expectedRefusal]),expected);
 for(const w of workers){assert.equal(w.forced,false);assert.equal(w.stdoutBytes,0);assert.equal(w.stderrBytes,0);assert.equal(w.signal,w[killKey]?'SIGKILL':null);assert.equal(w.code,w[killKey]?null:w.expectedRefusal?1:0);}
}
function groupChecks(r,current){
 assert.deepEqual(r.sourceRevision,current);assert.equal(r.candidateRevision.sha256,current.material.candidateRevisionSha256);
 assert.deepEqual(r.application,current.material.application);assert.deepEqual(r.baseApplication,current.material.frozenApplication);
 assert.deepEqual(r.expiryPolicy,{version:1,observationAfterMs:31000,proofAfterMs:34000,reads:2});assert.equal(r.generations.length,3);assert.equal(new Set(r.generations.map(g=>g.generation)).size,3);assert.equal(r.expiryObservations.length,8);
 for(const [i,g]of r.generations.entries()){
  assert.equal(g.postgrestExpiredStatus,401);assert.ok(g.observation.startedPastExpiryMs>=31000);assert.ok([200,401].includes(g.observation.status));assert.equal(g.expiryProof.status,401);assert.ok(g.expiryProof.startedPastExpiryMs>=34000);assert.ok(g.expiryProof.startedPastExpiryMs>=g.observation.endedPastExpiryMs);
  assert.deepEqual(r.expiryObservations.slice(i*2,i*2+2),[g.observation,g.expiryProof].map(s=>({generation:g.generation,expiresAt:g.expiresAt,...s})));
 }
 const tail=r.expiryObservations.slice(6);assert.deepEqual(tail,[r.outage.observation,r.outage.expiryProof].map(s=>({generation:tail[0].generation,expiresAt:tail[0].expiresAt,...s})));
 assert.equal(r.outage.realExpiredStatus,401);assert.equal(r.outage.originalBytesRetained,true);assert.equal(r.outage.dispatchesAfterCutoff,0);assert.ok(r.outage.stillValidReplies>0);assert.equal(r.outage.expiryProof.status,401);assert.ok(r.outage.expiryProof.startedPastExpiryMs>=34000);
 for(const row of r.expiryObservations){assert.ok(Number.isSafeInteger(row.startedPastExpiryMs));assert.ok(row.endedPastExpiryMs>=row.startedPastExpiryMs);if(row.startedPastExpiryMs>=34000)assert.equal(row.status,401);}
 const yes=['sameNextProcess','differentUid','automaticRenewal','nextSigningKeyReadDenied','nextCredentialWriteDenied','nextRequestReadDenied','issuerOutageAndRecovery','ordinaryServiceIdentityRetained'];
 const no=['reloadOrRestart','envFallback','signingMaterialPassedToNext','formalIssuerProvisioned','kongValidated','fullProductionGatewayValidated','productionReadPerformed','productionAuthorized','deploymentReady'];
 for(const k of yes)assert.equal(r.runtime[k],true);for(const k of no)assert.equal(r.runtime[k],false);
 assert.equal(r.runtime.financialCommitDispatches,1);assert.equal(r.runtime.financialDebitCount,1);assert.equal(r.runtime.financialPostRetries,0);assert.equal(r.runtime.actualWallClockGatewayExpirations,3);assert.notEqual(r.runtime.nextUid,r.runtime.issuerUid);assert.ok(r.runtime.nextUid>0&&r.runtime.issuerUid>0);
 assert.ok(r.continuousReplies>=3&&r.continuousReplies<200);assert.equal(r.methods.filter(m=>m==='faolla_member_checkout_submission_commit_v2').length,1);
 assert.equal(r.groupShutdown.code,0);assert.equal(r.groupShutdown.signal,null);assert.equal(r.groupShutdown.complete.passed,true);assert.equal(r.groupShutdown.complete.processes.length,2);assert.ok(r.groupShutdown.complete.processes.every(p=>p.code===0&&p.signal===null&&p.forced===false));
 assert.equal(r.databaseClosed,true);assert.equal(r.nextShutdown.acknowledged,true);assert.equal(r.nextShutdown.forbiddenFetches,0);assert.ok(r.stopped.every(p=>p.forced===false));assert.deepEqual(r.groupDiagnostics,[]);
}
function nativeChecks(r,mode,current){
 assert.equal(r.mode,mode);assert.equal(r.registryEngine,'PostgreSQL');assert.equal(r.serverVersion,'150008');assert.deepEqual(r.application,current.material.frozenApplication);
 assert.equal(r.bundleSha256,'f34249f74c0311323fac2f7779fe14ea3151ffacc74d3b5cacf75de8d41d839e');assert.equal(r.fixtureHistoricalRegistryRows,214);assert.equal(r.fixturePrerequisiteDdlSources,6);
 assert.equal(r.preinstall.functions,26);assert.equal(r.preinstall.guards,3);assert.equal(r.preinstall.registry,214);assert.match(r.preinstall.targetSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(r.installedContract,{functions:93,tables:24,guards:28,productionAuthorized:false,deploymentReady:false});
 for(const k of ['nativePostgresInstallationValidated','realDatabaseConnectionIdentityValidated','wholeInstallerInterrupted','persistentFullRegistryEvidenceValidated','syntheticGatewayAndAcceptanceReferences'])assert.equal(r[k],true);
 for(const k of ['fullHistoricalDdlReplay','fullProductionGatewayValidated','persistentProductionStorageValidated','hostBackupRestoreValidated','powerLossValidated','productionReadPerformed','productionAuthorized','deploymentReady','stripeEnabled'])assert.equal(r[k],false);
 const expected=[[false,true],[false,true],[false,true],[true,false],[false,false],[mode==='commit-unknown',false],[false,false],[false,false],[false,true],[false,true],[false,true],[false,true],[false,true],[false,true],[false,true],[false,false]];
 workerChecks(r.workers,'plannedKill',expected);
 for(const w of r.workers){if(!w.plannedKill)assert.equal(w.progress.opened,w.progress.closed);if(w.action==='recover'){assert.equal(w.progress.applied,0);assert.equal(w.progress.commitDispatches,0);}}
 const installations=r.workers.filter(w=>w.action==='install');assert.equal(installations.length,6);assert.deepEqual(installations.map(w=>w.progress.applied),[0,0,34,38,38,0]);assert.deepEqual(installations.map(w=>w.progress.commitDispatches),[0,0,0,0,1,0]);assert.equal(installations[2].progress.errorCode,'22012');
 assert.equal(r.openedConnections,r.closedConnections);assert.ok(r.openedConnections>16);assert.equal(r.remainingConnections,0);assert.equal(r.remainingChildren,0);assert.equal(r.cleanupFailures,0);
}

/** Saved kind is restricted to the exact externally reviewed historical bytes.
 * Synthetic kind can exercise this verifier but cannot bind saved production
 * evidence or claim that a real CI run was independently observed. */
export async function verifyReviewedCheckoutAcceptance(input){
 let stage='INPUT';
 try{
  exact(input,['kind','reviewWire','runsWire','reports','logs']);assert.ok(['saved-reviewed-owned-ci-evidence','owned-synthetic-evidence'].includes(input.kind));
  const review=decode(input.reviewWire,128*1024),runs=decode(input.runsWire,256*1024);
  stage='IDENTITY';
  if(input.kind==='saved-reviewed-owned-ci-evidence'){
   assert.equal(sha(input.reviewWire),reviewedCheckoutAcceptanceIdentity.reviewSha256);assert.equal(sha(input.runsWire),reviewedCheckoutAcceptanceIdentity.runsSha256);
   assert.equal(review.commit,reviewedCheckoutAcceptanceIdentity.commit);assert.deepEqual(review.runs,reviewedCheckoutAcceptanceIdentity.runs);
  }
  assert.equal(review.version,1);assert.equal(review.scope,'offline-reviewed-owned-native-full-registry-installation-not-production');assert.match(review.commit,/^[a-f0-9]{40}$/);
  exact(review.runs,['baseline','revision','files','native']);exact(runs,Object.keys(review.runs));assert.equal(review.jobs,18);assert.equal(review.fullCiPassed,true);assert.equal(review.totalScenarioChecks,524);assert.equal(review.retainedScenarioChecks,496);assert.equal(review.nativeFullRegistryScenarioChecks,28);
  for(const k of ['nativeFullRegistryInstalledPrivilegesValidated','wholeInstallerDeathAndDurableRecoveryValidated','pointsCouponBookingOnRecoveredInstallationValidated','syntheticGatewayAndAcceptanceReferences'])assert.equal(review[k],true);
  for(const k of ['fullHistoricalDdlReplay','fullProductionGatewayValidated','persistentProductionStorageValidated','hostBackupRestoreValidated','powerLossValidated','productionReadPerformed','productionAuthorized','deploymentReady','stripeEnabled'])assert.equal(review[k],false);
  assert.equal(review.reports.length,18);assert.equal(input.reports.length,18);assert.equal(new Set(input.reports.map(v=>v.artifact)).size,18);assert.equal(review.reports.reduce((n,r)=>n+r.checks,0),524);
  assert.equal(input.logs.length,2);assert.deepEqual(input.logs.map(v=>v.mode).sort(),['commit-unknown','normal']);
  stage='SOURCES';const current=await loadGroupNextRevision();assert.equal(current.sha256,'728ba93d53200b0ae9c7791c726988b4b56189d7c96208b563a3b965428a3849');
  const usedJobs=new Set(),usedArtifacts=new Set(),targets=new Set(),references=[];
  for(const [group,prefix,count,scope,jobName]of specification){
   stage='RUNS';
   const run=runs[group];assert.match(review.runs[group],/^[1-9][0-9]{0,19}$/);assert.equal(String(run.databaseId),review.runs[group]);assert.equal(run.headSha,review.commit);assert.equal(run.headBranch,'acceptance/member-checkout-real-auth-20261125');assert.equal(run.event,'push');assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
   assert.equal(run.jobs.length,{baseline:5,revision:10,files:1,native:2}[group]);const jobs=run.jobs.filter(j=>j.name===jobName);assert.equal(jobs.length,1);const job=jobs[0];assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');assert.ok(Number.isSafeInteger(job.databaseId)&&job.databaseId>0);assert.ok(!usedJobs.has(job.databaseId));usedJobs.add(job.databaseId);
   stage='REPORTS';const artifact=prefix+'-'+review.runs[group]+'-1',refs=review.reports.filter(v=>v.artifact===artifact);assert.equal(refs.length,1);const ref=refs[0];assert.equal(ref.group,group);assert.equal(ref.checks,count);assert.equal(ref.passed,true);assert.equal(ref.cleanupPassed,true);assert.ok(!usedArtifacts.has(artifact));usedArtifacts.add(artifact);
   const entry=input.reports.find(v=>v.artifact===artifact);assert.ok(entry);exact(entry,['artifact','wire']);assert.equal(sha(entry.wire),ref.sha256);const r=decode(entry.wire,4*1024*1024);
   assert.equal(r.commit,review.commit);assert.equal(r.scope,scope);assert.equal(r.passed,true);assert.equal(r.cleanupPassed,true);assert.equal(r.checks.length,count);assert.ok(r.checks.every(c=>c.passed===true));if(Object.hasOwn(r,'failure'))assert.equal(r.failure,null);
   if(prefix==='member-checkout-group-next'){stage='GROUP';groupChecks(r,current);}
   if(group==='native'){
    stage='NATIVE';const mode=prefix.endsWith('commit-unknown')?'commit-unknown':'normal';assert.equal(ref.mode,mode);nativeChecks(r,mode,current);targets.add(r.preinstall.targetSha256);
    stage='LOGS';
    const log=input.logs.find(v=>v.mode===mode);exact(log,['mode','wire']);assert.ok(Buffer.byteLength(log.wire)<=8*1024*1024);assert.equal(sha(log.wire),ref.logSha256);
    const lines=log.wire.split('\n');for(const n of [60,15])for(const metric of ['tests','pass'])assert.ok(lines.some(l=>l.trimEnd().endsWith('# '+metric+' '+n)));assert.ok(!lines.some(l=>/not ok [0-9]|# skipped [1-9]/.test(l)));
   }
   if(group==='files'){assert.equal(r.registryEngine,'PGlite');assert.equal(r.receiptInsertions,2);assert.equal(r.registryCount,216);assert.equal(r.nativePostgresInstallationValidated,false);assert.equal(r.wholeInstallerInterrupted,false);}
   references.push({artifact,group,sha256:ref.sha256,checks:count,...(ref.logSha256?{logSha256:ref.logSha256}:{})});
  }
  stage='SUMMARY';assert.equal(usedJobs.size,18);assert.equal(usedArtifacts.size,18);assert.equal(targets.size,2);
  const material={version:1,kind:'checkout-reviewed-owned-acceptance-reference-v1',referenceKind:input.kind,reviewSha256:sha(input.reviewWire),runsSha256:sha(input.runsWire),commit:review.commit,runs:review.runs,jobs:18,scenarioChecks:524,retainedScenarioChecks:496,nativeScenarioChecks:28,references,
   candidateRevisionSha256:current.material.candidateRevisionSha256,renewalRevisionSha256:current.material.renewalRevisionSha256,combinedRevisionSha256:current.sha256,candidateApplication:current.material.application,frozenApplication:current.material.frozenApplication,
   savedOwnedCiReportBytesVerified:input.kind==='saved-reviewed-owned-ci-evidence',syntheticClaimsOnly:input.kind==='owned-synthetic-evidence',
   distinctUidRenewalBuiltNextValidated:input.kind==='saved-reviewed-owned-ci-evidence',nativeFullRegistryInstallationValidated:input.kind==='saved-reviewed-owned-ci-evidence',pointsCouponBookingOnRecoveredInstallationValidated:input.kind==='saved-reviewed-owned-ci-evidence',sameCommitSeparateOwnedFixtures:true,
   nativeEvidenceUsesSyntheticSourceReferences:true,allHistoricalDdlReplayed:false,completeProductionTopologyValidated:false,productionEvidenceFreshnessProved:false,readPermissionReusable:false,productionAuthorized:false,deploymentReady:false,stripeEnabled:false};
  const result=freeze({material,sha256:sha(canonical(material))});verified.add(result);return result;
 }catch{throw Object.assign(Error('checkout_reviewed_acceptance_unverified'),{code:'CHECKOUT_ACCEPTANCE_'+stage});}
}
export function reviewedCheckoutAcceptanceSummary(value){
 assert.ok(verified.has(value),'checkout_reviewed_acceptance_unverified');return freeze({sha256:value.sha256,...value.material});
}
