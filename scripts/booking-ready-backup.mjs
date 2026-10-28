// Revalidate the retained formal backup under its ORIGINAL source identity.
// The new source-only receipt is checked separately, never substituted into it.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C,BOOKING_HANDOFF_BASELINE as B} from './booking-handoff-policy.mjs';
import {BOOKING_BUILT_SMOKE_PINS as P} from './booking-built-smoke-repair-policy.mjs';
import {BOOKING_DEPENDENCY_BASE as BASE,BOOKING_DEPENDENCY_STATES as STATES} from './booking-dependency-continuation-policy.mjs';
import {BOOKING_CI_RECEIPT,BOOKING_CI_INPUTS_SHA256} from './booking-ci-continuation-policy.mjs';
import {assertBookingReadySource} from './booking-ready-tool.mjs';
import {retainedBookingMigrationBackup} from './release-toolchain-admission-context.mjs';
import {assertBookingDependencyBinding,bookingModeAwareDependencies} from './booking-dependency-fingerprint.mjs';
import {BOOKING_FORMAL_DIRECTORY} from './booking-formal-backup-policy.mjs';
import {BOOKING_REGISTRY_ORIGINAL_TOOL} from './booking-registry-tool-policy.mjs';
import {readBookingFormalFile as read,assertBookingFormalPreserved} from './booking-formal-backup-tool.mjs';
import {attendanceRepairTreeFingerprint as tree} from './attendance-staged-tool-repair.mjs';
import {validateAttendanceBackupEvidence} from './attendance-production-database-migrations.mjs';
import {bookingPublicationBackupRequest,assertBookingFormalBackupBinding,validateBookingPublicationBackupEvidence as priorValidate} from './booking-formal-backup.mjs';
import {runOnlineToolGit} from './prepare-online-release-tool.mjs';
export {bookingPublicationBackupRequest};
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),APP='/www/wwwroot/merchant-space';
const OP='/var/lib/faolla-online-release/'+C,DIR=OP+'/'+BOOKING_FORMAL_DIRECTORY;
const need=(v,c)=>{if(!v)throw Error('booking_ready_backup_'+c);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b,c)=>need(isDeepStrictEqual(a,b),c);
export function observeBookingReadyApplication(){
 const application={};
 for(const pin of P.pair){
  const operation='/var/lib/faolla-online-release/'+pin.target,directory=APP+'.web-releases/'+pin.target.slice(0,12)+'-online';
  const git=args=>runOnlineToolGit(directory,args).toString().trim();
  need(git(['rev-parse','HEAD'])===pin.target&&!git(['status','--porcelain=v1','--untracked-files=all']),'application_source');
  for(const row of runOnlineToolGit(APP,['ls-tree','-r','-z',pin.target]).toString().split('\0').filter(Boolean)){
   const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
   need(m&&!m[3].split('/').some(p=>['','..','.'].includes(p)),'source_entry');
   const bytes=read(directory+'/'+m[3],{privateMode:false});need(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')===m[2],'application_blob');
  }
  for(const [name,digest]of Object.entries(pin.files)){
   const file=name==='state.json'?(pin.target===C?OP+'/built-smoke-original-state.json':OP+'/'+STATES.rollback.file):operation+'/'+name;
   need(hash(read(file))===digest,'application_proof');
  }
  need(hash(read(directory+'/.env.local'))===pin.envSha256,'application_environment');
  const dependencies=tree(directory+'/node_modules',{allowInternalLinks:true}),built=tree(directory+'/.next',{exclude:['cache','trace']});
  const saved=JSON.parse(read(pin.target===C?OP+'/'+STATES.primary.file:operation+'/rollback-built.json'));
  assertBookingDependencyBinding({target:pin.target,savedDigest:pin.target===C?saved.bookingDependenciesSha256:saved.dependenciesSha256,
   modeAwareDigest:bookingModeAwareDependencies(directory+'/node_modules'),streamedTree:dependencies});
  same(built,pin.built,'application_build');
  application[pin.target]={target:pin.target,tree:git(['rev-parse','HEAD^{tree}']),originalBuildTool:BOOKING_REGISTRY_ORIGINAL_TOOL,
   buildProofSha256:pin.files['attendance-build-proof.json'],environmentSha256:pin.envSha256,dependenciesSha256:dependencies.sha256,builtOutputSha256:built.sha256};
 }
 return application;
}
function observe(){
 const toolRevision=path.basename(ROOT);assertBookingReadySource(toolRevision);
 const application=observeBookingReadyApplication();
 const receipt=read(OP+'/'+BOOKING_CI_RECEIPT),prior=JSON.parse(receipt);
 need(prior.toolRevision===BASE&&prior.sourceInputsSha256===BOOKING_CI_INPUTS_SHA256,'backup_source');
 return {candidate:C,baseline:B,toolRevision:BASE,sourceInputsSha256:prior.sourceInputsSha256,toolClosureSha256:prior.toolClosureSha256,
  preservedSha256:assertBookingFormalPreserved(),toolReceiptSha256:hash(receipt),application:application[C],
  compatibilitySha256:hash(read(OP+'/booking-compatibility.json')),compatibilityEvidenceSha256:hash(read(OP+'/booking-compatibility-evidence.json'))};
}
export async function validateBookingPublicationBackupEvidence(request){
 if(request?.target!==C)return priorValidate(request);
 const retained=await retainedBookingMigrationBackup(request);if(retained)return retained;
 same(request,bookingPublicationBackupRequest(C,OP),'scope');const before=observe();
 const observed={...before,attemptSha256:hash(read(DIR+'/attempt.json')),keySha256:hash(read(DIR+'/backup.key')),
  createReportSha256:hash(read(request.createReport)),verifyReportSha256:hash(read(request.verifyReport))};
 const backup=await validateAttendanceBackupEvidence({...request,target:BASE});
 assertBookingFormalBackupBinding(JSON.parse(read(DIR+'/application-binding.json')),observed,backup);
 same(observe(),before,'source_changed');return backup;
}
