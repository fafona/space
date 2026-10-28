import test from 'node:test';import assert from 'node:assert/strict';
import {fingerprint,BUILD_MEMORY_FLOOR} from './release-toolchain-contracts.mjs';import {assessToolchainReadiness,localHostObservation} from './release-toolchain-doctor.mjs';
const time=Date.parse('2026-10-28T03:00:00.000Z');
const app=()=>({revision:'a'.repeat(40),source:fingerprint('application-source','s'),dependencies:fingerprint('application-dependencies','d'),migrations:fingerprint('application-migrations','m')});
function fixture(){const application=app(),database={environment:'production',containerId:'c'.repeat(64),image:'sha256:'+'d'.repeat(64),dataSource:'/opt/supabase/data',systemIdentifier:'1234567890',databaseOid:'5',serverVersionNum:'150008'},
 tool={revision:'b'.repeat(40),bundle:fingerprint('tool-bundle','t')},fresh={createdAt:'2026-10-28T02:00:00.000Z',expiresAt:'2026-10-29T02:00:00.000Z'};
 return {expected:{application,tool,database,scope:['src/approved.ts'],requiredDiskBytes:1024**3,backupMaxAgeMs:86400000,compatibilityMaxAgeMs:86400000},
 observed:{application:structuredClone(application),tool:structuredClone(tool),scope:['src/approved.ts'],database:structuredClone(database),
  build:{application:structuredClone(application),artifact:fingerprint('application-build','built-bytes'),verified:true},backup:{kind:'verified-database-backup',application:structuredClone(application),database:structuredClone(database),archive:fingerprint('backup-archive','x'),verified:true,...fresh},
  compatibility:{kind:'verified-database-compatibility',database:structuredClone(database),migrations:application.migrations,verified:true,...fresh},
  host:{platform:'linux',architecture:'x64',nodeMajor:20,availableMemoryBytes:BUILD_MEMORY_FLOOR,availableDiskBytes:2*1024**3}}};}
test('one preflight reports all blockers, is non-mutating and is never publication authority',()=>{
 const f=fixture(),before=structuredClone(f),r=assessToolchainReadiness(f.expected,f.observed,{nowMs:time});assert.equal(r.ready,true);assert.equal(r.buildRequired,false);assert.equal(r.publicationAuthority,false);assert.deepEqual(f,before);
});
test('memory floor applies to a needed build, not a proved existing immutable build',()=>{
 const f=fixture();f.observed.host.availableMemoryBytes=BUILD_MEMORY_FLOOR-1;
 assert.equal(assessToolchainReadiness(f.expected,f.observed,{nowMs:time}).ready,true);
 f.observed.build=null;const r=assessToolchainReadiness(f.expected,f.observed,{nowMs:time});assert.equal(r.ready,false);assert.equal(r.buildRequired,true);assert.equal(r.checks.find(v=>v.stage==='environment').code,'build_memory_insufficient');
});
test('expiry, wrong backup source, wrong database and scope drift are all visible before a long operation',()=>{
 const f=fixture();f.observed.scope.push('src/unauthorized.ts');f.observed.backup.application.revision='f'.repeat(40);f.observed.compatibility.expiresAt='2026-10-28T02:49:11.000Z';
 const r=assessToolchainReadiness(f.expected,f.observed,{nowMs:time});assert.equal(r.ready,false);
 assert.deepEqual(r.checks.filter(v=>!v.passed).map(v=>v.code),['scope_changed','backup_source_mismatch','evidence_stale']);
 f.observed.database.environment='isolated';assert.equal(assessToolchainReadiness(f.expected,f.observed,{nowMs:time}).checks.find(v=>v.stage==='backup').code,'database_identity_mismatch');
});
test('an invalid existing build cannot silently become a request to overwrite/rebuild it',()=>{
 const f=fixture();f.observed.build.application.dependencies=fingerprint('application-dependencies','changed');const r=assessToolchainReadiness(f.expected,f.observed,{nowMs:time});
 assert.equal(r.ready,false);assert.equal(r.buildRequired,false);assert.equal(r.checks.find(v=>v.stage==='candidate').code,'build_binding_mismatch');
});
test('node major, architecture and platform are explicit capabilities; kernel major is not a blind denylist',()=>{
 for(const patch of [{nodeMajor:19},{nodeMajor:99},{platform:'win32'},{architecture:'arm64'}]){const f=fixture();Object.assign(f.observed.host,patch);assert.equal(assessToolchainReadiness(f.expected,f.observed,{nowMs:time}).checks.find(v=>v.stage==='environment').code,'unsupported_runtime');}
 const f=fixture();f.observed.host.kernel='7.0.0';assert.equal(assessToolchainReadiness(f.expected,f.observed,{nowMs:time}).ready,true);
});
test('no-database operations cannot smuggle in a backup, pilot or compatibility action',()=>{
 const f=fixture();f.expected.database=null;f.observed.database=null;f.observed.backup=null;f.observed.compatibility=null;
 assert.equal(assessToolchainReadiness(f.expected,f.observed,{nowMs:time}).ready,true);
 f.observed.backup={};assert.equal(assessToolchainReadiness(f.expected,f.observed,{nowMs:time}).ready,false);
});
test('local host observation is bounded metadata only, with no environment/credential dump',()=>{
 const v=localHostObservation();assert.deepEqual(Object.keys(v).sort(),['architecture','availableDiskBytes','availableMemoryBytes','nodeMajor','platform'].sort());
 assert.ok(Number.isSafeInteger(v.availableMemoryBytes)&&v.availableMemoryBytes>=0);assert.ok(Number.isSafeInteger(v.availableDiskBytes)&&v.availableDiskBytes>=0);
});
