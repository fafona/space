import {createHash} from 'node:crypto';
import {buildAttendanceOnlineCandidate,attendanceOnlineBuildPlan} from './attendance-online-build.mjs';
import {assertContactWechatBuildEnvironmentKeys} from './contact-wechat-online-build.mjs';

// Approved 2026-10-18. This does not expand any previously authorized lane.
export const BACKUP_RELEASE_LANE='super-admin-backup-code-only';
export const BACKUP_RELEASE_BASELINE='9a877c86de64b094aa9268d9c03fb0ccec57b926';
export const BACKUP_REVIEWED_TOOL_REVISION='0e56725326ee150a43ad16d14e89f928405c7c9d';
export const BACKUP_APPLICATION_FILES=Object.freeze([
 'src/lib/platformAdminBackupCreateClient.ts','src/lib/platformMerchantSnapshot.ts',
 'src/lib/platformAdminBackupCreateClient.test.ts','src/lib/platformAdminBackupStrictWriteSecurity.test.ts',
 'src/lib/platformAdminBackupValidation.test.ts',
]);
// Inert checker repairs already merged after the live application was built.
// Require their exact reviewed Git bytes, not merely their filenames.
export const BACKUP_HISTORICAL_FILES=Object.freeze([
 'scripts/attendance-staged-tool-repair.test.mjs','scripts/contact-wechat-release-policy.test.mjs',
 'scripts/contact-wechat-staged-tool-repair-policy.mjs','scripts/contact-wechat-staged-tool-repair-policy.test.mjs',
 'scripts/contact-wechat-staged-tool-repair.mjs','scripts/contact-wechat-staged-tool-repair.test.mjs',
 'scripts/online-unpublished-candidate.test.mjs','scripts/prepare-online-release-tool.mjs','scripts/prepare-online-release-tool.test.mjs',
]);
export const BACKUP_TOOL_FILES=Object.freeze([
 'scripts/super-admin-backup-release-policy.mjs','scripts/super-admin-backup-release-policy.test.mjs',
 'scripts/online-traffic-release-policy.mjs','scripts/online-traffic-publication-policy.mjs',
 'scripts/online-traffic-release.mjs','scripts/online-traffic-release.test.mjs',
 'scripts/online-traffic-publication-policy.test.mjs','scripts/customer-code-release-policy.test.mjs',
 'docs/super-admin-backup-release-20261018.md',
]);
const allowed=new Set([...BACKUP_APPLICATION_FILES,...BACKUP_HISTORICAL_FILES,...BACKUP_TOOL_FILES]);
const fail=reason=>{throw Error(`super_admin_backup_release_${reason}`);};
export const hasBackupReleaseAnchor=files=>Array.isArray(files)&&BACKUP_APPLICATION_FILES.every(file=>files.includes(file));
export function assertBackupReleaseScope(files){
 if(!Array.isArray(files)||!BACKUP_APPLICATION_FILES.every(file=>files.includes(file))||new Set(files).size!==files.length||files.some(file=>!allowed.has(file)))fail('scope_rejected');
}
export function assertBackupReleaseClosure({baseline,files,readBlob}){
 if(baseline!==BACKUP_RELEASE_BASELINE)fail('baseline_invalid');
 assertBackupReleaseScope(files);
 for(const file of BACKUP_HISTORICAL_FILES)if(!files.includes(file)||!Buffer.from(readBlob(file)).equals(Buffer.from(readBlob(file,BACKUP_REVIEWED_TOOL_REVISION))))fail('historical_source_changed');
 return createHash('sha256').update(JSON.stringify(files.map(file=>[file,createHash('sha256').update(readBlob(file)).digest('hex')]))).digest('hex');
}
const overrides=new Set(['FAOLLA_WEB_BUILD_ID','NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID','FAOLLA_WEB_RELEASED_AT','FAOLLA_BACKGROUND_JOBS_PAUSED','MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED','MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED','PORT','PM2_HOME','NODE_OPTIONS','NEXT_TELEMETRY_DISABLED','PWD','NODE_APP_INSTANCE','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID','PM2_USAGE']);
export function backupProtectedEnvironment(env,keys){
 const names=keys??Object.keys(env).sort().filter(key=>/^[A-Z][A-Z0-9_]*$/.test(key)&&!overrides.has(key));
 if(names.some(key=>typeof env[key]!=='string'))fail('environment_changed');
 return Object.fromEntries(names.map(key=>[key,env[key]]));
}
export function assertBackupEnvironment(env,expected,exactKeys=true){
 const keys=Object.keys(backupProtectedEnvironment(expected));
 if(JSON.stringify(backupProtectedEnvironment(env,keys))!==JSON.stringify(backupProtectedEnvironment(expected))||exactKeys&&JSON.stringify(Object.keys(backupProtectedEnvironment(env)))!==JSON.stringify(keys))fail('environment_changed');
}
export function backupCandidateOverrides(s,releasedAt){
 return {FAOLLA_WEB_BUILD_ID:s.target,NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID:s.target,FAOLLA_WEB_RELEASED_AT:releasedAt,FAOLLA_BACKGROUND_JOBS_PAUSED:'1',MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED:'0',MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED:'0',FAOLLA_SUPER_ADMIN_ORIGIN:'https://console.faolla.com',PORT:String(s.port)};
}
export function backupCandidateEnvironmentText(text,changes){
 return text.split('\n').filter(line=>!Object.keys(changes).some(key=>line.startsWith(`${key}=`))).join('\n')+'\n'+Object.entries(changes).map(([key,value])=>`${key}=${value}`).join('\n')+'\n';
}
export function buildBackupReleaseCandidate(input,build=buildAttendanceOnlineCandidate){
 if(input?.lane!==BACKUP_RELEASE_LANE||input.baseline!==BACKUP_RELEASE_BASELINE)fail('build_scope_invalid');
 attendanceOnlineBuildPlan(input);
 assertContactWechatBuildEnvironmentKeys(input.environment);
 return build({directory:input.directory,target:input.target,operation:input.operation});
}
export const BACKUP_FOCUSED_TESTS=Object.freeze([
 'src/lib/platformAdminBackupCreateClient.test.ts','src/lib/platformAdminBackupValidation.test.ts',
 'src/lib/platformAdminBackupStrictWriteSecurity.test.ts','src/lib/platformAdminBackupRestoreClient.test.ts',
 'src/lib/platformAdminDataBackup.test.ts','src/lib/platformAdminBackupStrictRead.test.ts',
 'src/lib/platformMerchantSnapshot.test.ts','src/lib/platformMerchantSnapshotStore.test.ts',
 'scripts/super-admin-backup-release-policy.test.mjs','scripts/attendance-online-build.test.mjs',
 'scripts/online-traffic-publication-policy.test.mjs',
]);
