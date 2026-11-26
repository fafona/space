// Disposable CI lifecycle fixture, NOT a production or host-root isolation test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign,verify,X509Certificate} from 'node:crypto';
import {createCredentialRenewalController} from './member-checkout-credential-renewal.mjs';
import {createIsolatedDeliveryReceiver} from './member-checkout-isolated-delivery.mjs';
import {createIsolatedRenewalSupervisor} from './member-checkout-isolated-supervisor.mjs';
import credentialFile from './fixtures/merchant-checkout-credential-file.ts';
const {publishCredentialFile,createCredentialFileReader,validateCredentialEnvelope}=credentialFile;
const branch='refs/heads/acceptance/member-checkout-signing-supervision-20261126';
assert.equal(process.platform,'linux');assert.equal(process.version,'v24.13.1');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.GITHUB_REPOSITORY,'fafona/space');assert.equal(process.env.GITHUB_REF,branch);assert.match(process.env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
const temp=fs.realpathSync(process.env.RUNNER_TEMP);assert.ok(temp.startsWith('/home/runner/work/_temp'));
const root=fs.mkdtempSync(path.join(temp,'checkout-supervision-')),checks=[],hash=v=>createHash('sha256').update(v).digest('hex');
let phase='certificates',server=null,supervisor=null,run=null,mode='healthy',received=0,sends=0,signs=0,error=null,failure=null,observations={},cleanupPassed=false;
const check=(ok,field)=>{if(!ok)throw Object.assign(Error('owned_supervision_check_failed'),{field});};
function command(args){const r=spawnSync('openssl',args,{shell:false,encoding:'utf8',timeout:10000,maxBuffer:1048576});check(!r.error&&!r.signal&&r.status===0,'openssl_exit');return r.stdout;}
function cert(name,usage){
 const base=path.join(root,name),ext=base+'.ext';fs.writeFileSync(ext,'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage='+usage+'\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',{flag:'wx',mode:0o600});
 command(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN='+name,'-keyout',base+'.key','-out',base+'.csr']);command(['x509','-req','-in',base+'.csr','-CA',path.join(root,'ca.crt'),'-CAkey',path.join(root,'ca.key'),'-CAcreateserial','-days','1','-sha256','-extfile',ext,'-out',base+'.crt']);
 const pem=fs.readFileSync(base+'.crt','utf8');return {key:fs.readFileSync(base+'.key','utf8'),cert:pem,pin:hash(new X509Certificate(pem).raw)};
}
async function bounded(p,ms){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('owned_deadline')),ms))]);}finally{clearTimeout(timer);}}
async function until(condition){const end=performance.now()+12000;while(!condition()){check(!supervisor?.snapshot().reason&&!supervisor?.snapshot().stopRequested,'unexpected_early_fault');check(performance.now()<end,'owned_wait_deadline');await new Promise(r=>setTimeout(r,25));}}
const mark=name=>checks.push(name);
try{
 fs.chmodSync(root,0o700);command(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=owned-supervision-ca','-keyout',path.join(root,'ca.key'),'-out',path.join(root,'ca.crt')]);const ca=fs.readFileSync(path.join(root,'ca.crt'),'utf8'),client=cert('owned-client','clientAuth'),endpoint=cert('owned-server','serverAuth');
 const pair=generateKeyPairSync('ed25519'),directory=path.join(root,'delivery');fs.mkdirSync(directory,{mode:0o700});
 const p={directory,ownerUid:process.getuid(),ownerGid:process.getgid(),access:'owner',algorithm:'EdDSA',issuer:'owned-supervision',audience:'owned-runtime'};
 const receiver=createIsolatedDeliveryReceiver({filePolicy:p,recipientId:'owned-supervision',peerFingerprint:client.pin,timeoutMs:2000},{now:Date.now,verify:async jwt=>{const parts=jwt.split('.');return verify(null,Buffer.from(parts.slice(0,2).join('.')),pair.publicKey,Buffer.from(parts[2],'base64url'));},publish:async(policy,value,now)=>{const ack=await publishCredentialFile(policy,value,now);received++;return ack;}});
 const body=req=>new Promise((resolve,reject)=>{let bytes=0;const chunks=[];req.on('data',v=>{bytes+=v.length;if(bytes>32768){req.destroy();reject(Error('owned_body_refused'));}else chunks.push(v);});req.on('error',reject);req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
 server=https.createServer({ca,cert:endpoint.cert,key:endpoint.key,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',requestCert:true,rejectUnauthorized:true},async(req,res)=>{
  try{check(req.url==='/credentials'&&req.method==='POST'&&req.socket.authorized,'fixed_route_and_tls');const ack=await receiver.receive(await body(req),hash(req.socket.getPeerCertificate().raw));if(mode==='drop-ack')return;res.writeHead(200,{'content-type':'application/json'});res.end(ack);}
  catch{if(!res.destroyed){res.writeHead(403,{'content-type':'application/json'});res.end('{}');}}
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();check(address.address==='127.0.0.1'&&address.family==='IPv4','loopback_only');
 const send=q=>new Promise((resolve,reject)=>{
  sends++;const agent=new https.Agent({keepAlive:false,maxCachedSessions:0});let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;agent.destroy();error?reject(error):resolve(value);};
  const req=https.request({host:'127.0.0.1',port:address.port,path:'/credentials',method:'POST',ca,cert:client.cert,key:client.key,rejectUnauthorized:true,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',checkServerIdentity:(name,cert)=>tls.checkServerIdentity(name,cert)||(hash(cert.raw)===endpoint.pin?undefined:Error('owned_peer_refused')),agent,signal:q.signal,headers:{'content-type':q.contentType}},res=>{
   const pin=hash(res.socket.getPeerCertificate().raw);if(!res.socket.authorized||pin!==endpoint.pin){res.destroy();finish(Error('owned_peer_refused'));return;}
   let bytes=0;const chunks=[];res.on('data',v=>{bytes+=v.length;if(bytes>1024){res.destroy();finish(Error('owned_body_refused'));}else chunks.push(v);});res.on('error',()=>finish(Error('owned_transport_refused')));res.on('aborted',()=>finish(Error('owned_transport_refused')));res.on('end',()=>finish(null,{status:res.statusCode,peerFingerprint:pin,body:Buffer.concat(chunks).toString('utf8')}));
  });req.on('error',()=>finish(Error('owned_transport_refused')));req.setTimeout(2500,()=>req.destroy());req.end(q.body);
 });
 supervisor=createIsolatedRenewalSupervisor({renewal:{filePolicy:p,ttlSeconds:30,renewAheadMs:23000,pollMs:50,issueTimeoutMs:1000},delivery:{recipientId:'owned-supervision',peerFingerprint:endpoint.pin,timeoutMs:2000}},{createController:createCredentialRenewalController,wallNow:Date.now,monotonicNow:()=>performance.now(),send,sign:async(bytes,signal)=>{check(!signal.aborted,'sign_not_aborted');signs++;return sign(null,bytes,pair.privateKey);}});
 phase='initial-push';run=supervisor.run();await until(()=>supervisor.snapshot().published===1);const reader=createCredentialFileReader(p),read=()=>reader.read(AbortSignal.timeout(5000),Date.now,Date.now()+12000),first=await read(),firstInode=fs.statSync(directory+'/runtime.json',{bigint:true}).ino;check(first.generation===supervisor.snapshot().generation,'first_generation_binding');mark('unchanged-controller-and-supervisor-real-mtls-to-original-atomic-file-reader');
 phase='automatic-renewal';await until(()=>supervisor.snapshot().published===2);const second=await read(),secondInode=fs.statSync(directory+'/runtime.json',{bigint:true}).ino;check(second.generation!==first.generation&&secondInode!==firstInode,'atomic_new_generation');check(second.generation===supervisor.snapshot().generation,'renewed_generation_binding');mark('real-wall-clock-automatic-renewal-without-restarting-controller-or-reader');
 phase='lost-receipt';mode='drop-ack';const stopped=await bounded(run,12000);check(stopped.phase==='faulted'&&stopped.reason==='DELIVERY_UNCONFIRMED'&&stopped.stopConfirmed&&!stopped.loopRunning,'supervised_stop_after_lost_receipt');check(stopped.transport.halted&&stopped.published===2&&received===3&&sends===3&&signs===3,'ambiguous_publication_counts');mark('actual-file-commit-with-missing-tls-receipt-stops-signing-and-transport');
 phase='original-file-preserved';const after=await read();check(after.generation!==second.generation,'receiver_retains_original_after_missing_ack');validateCredentialEnvelope(after,p,Date.now(),Date.now()+12000);mark('ambiguous-original-file-is-kept-not-deleted-or-rolled-back');
 phase='no-retry';for(let i=0;i<3;i++)await supervisor.tick();await new Promise(r=>setTimeout(r,200));check(signs===3&&sends===3&&received===3,'no_later_sign_or_send');check(supervisor.snapshot().transport.confirmed===2,'late_receipt_not_fabricated');let restartRefused=false;try{supervisor.run();}catch{restartRefused=true;}check(restartRefused,'automatic_restart_refused');mark('later-ticks-do-not-sign-send-or-replay-financial-work-and-run-cannot-restart');
 const final=await supervisor.stop();check(final.stopConfirmed&&!final.loopRunning&&final.signerPending===0,'controlled_stop_complete');mark('explicit-stop-remains-idempotent-and-owned-loop-is-quiescent');
 observations={checks,tlsVersion:'TLSv1.3',sameOriginalController:true,originalFilePublisherAndReader:true,realClockAutomaticRenewal:true,confirmedPublications:2,receiverPublications:3,signRequests:signs,networkSends:sends,ambiguousFilePreserved:true,automaticRestart:false,lateResultsRepublished:false,physicalSignerStopProven:false,actualNextProcess:false,realPostgrest:false,financialDatabaseWrites:0,hostRootIsolationProven:false,persistentRecoveryProven:false,productionConnected:false};
}catch(e){error='owned_supervision_failed';failure={phase,code:/^[A-Z0-9_]{1,48}$/.test(e?.code??'')?e.code:null,field:/^[a-z_]{1,80}$/.test(e?.field??'')?e.field:null};}
finally{
 try{if(supervisor)await bounded(supervisor.stop(),7000);if(run)await bounded(run,7000);if(server){server.closeAllConnections();if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}check(fs.realpathSync(root)===root&&path.dirname(root)===temp&&path.basename(root).startsWith('checkout-supervision-')&&!fs.lstatSync(root).isSymbolicLink(),'cleanup_exact_owned_root');fs.rmSync(root,{recursive:true,force:false});cleanupPassed=!fs.existsSync(root)&&!server?.listening;}catch{error??='owned_supervision_cleanup_failed';}
}
const report={version:1,kind:'owned-isolated-renewal-supervision',commit:process.env.GITHUB_SHA,branch,passed:error===null&&cleanupPassed,checks,observations,error,failure,cleanup:{temporaryRootRemoved:!fs.existsSync(root),listenerClosed:!server?.listening,passed:cleanupPassed},productionConnected:false,installationAuthorized:false,deploymentAuthorized:false,stripeEnabled:false};
const wire=JSON.stringify(report,null,2)+'\n';assert.ok(!wire.includes('BEGIN PRIVATE KEY')&&!wire.includes('eyJ'));fs.writeFileSync(path.join(temp,'checkout-supervision-owned.json'),wire,{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleanupPassed,error,productionConnected:false}));if(!report.passed)process.exitCode=1;
