// Explicit standby maintenance for a reviewed ordinary application release.
// Reuse the ORIGINAL full retirement observer/plan/stop/persistence/journal.
// No migration, route edit, delete, restart, stop-by-name, or blind retry exists.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {withReviewedApplicationExecution,withApplicationStandbyExecution} from './application-release-authority.mjs';
import {withOnlineRetentionLocks,createOnlineRetentionProductionOperations,runOnlineRetentionUnderHeldLocks} from './online-release-retention-writer.mjs';
import {assertOnlineRetentionPlan,retentionHash} from './online-release-retention-policy.mjs';
import {bookingHostRead} from './booking-handoff-host-io.mjs';
const need=(value,reason)=>{if(!value)throw Error('application_standby_'+reason);};
const stableObservation=value=>{const result={...value};delete result.established;return result;};
export function applicationStandbyPlan(target,baseline,victimTarget){
 for(const value of [target,baseline,victimTarget])need(/^[a-f0-9]{40}$/.test(value??''),'identity');
 need(new Set([target,baseline,victimTarget]).size===3,'protected_target');
 return{target,baseline,victimTarget,source:'/var/lib/faolla-online-code/'+target,
  retainsFiles:true,retainsLogs:true,retainsRegistration:true,changesRoutes:false,changesDatabase:false};
}
export async function executeApplicationStandbyInspection(operations){
 const history=operations.history(),before=await operations.observe();assertOnlineRetentionPlan(before,history);
 need(before.kind==='retire'&&before.victim,'scope');
 await operations.wait(2000);const after=await operations.observe();assertOnlineRetentionPlan(after,history);
 need(isDeepStrictEqual(stableObservation(before),stableObservation(after))&&isDeepStrictEqual(operations.history(),history),'observation_changed');
 return{kind:'application-standby-eligible-not-stopped',activeTarget:before.active.target,rollbackTarget:before.rollback.target,
  victimTarget:before.victim.target,pmId:before.victim.process.pmId,pid:before.victim.process.pid,observationSha256:retentionHash(stableObservation(before)),stopped:false};
}
export async function applicationStandbyMain(action,target,baseline,victimTarget){
 const plan=applicationStandbyPlan(target,baseline,victimTarget);
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&
  process.cwd()===plan.source&&fileURLToPath(import.meta.url)===plan.source+'/scripts/application-release-standby.mjs'&&
  process.argv.length===6&&['inspect','retire'].includes(action),'invocation');
 return withOnlineRetentionLocks(lock=>withReviewedApplicationExecution({target,baseline,lock},()=>
  withApplicationStandbyExecution({target,baseline,victimTarget,action},async authority=>{
   const options={toolRevision:target,kind:'retire',activeTarget:authority.activeTarget,victimTarget,lock};
   const inspection=await executeApplicationStandbyInspection(createOnlineRetentionProductionOperations(options));
   if(action==='inspect')return inspection;
   const certificate=await runOnlineRetentionUnderHeldLocks(options);
   // Original writer proves the complete process set, saved PM2 configuration,
   // source, PID birth, no children/connections/route reference and paused jobs.
   need(JSON.parse(bookingHostRead('/var/lib/faolla-online-release/active.json')).target===authority.activeTarget,'active_changed');
   return{kind:'application-standby-retired',toolRevision:target,activeTarget:authority.activeTarget,rollbackTarget:certificate.rollback.target,
    victimTarget,certificateSha256:retentionHash(certificate),retainsFiles:true,retainsLogs:true,retainsRegistration:true,
    databaseChanged:false,routesChanged:false,mailEnabled:false};
  })));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const[action,target,baseline,victimTarget,...extra]=process.argv.slice(2);
 if(extra.length)throw Error('application_standby_invocation');
 applicationStandbyMain(action,target,baseline,victimTarget).then(value=>console.log(JSON.stringify(value)),error=>{
  console.error(JSON.stringify({kind:'application-standby-refused',code:/^[a-z_]{1,160}$/.test(error?.message??'')?error.message:'unconfirmed',automaticRetryAllowed:false}));process.exitCode=1;
 });
}
