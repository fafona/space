import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertCanonicalReleaseCommand,executeCanonicalPublication,executeCanonicalValidation} from './release-toolchain-release.mjs';
import {reviewedBookingExecution,preparedBookingExecution} from './release-toolchain-authority.mjs';
import {requireBookingAdmission,withFreshBookingAdmission,retainedBookingMigrationBackup,assertQualificationReport} from './release-toolchain-booking-admission.mjs';
import {FULL_REHEARSAL_SOURCES} from './release-toolchain-native-inventory.mjs';
import {bookingWatchdogControllerArguments,assertBookingWatchdogControllerArguments} from './booking-handoff-watchdog.mjs';
test('the real supervisor admits only the exact canonical publish argv under reviewed source authority; its old argv remains unchanged',()=>{
 const revision='a'.repeat(40),prefix='/var/lib/faolla-online-code/'+revision+'/scripts/';
 assert.deepEqual(bookingWatchdogControllerArguments(revision),['/usr/bin/node',prefix+'booking-handoff-host.mjs']);
 assert.deepEqual(bookingWatchdogControllerArguments(revision,true),['/usr/bin/node',prefix+'release-toolchain-release.mjs','publish']);
 for(const args of [['main',true],[revision,'true'],[revision,{}]])assert.throws(()=>bookingWatchdogControllerArguments(...args));
 for(const binary of ['node','/usr/bin/node'])for(const entry of [prefix+'release-toolchain-release.mjs','scripts/release-toolchain-release.mjs'])assert.equal(assertBookingWatchdogControllerArguments([binary,entry,'publish'],revision,true),true);
 for(const argv of [['node',prefix+'release-toolchain-release.mjs','publish','--extra'],['/bin/sh',prefix+'release-toolchain-release.mjs','publish'],['node','other.mjs','publish'],['node',prefix+'release-toolchain-release.mjs','validate']])assert.throws(()=>assertBookingWatchdogControllerArguments(argv,revision,true));
 assert.throws(()=>assertBookingWatchdogControllerArguments(['node',prefix+'booking-handoff-host.mjs'],revision,false));
 const source=readFileSync(new URL('./booking-handoff-watchdog.mjs',import.meta.url),'utf8');assert.match(source,/assertBookingWatchdogControllerArguments\(command\(process.pid\),toolRevision,!!reviewedBookingExecution\(toolRevision\)\)/);
});
test('production and qualification entries have closed commands and cannot consume a caller plan, skip, receipt or target',()=>{
 for(const action of ['status','qualify','prepare-worker','validate','publish'])assert.equal(assertCanonicalReleaseCommand([action]),action);
 for(const args of [[],['publish','skip'],['publish','--force'],['reset'],['resume'],['publish','other-database']])assert.throws(()=>assertCanonicalReleaseCommand(args));
 assert.equal(reviewedBookingExecution('a'.repeat(40)),null);assert.equal(preparedBookingExecution('a'.repeat(40)),null);
 assert.throws(()=>requireBookingAdmission('a'.repeat(40)));assert.throws(()=>withFreshBookingAdmission({proof:{verified:true}},()=>assert.fail()));
});
test('outside the actual independently issued fresh admission, historical backup checks stay on the legacy path',async()=>{assert.equal(await retainedBookingMigrationBackup({target:'caller'}),null);});
test('canonical publication holds backup/compatibility context through candidate, native acceptance, admission, switch and public verify',async()=>{
 const calls=[];let admitted=false;
 const ops=Object.fromEntries(['source','bundle','environment','candidate','rehearsal','admission','switch','verify'].map(name=>[name,async()=>{if(['candidate','rehearsal','admission','switch','verify'].includes(name))assert.equal(admitted,true);calls.push(name);} ]));
 ops.backupAndCompatibility=async next=>{calls.push('backup','compatibility');admitted=true;try{return await next();}finally{admitted=false;}};ops.result=()=>calls;
 assert.deepEqual(await executeCanonicalPublication(ops),['source','bundle','environment','backup','compatibility','candidate','rehearsal','admission','switch','verify']);
});
test('any unknown canonical stage stops before the next effect; switch is never replayed',async()=>{
 const order=['source','bundle','environment','backupAndCompatibility','candidate','rehearsal','admission','switch','verify'];
 for(const failure of order){const seen=[],ops=Object.fromEntries(order.map(name=>[name,async()=>{seen.push(name);if(name===failure)throw Error(name);} ]));ops.result=()=>assert.fail();
  ops.backupAndCompatibility=async next=>{seen.push('backupAndCompatibility');if(failure==='backupAndCompatibility')throw Error(failure);return next();};
  await assert.rejects(executeCanonicalPublication(ops));assert.deepEqual(seen,order.slice(0,order.indexOf(failure)+1));
 }
});
test('validate exercises all real preparation bindings but cannot switch, verify a publication, activate or mint a continuation',async()=>{
 const seen=[],ops=Object.fromEntries(['source','bundle','environment','candidate','rehearsal','admission'].map(name=>[name,async()=>seen.push(name)]));
 ops.backupAndCompatibility=async next=>{seen.push('backup','compatibility');await next();};ops.switch=()=>assert.fail('no switch');ops.verify=()=>assert.fail('no publication');ops.result=()=>seen;
 assert.deepEqual(await executeCanonicalValidation(ops),['source','bundle','environment','backup','compatibility','candidate','rehearsal','admission']);
});
test('native report refuses stale, wrong source, fake production system and incomplete recovery evidence',()=>{
 const at=Date.now(),v={schemaVersion:1,kind:'booking-full-native-handoff-acceptance',toolRevision:'a'.repeat(40),toolInventorySha256:'b'.repeat(64),candidate:'f274ad615550c83717aa7af2ad32339608e6f8aa',rollback:'6c5d5df31d06b43929e5ba5e6f3978dd51f1c6b0',productionMutated:false,originalTimerMutated:false,mailEnabled:false,publicationAuthority:false,backupRestoreVerified:true,allFixturesStopped:true,postgresServerVersionNum:'150008',postgresSystemIdentifier:'7612049595342295080',completedAt:new Date(at).toISOString(),sourceHashes:Object.fromEntries(FULL_REHEARSAL_SOURCES.map(f=>[f,'c'.repeat(64)])),cases:['normal','controller-death-before-commit','controller-death-after-commit'].map(name=>({name,completed:true,elapsedMs:1000,inheritedKernelLock:true,realNginx:true,realPostgres:true,realProcesses:true,ownedFixturesOnly:true}))};
 v.installedMetadataSha256='d'.repeat(64);v.defaultPrivilegesSha256='e'.repeat(64);const options={toolRevision:v.toolRevision,inventorySha256:v.toolInventorySha256,nowMs:at};assert.equal(assertQualificationReport(v,options),true);
 for(const patch of [{publicationAuthority:true},{productionMutated:true},{mailEnabled:true},{allFixturesStopped:false},{backupRestoreVerified:false},{toolRevision:'d'.repeat(40)},{toolInventorySha256:'d'.repeat(64)},{postgresSystemIdentifier:'7612049595342295079'},{completedAt:new Date(at-86400001).toISOString()},{cases:v.cases.slice(1)}])assert.throws(()=>assertQualificationReport({...v,...patch},options));
});
test('real adapters bind historical provenance separately from fresh backup and retain the inherited-lock failure exit',()=>{
 const release=readFileSync(new URL('./release-toolchain-release.mjs',import.meta.url),'utf8'),admission=readFileSync(new URL('./release-toolchain-booking-admission.mjs',import.meta.url),'utf8');
 for(const name of ['withReviewedBookingExecution','assertReviewedBookingNoPending','latestBookingQualification','collectFreshBookingAdmission','withFreshBookingAdmission','inspectBookingHandoffPreflight','createBookingHandoffHostOperations','executeBookingHandoffHost','process.exit(1)','publicVersions(C)'])assert.ok(release.includes(name),name);
 for(const name of ['verifyProductionDatabaseBackup','createProductionDatabaseBackup','sourceSha:C','FAOLLA_DATABASE_CONTAINER:\'supabase-db\'','backup_source_mismatch','currentMetadataContractSha256','historicalBackupArchiveSha256'])assert.ok(admission.includes(name),name);
 assert.doesNotMatch(release,/force|skip|backup override|withFreshAdmissionFromSameExecution/);
});
test('validate reuses the actual complete preflight inspection without claiming the old public-attempt files',()=>{
 const source=readFileSync(new URL('./booking-handoff-execution.mjs',import.meta.url),'utf8'),start=source.indexOf('export async function inspectBookingHandoffPreflight'),end=source.indexOf('export async function prepareBookingHandoffPreflight',start),inspection=source.slice(start,end);
 for(const token of ['liveDatasetAndPure','validateAttendanceBackupEvidence','verifyBookingAtomicRuntimeCohort','networkProof()','assertBookingAtomicActivationTransition'])assert.ok(inspection.includes(token),token);
 assert.doesNotMatch(inspection,/\bwrite\(|bookingHostReplace|fs\.write|process\.kill/);assert.match(source.slice(end),/await inspectBookingHandoffPreflight\(options\)/);
});
