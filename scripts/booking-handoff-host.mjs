// One fixed, reviewed booking cutover. Building/staging/database preparation are
// separate guarded commands; this entry cannot bypass them or broaden scope.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {requireBookingAdmission} from './release-toolchain-booking-admission.mjs';
import {BOOKING_HANDOFF_CANDIDATE as CANDIDATE,BOOKING_HANDOFF_APPLICATION as APPLICATION,BOOKING_HANDOFF_BASELINE as BASELINE,
 BOOKING_HANDOFF_CANDIDATE_CLOSURE_SHA256,BOOKING_HANDOFF_NATIVE_SOURCES,assertBookingHandoffWindow} from './booking-handoff-policy.mjs';
import {BOOKING_HANDOFF_ROOT as ROOT,verifyBookingAtomicRuntimeCohort} from './booking-handoff-runtime.mjs';
import {prepareBookingHandoffPreflight,installAndDrainBookingIngress,activateRepairedBookingAuthority,closeBookingIngress} from './booking-handoff-execution.mjs';
import {createProductionBookingIngressPlan,BOOKING_INGRESS_VHOST} from './booking-handoff-ingress.mjs';
import {createBookingAtomicRoutingPlan,applyBookingAtomicRouting} from './booking-handoff-routing.mjs';
import {pauseLegacyBookingHost} from './booking-handoff-legacy.mjs';
import {armBookingHandoffWatchdog,finishBookingHandoffWatchdog} from './booking-handoff-watchdog.mjs';
import {commitBookingHandoffRetention,enableCommittedBookingWorker} from './booking-handoff-journal.mjs';
import {assertBookingRetentionHandoff} from './booking-handoff-retention.mjs';
import {withOnlineRetentionLocks,assertOnlineRetentionHeldLocks} from './online-release-retention-writer.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {retentionCanonicalText,retentionHash} from './online-release-retention-policy.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY} from './web-presentation-release-policy.mjs';
import {assertBookingHostInvocation,bookingHostRead as read,bookingHostWriteOnce as write,bookingHostReplace as replace,
 bookingHostHash as hash,bookingHostEqual as equal,bookingHostNeed as need,BOOKING_HOST_RELEASE as RELEASE} from './booking-handoff-host-io.mjs';

const location=a=>Object.fromEntries(['target','name','directory','port'].map(k=>[k,a[k]]));
const now=()=>new Date().toISOString();

/** Pure construction followed by the SAME retention validator used by history
 * replay. No fabricated observation, test fixture or success flag is accepted. */
export function bookingHandoffPublication({history,originalStageText,cohort,legacyTransition,activation,ruleRepair,rollbackReadiness,evidence}){
 const original=JSON.parse(originalStageText),prior=history.entries.at(-1);
 const added=cohort.processes.filter(p=>!prior.processes.some(old=>old.name===p.name));
 const handoff={evidence,originalStageText,legacyBefore:legacyTransition.legacyBefore,legacyAfter:legacyTransition.legacyAfter,
  added,runtimeByName:cohort.runtimeByName,databaseBefore:activation.before,databaseAfter:activation.after,rollbackReadiness,ruleRepair};
 assertBookingRetentionHandoff({handoff,prior,previousSha256:history.headSha256,active:cohort.active,rollback:cohort.rollback,
  processes:cohort.processes,toolRevision:evidence.toolRevision,completedAt:evidence.completedAt});
 const state={...original,...location(cohort.active),status:'active',activatedAt:evidence.completedAt,baseline:APPLICATION,
  oldName:cohort.rollback.name,oldDirectory:cohort.rollback.directory,oldPort:cohort.rollback.port,
  bookingHandoffSha256:retentionHash(handoff),bookingOriginalStageSha256:evidence.priorStageSha256};
 return {handoff,state,stateText:JSON.stringify(state,null,2),activeText:JSON.stringify(location(cohort.active))};
}

export async function executeBookingHandoffHost(operations){
 await operations.admit();await operations.preflight();const window=await operations.plans();
 assertBookingHandoffWindow(window,{nowMs:operations.nowMs()});const supervisor=await operations.arm();
 // Once armed, all failures are terminal for this controller. It must exit so
 // the independently inherited kernel lock and fixed recovery can take over.
 // No normal finally block restores the unsafe original JSON/routing edge.
 await operations.gateAndDrain();await operations.armCompatibleFallback();await operations.activate();
 await operations.pauseOriginalOnce();await operations.routePrimary();await operations.unfence();
 await operations.publication();const journal=await operations.journal();const worker=await operations.worker();
 const watchdog=await operations.finishSupervisor(supervisor);return {journal,worker,watchdog};
}

