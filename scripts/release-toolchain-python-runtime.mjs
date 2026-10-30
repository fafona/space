// Actual trusted interpreter acceptance. Fixed pure unit suite only; no formal
// witness, PM2 socket, process control, environment output or arbitrary command.
import * as fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
import{captureTrustedPython,verifyTrustedPython}from'./production-maintenance-trusted-python.mjs';
import{inspectPinnedExecutionSource,ownedReleasePath}from'./release-toolchain-source.mjs';
import{bookingHostRead,bookingHostWriteOnce,bookingHostSync}from'./booking-handoff-host-io.mjs';
import{canonicalJson,sha256,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const SOURCE=path.dirname(path.dirname(fileURLToPath(import.meta.url))),REVISION=path.basename(SOURCE),HELPER='release-toolchain-active-generation-pm2-worker.py',SUITE='release-toolchain-active-generation-pm2-worker.test.py',sourceHash=name=>sha256(bookingHostRead(SOURCE+'/scripts/'+name,{binary:true,privateMode:false}));
const exact=(value,keys)=>need(value&&typeof value==='object'&&!Array.isArray(value)&&canonicalJson(Object.keys(value).sort())===canonicalJson(keys.split(' ').sort()),'evidence_invalid');
export function assertActualPythonRuntimeProof(value,{toolRevision,inventorySha256,helperSha256,suiteSha256,nowMs=Date.now()}){
 exact(value,'kind toolRevision inventorySha256 helperSha256 suiteSha256 pythonVersion trustedPython tests stderrSha256 stdoutSha256 passed socketOpenedBySuite processControlPerformed businessDataWritten formalHostModified publicationAuthority completedAt');
 need(value.kind==='actual-trusted-python-worker-contract-passed'&&value.toolRevision===toolRevision&&value.inventorySha256===inventorySha256&&value.helperSha256===helperSha256&&value.suiteSha256===suiteSha256&&value.tests===11&&value.passed===true&&/^3\.(?:[6-9]|[1-9][0-9])\.[0-9]{1,3}$/.test(value.pythonVersion??''),'evidence_invalid');
 for(const k of ['socketOpenedBySuite','processControlPerformed','businessDataWritten','formalHostModified','publicationAuthority'])need(value[k]===false,'evidence_invalid');for(const k of ['stderrSha256','stdoutSha256'])need(/^[a-f0-9]{64}$/.test(value[k]??''),'evidence_invalid');
 const at=Date.parse(value.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===value.completedAt&&at<=nowMs&&nowMs-at<86400000,'evidence_stale');return true;
}
// No resource arguments: the exact physical source determines both scripts.
// This is read-only component acceptance, never publication/control authority.
export function runActualPythonWorkerContract(){
 need(process.platform==='linux'&&process.getuid?.()===0&&/^[a-f0-9]{40}$/.test(REVISION)&&SOURCE==='/var/lib/faolla-online-code/'+REVISION,'unsupported_runtime');
 const source=inspectPinnedExecutionSource({revision:REVISION,directory:SOURCE}),python=captureTrustedPython(),helperSha256=sourceHash(HELPER),suiteSha256=sourceHash(SUITE);verifyTrustedPython(python);
 const options={cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024};
 const version=spawnSync(python.target.path,['-I','-S','-B','-c',"import sys;print('.'.join(str(v) for v in sys.version_info[:3]))"],options);verifyTrustedPython(python);
 need(version.status===0&&!version.error&&!version.signal&&version.stderr===''&&typeof version.stdout==='string','operation_unconfirmed');
 const result=spawnSync(python.target.path,['-I','-S','-B',SOURCE+'/scripts/'+SUITE],options);verifyTrustedPython(python);
 need(result.status===0&&!result.error&&!result.signal&&result.stdout===''&&/\bRan 11 tests in [0-9.]+s\s+OK\s*$/.test(result.stderr??''),'python_runtime_contract_failed');
 need(sourceHash(HELPER)===helperSha256&&sourceHash(SUITE)===suiteSha256,'source_changed');
 const proof={kind:'actual-trusted-python-worker-contract-passed',toolRevision:REVISION,inventorySha256:source.inventorySha256,helperSha256,suiteSha256,pythonVersion:version.stdout.trim(),trustedPython:python,tests:11,stderrSha256:sha256(result.stderr),stdoutSha256:sha256(result.stdout),passed:true,socketOpenedBySuite:false,processControlPerformed:false,businessDataWritten:false,formalHostModified:false,publicationAuthority:false,completedAt:new Date().toISOString()};assertActualPythonRuntimeProof(proof,{toolRevision:REVISION,inventorySha256:source.inventorySha256,helperSha256,suiteSha256});return proof;
}
export function verifyActualPythonRuntimeFile(filename,{toolRevision,inventorySha256}){
 need(toolRevision===REVISION,'source_changed');const text=bookingHostRead(filename),value=JSON.parse(text);need(text===canonicalJson(value)+'\n','evidence_invalid');assertActualPythonRuntimeProof(value,{toolRevision,inventorySha256,helperSha256:sourceHash(HELPER),suiteSha256:sourceHash(SUITE)});verifyTrustedPython(value.trustedPython);return{proof:value,sha256:sha256(text)};
}
export function acceptActualPythonWorkerRuntimeInCi(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.FAOLLA_RELEASE_PRODUCTION_EQ==='1'&&!['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'].some(p=>fs.existsSync(p)),'unsupported_runtime');
 const root=fs.mkdtempSync('/var/lib/faolla-python-runtime-ci-');fs.chmodSync(root,0o700);ownedReleasePath(root,{directory:true,privateMode:true});bookingHostSync('/var/lib');
 try{const proof=runActualPythonWorkerContract();bookingHostWriteOnce(root+'/acceptance.json',canonicalJson(proof)+'\n');return{kind:proof.kind,root,pythonVersion:proof.pythonVersion,tests:proof.tests,publicationAuthority:false};}
 catch(error){bookingHostWriteOnce(root+'/failure.json',canonicalJson({kind:'actual-python-runtime-contract-unconfirmed',errorSha256:sha256(String(error?.message??'unknown')),detailsRedacted:true,formalHostModified:false,publicationAuthority:false})+'\n');throw error;}
}

