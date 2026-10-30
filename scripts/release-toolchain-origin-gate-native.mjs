// Owned transport acceptance only. Never installs a formal ingress gate or
// accepts a caller-selected formal endpoint/CA. All fixtures remain private.
import * as fs from 'node:fs';import path from 'node:path';import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';import {connect as h2Connect,constants as h2} from 'node:http2';
import {randomUUID} from 'node:crypto';import {fileURLToPath,pathToFileURL} from 'node:url';
import {readBoundedOriginGateResponse,activeBookingOriginProbeOptions} from './release-toolchain-origin-gate-probe.mjs';
import {proveActiveBookingGatedWorkerCohort,activeBookingIngressSnippet} from './release-toolchain-active-generation-ingress.mjs';
import {toolchainNginxProfile} from './release-toolchain-profiles.mjs';
import {ownedReleasePath} from './release-toolchain-source.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),NAME='owned-origin.faolla.invalid',NGINX=fs.existsSync('/www/server/nginx/sbin/nginx')?'/www/server/nginx/sbin/nginx':'/usr/sbin/nginx';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=path.basename(source);
function run(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',timeout:10000,maxBuffer:65536,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C'}});need(r.status===0&&!r.signal&&!r.error,'operation_unconfirmed');return r.stdout;}
const seal=(root,name,v)=>{fs.writeFileSync(root+'/'+name,canonicalJson(v)+'\n',{flag:'wx',mode:0o600});};
async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
function birth(pid){try{const text=fs.readFileSync('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);return{pid,startTicks:fields[19],state:fields[0]};}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}}
function live(f){const a=birth(f.pid);return a&&a.startTicks===f.startTicks&&a.state!=='Z';}
function workers(master){need(live(master),'owned_resource_changed');return fs.readFileSync('/proc/'+master.pid+'/task/'+master.pid+'/children','utf8').trim().split(/\s+/).filter(Boolean).map(Number).map(birth).filter(f=>f&&f.state!=='Z').map(({pid,startTicks})=>({pid,startTicks}));}
async function until(fn,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(25);}need(false,'operation_unconfirmed');}
export async function acceptOwnedOriginGateTransport(){
 need(process.platform==='linux'&&process.getuid?.()===0&&source==='/var/lib/faolla-online-code/'+revision&&/^[a-f0-9]{40}$/.test(revision),'unsupported_runtime');
 const root=fs.mkdtempSync('/var/lib/faolla-origin-gate-native-');fs.chmodSync(root,0o700);
 const at=Date.now(),window={id:randomUUID(),startedAt:new Date(at).toISOString(),deadlineAt:new Date(at+600000).toISOString()},port=await freePort(),proxyPort=await freePort();let master,session,proxy,success=false,stage='certificate',cancelled=false;
 const cancel=()=>{cancelled=true;},verify=()=>{need(!cancelled,'operation_unconfirmed');need(live(master),'owned_resource_changed');};process.on('SIGTERM',cancel);process.on('SIGINT',cancel);
 const owner={kind:'owned-origin-gate-transport-started',toolRevision:revision,sourceSha256:sha256(fs.readFileSync(fileURLToPath(import.meta.url))),root,port,proxyPort,window,formalHostTouched:false,publicationAuthority:false};seal(root,'started.json',owner);
 try{
  // A private CA is used only by the private TLS fixture. Production probe
  // options never accept this CA and keep normal system trust validation.
  run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+NAME,'-addext','subjectAltName=DNS:'+NAME,'-keyout',root+'/key.pem','-out',root+'/cert.pem']);fs.chmodSync(root+'/key.pem',0o600);const ca=fs.readFileSync(root+'/cert.pem');
  const profile=toolchainNginxProfile(NGINX),config=`user root;pid ${root}/nginx.pid;working_directory ${root};error_log ${root}/error.log;worker_processes 8;events {worker_connections 256;accept_mutex on;}http {${profile.httpDirectives}access_log off;keepalive_timeout 120;server {listen 127.0.0.1:${port} ssl http2;server_name ${NAME};ssl_certificate ${root}/cert.pem;ssl_certificate_key ${root}/key.pem;${activeBookingIngressSnippet(window)}location / {return 200 '{}';}}}`;
  fs.writeFileSync(root+'/nginx.conf',config,{mode:0o600,flag:'wx'});stage='nginx-start';run(NGINX,['-p',root+'/', '-c',root+'/nginx.conf','-t']);
  // Register the directly spawned child BEFORE waiting on its PID-file ack.
  // nginx -t can leave an empty PID file; it never grants signal authority.
  const output=fs.openSync(root+'/nginx-output.log','wx',0o600);let child;try{child=spawn(NGINX,['-p',root+'/', '-c',root+'/nginx.conf','-g','daemon off;'],{cwd:root,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C'},stdio:['ignore',output,output]});}finally{fs.closeSync(output);}
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});master=birth(child.pid);need(master&&fs.realpathSync('/proc/'+master.pid+'/exe')===fs.realpathSync(NGINX)&&fs.realpathSync('/proc/'+master.pid+'/cwd')===root,'owned_resource_changed');seal(root,'nginx-process.json',master);
  await until(()=>{verify();return fs.existsSync(root+'/nginx.pid')&&/^[1-9][0-9]*\n?$/.test(fs.readFileSync(root+'/nginx.pid','utf8'))&&Number(fs.readFileSync(root+'/nginx.pid','utf8').trim())===master.pid&&workers(master).length===8;});const cohort=workers(master);
  const fixed=activeBookingOriginProbeOptions(window,0),options={...fixed,port,servername:NAME,ca,headers:{...fixed.headers,Host:NAME}};
  stage='tls-negative';for(const invalid of[{...options,servername:'wrong.faolla.invalid'},{...options,ca:undefined}]){let rejected=false;try{await readBoundedOriginGateResponse(httpsRequest,invalid);}catch{rejected=true;}need(rejected,'gate_not_confirmed');}
  stage='pooled-http2-origin';session=h2Connect('https://127.0.0.1:'+port,{servername:NAME,ca,rejectUnauthorized:true});session.on('error',()=>{});await new Promise((resolve,reject)=>{session.once('connect',resolve);session.once('error',reject);});need(session.socket.authorized&&session.alpnProtocol==='h2','gate_not_confirmed');
  // An owned reverse proxy deliberately reuses ONE verified HTTP/2 origin
  // session for every fresh external request, matching the CDN failure mode.
  proxy=createServer((req,res)=>{const stream=session.request({[h2.HTTP2_HEADER_METHOD]:'GET',[h2.HTTP2_HEADER_PATH]:req.url,[h2.HTTP2_HEADER_AUTHORITY]:NAME});stream.once('response',headers=>{res.writeHead(Number(headers[':status']),{'content-type':'application/json'});stream.pipe(res);});stream.once('error',()=>res.destroy());stream.end();});await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(proxyPort,'127.0.0.1',resolve);});
  const pooled=[];for(let i=0;i<16;i++){verify();const response=await readBoundedOriginGateResponse(httpRequest,{host:'127.0.0.1',port:proxyPort,path:'/api/bookings?pooled='+i,method:'GET',agent:false,headers:{Connection:'close'}});need(response.status===503&&response.value?.operation===window.id,'gate_not_confirmed');pooled.push(response.value.workerPid);}need(new Set(pooled).size===1&&cohort.some(w=>w.pid===pooled[0]),'gate_not_confirmed');
  // Exercise the unmodified cohort verifier, with actual responses from the
  // owned multiplexing proxy. Its independent elapsed clock reaches the
  // existing bound quickly; the formal verifier's limits are not altered.
  let clock=Date.now(),rejected=false;try{await proveActiveBookingGatedWorkerCohort({verify,expectedWorkerCount:8,workers:()=>workers(master),nowMs:()=>clock,probe:()=>readBoundedOriginGateResponse(httpRequest,{host:'127.0.0.1',port:proxyPort,path:'/api/bookings',agent:false}),wait:async()=>{clock+=5000;}},window);}catch(e){need(e.message==='release_toolchain_gate_not_confirmed','operation_unconfirmed');rejected=true;}need(rejected,'gate_not_confirmed');
  stage='fresh-https-origin';let index=0;const proof=await proveActiveBookingGatedWorkerCohort({verify,expectedWorkerCount:8,workers:()=>workers(master),nowMs:()=>Date.now(),probe:()=>readBoundedOriginGateResponse(httpsRequest,{...options,path:'/api/bookings?fresh='+index++}),wait:sleep},window);need(proof.workers.length===8&&cohort.every(w=>proof.workers.some(p=>p.pid===w.pid&&p.startTicks===w.startTicks)),'gate_not_confirmed');seal(root,'fresh-cohort.json',proof);seal(root,'pooled-observations.json',{observations:pooled,distinctOriginWorkers:1,existingCohortVerifierRejected:true});success=true;
 }catch(error){seal(root,'failed.json',{kind:'owned-origin-gate-transport-failed',toolRevision:revision,stage,errorSha256:sha256(String(error?.message)),publicationAuthority:false});throw error;}
 finally{
  session?.destroy();if(proxy){proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
  if(master&&live(master)){need(fs.realpathSync('/proc/'+master.pid+'/exe')===fs.realpathSync(NGINX)&&fs.realpathSync('/proc/'+master.pid+'/cwd')===root,'owned_resource_changed');process.kill(master.pid,'SIGTERM');await until(()=>!live(master));}
  for(const name of fs.readdirSync('/proc').filter(v=>/^[1-9][0-9]*$/.test(v)))try{need(fs.realpathSync('/proc/'+name+'/cwd')!==root,'cleanup_unconfirmed');}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
  seal(root,'cleanup.json',{allOwnedProcessesStopped:true,formalHostTouched:false,publicationAuthority:false});
  process.off('SIGTERM',cancel);process.off('SIGINT',cancel);
 }
 need(success,'operation_unconfirmed');const files=Object.fromEntries(['started.json','nginx-process.json','fresh-cohort.json','pooled-observations.json','cleanup.json'].map(name=>[name,sha256(fs.readFileSync(root+'/'+name))]));
 const report={kind:'owned-origin-gate-transport-verified',toolRevision:revision,sourceSha256:owner.sourceSha256,files,eightActualNginxWorkers:true,pooledHttp2ReverseProxyReproduced:true,pooledCoverageRejected:true,freshVerifiedTlsCoveredAllWorkers:true,wrongHostnameRejected:true,untrustedCertificateRejected:true,allOwnedProcessesStopped:true,formalHostTouched:false,publicationAuthority:false};seal(root,'verified.json',report);return verifyOwnedOriginGateTransport(root,{toolRevision:revision});
}
export function verifyOwnedOriginGateTransport(root,{toolRevision}){
 need(process.platform==='linux'&&process.getuid?.()===0&&source==='/var/lib/faolla-online-code/'+toolRevision&&revision===toolRevision&&/^\/var\/lib\/faolla-origin-gate-native-[A-Za-z0-9]+$/.test(root),'unsupported_runtime');ownedReleasePath(root,{directory:true,privateMode:true});need(!fs.existsSync(root+'/failed.json'),'operation_unconfirmed');
 const read=name=>{ownedReleasePath(root+'/'+name,{privateMode:true});const text=fs.readFileSync(root+'/'+name,'utf8'),v=JSON.parse(text);need(text===canonicalJson(v)+'\n','evidence_invalid');return v;},report=read('verified.json');
 need(report.kind==='owned-origin-gate-transport-verified'&&report.toolRevision===toolRevision&&report.sourceSha256===sha256(fs.readFileSync(fileURLToPath(import.meta.url))),'source_changed');
 for(const key of ['eightActualNginxWorkers','pooledHttp2ReverseProxyReproduced','pooledCoverageRejected','freshVerifiedTlsCoveredAllWorkers','wrongHostnameRejected','untrustedCertificateRejected','allOwnedProcessesStopped'])need(report[key]===true,'evidence_invalid');need(report.formalHostTouched===false&&report.publicationAuthority===false,'evidence_invalid');
 const required=['started.json','nginx-process.json','fresh-cohort.json','pooled-observations.json','cleanup.json'];need(canonicalJson(Object.keys(report.files??{}).sort())===canonicalJson(required.sort()),'evidence_invalid');for(const name of required){read(name);need(report.files[name]===sha256(fs.readFileSync(root+'/'+name)),'evidence_invalid');}
 const owner=read('started.json'),master=read('nginx-process.json'),proof=read('fresh-cohort.json'),pooled=read('pooled-observations.json');need(owner.root===root&&owner.toolRevision===toolRevision&&owner.sourceSha256===report.sourceSha256&&owner.formalHostTouched===false&&owner.publicationAuthority===false,'evidence_invalid');
 need(proof.kind==='active-booking-current-nginx-cohort-gated'&&proof.mutationPerformed===false&&canonicalJson(proof.window)===canonicalJson(owner.window)&&proof.workers?.length===8&&new Set(proof.workers.map(w=>w.pid)).size===8&&proof.workersSha256===sha256(canonicalJson(proof.workers)),'evidence_invalid');
 need(pooled.observations?.length===16&&new Set(pooled.observations).size===1&&pooled.distinctOriginWorkers===1&&pooled.existingCohortVerifierRejected===true&&proof.workers.some(w=>w.pid===pooled.observations[0]),'evidence_invalid');for(const fact of [master,...proof.workers])need(Number.isSafeInteger(fact.pid)&&fact.pid>1&&/^[1-9][0-9]*$/.test(fact.startTicks)&&!live(fact),'cleanup_unconfirmed');need(read('cleanup.json').allOwnedProcessesStopped===true,'cleanup_unconfirmed');
 return{root,report,sha256:sha256(fs.readFileSync(root+'/verified.json'))};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)acceptOwnedOriginGateTransport().then(v=>console.log(canonicalJson(v)),e=>{console.error(canonicalJson({kind:'owned-origin-gate-transport-refused',code:e.message}));process.exitCode=1;});