function nativeAcceptance(toolRevision){
 // The full native runner writes this only from actual normal/failure results.
 // Its implementation and source bindings are installed with this same tool.
 const adopted=reviewedBookingExecution(toolRevision);if(adopted){const admission=requireBookingAdmission(toolRevision);return admission.compatibility.nativeAcceptanceSha256;}
 const text=read(ROOT+'/native-handoff-acceptance.json'),value=JSON.parse(text);
 need(value.schemaVersion===1&&value.kind==='booking-full-native-handoff-acceptance'&&value.toolRevision===toolRevision&&
  value.candidate===CANDIDATE&&value.rollback===APPLICATION&&value.productionMutated===false&&
  value.postgresServerVersionNum==='150008'&&value.postgresSystemIdentifier!=='7612049595342295079'&&
  value.originalTimerMutated===false&&value.mailEnabled===false&&value.allFixturesStopped===true&&
  /^[1-9][0-9]{0,19}$/.test(value.postgresSystemIdentifier??'')&&Array.isArray(value.cases)&&value.cases.length===3&&['normal','controller-death-before-commit','controller-death-after-commit'].every(name=>
   value.cases.filter(c=>c.name===name&&c.completed===true&&c.elapsedMs>0&&c.elapsedMs<=600000&&c.inheritedKernelLock===true&&
    c.realNginx===true&&c.realPostgres===true&&c.realProcesses===true&&c.ownedFixturesOnly===true).length===1),'native_acceptance_missing');
 const completedAt=Date.parse(value.completedAt);need(Number.isFinite(completedAt)&&Date.now()>=completedAt&&Date.now()-completedAt<86400000,'native_acceptance_stale');
 equal(Object.keys(value.sourceHashes??{}).sort(),[...BOOKING_HANDOFF_NATIVE_SOURCES].sort(),'native_source_inventory');
 for(const file of BOOKING_HANDOFF_NATIVE_SOURCES)need(hash(read('/var/lib/faolla-online-code/'+toolRevision+'/scripts/'+file,{privateMode:false}))===value.sourceHashes[file],'native_source_changed');
 const roots=new Set();for(const c of value.cases){need(typeof c.receiptFile==='string'&&/^\/var\/lib\/faolla-booking-full-rehearsal-[A-Za-z0-9]+\/cases\/[a-z-]+\.json$/.test(c.receiptFile)&&
  path.basename(c.receiptFile)===c.name+'.json'&&hash(read(c.receiptFile))===c.receiptSha256,'native_case_changed');roots.add(path.dirname(path.dirname(c.receiptFile)));
  const actual=JSON.parse(read(c.receiptFile));for(const key of ['name','completed','elapsedMs','inheritedKernelLock','realNginx','realPostgres','realProcesses','ownedFixturesOnly'])equal(actual[key],c[key],'native_case_binding');
  need(actual.allFixturesStopped===true&&actual.gateClosed===true&&actual.rowsPreserved===true&&actual.actualDatabase?.systemIdentifier===value.postgresSystemIdentifier&&
   actual.actualDatabase?.serverVersionNum==='150008','native_actual_result');
 }need(roots.size===1,'native_case_root');
 return hash(text);
}