// Separate fixed suite for the recovered-source helper. The original eleven
// checks and their proof schema above are not reduced or reinterpreted.
export function runOriginRecoveryPythonWorkerContract(){
 need(process.platform==='linux'&&process.getuid?.()===0&&SOURCE==='/var/lib/faolla-online-code/'+REVISION&&/^[a-f0-9]{40}$/.test(REVISION),'unsupported_runtime');
 const helper='release-toolchain-origin-recovery-pm2-worker.py',suite='release-toolchain-origin-recovery-pm2-worker.test.py',python=captureTrustedPython(),helperSha256=sourceHash(helper),suiteSha256=sourceHash(suite);verifyTrustedPython(python);
 const result=spawnSync(python.target.path,['-I','-S','-B',SOURCE+'/scripts/'+suite],{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024**2});verifyTrustedPython(python);need(result.status===0&&!result.error&&!result.signal&&result.stdout===''&&/\bRan 6 tests in [0-9.]+s\s+OK\s*$/.test(result.stderr??''),'python_runtime_contract_failed');need(sourceHash(helper)===helperSha256&&sourceHash(suite)===suiteSha256,'source_changed');
 return{kind:'actual-origin-recovery-python-worker-contract-passed',toolRevision:REVISION,helperSha256,suiteSha256,trustedPython:python,tests:6,stderrSha256:sha256(result.stderr),passed:true,socketOpenedBySuite:false,processControlPerformed:false,businessDataWritten:false,formalHostModified:false,publicationAuthority:false,completedAt:new Date().toISOString()};
}
export function verifyOriginRecoveryPythonRuntimeFile(filename,{toolRevision}){
 need(toolRevision===REVISION,'source_changed');const text=bookingHostRead(filename),v=JSON.parse(text);need(text===canonicalJson(v)+'\n'&&v.kind==='actual-origin-recovery-python-worker-contract-passed'&&v.toolRevision===toolRevision&&v.tests===6&&v.passed===true&&v.helperSha256===sourceHash('release-toolchain-origin-recovery-pm2-worker.py')&&v.suiteSha256===sourceHash('release-toolchain-origin-recovery-pm2-worker.test.py')&&/^[a-f0-9]{64}$/.test(v.stderrSha256),'evidence_invalid');for(const key of ['socketOpenedBySuite','processControlPerformed','businessDataWritten','formalHostModified','publicationAuthority'])need(v[key]===false,'evidence_invalid');const at=Date.parse(v.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===v.completedAt&&at<=Date.now()&&Date.now()-at<86400000,'evidence_stale');verifyTrustedPython(v.trustedPython);return{proof:v,sha256:sha256(text)};
}

