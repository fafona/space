// Real SIGTERM of our directly spawned full-rehearsal controller. This cannot
// signal a PM2 process or accept a caller PID. All fixture evidence is retained.
import * as fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {inspectPinnedExecutionSource,ownedReleasePath} from './release-toolchain-source.mjs';
import {captureToolchainProductionSnapshot,captureActiveToolchainProductionSnapshot} from './release-toolchain-full-rehearsal.mjs';
import {validateIsolationContainer} from './release-toolchain-isolation.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=path.basename(directory),INACTIVE_ENTRY=directory+'/scripts/release-toolchain-full-rehearsal.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms)),same=(a,b)=>need(canonicalJson(a)===canonicalJson(b),'observation_mismatch');
async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('release_toolchain_cleanup_unconfirmed')),ms);})]);}finally{clearTimeout(timer);}}
function fact(pid){const s=fs.readFileSync('/proc/'+pid+'/stat','utf8'),f=s.slice(s.lastIndexOf(')')+2).trim().split(/\s+/);need(fs.lstatSync('/proc/'+pid).uid===0&&f[0]!=='Z','owned_resource_changed');
 return {pid,startTicks:f[19],executable:fs.realpathSync('/proc/'+pid+'/exe'),cwd:fs.realpathSync('/proc/'+pid+'/cwd'),commandSha256:sha256(fs.readFileSync('/proc/'+pid+'/cmdline'))};}
