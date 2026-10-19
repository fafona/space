import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {executeLoginUnbuiltResume,loginUnbuiltRepairImportClosure,loginUnbuiltRepairMain,prepareLoginUnbuiltToolRepair} from './merchant-login-unbuilt-repair.mjs';
import {LOGIN_UNBUILT_REPAIR as p,LOGIN_UNBUILT_REPAIR_FILES as allowed,assertLoginUnbuiltState} from './merchant-login-unbuilt-repair-policy.mjs';
const source=fs.readFileSync(new URL('./merchant-login-unbuilt-repair.mjs',import.meta.url),'utf8');
const digest=x=>createHash('sha256').update(x).digest('hex');
const need=(ok,why)=>{if(!ok)throw Error('merchant_login_unbuilt_'+why);};
const same=(a,b,why)=>{try{assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));}catch{throw Error('merchant_login_unbuilt_'+why);}};
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b).replace(/^export /gm,'');}
function sequenceFixture(failure){const calls=[],ports={};let verifies=0;
 for(const name of ['check','begin','verify','tests','build','verifyBuilt','checkBuilt','start','smoke','ready','complete','wait'])ports[name]=async()=>{calls.push(name);if(name==='verify')verifies++;if(name===failure||failure==='verify-after-build'&&name==='verify'&&verifies===3)throw Error('fixture_'+failure);};
 return {calls,ports};
}
test('resume runs all gates and tests before its single sandbox build and retained start',async()=>{
 const f=sequenceFixture();await executeLoginUnbuiltResume(f.ports);assert.deepEqual(f.calls,['check','begin','verify','tests','check','verify','build','verifyBuilt','checkBuilt','verify','start','smoke','ready','complete']);
});
test('any prebuild gate failure prevents build and process start; postbuild gates prevent start',async()=>{
 for(const fail of ['check','begin','verify','tests','build','verifyBuilt','checkBuilt','verify-after-build','start','ready','complete']){const f=sequenceFixture(fail);await assert.rejects(executeLoginUnbuiltResume(f.ports));if(['check','begin','verify','tests'].includes(fail))assert.ok(!f.calls.includes('build'));if(['check','begin','verify','tests','build','verifyBuilt','checkBuilt','verify-after-build'].includes(fail))assert.ok(!f.calls.includes('start'));if(fail!=='complete')assert.ok(!f.calls.includes('complete'));}
});
test('readiness retries are bounded and cannot mark a failed candidate ready',async()=>{
 const f=sequenceFixture();let probes=0;f.ports.smoke=async()=>{f.calls.push('smoke');if(++probes<3)throw Error('not_ready');};await executeLoginUnbuiltResume(f.ports);assert.equal(probes,3);assert.equal(f.calls.filter(x=>x==='wait').length,2);
 const bad=sequenceFixture('smoke');await assert.rejects(executeLoginUnbuiltResume(bad.ports),/candidate_not_ready/);assert.equal(bad.calls.filter(x=>x==='smoke').length,25);assert.ok(!bad.calls.includes('ready')&&!bad.calls.includes('complete'));
});
test('bootstrap import closure includes every static script edge, rejects packages and escapes',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));const actual=loginUnbuiltRepairImportClosure(name=>fs.readFileSync(path.join(root,name),'utf8'));assert.ok(actual.includes('scripts/prepare-online-release-tool.mjs')&&actual.includes('scripts/merchant-login-unbuilt-repair-policy.mjs'));
 for(const bad of ["import x from 'external-package';","import x from '../src/anything.mjs';"]){assert.throws(()=>loginUnbuiltRepairImportClosure(()=>bad),/bootstrap_import/);}
 const map=new Map([['scripts/merchant-login-unbuilt-repair.mjs',"import fs from 'node:fs'; import './a.mjs';\nexport {x} from './b.mjs';"],['scripts/a.mjs',"import './b.mjs';"],['scripts/b.mjs','export const x=1;']]);assert.deepEqual(loginUnbuiltRepairImportClosure(n=>map.get(n)),[...map.keys()].sort());
});
function sourceFixture(change={}){
 const revision='e'.repeat(40),APP='/www/wwwroot/merchant-space',root=`/var/lib/faolla-online-code/${revision}`,inputs='fixed-application-inputs';let checked=0;
 const run=runInNewContext(`${section('function verifySource(', 'function candidateSource(')}\nverifySource`,{process:{platform:'linux',getuid:()=>0},p:{...p,sourceInputsSha256:digest(inputs)},APP,path:path.posix,need,same,sha:digest,allowed,
  assertOnlineToolOwnedPath:()=>{},git:(dir,args)=>{if(args[0]==='merge-base')return '';if(args[0]==='diff')return (change.files??allowed).map(n=>`${change.status??'M'}\t${n}`).join('\n');if(args.at(-1)==='origin/main')return change.main??revision;if(args.at(-1)==='HEAD'&&args.includes('--abbrev-ref'))return change.symbolic?'main':'HEAD';if(args[0]==='status')return change.dirty?' M changed':'';if(args.at(-1)==='HEAD')return revision;throw Error('unexpected_git');},
  assertLoginUnbuiltRepairToolScope:files=>{need(files.length===allowed.length&&new Set(files).size===files.length&&files.every(n=>allowed.includes(n)),'tool_scope');},sourceInputs:r=>change.inputs&&r===revision?'changed':inputs,
  createOnlineReleaseToolPlan:r=>({target:r}),verifyOnlineReleaseTool:()=>{checked++;}});
 return {run:()=>run(revision,change.root??root),checks:()=>checked};
}
test('repair tool must be exact detached clean main with only the fixed tool closure',()=>{
 const f=sourceFixture();assert.equal(f.run().toolRevision,'e'.repeat(40));assert.equal(f.checks(),1);
 for(const patch of [{main:'f'.repeat(40)},{symbolic:true},{dirty:true},{root:'/arbitrary'},{inputs:true},{status:'D'},{status:'R100'},{files:allowed.slice(1)},{files:[...allowed,'src/lib/authSessionRecovery.ts']}])assert.throws(sourceFixture(patch).run,/merchant_login_unbuilt_/);
});
test('actual continuation has no state reset, candidate overwrite, database or cleanup operations',()=>{
 assert.doesNotMatch(source,/\b(?:unlinkSync|rmSync|rmdirSync|truncateSync)\b|\b(?:DROP|TRUNCATE)\s|applyProductionDatabaseMigrations|createProductionDatabaseBackup/);
 assert.match(source,/O_EXCL\|fs.constants.O_NOFOLLOW/);assert.match(source,/need\(!exists\(attemptFile\)&&!exists\(resultFile\),'resume_already_attempted'\)/);
 assert.match(source,/same\(observe\(\),before,'candidate_changed_during_preparation'\)/);assert.match(source,/fixedLoginUnbuiltRepairReceipt:receipt/);
 assert.match(source,/verifyOnlineReleaseTool\(createOnlineReleaseToolPlan\(revision\)\)/);assert.match(source,/candidateSource\(\)/);assert.match(source,/assertOnlineRetentionPublication/);
 assert.match(source,/assertLoginUnbuiltState\(state,JSON.parse\(original\)/);assert.match(source,/buildLoginReleaseCandidate\(/);assert.match(source,/loginUnitTestEnvironment\(\)/);
 assert.match(source,/merchant-login-unbuilt-repair-policy.test.mjs/);assert.match(source,/merchant-login-unbuilt-repair.test.mjs/);
 const build=section('export async function resumeLoginUnbuiltCandidate(', 'export function loginUnbuiltRepairMain(');assert.doesNotMatch(build,/process\.env|\.env\.local.*write|writeFileSync/);
});
test('CLI has no build, activate, retry, target or path options; non-Linux invocation cannot mutate',()=>{
 for(const args of [[],['status'],['prepare','e'.repeat(40)],['prepare','e'.repeat(40),'approved-merchant-login-unbuilt-test-environment-repair','--force'],['activate','e'.repeat(40),'approved-merchant-login-unbuilt-test-environment-repair']])assert.throws(()=>loginUnbuiltRepairMain(args),/invocation/);
 assert.throws(()=>prepareLoginUnbuiltToolRepair('e'.repeat(40),'wrong'),/approval_required/);
 if(process.platform!=='linux')assert.throws(()=>prepareLoginUnbuiltToolRepair('e'.repeat(40),'approved-merchant-login-unbuilt-test-environment-repair'),/invocation/);
});

function observationFixture(phase='unbuilt',change={}){
 const operation=p.operation,directory=p.directory,originalFile=operation+'/original.json',proxy='/proxy',marker='/marker',maintenance='/maintenance';
 const paths={'state.json':operation+'/state.json','runtime.json':operation+'/runtime.json','.env.local':directory+'/.env.local'};
 const raw=Buffer.from('runtime'),active=Buffer.from(JSON.stringify({target:p.baseline})),maintenanceBytes=Buffer.from('{"phase":"ended"}'),markerBytes=Buffer.from('marker'),proxyBytes=Buffer.from('proxy');
 const original={target:p.target,baseline:p.baseline,name:p.name,directory:p.directory,port:p.port,lane:'merchant-login-recovery-code-only',status:'preparing',oldDirectory:'/baseline',configs:{'proxy.conf':{oldHash:digest(proxyBytes)}}};
 const originalBytes=Buffer.from(JSON.stringify(original));
 const proof={target:p.target,buildId:p.target,guardedCommand:'npm run build',memoryBytes:4294967296,heapMiB:3072,cpuQuotaPercent:100,tasks:128,seconds:1200,privateNetworkVerified:true,swapBytes:0,...change.proof};
 const proofBytes=Buffer.from(JSON.stringify(proof));
 const current={...original,...(phase!=='unbuilt'?{loginBuildProofSha256:digest(proofBytes)}:{}),...(phase==='ready'?{status:'ready-no-database'}:{}),...change.state};
 const currentBytes=Buffer.from(JSON.stringify(current)),dependency={sha256:'d'.repeat(64),files:1,bytes:10};
 const pins={'state.json':digest(originalBytes),'runtime.json':digest(raw),'.env.local':digest(raw)};
 const files=new Map([[paths['state.json'],currentBytes],[originalFile,originalBytes],[paths['runtime.json'],raw],[paths['.env.local'],raw],['/root/.pm2/dump.pm2',Buffer.from(JSON.stringify(change.dump??[]))],['/var/lib/faolla-online-release/active.json',active],[maintenance+'/state.json',maintenanceBytes],[marker,markerBytes],[proxy+'/proxy.conf',proxyBytes],[operation+'/attendance-build-proof.json',proofBytes],[directory+'/.next/BUILD_ID',Buffer.from(p.target)]]);
 if(change.file)files.set(change.file,Buffer.from('changed'));
 const config={...p,stateSha256:digest(originalBytes),dependency,activeSha256:digest(active),maintenanceSha256:digest(maintenanceBytes),markerSha256:digest(markerBytes)};
 const baseline={name:'baseline',pid:123,pm2_env:{status:'online',pm_cwd:'/baseline'}};
 const candidate={name:p.name,pid:456,pm2_env:{status:'online',pm_cwd:change.cwd??p.directory}};
 const processes=[baseline,...(phase==='ready'||change.started?[candidate]:[])];let pmReads=0;
 const api=runInNewContext(`${section('function observe(', 'function checkedReceipt(')}\nobserve`,{p:config,paths,pins,absent:['/absent/.next','/absent/database-ready.json'],originalFile,maintenance,WEB_RELEASE_FILES:['proxy.conf'],WEB_RELEASE_PROXY:proxy,WEB_RELEASE_MARKER:marker,
  need,same,sha:digest,JSON,Buffer,fs:{lstatSync:()=>({mode:0o700}),realpathSync:()=>change.cwd??p.directory,readFileSync:()=>Buffer.from('process-fact')},assertOnlineToolOwnedPath:()=>{},
  ownedFile:name=>{assert.ok(files.has(name),name);return Buffer.from(files.get(name));},assertLoginUnbuiltState,candidateSource:()=>need(!change.source,'candidate_source_changed'),attendanceRepairTreeFingerprint:()=>change.dependencies?{...dependency,sha256:'e'.repeat(64)}:dependency,
  exists:name=>change.absent===name,command:name=>name==='ss'?(change.socket??''):(change.unit??'not-found'),readOnlineRetentionHistory:()=>({headSha256:change.history??p.retentionHeadSha256}),
  pm:()=>{pmReads++;return change.processes&&pmReads>1?[...processes,{name:'unexpected',pid:987}]:processes;},normalizeRetirementProcess:x=>({name:x.name,pid:x.pid}),assertOnlineRetentionPublication:()=>{}});
 return {run:()=>api(phase,{sealed:phase!=='unbuilt'}),paths,files,proofBytes};
}
test('real observation accepts the original then only the proof-added and ready states; original bytes remain sealed',()=>{
 for(const phase of ['unbuilt','built','ready']){const f=observationFixture(phase),before=[...f.files].map(([n,b])=>[n,b.toString('hex')]);const result=f.run();assert.equal(result.preservedFiles['state.json'],digest(f.files.get(p.operation+'/original.json')));assert.equal(result.buildProofSha256,phase==='unbuilt'?null:digest(f.proofBytes));assert.deepEqual([...f.files].map(([n,b])=>[n,b.toString('hex')]),before);}
});
test('observation rejects source, dependencies, records, proxy, history, process and build drift without writes',()=>{
 for(const change of [{source:true},{dependencies:true},{state:{extra:'changed'}},{state:{status:'active'}},{file:p.operation+'/runtime.json'},{file:p.directory+'/.env.local'},{file:'/var/lib/faolla-online-release/active.json'},{file:'/maintenance/state.json'},{file:'/marker'},{file:'/proxy/proxy.conf'},{history:'e'.repeat(64)},{started:true},{processes:true},{unit:'loaded'},{absent:'/absent/.next'},{absent:'/absent/database-ready.json'},{socket:'LISTEN 0 511 127.0.0.1:3103 0.0.0.0:*'},{dump:[{name:p.name}]},{dump:[{pm_cwd:p.directory}]}])assert.throws(observationFixture('unbuilt',change).run);
 for(const proof of [{memoryBytes:3*1024**3},{heapMiB:1792},{privateNetworkVerified:false},{swapBytes:1},{target:p.baseline},{seconds:2400},{guardedCommand:'skip'}])assert.throws(observationFixture('built',{proof}).run,/build_proof_changed/);
 assert.throws(observationFixture('ready',{cwd:'/different'}).run,/candidate_process_changed/);
 assert.throws(observationFixture('built',{absent:'/absent/database-ready.json'}).run,/database_attempt_exists/);
});

test('activation requires the exact sealed ready-state, build-output and live-process result',()=>{
 const receiptBytes=Buffer.from('receipt'),observation={stateSha256:'a'.repeat(64),buildProofSha256:'b'.repeat(64),dependencySha256:'c'.repeat(64),candidate:{pid:123}};
 const valid={schemaVersion:1,toolRevision:'e'.repeat(40),receiptSha256:digest(receiptBytes),attemptSha256:'0'.repeat(64),readyStateSha256:observation.stateSha256,buildProofSha256:observation.buildProofSha256,builtOutputSha256:'d'.repeat(64),dependencySha256:observation.dependencySha256,candidate:observation.candidate,completedAt:'2026-10-19T00:00:00.000Z'};
 for(const patch of [null,{readyStateSha256:'f'.repeat(64)},{buildProofSha256:'f'.repeat(64)},{builtOutputSha256:'f'.repeat(64)},{dependencySha256:'f'.repeat(64)},{candidate:{pid:987}},{receiptSha256:'f'.repeat(64)},{toolRevision:p.target},{extra:true},{completedAt:'invalid'}]){
  const raw=Buffer.from(JSON.stringify({...valid,...patch})),api=runInNewContext(`${section('export function assertLoginUnbuiltRepairCandidate(', 'export function prepareLoginUnbuiltToolRepair(')}\nassertLoginUnbuiltRepairCandidate`,{p,ROOT:'/tool',resultFile:'/result',receiptFile:'/receipt',need,same,sha:digest,JSON,
   checkedReceipt:()=>({bytes:receiptBytes,receipt:{toolRevision:valid.toolRevision}}),checkedAttempt:()=>valid.attemptSha256,observe:()=>observation,ownedFile:name=>name==='/result'?raw:receiptBytes,attendanceRepairTreeFingerprint:()=>({sha256:'d'.repeat(64)})});
  if(patch===null)api({target:p.target,phase:'ready'});else assert.throws(()=>api({target:p.target,phase:'ready'}));
 }
});