export function runSettledPreIngressPythonWorkerContract(){
 need(process.platform==='linux'&&process.getuid?.()===0&&SOURCE==='/var/lib/faolla-online-code/'+REVISION&&/^[a-f0-9]{40}$/.test(REVISION),'unsupported_runtime');
 const helper='release-toolchain-settled-pre-ingress-pm2-worker.py',suite='release-toolchain-settled-pre-ingress-pm2-worker.test.py',python=captureTrustedPython(),helperSha256=sourceHash(helper),suiteSha256=sourceHash(suite);verifyTrustedPython(python);
 const result=spawnSync(python.target.path,['-I','-S','-B',SOURCE+'/scripts/'+suite],{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024**2});verifyTrustedPython(python);need(result.status===0&&!result.error&&!result.signal&&result.stdout===''&&/\bRan 6 tests in [0-9.]+s\s+OK\s*$/.test(result.stderr??''),'python_runtime_contract_failed');need(sourceHash(helper)===helperSha256&&sourceHash(suite)===suiteSha256,'source_changed');
 return{kind:'actual-settled-pre-ingress-python-worker-contract-passed',toolRevision:REVISION,helperSha256,suiteSha256,trustedPython:python,tests:6,stderrSha256:sha256(result.stderr),passed:true,socketOpenedBySuite:false,processControlPerformed:false,businessDataWritten:false,formalHostModified:false,publicationAuthority:false,completedAt:new Date().toISOString()};
}
export function verifySettledPreIngressPythonRuntimeFile(filename,{toolRevision}){
 need(toolRevision===REVISION,'source_changed');const text=bookingHostRead(filename),value=JSON.parse(text);need(text===canonicalJson(value)+'\n'&&value.kind==='actual-settled-pre-ingress-python-worker-contract-passed'&&value.toolRevision===toolRevision&&value.tests===6&&value.passed===true&&value.helperSha256===sourceHash('release-toolchain-settled-pre-ingress-pm2-worker.py')&&value.suiteSha256===sourceHash('release-toolchain-settled-pre-ingress-pm2-worker.test.py')&&/^[a-f0-9]{64}$/.test(value.stderrSha256),'evidence_invalid');for(const key of['socketOpenedBySuite','processControlPerformed','businessDataWritten','formalHostModified','publicationAuthority'])need(value[key]===false,'evidence_invalid');const at=Date.parse(value.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===value.completedAt&&at<=Date.now()&&Date.now()-at<86400000,'evidence_stale');verifyTrustedPython(value.trustedPython);return{proof:value,sha256:sha256(text)};
}

