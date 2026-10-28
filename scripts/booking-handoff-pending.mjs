// One terminal booking-ready case; the original general guard is unchanged.
import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {BOOKING_HANDOFF_APPLICATION as APPLICATION} from './booking-handoff-policy.mjs';
import {reviewedBookingExecution} from './release-toolchain-authority.mjs';
import {collectBookingReadyRuntimeCohort} from './booking-ready-runtime.mjs';
import {observeBookingBuiltSmokePair} from './booking-built-smoke-repair.mjs';
import {observeBookingCompatibilityContinuation} from './booking-compatibility-tool.mjs';
import {observeBookingRegistryContinuation} from './booking-registry-tool.mjs';
import {assertBookingRollbackToolPreparation} from './booking-handoff-retention.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {ATTENDANCE_STAGED_REPAIR,assertAttendanceStagedRepairReceipt} from './attendance-staged-tool-repair-policy.mjs';
import {CONTACT_WECHAT_STAGED_REPAIR,assertContactWechatStagedRepairReceipt} from './contact-wechat-staged-tool-repair-policy.mjs';
import {LOGIN_UNBUILT_REPAIR,assertLoginUnbuiltRepairReceipt} from './merchant-login-unbuilt-repair-policy.mjs';
import {GOOGLE_UNBUILT_CLOSURE,GOOGLE_UNBUILT_ABSENT_PATHS,GOOGLE_UNBUILT_PRESERVED_FILES,
  assertGoogleUnbuiltClosureReceipt} from './google-transition-unbuilt-close-policy.mjs';
import {assertOnlineToolOwnedPath,runOnlineToolGit,readUnpublishedBuildEnvironmentDirectories,
  UNPUBLISHED_CANDIDATE_INCIDENT,UNPUBLISHED_CANDIDATE_ABSENT_PATHS,UNPUBLISHED_CANDIDATE_PRESERVED_FILES,
  UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT,UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS,UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES,
  assertUnpublishedCandidateTerminationReceipt,assertUnpublishedBuildEnvironmentTerminationReceipt} from './prepare-online-release-tool.mjs';
