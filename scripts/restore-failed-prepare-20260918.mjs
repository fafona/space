import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync,writeFileSync,fsyncSync,mkdirSync,renameSync,rmdirSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

// Explicitly authorized aborted-prepare recovery. No deployment, process
// control, database changes, state rewrite or generic maintenance unlock.
export const RECOVERY = Object.freeze({
  operationId:'dc89b235-e4cf-4d1b-af5c-f2016e568ecb',
  targetSha:'6ae1527dadf19e8ce4c26e59c6e4a0746ed0a585',
  oldSha:'1aab7b9beb10d0f86f5354b873d8a56c85cae576',
  stateDigest:'ad43fed75fd1d1f6a6a720b0dbbaec3d60c5edb15da37cd170d879913547f072',
  root:'/var/lib/faolla-maintenance/merchant-space',
  archive:'/var/lib/faolla-maintenance/merchant-space.archived-35395021973',
  receipt:'/var/lib/faolla-aborted-prepare-35395021973',
  source:'/var/lib/faolla-unlaunched-code-35292255885/source/scripts/',
});
const fail = () => {throw Error('aborted_prepare_recovery_unverified');};
const hash = value => createHash('sha256').update(value).digest('hex');
let stage='initial';
export function assertUnchangedOldRuntime(frozen,observed) {
  const allowed=new Set(['.daemon.processIdentity',...['1','2','3'].map(i=>`.worker.managed.processes.${i}.processIdentity`),...['0','1'].map(i=>`.worker.managed.nativeProofs.${i}.process.processIdentity`)]);
  function compare(a,b,path='') {
    if(JSON.stringify(a)===JSON.stringify(b))return;
    if(allowed.has(path)) {
      if(typeof a!=='string'||typeof b!=='string'||!/^\d+(?::\d+){7}$/.test(a)||!/^\d+(?::\d+){7}$/.test(b))fail();
      const x=a.split(':'),y=b.split(':');
      if([0,2,5,6,7].some(i=>x[i]!==y[i]))fail();
      return;
    }
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b)||JSON.stringify(Object.keys(a))!==JSON.stringify(Object.keys(b)))fail();
    for(const k of Object.keys(a))compare(a[k],b[k],path+'.'+k);
  }
  compare(frozen,observed);
}
function privateFile(path,maximum=524288) {
  const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.nlink!==1||(before.mode&0o077)||before.size<1||before.size>maximum)fail();
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const opened=fstatSync(fd),bytes=readFileSync(fd),after=lstatSync(path);if([opened,after].some(s=>s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.mtimeMs!==before.mtimeMs))fail();return bytes;}finally{closeSync(fd);}
}
function directory(path) {const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||realpathSync(path)!==path)fail();return s;}
function syncDir(path){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}}
function receipt(name,value){const fd=openSync(RECOVERY.receipt+'/'+name,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}syncDir(RECOVERY.receipt);}
export async function recover(mode) {
  if(process.platform!=='linux'||process.getuid()!==0||!['--plan','--restore'].includes(mode))fail();
  const r=RECOVERY;directory(r.root);
  const bytes=privateFile(r.root+'/state.json');if(hash(bytes)!==r.stateDigest)fail();
  const s=JSON.parse(bytes),boot=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  if(s.operationId!==r.operationId||s.targetSha!==r.targetSha||s.expectedOldSha!==r.oldSha||s.version!==2||s.revision!==3||s.phase!=='failed-unknown'||s.bootId!==boot||s.candidate!==null||s.resumed!==null||s.launchJournal!==null||s.launchDisk!==null||s.finalDump!==null)fail();
  if(existsSync(r.archive)||existsSync(r.receipt))fail();
  const load=name=>import(pathToFileURL(r.source+name+'.mjs').href);
  const runtime=await load('production-maintenance-runtime'),control=await load('production-maintenance-control'),ingress=await load('production-maintenance-ingress');
  stage='state-validation';control.validateMaintenanceState(s,{...s},boot,Date.now());control.validateMaintenanceSubproofBindings(s);
  const envApi=await load('read-production-supabase-environment');
  stage='environment';const env=envApi.readFrozenProductionSupabaseRollbackEnvironmentSnapshot(s.runtime.disk.runtime+'/.env.local',r.oldSha);
  const probe={probeHeaders:{apikey:env.anonKey,authorization:`Bearer ${env.anonKey}`}};
  const checkRuntime=async()=>assertUnchangedOldRuntime(s.runtime,await runtime.captureRuntime(s.runtime.input));
  stage='runtime';await checkRuntime();stage='ingress';await ingress.verifyIngress(s.ingress,probe);
  const smoke=await load('check-production-smoke');
  const smokeAt=async(origin)=>{const result=await smoke.runProductionSmoke({origin,paths:['/','/login','/10000000','/admin','/enterprise'],expectedBuildId:r.oldSha,attempts:2,delayMs:1000,timeoutMs:12000,logger:{log:()=>{},warn:()=>{}}});if(!result.ok||result.buildId!==r.oldSha)fail();};
  // Match the existing HTTPS reverse proxy; following canonical redirects
  // during a held window would test the public fence, not the local app.
  stage='local-smoke';
  for(const path of ['/','/login']) {
    const response=spawnSync('/usr/bin/curl',['--silent','--show-error','--max-time','12','--header','Host: launch.faolla.com','--header','X-Forwarded-Proto: https','--write-out','\n%{http_code}','http://127.0.0.1:3000'+path],{encoding:'utf8',timeout:15000,maxBuffer:1048576});
    if(response.status!==0||!response.stdout.endsWith('\n200'))fail();const html=response.stdout;
    if(!html.includes('/_next/static/')||smoke.containsDefaultClientExceptionPage(html))fail();
  }
  if(mode==='--plan')return {state:'recovery-planned',operationId:r.operationId};
  // External caller also holds the standard deployment flock. Never steal an
  // existing operation lock; preserve the original failed state byte-for-byte.
  const lock=r.root+'/operation.lock';mkdirSync(lock,{mode:0o700});const identity=directory(lock);let archived=false;
  try {
    await checkRuntime();if(!privateFile(r.root+'/state.json').equals(bytes))fail();
    mkdirSync(r.receipt,{mode:0o700});directory(r.receipt);
    receipt('started.json',{version:1,operationId:r.operationId,oldSha:r.oldSha,stateDigest:r.stateDigest,at:new Date().toISOString(),scriptDigest:hash(readFileSync(new URL(import.meta.url)))});
    try {
      stage='restore-ingress';await ingress.restoreIngress(s.ingress,probe);
      stage='restored-runtime';await checkRuntime();stage='public-smoke';await smokeAt('https://launch.faolla.com');await smokeAt('https://www.faolla.com');
    } catch(error) {
      const token=privateFile(r.root+'/control.token',64).toString();
      const closed=await ingress.installIngress(s.ingress,token,probe);
      receipt('reclosed.json',{operationId:r.operationId,ingress:closed,at:new Date().toISOString()});
      throw error;
    }
    if(!privateFile(r.root+'/state.json').equals(bytes)||existsSync(r.archive))fail();
    directory(r.root);renameSync(r.root,r.archive);archived=true;syncDir('/var/lib/faolla-maintenance');
    receipt('completed.json',{version:1,state:'old-service-restored',operationId:r.operationId,oldSha:r.oldSha,stateDigest:r.stateDigest,archive:r.archive,at:new Date().toISOString()});
    return {state:'old-service-restored',oldSha:r.oldSha,operationId:r.operationId};
  } finally {
    const actual=(archived?r.archive:r.root)+'/operation.lock',current=directory(actual);
    if(current.dev!==identity.dev||current.ino!==identity.ino)fail();rmdirSync(actual);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  recover(process.argv[2]).then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('aborted_prepare_recovery_unverified:'+stage);process.exitCode=1;});
}
