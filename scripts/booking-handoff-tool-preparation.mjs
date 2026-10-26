// Source-only installer for the single certified booking-ready state.
// The original bootstrap and all original pending-candidate protections remain
// mandatory; no candidate, DB, process, traffic or historical receipt is edited.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {spawnSync} from 'node:child_process';
import {assertBookingHandoffToolNoPending,assertBookingBasePendingGuardSource} from './booking-handoff-pending.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES,WEB_RELEASE_PROXY,WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
import {verifyHistoricalOnlineTool} from './online-release-tool-retention.mjs';
import {createOnlineReleaseToolPlan,executeOnlineReleaseToolPlan,verifyOnlineReleaseTool,verifyOnlineToolBootstrap,
  assertOnlineToolOwnedPath,withOnlineToolPreparationLocks,runOnlineToolGit} from './prepare-online-release-tool.mjs';
const APP='/www/wwwroot/merchant-space',TOOL_ROOT='/var/lib/faolla-online-code';
const MAINTENANCE='/var/lib/faolla-maintenance/merchant-space',RELEASE_ROOT='/var/lib/faolla-online-release';
const SELF='scripts/booking-handoff-tool-preparation.mjs',SHA=/^[a-f0-9]{40}$/;
const fail=code=>{throw Error('online_tool_'+code);};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const equal=(a,b,code)=>{if(!isDeepStrictEqual(a,b))fail(code);};
function verifyAdapter(target){
  const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=path.basename(directory);
  if(revision.length!==40||!SHA.test(revision)||directory!==TOOL_ROOT+'/'+revision)fail('booking_adapter_path');
  const ownPlan=createOnlineReleaseToolPlan(revision);
  if(revision===target)verifyOnlineReleaseTool(ownPlan);
  else verifyHistoricalOnlineTool(ownPlan,target);
  const plan=createOnlineReleaseToolPlan(target);
  // Every original bootstrap check, including the unchanged helper + four
  // builtin-only dependency bytes, remains mandatory before any checkout.
  verifyOnlineToolBootstrap(plan,directory+'/scripts/prepare-online-release-tool.mjs');
  if(!fs.readFileSync(fileURLToPath(import.meta.url)).equals(runOnlineToolGit(APP,['show',target+':'+SELF])))fail('booking_adapter_source_changed');
  const standard=runOnlineToolGit(APP,['show',target+':scripts/prepare-online-release-tool.mjs']).toString();
  assertBookingBasePendingGuardSource(standard);
  return plan;
}
function protectedFacts(){
  const files=[RELEASE_ROOT+'/active.json',MAINTENANCE+'/state.json',WEB_RELEASE_MARKER,
    ...WEB_RELEASE_FILES.map(file=>WEB_RELEASE_PROXY+'/'+file)];
  const hashes=Object.fromEntries(files.map(file=>{assertOnlineToolOwnedPath(file,'file');return [file,sha256(fs.readFileSync(file))];}));
  const r=spawnSync('pm2',['jlist'],{encoding:'utf8',timeout:10000,maxBuffer:32*1024**2,windowsHide:true,
    env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2'}});
  if(r.status!==0||r.error||r.signal)fail('booking_adapter_observation');
  return {hashes,retentionHeadSha256:readOnlineRetentionHistory().headSha256,
    processes:JSON.parse(r.stdout).map(normalizeRetirementProcess).sort((a,b)=>a.pmId-b.pmId)};
}
export function prepareBookingHandoffToolMain(args=process.argv.slice(2)){
  if(process.platform!=='linux'||process.getuid?.()!==0||args.length!==1)fail('invocation_invalid');
  const plan=verifyAdapter(args[0]);
  return withOnlineToolPreparationLocks({deployLock:APP+'.deploy.lock',maintenance:MAINTENANCE},()=>{
    verifyAdapter(plan.target);assertBookingHandoffToolNoPending();
    const before=protectedFacts(),mask=process.umask(0o077);
    try{
      const result=executeOnlineReleaseToolPlan(plan);
      verifyAdapter(plan.target);assertBookingHandoffToolNoPending();equal(protectedFacts(),before,'booking_adapter_live_state_changed');
      return {...result,bookingTerminalStateVerified:true,housekeepingPerformed:false};
    }finally{process.umask(mask);}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(prepareBookingHandoffToolMain()));}
  catch(e){console.error(/^online_tool_[a-z_]+$/.test(e?.message??'')?e.message:'booking_handoff_tool_preparation_unverified');process.exitCode=1;}
}