export function createBookingHandoffHostOperations(options){
 const {lock,toolRevision}=options;let window=null;
 const held=()=>assertOnlineRetentionHeldLocks(lock);
 return {nowMs:()=>Date.now(),
  admit:()=>{assertBookingHostInvocation(options);nativeAcceptance(toolRevision);verifyBookingAtomicRuntimeCohort(options);
   const assets=JSON.parse(read(ROOT+'/static-assets.json'));need(assets.kind==='booking-immutable-assets'&&assets.files>0,'assets_missing');},
  preflight:()=>prepareBookingHandoffPreflight(options),
  plans:()=>{
   held();const cohort=verifyBookingAtomicRuntimeCohort(options),vhostText=read(BOOKING_INGRESS_VHOST,{privateMode:false}),
    mainSha256=hash(read('/www/server/nginx/conf/nginx.conf',{privateMode:false})),before=Object.fromEntries(WEB_RELEASE_FILES.map(f=>[f,read(WEB_RELEASE_PROXY+'/'+f,{privateMode:false})]));
   const startedAt=now();window={id:randomUUID(),startedAt,deadlineAt:new Date(Date.parse(startedAt)+600000).toISOString()};
   const gate=createProductionBookingIngressPlan({vhostText,mainSha256,window}),routing=createBookingAtomicRoutingPlan({before,primary:cohort.active,rollback:cohort.rollback,window});
   write(ROOT+'/ingress-plan.json',retentionCanonicalText(gate));write(ROOT+'/routing-plan.json',retentionCanonicalText(routing));
   write(ROOT+'/recovery-plan.json',retentionCanonicalText({schemaVersion:1,kind:'booking-fixed-failure-recovery-plan',toolRevision,window,
    baseline:BASELINE,compatibleRollback:APPLICATION,candidate:CANDIDATE,authorityNeverDeactivated:true,legacyRowsNeverRestored:true,
    originalPauseAttemptFile:ROOT+'/legacy-restart-attempt.json',nativeAcceptanceSha256:nativeAcceptance(toolRevision)}));return window;
  },
  arm:()=>armBookingHandoffWatchdog(options),gateAndDrain:()=>installAndDrainBookingIngress(options),
  armCompatibleFallback:()=>applyBookingAtomicRouting({...options,phase:'armed'}),activate:()=>activateRepairedBookingAuthority(options),
  pauseOriginalOnce:()=>pauseLegacyBookingHost(options),routePrimary:()=>applyBookingAtomicRouting({...options,phase:'primary'}),unfence:()=>closeBookingIngress(options),
  publication:()=>{
   held();assertBookingHandoffWindow(window,{nowMs:Date.now()});const history=readOnlineRetentionHistory(),cohort=verifyBookingAtomicRuntimeCohort(options),
    preflight=JSON.parse(read(ROOT+'/preflight.json')),originalStageText=read(ROOT+'/primary-original-stage.json'),activation=JSON.parse(read(ROOT+'/activation.json')),
    ruleRepair=JSON.parse(read(ROOT+'/rule-repair.json')),rollbackReadiness=JSON.parse(read(ROOT+'/rollback-readiness.json')),
    legacyTransition=JSON.parse(read(ROOT+'/legacy-runtime-transition.json'));
   const evidence={schemaVersion:1,kind:'booking-task-handoff',candidate:CANDIDATE,baseline:BASELINE,application:APPLICATION,toolRevision,window,completedAt:now(),
    priorRetentionHeadSha256:history.headSha256,priorStageSha256:hash(originalStageText),sourceClosureSha256:BOOKING_HANDOFF_CANDIDATE_CLOSURE_SHA256,
    compatibilitySha256:preflight.compatibilitySha256,backupSha256:preflight.backupSha256,activationSha256:retentionHash(activation),
    ruleRepairSha256:retentionHash(ruleRepair),rollbackReadinessSha256:retentionHash(rollbackReadiness)};
   for(const [file,key]of [['preflight.json','preflightSha256'],['ingress-receipt.json','ingressGateSha256'],['legacy-drain.json','legacyDrainSha256'],['recovery-plan.json','recoveryPlanSha256']])evidence[key]=hash(read(ROOT+'/'+file));
   const publication=bookingHandoffPublication({history,originalStageText,cohort,legacyTransition,activation,ruleRepair,rollbackReadiness,evidence});
   write(ROOT+'/handoff-proof.json',retentionCanonicalText(publication.handoff));
   equal(read(RELEASE+'/'+CANDIDATE+'/state.json'),originalStageText,'primary_original_stage_changed');equal(read(RELEASE+'/active.json'),preflight.activeFileText,'active_predecessor_changed');
   write(ROOT+'/publication-metadata-attempt.json',retentionCanonicalText({window,at:now(),stateSha256:hash(publication.stateText),activeFileSha256:hash(publication.activeText)}));
   held();replace(RELEASE+'/'+CANDIDATE+'/state.json',originalStageText,publication.stateText,window.id+'-active-state');
   replace(RELEASE+'/active.json',preflight.activeFileText,publication.activeText,window.id+'-active-file');return publication;
  },
  journal:()=>commitBookingHandoffRetention(options),worker:()=>enableCommittedBookingWorker(options),
  finishSupervisor:handle=>finishBookingHandoffWatchdog({lock,handle}),
 };
}

async function main(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.argv.length===2,'fixed_invocation');
 const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
 need(directory==='/var/lib/faolla-online-code/'+toolRevision&&/^[a-f0-9]{40}$/.test(toolRevision)&&process.cwd()===directory,'fixed_source');
 const result=await withOnlineRetentionLocks(async lock=>{
  try{return await executeBookingHandoffHost(createBookingHandoffHostOperations({lock,toolRevision}));}
  catch(error){
   // After a supervisor lease has been claimed, exiting must NOT run the
   // normal lock-scope finally first. That would remove operation.lock while
   // the still-live parent briefly races the watchdog's kernel guard. Leave
   // the real inherited OFD and owned empty directory to independent recovery.
   let lease;try{lease=JSON.parse(read(ROOT+'/watchdog-lease.json'));}catch(readError){if(readError.code!=='ENOENT')throw readError;}
   if(lease?.parent?.pid===process.pid&&lease.toolRevision===toolRevision){
    try{write(ROOT+'/controller-failure.json',retentionCanonicalText({schemaVersion:1,kind:'booking-controller-failure',operationId:lease.window.id,at:now(),errorSha256:hash(String(error?.message??'unknown'))}));}
    finally{console.error('booking_handoff_controller_failed_independent_recovery_retains_lock');process.exit(1);}
   }throw error;
  }
 });
 console.log(JSON.stringify({kind:'booking-handoff-completed',target:CANDIDATE,worker:result.worker,watchdogOutcome:result.watchdog.outcome}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){main().catch(()=>{console.error('booking_handoff_not_completed_evidence_preserved');process.exitCode=1;});}
