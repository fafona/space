// A read-only early diagnostic, NOT a substitute for fresh production attesters.
import * as fs from 'node:fs';
import os from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {BUILD_MEMORY_FLOOR,ToolchainError,assertApplication,assertBuiltArtifact,compareApplication,assertFingerprint,compareFingerprint,compareDatabase,assertBackupBinding,assertFreshEvidence,publicFailure,requireToolchain as need,safeRelativePath} from './release-toolchain-contracts.mjs';
export function assessToolchainReadiness(expected,observed,{nowMs=Date.now()}={}){
 const checks=[];function check(stage,test){try{test();checks.push({stage,passed:true,code:null});}catch(error){checks.push({stage,passed:false,code:publicFailure(error,{stage}).code});}}
 const sameTool=()=>{need(typeof expected?.tool?.revision==='string'&&/^[a-f0-9]{40}$/.test(expected.tool.revision)&&expected.tool.revision===observed?.tool?.revision,'source_changed');compareFingerprint(expected.tool.bundle,observed.tool.bundle,'tool-bundle');};
 check('source',()=>{assertApplication(expected.application);compareApplication(expected.application,observed.application);
  need(Array.isArray(expected.scope)&&Array.isArray(observed.scope),'scope_changed');for(const v of [...expected.scope,...observed.scope])safeRelativePath(v);
  need(new Set(expected.scope).size===expected.scope.length&&new Set(observed.scope).size===observed.scope.length&&isDeepStrictEqual([...expected.scope].sort(),[...observed.scope].sort()),'scope_changed');});
 check('bundle',sameTool);
 const buildRequired=observed.build===null;
 check('candidate',()=>{need(observed.build===null||observed.build?.verified===true,'build_binding_mismatch');
  if(!buildRequired)try{assertBuiltArtifact(observed.build,expected.application);}catch{throw new ToolchainError('build_binding_mismatch');}});
 check('environment',()=>{const h=observed.host;need(h?.platform==='linux'&&h.architecture==='x64'&&h.nodeMajor===20,'unsupported_runtime');
  need(Number.isSafeInteger(h.availableMemoryBytes)&&h.availableMemoryBytes>=0&&Number.isSafeInteger(h.availableDiskBytes)&&h.availableDiskBytes>=0,'evidence_invalid');
  need(!buildRequired||h.availableMemoryBytes>=BUILD_MEMORY_FLOOR,'build_memory_insufficient');
  need(Number.isSafeInteger(expected.requiredDiskBytes)&&expected.requiredDiskBytes>=64*1024**2&&h.availableDiskBytes>=expected.requiredDiskBytes,'disk_insufficient');});
 check('backup',()=>{if(expected.database===null){need(observed.database===null&&observed.backup===null,'database_identity_mismatch');return;}
  compareDatabase(expected.database,observed.database);assertBackupBinding(observed.backup,{application:expected.application,database:expected.database,nowMs,maxAgeMs:expected.backupMaxAgeMs});});
 check('compatibility',()=>{if(expected.database===null){need(observed.compatibility===null,'evidence_invalid');return;}
  const v=observed.compatibility;need(v?.kind==='verified-database-compatibility'&&v.verified===true,'evidence_invalid');compareDatabase(v.database,expected.database);
  assertFingerprint(v.migrations,'application-migrations');compareFingerprint(v.migrations,expected.application.migrations,'application-migrations');
  assertFreshEvidence(v,{nowMs,maxAgeMs:expected.compatibilityMaxAgeMs});});
 return {schemaVersion:1,kind:'release-toolchain-preflight',ready:checks.every(c=>c.passed),buildRequired,checks,publicationAuthority:false,observedAt:new Date(nowMs).toISOString()};
}
export function localHostObservation(directory=process.cwd()){
 let availableMemoryBytes=os.freemem();
 if(process.platform==='linux'){
  const text=fs.readFileSync('/proc/meminfo','utf8'),match=text.match(/^MemAvailable:\s+([0-9]+) kB$/m);need(match,'evidence_invalid');availableMemoryBytes=Number(match[1])*1024;
  // Respect a container limit instead of mistaking the host's RAM for ours.
  const limit='/sys/fs/cgroup/memory.max',used='/sys/fs/cgroup/memory.current';if(fs.existsSync(limit)&&fs.existsSync(used)){
   const raw=fs.readFileSync(limit,'utf8').trim(),current=Number(fs.readFileSync(used,'utf8').trim());
   if(raw!=='max'){const maximum=Number(raw);need(Number.isSafeInteger(maximum)&&maximum>0&&Number.isSafeInteger(current)&&current>=0,'evidence_invalid');availableMemoryBytes=Math.min(availableMemoryBytes,Math.max(0,maximum-current));}
  }
 }
 const disk=fs.statfsSync(directory),availableDiskBytes=disk.bavail*disk.bsize;
 need(Number.isSafeInteger(availableMemoryBytes)&&Number.isSafeInteger(availableDiskBytes),'evidence_invalid');
 return {platform:process.platform,architecture:process.arch,nodeMajor:Number(process.versions.node.split('.')[0]),availableMemoryBytes,availableDiskBytes};
}