function present(expected){try{return fact(expected.pid);}catch(e){if(['ENOENT','ESRCH'].includes(e.code)||e.code==='owned_resource_changed')return null;throw e;}}
const read=file=>{ownedReleasePath(file,{privateMode:true});return JSON.parse(fs.readFileSync(file,'utf8'));};
function seal(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,canonicalJson(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const roots=()=>fs.readdirSync('/var/lib').filter(n=>/^faolla-booking-full-rehearsal-[A-Za-z0-9]+$/.test(n));
function ownedRoot(before,expected){const found=[];for(const name of roots().filter(n=>!before.has(n))){const root='/var/lib/'+name;try{const owner=read(root+'/owner.json');if(owner.controller?.pid!==expected.pid)continue;
 const controller=owner.controller;for(const key of ['pid','startTicks','executable','cwd','commandSha256'])same(controller[key],expected[key]);need(owner.root===root&&owner.toolRevision===revision,'source_changed');found.push(root);
 }catch(e){if(e.code!=='ENOENT')throw e;}}need(found.length<=1,'owned_resource_changed');return found[0];}
function fixtureProcesses(root){const result=[];for(const name of ['normal','controller-death-before-commit','controller-death-after-commit']){const dir=root+'/runtime-'+name;if(!fs.existsSync(dir))continue;
 for(const file of fs.readdirSync(dir).filter(n=>['controller.json','watchdog.json','legacy.json','nginx-process.json'].includes(n)||/^owned-process-[1-9][0-9]*\.json$/.test(n))){const v=read(dir+'/'+file),p=v.process??v;if(Number.isSafeInteger(p.pid))result.push(p);}
 }return result;}
export function verifyFullInterruptionReport(root,{toolRevision=revision}={}){
 need(/^\/var\/lib\/faolla-release-toolchain-interruption-[A-Za-z0-9]+$/.test(root),'invalid_path');ownedReleasePath(root,{directory:true,privateMode:true});const report=read(root+'/verified.json');
 need(report.kind==='release-toolchain-full-interruption-acceptance'&&report.toolRevision===toolRevision&&report.signal==='SIGTERM'&&Number.isSafeInteger(report.exitCode)&&report.exitCode>0&&report.exitSignal===null&&report.interruptedAtOwnedMidCase===true&&report.allFixturesStopped===true&&report.productionMutated===false&&report.publicationAuthority===false,'evidence_invalid');
 assertStopped(report);return {root,report,sha256:sha256(fs.readFileSync(root+'/verified.json'))};
}
function assertStopped(report){
 need(/^\/var\/lib\/faolla-booking-full-rehearsal-[A-Za-z0-9]+$/.test(report.fixtureRoot)&&!fs.existsSync(report.fixtureRoot+'/acceptance.json'),'evidence_invalid');
 for(const p of fixtureProcesses(report.fixtureRoot))need(!present(p),'cleanup_unconfirmed');need(/^\/var\/lib\/faolla-release-toolchain-isolation-[A-Za-z0-9]+$/.test(report.isolationRoot??''),'invalid_path');const dbOwner=read(report.isolationRoot+'/owner.json');
 const r=spawnSync('docker',['inspect',dbOwner.containerId],{encoding:'utf8',timeout:10000,maxBuffer:4*1024**2});need(r.status===0&&!r.error&&!r.signal,'operation_unconfirmed');validateIsolationContainer(JSON.parse(r.stdout)[0],dbOwner,{running:false});
}
async function rehearseFullToolchainInterruptionProfile(activeProfile){
 const FILE=activeProfile?directory+'/scripts/release-toolchain-full-active-rehearsal.mjs':INACTIVE_ENTRY;
 need(process.platform==='linux'&&process.getuid?.()===0,'unsupported_runtime');inspectPinnedExecutionSource({revision,directory});const snapshot=activeProfile?captureActiveToolchainProductionSnapshot:captureToolchainProductionSnapshot,formal=snapshot(),before=new Set(roots()),root=fs.mkdtempSync('/var/lib/faolla-release-toolchain-interruption-');fs.chmodSync(root,0o700);
 const output=fs.openSync(root+'/controller.log',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);let child;try{child=spawn('/usr/bin/node',[FILE],{cwd:directory,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C.UTF-8'},stdio:['ignore',output,output]});}finally{fs.closeSync(output);}
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});const expected=fact(child.pid),ended=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));let fixtureRoot,interrupted=false,cancelRequested=false;
 const interrupt=()=>{cancelRequested=true;};process.on('SIGTERM',interrupt);process.on('SIGINT',interrupt);
 try{
  const deadline=Date.now()+90000;while(Date.now()<deadline){need(!cancelRequested,'operation_unconfirmed');same(fact(child.pid),expected);fixtureRoot=ownedRoot(before,expected);if(fixtureRoot&&fs.existsSync(fixtureRoot+'/runtime-normal/watchdog-armed.json'))break;await wait(25);}
  need(fixtureRoot&&fs.existsSync(fixtureRoot+'/runtime-normal/watchdog-armed.json')&&!fs.existsSync(fixtureRoot+'/acceptance.json'),'operation_unconfirmed');same(fact(child.pid),expected);
  seal(root+'/signal-intent.json',{kind:'owned-native-interruption-intent',controller:expected,fixtureRoot,signal:'SIGTERM',at:new Date().toISOString()});process.kill(expected.pid,'SIGTERM');interrupted=true;
  const exit=await bounded(ended,60000);need(Number.isSafeInteger(exit.code)&&exit.code>0&&exit.signal===null&&!cancelRequested,'cleanup_unconfirmed');need(!present(expected),'cleanup_unconfirmed');
  const caseOwner=read(fixtureRoot+'/runtime-normal/owner.json');if(activeProfile)same(captureActiveToolchainProductionSnapshot(),formal);else same(captureToolchainProductionSnapshot(),formal);
  const report={kind:'release-toolchain-full-interruption-acceptance',...(activeProfile?{observationProfile:'fixed-active-incident-connect-only'}:{}),toolRevision:revision,signal:'SIGTERM',exitCode:exit.code,exitSignal:exit.signal,interruptedAtOwnedMidCase:true,fixtureRoot,isolationRoot:caseOwner.isolationRoot,allFixturesStopped:true,productionMutated:false,publicationAuthority:false,completedAt:new Date().toISOString()};
  assertStopped(report);seal(root+'/verified.json',report);return verifyFullInterruptionReport(root);
 }finally{
  // Graceful cancellation is the only signal this wrapper is allowed to send.
  // If identity is uncertain, leave evidence and fail rather than kill by name.
  try{const live=present(expected);if(live){same(live,expected);if(!interrupted)process.kill(expected.pid,'SIGTERM');await bounded(ended,60000);need(!present(expected),'cleanup_unconfirmed');}}finally{process.removeListener('SIGTERM',interrupt);process.removeListener('SIGINT',interrupt);}
 }
}
export const rehearseFullToolchainInterruption=()=>rehearseFullToolchainInterruptionProfile(false);
export const rehearseFullActiveToolchainInterruption=()=>rehearseFullToolchainInterruptionProfile(true);
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)rehearseFullToolchainInterruption().then(v=>console.log(canonicalJson({kind:v.report.kind,root:v.root,fixtureRoot:v.report.fixtureRoot,allFixturesStopped:true,productionMutated:false})),()=>{console.error('release_toolchain_full_interruption_unconfirmed_evidence_preserved');process.exitCode=1;});
