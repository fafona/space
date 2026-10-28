// Canonical fixed-profile production entry. Unlike release-toolchain.mjs (the
// diagnostic CLI), publish can mutate production ONLY after independent main,
// full CI, source/build, ownership, backup, native recovery and existing guards.
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';
import {canonicalJson,sha256,fingerprint,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {collectRemoteReleaseReview,inspectPinnedExecutionSource,assertUnchangedApplicationSource,parseSourceTree,sourceGit,ownedReleasePath} from './release-toolchain-source.mjs';
import {withReviewedBookingExecution,reviewedBookingExecution,refreshReviewedBookingExecution} from './release-toolchain-authority.mjs';
import {BOOKING_PREPARATION_REVISION,verifyBookingPreparation} from './release-toolchain-booking-profile.mjs';
import {latestBookingQualification,verifyQualificationFiles,collectFreshBookingAdmission,withFreshBookingAdmission,requireBookingAdmission,observeBookingCompatibility} from './release-toolchain-booking-admission.mjs';
import {prepareExecutionWorker} from './release-toolchain-worker.mjs';
import {runFullToolchainRehearsal} from './release-toolchain-full-rehearsal.mjs';
import {rehearseFullToolchainInterruption} from './release-toolchain-full-interrupt.mjs';
import {localHostObservation} from './release-toolchain-doctor.mjs';
import {createToolchainRun,executeJournaledStage,inspectToolchainRun,toolchainRunBinding} from './release-toolchain-journal.mjs';
import {withOnlineRetentionLocks,assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {assertReviewedBookingNoPending} from './booking-handoff-pending.mjs';
import {collectBookingReadyRuntimeCohort,bookingReadyRawProcesses} from './booking-ready-runtime.mjs';
import {createBookingHandoffHostOperations,executeBookingHandoffHost} from './booking-handoff-host.mjs';
import {inspectBookingHandoffPreflight} from './booking-handoff-execution.mjs';
import {assertBookingWatchdogControllerArguments} from './booking-handoff-watchdog.mjs';
import {stageFailureDiagnostic} from './release-toolchain-diagnostics.mjs';
import {FULL_REHEARSAL_SOURCES} from './release-toolchain-native-inventory.mjs';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {bookingHostRead,bookingHostWriteOnce} from './booking-handoff-host-io.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory),ROOT='/var/lib/faolla-booking-handoff/'+C;
let reportingStage='source',reportingArtifacts;
const seal=(file,value)=>bookingHostWriteOnce(file,canonicalJson(value)+'\n'),read=file=>JSON.parse(bookingHostRead(file));
const same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'observation_mismatch');
function recordStageFailure(error,stage){if(!reportingArtifacts)return;try{const file=reportingArtifacts+'/failure-'+stage+'.json';if(!fs.existsSync(file))seal(file,{...stageFailureDiagnostic(error,{stage,toolRevision,knownFiles:FULL_REHEARSAL_SOURCES}),at:new Date().toISOString()});}catch{console.error('release_toolchain_private_diagnostic_unconfirmed');}}
function invocation(){need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(toolRevision)&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory,'unsupported_runtime');}
function privateChild(parent,name){ownedReleasePath(parent,{directory:true});const child=parent+'/'+name;fs.mkdirSync(child,{mode:0o700});return child;}
function ensurePrivate(parent,name){const child=parent+'/'+name;if(!fs.existsSync(child))privateChild(parent,name);ownedReleasePath(child,{directory:true,privateMode:true});return child;}
async function publicVersions(expected){const result=[];for(const origin of ['https://faolla.com','https://launch.faolla.com']){const r=await fetch(origin+'/api/app-web-version?releaseToolchain='+randomUUID(),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(5000)}),v=await r.json();need(r.status===200&&v.ok===true&&v.buildId===expected,'observation_mismatch');result.push({origin,status:r.status,buildId:v.buildId});}return result;}
export function assertCanonicalReleaseCommand(args){need(Array.isArray(args)&&args.length===1&&['status','qualify','prepare-worker','validate','publish'].includes(args[0]),'invalid_contract');return args[0];}
export function releaseStatusFailure(stage,error){const names={source:'source',review:'source',environment:'environment',preparation:'candidate',qualification:'rehearsal',compatibility:'compatibility',worker:'candidate',public:'verify'};need(Object.hasOwn(names,stage),'invalid_contract');return {stage,passed:false,failure:publicFailure(error,{stage:names[stage]})};}
export async function collectReleaseToolchainStatus(){
 invocation();const checks=[];let qualification;async function check(stage,work){try{const detail=await work();checks.push({stage,passed:true,detail});}catch(error){checks.push(releaseStatusFailure(stage,error));}}
 await check('source',()=>inspectPinnedExecutionSource({revision:toolRevision,directory}).inventorySha256);
 await check('review',()=>collectRemoteReleaseReview(toolRevision));
 await check('environment',()=>{const h=localHostObservation(directory);need(h.platform==='linux'&&h.architecture==='x64'&&h.nodeMajor===20&&h.availableDiskBytes>=1024**3,'unsupported_runtime');return {...h,applicationRebuildRequired:false};});
 await check('preparation',()=>{const p=verifyBookingPreparation(BOOKING_PREPARATION_REVISION);return {revision:p.revision,applicationBuilds:p.application,preservedSha256:p.preservedSha256};});
 await check('qualification',()=>{qualification=latestBookingQualification(toolRevision,inspectPinnedExecutionSource({revision:toolRevision,directory}).inventorySha256);return qualification.sha256;});
 await check('compatibility',()=>{need(qualification,'evidence_invalid');return observeBookingCompatibility(qualification);});
 await check('worker',()=>{const p=bookingReadyRawProcesses().find(p=>p.name==='merchant-space-booking-atomic-'+C.slice(0,12));need(p?.pm2_env.pm_exec_path===directory+'/scripts/booking-atomic-worker.mjs','source_changed');return {pid:p.pid,gated:!fs.existsSync(ROOT+'/worker-enabled.json')};});
 await check('public',()=>publicVersions(B));return {kind:'release-toolchain-production-readiness',toolRevision,checks,readyForFreshAdmission:checks.every(c=>c.passed),freshEncryptedBackupStillRequired:true,publicationAuthority:false,productionMutated:false};
}
async function qualify(){
 invocation();const review=await collectRemoteReleaseReview(toolRevision,{production:false}),source=inspectPinnedExecutionSource({revision:toolRevision,directory});
 assertUnchangedApplicationSource(C,parseSourceTree(sourceGit('/www/wwwroot/merchant-space',['ls-tree','-r','-z',C])),source.rows);
 return withOnlineRetentionLocks(async lock=>{assertOnlineRetentionHeldLocks(lock);const preparation=verifyBookingPreparation(BOOKING_PREPARATION_REVISION),root=ensurePrivate(ensurePrivate(ROOT,'toolchain-qualification'),toolRevision),attempt=privateChild(root,'attempt_'+Date.now()+'_'+randomUUID());
  seal(attempt+'/started.json',{kind:'release-toolchain-qualification-attempt',toolRevision,inventorySha256:source.inventorySha256,review,application:preparation.application,startedAt:new Date().toISOString()});
  const before=await publicVersions(B);try{reportingStage='rehearsal';const result=await runFullToolchainRehearsal();same(verifyBookingPreparation(BOOKING_PREPARATION_REVISION),preparation);same(await publicVersions(B),before);assertOnlineRetentionHeldLocks(lock);
   const native=verifyQualificationFiles(result.root,{toolRevision,inventorySha256:source.inventorySha256}),interruption=await rehearseFullToolchainInterruption();same(verifyBookingPreparation(BOOKING_PREPARATION_REVISION),preparation);same(await publicVersions(B),before);
   seal(attempt+'/verified.json',{toolRevision,root:result.root,nativeSha256:native.sha256,interruptionRoot:interruption.root,interruptionSha256:interruption.sha256,application:preparation.application,completedAt:new Date().toISOString()});
   return {kind:'release-toolchain-qualified',toolRevision,root:result.root,attempt,nativeSha256:native.sha256,productionMutated:false,mailEnabled:false};
  }catch(error){seal(attempt+'/failed.json',{...publicFailure(error,{stage:'rehearsal'}),failedAt:new Date().toISOString()});throw error;}
 });
}
// Tested sequencing seam, not an actuator. The real entry constructs all IO
// itself; no CLI plan, injected database, green JSON or override is accepted.
export async function executeCanonicalPublication(operations){
 await operations.source();await operations.bundle();await operations.environment();await operations.backupAndCompatibility(async()=>{
  await operations.candidate();await operations.rehearsal();await operations.admission();await operations.switch();await operations.verify();
 });return operations.result();
}
export async function executeCanonicalValidation(operations){
 await operations.source();await operations.bundle();await operations.environment();await operations.backupAndCompatibility(async()=>{
  await operations.candidate();await operations.rehearsal();await operations.admission();
 });return operations.result();
}
async function publish(lock,authority,{publication=true}={}){
 assertOnlineRetentionHeldLocks(lock);assertReviewedBookingNoPending(toolRevision);const qualification=latestBookingQualification(toolRevision,authority.tool.inventorySha256);same(qualification.application,authority.prepared.application);
 // A stale worker is an EARLY refusal, before any production backup/preflight
 // or public mutation. prepare-worker is a separate one-attempt operation.
 const cohort=collectBookingReadyRuntimeCohort({toolRevision}),worker=cohort.processes.find(p=>p.name==='merchant-space-booking-atomic-'+C.slice(0,12));need(worker?.executable===directory+'/scripts/booking-atomic-worker.mjs','source_changed');
 const parent=ensurePrivate('/var/lib','faolla-release-toolchain-runs'),binding=toolchainRunBinding({profile:'booking-handoff',application:authority.application,toolRevision,toolInventorySha256:authority.tool.inventorySha256}),run=createToolchainRun(parent,binding),artifacts=privateChild(ensurePrivate(ROOT,'toolchain-admission'),Date.now()+'-'+randomUUID());
 reportingArtifacts=artifacts;
 const stage=async(name,execute,verify=v=>v)=>{reportingStage=name;try{return await executeJournaledStage(run,name,{binding,observe:()=>fingerprint('evidence',{toolRevision,name},'canonical-json-v1'),execute,verify:async value=>fingerprint('evidence',await verify(value),'canonical-json-v1')});}catch(error){recordStageFailure(error,name);throw error;}};
 let result;return (publication?executeCanonicalPublication:executeCanonicalValidation)({
  source:()=>stage('source',()=>{reviewedBookingExecution(toolRevision);return authority.application;}),bundle:()=>stage('bundle',()=>authority.tool),
  environment:()=>stage('environment',()=>{const h=localHostObservation(directory);need(h.platform==='linux'&&h.architecture==='x64'&&h.nodeMajor===20&&h.availableDiskBytes>=1024**3,'unsupported_runtime');return h;}),
  backupAndCompatibility:async next=>{let admission;await stage('backup',async()=>{admission=await collectFreshBookingAdmission({lock,directory:artifacts,qualification});return admission.proof.backup;});
   return withFreshBookingAdmission(admission,async()=>{await stage('compatibility',()=>requireBookingAdmission(toolRevision).compatibility);return next();});},
  candidate:()=>stage('candidate',()=>collectBookingReadyRuntimeCohort({toolRevision})),rehearsal:()=>stage('rehearsal',()=>verifyQualificationFiles(qualification.root,{toolRevision,inventorySha256:authority.tool.inventorySha256}).sha256),
  admission:()=>stage('admission',async()=>{await refreshReviewedBookingExecution(toolRevision);assertReviewedBookingNoPending(toolRevision);const preflight=await inspectBookingHandoffPreflight({lock,toolRevision});return {admission:requireBookingAdmission(toolRevision),preflight:preflight.preflight};}),
  switch:()=>stage('switch',async()=>{try{result=await executeBookingHandoffHost(createBookingHandoffHostOperations({lock,toolRevision}));return result;}catch(error){
   const lease=fs.existsSync(ROOT+'/watchdog-lease.json')?read(ROOT+'/watchdog-lease.json'):null;if(lease?.parent?.pid===process.pid&&lease.toolRevision===toolRevision){seal(ROOT+'/controller-failure.json',{kind:'release-toolchain-controller-failure',operationId:lease.window.id,errorSha256:sha256(String(error?.message??'unknown')),at:new Date().toISOString()});console.error('release_toolchain_controller_failed_independent_recovery_retains_lock');process.exit(1);}throw error;
  }}),verify:()=>stage('verify',async()=>({public:await publicVersions(C),result})),result:()=>{const audit={toolRevision,run,journalHead:inspectToolchainRun(run).head,evidenceDirectory:artifacts,freshAdmissionSha256:sha256(bookingHostRead(artifacts+'/admission.json'))};
   const completed=publication?{...audit,kind:'release-toolchain-publication-completed',mailEnabled:false,result}:{...audit,kind:'release-toolchain-preflight-validated',verifiedThrough:'admission',applicationPublished:false,productionDatabaseMutated:false,trafficChanged:false,mailEnabled:false,publicationAuthority:false};seal(artifacts+'/completion.json',completed);return completed;},
 });
}
async function main(){invocation();const action=assertCanonicalReleaseCommand(process.argv.slice(2));if(action==='publish'){need(fs.realpathSync(process.execPath)==='/usr/bin/node','unsupported_runtime');assertBookingWatchdogControllerArguments(fs.readFileSync('/proc/self/cmdline','utf8').replace(/\0+$/,'').split('\0'),toolRevision,true);}if(action==='status')return collectReleaseToolchainStatus();if(action==='qualify')return qualify();
 return withReviewedBookingExecution({applicationRevision:C,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyBookingPreparation},authority=>withOnlineRetentionLocks(lock=>{
  if(action!=='prepare-worker')return publish(lock,authority,{publication:action==='publish'});reportingStage='candidate';assertReviewedBookingNoPending(toolRevision);const qualification=latestBookingQualification(toolRevision,authority.tool.inventorySha256);same(qualification.application,authority.prepared.application);return prepareExecutionWorker({lock,toolRevision});
 }));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(result=>console.log(canonicalJson(result)),error=>{recordStageFailure(error,reportingStage);console.error(canonicalJson({...publicFailure(error,{stage:reportingStage}),...(reportingArtifacts?{evidenceDirectory:reportingArtifacts}:{})}));process.exitCode=1;});
