// Real loopback-only ingress regression. No production config, PM2 or DB access.
// This is boundary-specific engineering evidence, NOT publication acceptance.
import * as fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';
import {createServer} from 'node:http';import {spawn,spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {bookingIngressSnippet} from './booking-handoff-ingress.mjs';
import {drainAndProbeIngress} from './release-toolchain-ingress.mjs';
import {inspectToolchainNginxProfile} from './release-toolchain-profiles.mjs';
import {requireToolchain as need,ToolchainError,sha256,canonicalJson,publicFailure} from './release-toolchain-contracts.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const childEnv=()=>({PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:os.tmpdir(),LANG:'C.UTF-8',LC_ALL:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''});
function procFact(pid){const root='/proc/'+pid,text=fs.readFileSync(root+'/stat','utf8'),parts=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
 return {pid,state:parts[0],startTicks:parts[19],uid:fs.lstatSync(root).uid,executable:parts[0]==='Z'?null:fs.realpathSync(root+'/exe'),cwd:parts[0]==='Z'?null:fs.realpathSync(root+'/cwd')};}
function ownedAlive(expected,{binary,directory}){try{const actual=procFact(expected.pid);need(actual.startTicks===expected.startTicks,'owned_resource_changed');if(actual.state==='Z')return false;
 need(actual.uid===process.getuid()&&actual.executable===binary&&actual.cwd===directory,'owned_resource_changed');return true;
 }catch(e){if(['ENOENT','ESRCH'].includes(e.code))return false;throw e;}}
async function stopOwned(expected,context){if(!ownedAlive(expected,context))return;process.kill(expected.pid,'SIGTERM');
 for(let i=0;i<100&&ownedAlive(expected,context);i++)await wait(20);
 if(ownedAlive(expected,context)){process.kill(expected.pid,'SIGKILL');for(let i=0;i<100&&ownedAlive(expected,context);i++)await wait(20);}need(!ownedAlive(expected,context),'cleanup_unconfirmed');}
async function until(fn,timeout=5000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn())return;await wait(10);}throw new ToolchainError('operation_unconfirmed');}
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return server.address().port;}
async function freePort(){const s=net.createServer(),port=await listen(s);await new Promise(resolve=>s.close(resolve));return port;}
function acceptedBy(worker,serverPort,clientPort){
 const endpoint=port=>'0100007F:'+port.toString(16).toUpperCase().padStart(4,'0');
 const rows=fs.readFileSync('/proc/net/tcp','utf8').trim().split(/\r?\n/).slice(1).map(l=>l.trim().split(/\s+/));
 const inode=rows.find(r=>r[1]===endpoint(serverPort)&&r[2]===endpoint(clientPort)&&r[3]==='01')?.[9];if(!inode)return false;
 for(const fd of fs.readdirSync('/proc/'+worker.pid+'/fd'))try{if(fs.readlinkSync('/proc/'+worker.pid+'/fd/'+fd)==='socket:['+inode+']')return true;}catch(e){if(e.code!=='ENOENT')throw e;}return false;
}
export function parseSyntheticHttp(text){
 need(typeof text==='string'&&Buffer.byteLength(text)<=65536,'observation_mismatch');const head=text.split('\r\n\r\n')[0],lines=head.split('\r\n'),match=/^HTTP\/1\.[01] ([0-9]{3}) /.exec(lines.shift()??'');need(match,'observation_mismatch');
 const headers=new Map(lines.map(l=>{const at=l.indexOf(':');return [l.slice(0,at).toLowerCase(),l.slice(at+1).trim()];}));
 const workerPid=Number(headers.get('x-faolla-lab-worker')),gate=headers.get('x-faolla-lab-gate');need(Number.isSafeInteger(workerPid)&&workerPid>0&&['open','gated'].includes(gate),'observation_mismatch');return {status:Number(match[1]),workerPid,gate};
}
async function caseRun(profile,parent,index,{fault='none'}={}){
 const binary=profile.resolvedBinary;
 const directory=fs.mkdtempSync(path.join(parent,'case-'+index+'-'));fs.chmodSync(directory,0o700);const context={binary,directory},events=[],workers=new Map();
 const sockets=new Set(),upstream=createServer((req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'application/json',Connection:'close'});res.end('{"fixture":true}');});
 upstream.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const upstreamPort=await listen(upstream),port=await freePort(),file=path.join(directory,'nginx.conf'),id=randomUUID();
 const startedAt=new Date().toISOString(),window={id,startedAt,deadlineAt:new Date(Date.parse(startedAt)+600000).toISOString()};
 function config(gated){return `${process.getuid()===0?'user root;':''}working_directory ${directory};pid ${directory}/nginx.pid;error_log ${directory}/nginx-error.log notice;worker_processes 1;
events {worker_connections 64;}http {${profile.httpDirectives}access_log off;client_body_temp_path ${directory}/client;proxy_temp_path ${directory}/proxy;
server {listen 127.0.0.1:${port};server_name localhost;add_header X-Faolla-Lab-Worker $pid always;add_header X-Faolla-Lab-Gate ${gated?'gated':'open'} always;
${gated?bookingIngressSnippet(window):''}
location / {proxy_pass http://127.0.0.1:${upstreamPort};proxy_set_header Connection close;}}}`;}
 const write=(name,value)=>fs.writeFileSync(path.join(directory,name),canonicalJson(value)+'\n',{flag:'wx',mode:0o600});
 write('owner.json',{kind:'release-toolchain-owned-lab-case',directory,index,id,publicationAuthority:false});
 let master,child,held,heldText='',heldDone,mixed,probeCount=0,outcome='unknown',error,phase='prepare';
 function command(args){const r=spawnSync(binary,args,{cwd:directory,env:childEnv(),encoding:'utf8',timeout:5000,maxBuffer:262144});
  events.push({step:'nginx-command',status:r.status,stderrSha256:sha256(r.stderr??'')});need(r.status===0&&!r.error&&!r.signal,'operation_unconfirmed');}
 async function probe(uri,method='GET'){const response=await fetch('http://127.0.0.1:'+port+uri,{method,headers:{Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(1500)}),text=await response.text();
  const result={status:response.status,workerPid:Number(response.headers.get('X-Faolla-Lab-Worker')),gate:response.headers.get('X-Faolla-Lab-Gate')};
  let value;try{value=JSON.parse(text);}catch{return {...result,value:null};}return {...result,value};}
 function snapshotWorkers(){if(!master||!ownedAlive(master,context))return [];
  const ids=fs.readFileSync('/proc/'+master.pid+'/task/'+master.pid+'/children','utf8').trim().split(/\s+/).filter(Boolean).map(Number);
  return ids.map(pid=>{const f=procFact(pid);need(f.uid===process.getuid()&&f.executable===binary&&f.cwd===directory,'owned_resource_changed');workers.set(f.pid,f);return f;});}
 try{
  fs.mkdirSync(path.join(directory,'logs'),{mode:0o700});fs.writeFileSync(file,config(false),{flag:'wx',mode:0o600});phase='baseline-syntax';command(['-p',directory+'/', '-c',file,'-t']);
  const fd=fs.openSync(path.join(directory,'process.log'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  try{child=spawn(binary,['-p',directory+'/', '-c',file,'-g','daemon off;'],{cwd:directory,env:childEnv(),stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
  phase='baseline-start';await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});master=procFact(child.pid);need(master.executable===binary&&master.cwd===directory,'owned_resource_changed');
  await until(async()=>{need(ownedAlive(master,context),'owned_resource_changed');try{return fs.readFileSync(path.join(directory,'nginx.pid'),'utf8').trim()===String(master.pid)&&(await probe('/api/app-web-version')).status===200;}catch(e){if(e instanceof ToolchainError)throw e;return false;}});
  phase='held-request';const old=snapshotWorkers();need(old.length===1,'observation_mismatch');
  held=net.connect({host:'127.0.0.1',port});heldDone=new Promise((resolve,reject)=>{held.on('data',b=>{heldText+=b;if(Buffer.byteLength(heldText)>65536){reject(new ToolchainError('observation_mismatch'));held.destroy();}});held.once('end',()=>resolve(heldText));held.once('error',reject);});heldDone.catch(()=>{});
  await new Promise((resolve,reject)=>{held.once('connect',resolve);held.once('error',reject);});
  // A real already-accepted incomplete request keeps the old generation alive.
  // Its destination is our constant fixture, never an application business API.
  held.write('POST /api/publish HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n');
  await until(()=>acceptedBy(old[0],port,held.localPort));
  let releaseOld=false;const start=Date.now();
  await drainAndProbeIngress({nowMs:()=>Date.now(),now:()=>new Date().toISOString(),authorize:()=>need(ownedAlive(master,context),'owned_resource_changed'),
   workers:()=>old,begin:()=>events.push({step:'begin'}),install:()=>{fs.writeFileSync(file,config(true)+(fault==='syntax'?'\ninvalid_fixture_directive;':''),{mode:0o600});events.push({step:'install'});},
   syntax:()=>{phase='gate-syntax';command(['-p',directory+'/', '-c',file,'-t']);},reload:()=>{phase='reload';need(fs.readFileSync(path.join(directory,'nginx.pid'),'utf8').trim()===String(master.pid),'owned_resource_changed');command(['-p',directory+'/', '-c',file,'-s','reload']);},
   drain:async()=>{
    phase='mixed-generation-drain';snapshotWorkers();if(!releaseOld){let newer;await until(async()=>{const r=await probe('/api/bookings');if(r.status===503&&r.gate==='gated'&&r.workerPid!==old[0].pid){newer=r;return true;}return false;});
     held.write('\r\n');const prior=parseSyntheticHttp(await Promise.race([heldDone,new Promise((_,reject)=>setTimeout(()=>reject(new ToolchainError('operation_unconfirmed')),2000))]));
     need(prior.status===200&&prior.gate==='open'&&prior.workerPid===old[0].pid,'observation_mismatch');mixed={newer:{status:newer.status,workerPid:newer.workerPid,gate:newer.gate},prior};releaseOld=true;events.push({step:'mixed-generations-proved',...mixed});
    }
    return {oldWorkersRemaining:old.filter(f=>ownedAlive(f,context)).length,applicationConnections:sockets.size};
   },wait,probeGate:async()=>{phase='gate-proof';probeCount++;need(old.every(f=>!ownedAlive(f,context))&&sockets.size===0,'ingress_not_drained');
    for(const [method,uri]of [['GET','/api/bookings'],['POST','/api/publish'],['POST','/api/personal-guest-merge']]){const r=await probe(uri,method);
     need(r.status===503&&r.gate==='gated'&&r.value?.error==='booking_temporarily_paused'&&r.value.operation===id&&!old.some(f=>f.pid===r.workerPid),'gate_not_confirmed');}
    for(const uri of ['/login','/api/orders','/api/merchant-enterprise/attendance'])need((await probe(uri)).status===200,'gate_not_confirmed');
    if(fault==='probe')throw new ToolchainError('gate_not_confirmed');events.push({step:'all-gates-proved-after-drain'});
   },
  },{startedAtMs:start,deadlineAtMs:start+90000,window});outcome='passed';
 }catch(e){error=publicFailure(e,{stage:'rehearsal'});outcome='failed';}
 finally{
  if(held)held.destroy();for(const socket of sockets)socket.destroy();
  const failures=[];try{snapshotWorkers();}catch(e){failures.push(publicFailure(e,{stage:'rehearsal'}));}
  for(const f of [master,...workers.values()].filter(Boolean))try{await stopOwned(f,context);}catch(e){failures.push(publicFailure(e,{stage:'rehearsal'}));}
  await new Promise(resolve=>upstream.close(resolve));need(failures.length===0&&[master,...workers.values()].filter(Boolean).every(f=>!ownedAlive(f,context)),'cleanup_unconfirmed');
 }
 const expected=fault==='none'?'passed':'failed',result={schemaVersion:1,kind:'release-toolchain-ingress-case',publicationAuthority:false,databaseAccess:false,directory,fault,outcome,expectedOutcome:expected,
  mixedGenerationObserved:!!mixed,mixed:mixed??null,probeCount,error:error??null,phase,allOwnedStopped:true,events};write('result.json',result);
 need(outcome===expected&&(fault!=='none'||!!mixed&&probeCount===1)&&
  (fault!=='syntax'||error?.code==='operation_unconfirmed'&&probeCount===0)&&
  (fault!=='probe'||error?.code==='gate_not_confirmed'&&probeCount===1&&!!mixed),'observation_mismatch');return result;
}
export async function rehearseToolchainIngress({nginx,runs=3,parent=os.tmpdir(),onEvent=()=>{}}){
 need(process.platform==='linux'&&process.arch==='x64'&&Number.isInteger(runs)&&runs>=1&&runs<=10,'unsupported_runtime');
 const profile=inspectToolchainNginxProfile(nginx);
 const base=fs.realpathSync(parent);need(/^\/[A-Za-z0-9_./-]+$/.test(base),'invalid_path');
 const root=fs.mkdtempSync(path.join(base,'faolla-release-toolchain-lab-'));fs.chmodSync(root,0o700);const results=[];
 const attempt={schemaVersion:1,kind:'release-toolchain-lab-attempt',root,nginxProfile:profile.id,publicationAuthority:false,databaseAccess:false,startedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(root,'attempt.json'),canonicalJson(attempt)+'\n',{flag:'wx',mode:0o600});onEvent(attempt);
 for(let i=0;i<runs;i++)results.push(await caseRun(profile,root,i));
 results.push(await caseRun(profile,root,runs,{fault:'syntax'}));results.push(await caseRun(profile,root,runs+1,{fault:'probe'}));
 const report={schemaVersion:1,kind:'release-toolchain-ingress-rehearsal',publicationAuthority:false,scope:'ingress-boundary-only',root,databaseAccess:false,
  normalRuns:runs,mixedGenerationProvedInEveryNormalRun:results.filter(r=>r.fault==='none').every(r=>r.mixedGenerationObserved&&r.outcome==='passed'),
  syntaxFailureRefused:true,probeFailureRefused:true,noMutatingPostRetry:results.every(r=>r.probeCount<=1),allOwnedStopped:results.every(r=>r.allOwnedStopped),
  results:results.map(({directory,fault,outcome})=>({directory,fault,outcome})),completedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(root,'report.json'),canonicalJson(report)+'\n',{flag:'wx',mode:0o600});return report;
}