const APP='/www/wwwroot/merchant-space';
const MAINTENANCE='/var/lib/faolla-maintenance/merchant-space',RELEASE_ROOT='/var/lib/faolla-online-release';
const SHA=/^[a-f0-9]{40}$/;
const fail=code=>{throw Error('online_tool_'+code);};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=file=>{try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const equal=(a,b,code)=>{if(!isDeepStrictEqual(a,b))fail(code);};
export const BOOKING_BASE_PENDING_GUARD_SHA256='2d0b65ce8ff36b2658af66d54210a069523e66c2b969584118b36c0fe58c314b';
function originalGuard(source){
  source=source.replaceAll('\r\n','\n');
  const start=source.indexOf('export function assertOnlineToolNoPending'),end=source.indexOf('export function withOnlineToolPreparationLocks');
  if(start<0||end<=start)fail('booking_original_guard_missing');
  return source.slice(start,end);
}
function privateRead(file){
  assertOnlineToolOwnedPath(file,'file');const before=fs.lstatSync(file);
  if((before.mode&0o777)!==0o600||before.size<1||before.size>16*1024**2)fail('booking_terminal_file');
  const identity=st=>Object.fromEntries(['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].map(k=>[k,st[k]]));
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    equal(identity(fs.fstatSync(fd)),identity(before),'booking_terminal_file_replaced');const bytes=fs.readFileSync(fd);
    equal(identity(fs.fstatSync(fd)),identity(before),'booking_terminal_file_changed');
    equal(identity(fs.lstatSync(file)),identity(before),'booking_terminal_file_replaced');
    if(bytes.length!==before.size)fail('booking_terminal_file_changed');return bytes;
  }finally{fs.closeSync(fd);}
}
function validateBookingRollbackTerminal({stateText,directory,state,checkPath}){
  if(directory!==RELEASE_ROOT+'/'+APPLICATION)fail('release_pending');
  checkPath(directory);checkPath(state,'file');
  if((fs.lstatSync(directory).mode&0o777)!==0o700)fail('unsafe_path');
  equal(privateRead(state),Buffer.from(stateText),'booking_terminal_state_changed');
  const source=APP+'.web-releases/'+APPLICATION.slice(0,12)+'-online';
  const artifacts={buildEvidence:privateRead(directory+'/attendance-build-proof.json'),
    runtime:privateRead(directory+'/atomic-runtime.json'),environmentFile:privateRead(source+'/.env.local')};
  assertBookingRollbackToolPreparation({stateText,history:readOnlineRetentionHistory(),artifacts});
  if(runOnlineToolGit(source,['rev-parse','HEAD']).toString().trim()!==APPLICATION||
    runOnlineToolGit(source,['status','--porcelain=v1','--untracked-files=all']).toString().trim())fail('booking_terminal_source_changed');
  const proof=JSON.parse(artifacts.buildEvidence);
  assertOnlineToolOwnedPath(source+'/.next/BUILD_ID','file');
  if(proof.target!==APPLICATION||proof.guardedCommand!=='npm run build'||proof.memoryBytes!==4294967296||
    proof.heapMiB!==3072||proof.cpuQuotaPercent!==100||proof.tasks!==128||proof.seconds!==1200||
    proof.privateNetworkVerified!==true||proof.swapBytes!==0||
    fs.readFileSync(source+'/.next/BUILD_ID','utf8').trim()!==proof.buildId)fail('booking_terminal_build_changed');
}

function bookingHandoffPendingBody({maintenance = MAINTENANCE, releaseRoot = RELEASE_ROOT, fixedStagedRepairReceipt, fixedContactWechatStagedRepairReceipt, fixedLoginUnbuiltRepairReceipt} = {}, checkPath = assertOnlineToolOwnedPath, builtPair) {
  // This is not a CLI skip option. Only the separately reviewed, locked repair
  // entrypoint supplies a complete receipt for its single fixed built/unbuilt case.
  if (fixedStagedRepairReceipt !== undefined) assertAttendanceStagedRepairReceipt(fixedStagedRepairReceipt);
  if (fixedStagedRepairReceipt !== undefined && fixedContactWechatStagedRepairReceipt !== undefined) fail('release_pending');
  if (fixedContactWechatStagedRepairReceipt !== undefined) assertContactWechatStagedRepairReceipt(fixedContactWechatStagedRepairReceipt);
  if (fixedLoginUnbuiltRepairReceipt !== undefined) {
    if (fixedStagedRepairReceipt !== undefined || fixedContactWechatStagedRepairReceipt !== undefined) fail('release_pending');
    assertLoginUnbuiltRepairReceipt(fixedLoginUnbuiltRepairReceipt);
  }
  checkPath(maintenance);
  const statePath = path.join(maintenance, 'state.json'); checkPath(statePath, 'file');
  if (JSON.parse(fs.readFileSync(statePath, 'utf8')).phase !== 'ended') fail('maintenance_not_ended');
  checkPath(releaseRoot);
  let stagedRepairMatched = false, contactStagedRepairMatched = false;
  let loginUnbuiltRepairMatched = false;
  for (const name of fs.readdirSync(releaseRoot)) {
    if (name === 'active.json') {checkPath(path.join(releaseRoot, name), 'file'); continue;}
    if (!SHA.test(name)) fail('release_entry_invalid');
    const directory = path.join(releaseRoot, name); checkPath(directory);
    const state = path.join(directory, 'state.json'); checkPath(state, 'file');
    const stateText = fs.readFileSync(state, 'utf8'), value = JSON.parse(stateText);
    if (value.target !== name) fail('release_pending');
    if (['active', 'rolled-back'].includes(value.status)) continue;
    // BEGIN exact already-built booking smoke repair; normal callers have no pair.
    if (builtPair && Object.hasOwn(builtPair.preserved, name)) {
      if (directory !== RELEASE_ROOT+'/'+name || sha256(privateRead(state)) !== builtPair.preserved[name].stateSha256) fail('release_pending');
      continue;
    }
    // END exact already-built booking smoke repair.
    // BEGIN exact booking terminal state; all original pending cases stay below.
    if (name === APPLICATION && value.status === 'booking-rollback-ready') {
      validateBookingRollbackTerminal({stateText,directory,state,checkPath});
      continue;
    }
    // END exact booking terminal state.
    if (name === '8fabf8078a15115ad7765ae7dc60ae63adc74f98') {
      const p = GOOGLE_UNBUILT_CLOSURE, receiptPath = path.join(directory, 'unpublished-termination.json');
      if (directory !== p.operation || value.status !== 'preparing' || sha256(stateText) !== p.stateSha256 || !exists(receiptPath)) fail('release_pending');
      checkPath(p.directory); checkPath(receiptPath, 'file');
      for (const [full, mode] of [[directory, 0o700], [state, 0o600], [receiptPath, 0o600]])
        if ((fs.lstatSync(full).mode & 0o777) !== mode) fail('unsafe_path');
      const preservedFiles = {};
      for (const [key, full] of Object.entries(GOOGLE_UNBUILT_PRESERVED_FILES)) {
        checkPath(full, 'file'); if ((fs.lstatSync(full).mode & 0o777) !== 0o600) fail('unsafe_path');
        preservedFiles[key] = sha256(fs.readFileSync(full));
      }
      for (const full of GOOGLE_UNBUILT_ABSENT_PATHS) if (exists(full)) fail('release_pending');
      assertGoogleUnbuiltClosureReceipt({stateText,receipt:JSON.parse(fs.readFileSync(receiptPath,'utf8')),
        preservedFiles,absentPaths:[...GOOGLE_UNBUILT_ABSENT_PATHS]});
      continue;
    }
    if (fixedLoginUnbuiltRepairReceipt !== undefined && name === LOGIN_UNBUILT_REPAIR.target) {
      const receipt = fixedLoginUnbuiltRepairReceipt, incident = LOGIN_UNBUILT_REPAIR;
      if (directory !== incident.operation || value.status !== 'preparing' || value.lane !== 'merchant-login-recovery-code-only' ||
          value.baseline !== incident.baseline || value.directory !== incident.directory || value.name !== incident.name ||
          value.port !== incident.port || sha256(stateText) !== incident.stateSha256 || receipt.originalStateSha256 !== incident.stateSha256)
        fail('release_pending');
      if ((fs.lstatSync(directory).mode & 0o777) !== 0o700 || (fs.lstatSync(state).mode & 0o777) !== 0o600) fail('unsafe_path');
      checkPath(incident.directory); loginUnbuiltRepairMatched = true; continue;
    }
    if (fixedContactWechatStagedRepairReceipt !== undefined && name === CONTACT_WECHAT_STAGED_REPAIR.target) {
      const receipt = fixedContactWechatStagedRepairReceipt, incident = CONTACT_WECHAT_STAGED_REPAIR;
      if (directory !== incident.operation || value.status !== 'preparing' || value.lane !== 'contact-wechat-code-only' ||
          value.baseline !== incident.baseline || value.directory !== incident.directory || value.name !== incident.name ||
          value.port !== incident.port || sha256(stateText) !== incident.stateSha256 ||
          receipt.originalStateSha256 !== incident.stateSha256) fail('release_pending');
      if ((fs.lstatSync(directory).mode & 0o777) !== 0o700 || (fs.lstatSync(state).mode & 0o777) !== 0o600) fail('unsafe_path');
      checkPath(incident.directory);
      assertContactWechatStagedRepairReceipt(receipt, {target: name, toolRevision: receipt.toolRevision});
      contactStagedRepairMatched = true;
      continue;
    }
    if (fixedStagedRepairReceipt !== undefined && name === ATTENDANCE_STAGED_REPAIR.target) {
      const receipt = fixedStagedRepairReceipt, incident = ATTENDANCE_STAGED_REPAIR;
      if (directory !== incident.operation || value.status !== 'staged' || value.baseline !== incident.baseline ||
          value.directory !== incident.directory || sha256(stateText) !== incident.stateSha256 ||
          receipt.originalStateSha256 !== incident.stateSha256) fail('release_pending');
      if ((fs.lstatSync(directory).mode & 0o777) !== 0o700 || (fs.lstatSync(state).mode & 0o777) !== 0o600) fail('unsafe_path');
      checkPath(incident.directory);
      assertAttendanceStagedRepairReceipt(receipt, {target: name, toolRevision: receipt.toolRevision});
      stagedRepairMatched = true;
      continue;
    }
    const environmentCase = name === UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT.target;
    const incident = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT : UNPUBLISHED_CANDIDATE_INCIDENT;
    const retainedPaths = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES : UNPUBLISHED_CANDIDATE_PRESERVED_FILES;
    const absentPaths = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS : UNPUBLISHED_CANDIDATE_ABSENT_PATHS;
    const receiptPath = path.join(directory, 'unpublished-termination.json');
    if (name !== incident.target || directory !== incident.operation || value.status !== 'preparing' || !exists(receiptPath)) fail('release_pending');
    checkPath(receiptPath, 'file'); checkPath(incident.directory);
    for (const [full, mode] of [[directory, 0o700], [state, 0o600], [receiptPath, 0o600]])
      if ((fs.lstatSync(full).mode & 0o777) !== mode) fail('unsafe_path');
    const preservedFiles = {};
    for (const [key, full] of Object.entries(retainedPaths)) {
      checkPath(full, 'file'); if ((fs.lstatSync(full).mode & 0o777) !== 0o600) fail('unsafe_path');
      preservedFiles[key] = sha256(fs.readFileSync(full));
    }
    for (const full of absentPaths) if (exists(full)) fail('release_pending');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (environmentCase) {
      checkPath(incident.buildSource, 'file');
      assertUnpublishedBuildEnvironmentTerminationReceipt({stateText, receipt, preservedFiles, absentPaths: [...absentPaths],
        preservedDirectories: readUnpublishedBuildEnvironmentDirectories(fs, checkPath), buildSourceSha256: sha256(fs.readFileSync(incident.buildSource))});
    } else assertUnpublishedCandidateTerminationReceipt({stateText, receipt, preservedFiles, absentPaths: [...absentPaths]});
  }
  if (fixedStagedRepairReceipt !== undefined && !stagedRepairMatched) fail('release_pending');
  if (fixedContactWechatStagedRepairReceipt !== undefined && !contactStagedRepairMatched) fail('release_pending');
  if (fixedLoginUnbuiltRepairReceipt !== undefined && !loginUnbuiltRepairMatched) fail('release_pending');
}

export function assertBookingBasePendingGuardSource(source){
  if(sha256(originalGuard(source))!==BOOKING_BASE_PENDING_GUARD_SHA256)fail('booking_original_guard_changed');return true;
}
export function assertBookingBuiltSmokeToolNoPending(){
  assertBookingBasePendingGuardSource(fs.readFileSync(new URL('./prepare-online-release-tool.mjs',import.meta.url),'utf8'));
  // No user-supplied token, target, path, receipt or exception. The actual fixed
  // pair is re-attested immediately before replaying every other original case.
  const pair=observeBookingBuiltSmokePair();return bookingHandoffPendingBody({},assertOnlineToolOwnedPath,pair);
}
export function assertBookingCompatibilityToolNoPending(){
  if(arguments.length)fail('booking_unexpected_pending_argument');
  assertBookingBasePendingGuardSource(fs.readFileSync(new URL('./prepare-online-release-tool.mjs',import.meta.url),'utf8'));
  const pair=observeBookingCompatibilityContinuation('staged');
  // The same private pending body; only actual fixed, fully attested states.
  for(const target of Object.keys(pair.preserved))pair.preserved[target].stateSha256=sha256(privateRead(RELEASE_ROOT+'/'+target+'/state.json'));
  return bookingHandoffPendingBody({},assertOnlineToolOwnedPath,pair);
}
export function assertBookingRegistryToolNoPending(){
  if(arguments.length)fail('booking_unexpected_pending_argument');
  assertBookingBasePendingGuardSource(fs.readFileSync(new URL('./prepare-online-release-tool.mjs',import.meta.url),'utf8'));
  const pair=observeBookingRegistryContinuation('staged');
  for(const target of Object.keys(pair.preserved))pair.preserved[target].stateSha256=sha256(privateRead(RELEASE_ROOT+'/'+target+'/state.json'));
  return bookingHandoffPendingBody({},assertOnlineToolOwnedPath,pair);
}
export function assertBookingHandoffToolNoPending(...args){
  if(args.length>2)fail('booking_unexpected_pending_argument');
  const file=new URL('./prepare-online-release-tool.mjs',import.meta.url);assertOnlineToolOwnedPath(fileURLToPath(file),'file');
  assertBookingBasePendingGuardSource(fs.readFileSync(file,'utf8'));
  return bookingHandoffPendingBody(...args);
}
export function assertReviewedBookingNoPending(toolRevision){
  if(arguments.length!==1||!reviewedBookingExecution(toolRevision))fail('booking_reviewed_source_required');
  assertBookingBasePendingGuardSource(fs.readFileSync(new URL('./prepare-online-release-tool.mjs',import.meta.url),'utf8'));
  const cohort=collectBookingReadyRuntimeCohort({toolRevision}),C=cohort.active.target;
  const expected={[C]:'7ba13be0b859c918a71481b469596d6f2ef430ba61b1fc1946471812fb5651d3',[APPLICATION]:'12a7590d9de39d10179d0b60d3730c0451c5ad9e2b9a6d22044a77fe0861be3d'};
  const pair={preserved:{}};for(const [target,digest]of Object.entries(expected)){
    if(sha256(privateRead(RELEASE_ROOT+'/'+target+'/state.json'))!==digest)fail('release_pending');pair.preserved[target]={stateSha256:digest};
  }
  return bookingHandoffPendingBody({},assertOnlineToolOwnedPath,pair);
}
