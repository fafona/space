// Isolated engineering acceptance only; no production service identifiers.
import * as fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';import {verifyToolchainBundle} from './release-toolchain-bundle.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fact(pid){const base='/proc/'+pid,s=fs.readFileSync(base+'/stat','utf8'),v=s.slice(s.lastIndexOf(')')+2).trim().split(/\s+/);
 return {pid,ppid:Number(v[1]),ticks:v[19],uid:fs.lstatSync(base).uid,exe:fs.realpathSync(base+'/exe'),cwd:fs.realpathSync(base+'/cwd'),args:fs.readFileSync(base+'/cmdline','utf8').split('\0').filter(Boolean)};}
export function assertLabControllerIdentity(before,current,{entry,binary,cwd,uid}){
 assert.equal(current.pid,before.pid);assert.equal(current.ticks,before.ticks);assert.equal(current.uid,uid);
 assert.equal(current.exe,fs.realpathSync(process.execPath));assert.equal(current.cwd,cwd);
 assert.deepEqual(current.args,[process.execPath,entry,'rehearse',binary,'10']);return true;
}
export async function interruptToolchainAcceptance(bundle,binary){
 assert.equal(process.platform,'linux');verifyToolchainBundle(bundle);
 const entry=path.join(fs.realpathSync(bundle),'scripts/release-toolchain.mjs'),cwd=process.cwd(),uid=process.getuid();
 const child=spawn(process.execPath,[entry,'rehearse',binary,'10'],{cwd,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''},stdio:['ignore','pipe','pipe']});
 let output='',stderr='',closed=false,exitCode,exitSignal;child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{stderr+=b;});
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{closed=true;exitCode=code;exitSignal=signal;resolve();});});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 const before=fact(child.pid),identity={entry,binary,cwd,uid};let attempt,observed,signalled=false;
 const deadline=Date.now()+20000;
 try{
  while(!observed&&!closed&&Date.now()<deadline){
   assert.ok(output.length<262144&&stderr.length<262144);
   for(const line of output.split('\n').filter(Boolean))try{const v=JSON.parse(line);if(v.kind==='release-toolchain-lab-attempt')attempt=v;}catch{}
   if(attempt){
    assert.equal(attempt.publicationAuthority,false);assert.equal(attempt.databaseAccess,false);
    assert.match(attempt.root,/^\/tmp\/faolla-release-toolchain-lab-[A-Za-z0-9]+$/);
    const root=fs.lstatSync(attempt.root);assert.equal(root.uid,uid);assert.equal(root.mode&0o777,0o700);
    for(const name of fs.readdirSync(attempt.root).filter(n=>/^case-[0-9]+-[A-Za-z0-9]+$/.test(n))){
     const directory=path.join(attempt.root,name),pidFile=path.join(directory,'nginx.pid');if(!fs.existsSync(pidFile))continue;
     const text=fs.readFileSync(pidFile,'utf8').trim();if(!/^[1-9][0-9]*$/.test(text))continue;
     try{const f=fact(Number(text));if(f.ppid===child.pid&&f.uid===uid&&f.cwd===directory&&f.exe===fs.realpathSync(binary))observed={directory,pid:f.pid,ticks:f.ticks};}
     catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
    }
   }
   if(!observed)await wait(2);
  }
  assert.ok(observed,'must interrupt an actually started owned Nginx, not an empty fixture');
  assertLabControllerIdentity(before,fact(child.pid),identity);assert.equal(child.kill('SIGTERM'),true);signalled=true;
  let timer;try{await Promise.race([completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('interruption_exit_unconfirmed')),15000);})]);}finally{clearTimeout(timer);}
  assert.equal(exitCode,1);assert.equal(exitSignal,null);assert.equal(fs.existsSync(path.join(attempt.root,'report.json')),false);
  const cases=fs.readdirSync(attempt.root).filter(n=>/^case-[0-9]+-[A-Za-z0-9]+$/.test(n));assert.ok(cases.length>0);
  for(const name of cases){const result=JSON.parse(fs.readFileSync(path.join(attempt.root,name,'result.json'),'utf8'));assert.equal(result.allOwnedStopped,true);}
  const interrupted=JSON.parse(fs.readFileSync(path.join(observed.directory,'result.json'),'utf8'));
  assert.equal(interrupted.outcome,'failed');assert.equal(interrupted.error.code,'operation_unconfirmed');
  try{assert.notEqual(fact(observed.pid).ticks,observed.ticks,'owned interrupted Nginx still exists');}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
  const failure=JSON.parse(stderr.trim());assert.equal(failure.kind,'release-toolchain-failure');assert.equal(failure.stage,'rehearsal');
  assert.equal(failure.detailsRedacted,true);assert.equal(failure.code,'observation_mismatch');
  const report={schemaVersion:1,kind:'release-toolchain-interruption-proof',publicationAuthority:false,databaseAccess:false,root:attempt.root,
   ownedNginxWasStarted:true,controllerReceivedSigterm:true,controllerExitCode:exitCode,allOwnedStopped:true,noSuccessfulRehearsalReport:true};
  fs.writeFileSync(path.join(attempt.root,'interruption-proof.json'),JSON.stringify(report)+'\n',{flag:'wx',mode:0o600});return report;
 }finally{
  // No name-based/global kill. Even an unsuccessful acceptance may signal only
  // this directly spawned controller, with its PID AND birth/command identity.
  if(!closed&&!signalled){assertLabControllerIdentity(before,fact(child.pid),identity);child.kill('SIGTERM');}
 }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 assert.equal(process.argv.length,4);interruptToolchainAcceptance(process.argv[2],process.argv[3]).then(v=>console.log(JSON.stringify(v)),()=>{console.error('release_toolchain_interruption_acceptance_failed');process.exitCode=1;});
}