export function runPreSupervisorPythonWorkerContract(){
 need(process.platform==='linux'&&process.getuid?.()===0&&SOURCE==='/var/lib/faolla-online-code/'+REVISION&&/^[a-f0-9]{40}$/.test(REVISION),'unsupported_runtime');
 const helper='release-toolchain-pre-supervisor-pm2-worker.py',suite='release-toolchain-pre-supervisor-pm2-worker.test.py',python=captureTrustedPython(),helperSha256=sourceHash(helper),suiteSha256=sourceHash(suite);verifyTrustedPython(python);
 const result=spawnSync(python.target.path,['-I','-S','-B',SOURCE+'/scripts/'+suite],{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024**2});verifyTrustedPython(python);need(result.status===0&&!result.error&&!result.signal&&result.stdout===''&&/\bRan 6 tests in [0-9.]+s\s+OK\s*$/.test(result.stderr??''),'python_runtime_contract_failed');need(sourceHash(helper)===helperSha256&&sourceHash(suite)===suiteSha256,'source_changed');
 return{kind:'actual-pre-supervisor-python-worker-contract-passed',toolRevision:REVISION,helperSha256,suiteSha256,trustedPython:python,tests:6,stderrSha256:sha256(result.stderr),passed:true,socketOpenedBySuite:false,processControlPerformed:false,businessDataWritten:false,formalHostModified:false,publicationAuthority:false,completedAt:new Date().toISOString()};
}
export function verifyPreSupervisorPythonRuntimeFile(filename,{toolRevision}){
 need(toolRevision===REVISION,'source_changed');const text=bookingHostRead(filename),value=JSON.parse(text);need(text===canonicalJson(value)+'\n'&&value.kind==='actual-pre-supervisor-python-worker-contract-passed'&&value.toolRevision===toolRevision&&value.tests===6&&value.passed===true&&value.helperSha256===sourceHash('release-toolchain-pre-supervisor-pm2-worker.py')&&value.suiteSha256===sourceHash('release-toolchain-pre-supervisor-pm2-worker.test.py')&&/^[a-f0-9]{64}$/.test(value.stderrSha256),'evidence_invalid');for(const key of['socketOpenedBySuite','processControlPerformed','businessDataWritten','formalHostModified','publicationAuthority'])need(value[key]===false,'evidence_invalid');const at=Date.parse(value.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===value.completedAt&&at<=Date.now()&&Date.now()-at<86400000,'evidence_stale');verifyTrustedPython(value.trustedPython);return{proof:value,sha256:sha256(text)};
}

export function runRecoveredPublicationPythonWorkerContract(){
 need(process.platform==='linux'&&process.getuid?.()===0&&SOURCE==='/var/lib/faolla-online-code/'+REVISION&&/^[a-f0-9]{40}$/.test(REVISION),'unsupported_runtime');
 const helper='release-toolchain-recovered-publication-pm2-worker.py',suite='release-toolchain-recovered-publication-pm2-worker.test.py',python=captureTrustedPython(),helperSha256=sourceHash(helper),suiteSha256=sourceHash(suite);verifyTrustedPython(python);
 const result=spawnSync(python.target.path,['-I','-S','-B',SOURCE+'/scripts/'+suite],{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024**2});verifyTrustedPython(python);need(result.status===0&&!result.error&&!result.signal&&result.stdout===''&&/\bRan 6 tests in [0-9.]+s\s+OK\s*$/.test(result.stderr??''),'python_runtime_contract_failed');need(sourceHash(helper)===helperSha256&&sourceHash(suite)===suiteSha256,'source_changed');
 return{kind:'actual-recovered-publication-python-worker-contract-passed',toolRevision:REVISION,helperSha256,suiteSha256,trustedPython:python,tests:6,stderrSha256:sha256(result.stderr),passed:true,socketOpenedBySuite:false,processControlPerformed:false,businessDataWritten:false,formalHostModified:false,publicationAuthority:false,completedAt:new Date().toISOString()};
}
export function verifyRecoveredPublicationPythonRuntimeFile(filename,{toolRevision}){
 need(toolRevision===REVISION,'source_changed');const text=bookingHostRead(filename),value=JSON.parse(text);need(text===canonicalJson(value)+'\n'&&value.kind==='actual-recovered-publication-python-worker-contract-passed'&&value.toolRevision===toolRevision&&value.tests===6&&value.passed===true&&value.helperSha256===sourceHash('release-toolchain-recovered-publication-pm2-worker.py')&&value.suiteSha256===sourceHash('release-toolchain-recovered-publication-pm2-worker.test.py')&&/^[a-f0-9]{64}$/.test(value.stderrSha256),'evidence_invalid');for(const key of['socketOpenedBySuite','processControlPerformed','businessDataWritten','formalHostModified','publicationAuthority'])need(value[key]===false,'evidence_invalid');const at=Date.parse(value.completedAt);need(Number.isFinite(at)&&new Date(at).toISOString()===value.completedAt&&at<=Date.now()&&Date.now()-at<86400000,'evidence_stale');verifyTrustedPython(value.trustedPython);return{proof:value,sha256:sha256(text)};
}
