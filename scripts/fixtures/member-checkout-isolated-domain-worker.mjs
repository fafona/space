// Owned container fixture only. No production connector or service installer.
import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import {createHash,generateKeyPairSync,randomUUID,sign,verify} from 'node:crypto';
import {createIsolatedDeliveryPublisher,createIsolatedDeliveryReceiver} from '../member-checkout-isolated-delivery.mjs';
import {publishCredentialFile,validateCredentialEnvelope} from './merchant-checkout-credential-file.ts';
const hash=v=>createHash('sha256').update(v).digest('hex'),canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export async function runOwnedDomainWorker(config,iterator){
 const emit=v=>process.stdout.write(JSON.stringify(v)+'\n'),need=v=>{if(!v)throw Error('owned_domain_check_failed');};
 need(process.platform==='linux'&&process.getuid()===0&&['issuer','receiver','gateway'].includes(config.role));
 const filePolicy={directory:'/work/delivery',ownerUid:0,ownerGid:0,access:'owner',algorithm:'EdDSA',issuer:'owned-isolated',audience:'owned-runtime'},pub=config.publicKey??null;
 let server=null,pair=null,publisher=null,receiver=null,current=null,first=null,dropNextAck=false,received=0,authorized=0,rejected=0;
 const request=async(host,path,body,options={})=>new Promise((resolve,reject)=>{
  const pin=options.pin,agent=new https.Agent({keepAlive:false,maxCachedSessions:0});let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;agent.destroy();error?reject(error):resolve(value);};
  const req=https.request({host,port:8443,path,method:'POST',ca:config.ca,cert:options.client===false?undefined:config.cert,key:options.client===false?undefined:config.key,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',rejectUnauthorized:true,agent,signal:options.signal,checkServerIdentity:(name,cert)=>tls.checkServerIdentity(name,cert)||(hash(cert.raw)===pin?undefined:Error('owned_peer_refused')),headers:{'content-type':'application/json',...(options.jwt?{authorization:'Bearer '+options.jwt}:{})}},res=>{
   const fingerprint=hash(res.socket.getPeerCertificate().raw);if(!res.socket.authorized||fingerprint!==pin){res.destroy();finish(Error('owned_peer_refused'));return;}
   const chunks=[];let bytes=0;res.on('data',v=>{bytes+=v.length;if(bytes>32768){res.destroy();finish(Error('owned_body_refused'));}else chunks.push(v);});res.on('error',()=>finish(Error('owned_transport_failed')));res.on('end',()=>finish(null,{status:res.statusCode,peerFingerprint:fingerprint,body:Buffer.concat(chunks).toString('utf8')}));
  });req.on('error',()=>finish(Error('owned_transport_failed')));req.setTimeout(2500,()=>req.destroy());req.end(body);
 });
 const verifyJwt=jwt=>{try{const a=jwt.split('.'),p=JSON.parse(Buffer.from(a[1],'base64url'));validateCredentialEnvelope({version:1,purpose:'faolla-checkout-runtime-v1',generation:p.jti,jwt},filePolicy,Date.now(),Date.now());return verify(null,Buffer.from(a.slice(0,2).join('.')),pub,Buffer.from(a[2],'base64url'));}catch{return false;}};
 const publishConfig=()=>({filePolicy,recipientId:'owned-receiver',peerFingerprint:config.receiverPin,timeoutMs:1200});
 const newPublisher=()=>createIsolatedDeliveryPublisher(publishConfig(),{now:Date.now,send:async q=>request('receiver','/credentials',q.body,{pin:config.receiverPin,signal:q.signal})});
 const readBody=req=>new Promise((resolve,reject)=>{let bytes=0;const parts=[];req.on('data',v=>{bytes+=v.length;if(bytes>32768){req.destroy();reject(Error('owned_body_refused'));}else parts.push(v);});req.on('error',reject);req.on('end',()=>resolve(Buffer.concat(parts).toString('utf8')));});
 const respond=(res,status,v)=>{res.writeHead(status,{'content-type':'application/json'});res.end(typeof v==='string'?v:JSON.stringify(v));};
 try{
  if(config.role==='issuer'){
   pair=generateKeyPairSync('ed25519');fs.mkdirSync('/signing/private',{recursive:true,mode:0o700});fs.writeFileSync('/signing/private/issuer.pem',pair.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});publisher=newPublisher();
   emit({kind:'ready',role:'issuer',pid:process.pid,uid:process.getuid(),publicKey:pair.publicKey.export({type:'spki',format:'pem'}),inboundSigningListener:false});
  }else if(config.role==='receiver'){
   fs.mkdirSync(filePolicy.directory,{recursive:true,mode:0o700});receiver=createIsolatedDeliveryReceiver({filePolicy,recipientId:'owned-receiver',peerFingerprint:config.issuerPin,timeoutMs:2000},{now:Date.now,verify:async jwt=>verifyJwt(jwt),publish:async(p,v,now)=>{const ack=await publishCredentialFile(p,v,now);current=v;first??=v;received++;return ack;}});
   server=https.createServer({ca:config.ca,cert:config.cert,key:config.key,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',requestCert:true,rejectUnauthorized:true},async(req,res)=>{
    try{if(req.url!=='/credentials'||req.method!=='POST'||!req.socket.authorized)return respond(res,403,{});const peer=hash(req.socket.getPeerCertificate().raw),body=await readBody(req),ack=await receiver.receive(body,peer);if(dropNextAck){dropNextAck=false;setTimeout(()=>{if(!res.destroyed)respond(res,200,ack);},1800);}else respond(res,200,ack);}catch{if(!res.destroyed)respond(res,403,{error:'owned_delivery_refused'});}
   });await new Promise(r=>server.listen(8443,'0.0.0.0',r));emit({kind:'ready',role:'receiver',pid:process.pid,uid:process.getuid(),signingMaterialLoaded:false});
  }else{
   server=https.createServer({cert:config.cert,key:config.key,minVersion:'TLSv1.3',maxVersion:'TLSv1.3'},async(req,res)=>{
    const jwt=req.headers.authorization?.replace(/^Bearer /,'')??'';if(req.url==='/rpc'&&req.method==='POST'&&verifyJwt(jwt)){authorized++;return respond(res,200,{accepted:true});}rejected++;respond(res,401,{error:'owned_capability_refused'});
   });await new Promise(r=>server.listen(8443,'0.0.0.0',r));emit({kind:'ready',role:'gateway',pid:process.pid,uid:process.getuid(),signingMaterialLoaded:false,realPostgrest:false});
  }
  for await(const line of iterator){
   let q;try{q=JSON.parse(line);}catch{emit({kind:'control-refused'});continue;}if(!q||Object.keys(q).length!==1||typeof q.command!=='string'){emit({kind:'control-refused'});continue;}
   if(q.command==='stop'){emit({kind:'stopped',role:config.role,received,authorized,rejected});break;}
   if(config.role==='issuer'&&q.command==='issue'){
    const generation=randomUUID(),iat=Math.floor(Date.now()/1000),claims={role:'faolla_checkout_runtime',iss:filePolicy.issuer,aud:filePolicy.audience,iat,exp:iat+30,jti:generation},wire=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url'),value={version:1,purpose:'faolla-checkout-runtime-v1',generation,jwt:wire+'.'+sign(null,Buffer.from(wire),pair.privateKey).toString('base64url')};
    try{await publisher.publish(filePolicy,value,Date.now());emit({kind:'issued',generation,expiresAt:claims.exp*1000,state:publisher.snapshot()});}catch{emit({kind:'issue-refused',state:publisher.snapshot()});}
   }else if(config.role==='issuer'&&q.command==='resume'){publisher=newPublisher();emit({kind:'resumed'});
   }else if(config.role==='receiver'&&q.command==='drop-ack'){dropNextAck=true;emit({kind:'ack-drop-armed'});
   }else if(config.role==='receiver'&&q.command==='snapshot'){emit({kind:'receiver-snapshot',received,state:receiver.snapshot()});
   }else if(config.role==='receiver'&&q.command==='call'){
    need(current);const response=await request('gateway','/rpc','{}',{pin:config.gatewayPin,client:false,jwt:current.jwt});emit({kind:'called',status:response.status});
   }else if(config.role==='receiver'&&q.command==='call-original'){
    need(first);const response=await request('gateway','/rpc','{}',{pin:config.gatewayPin,client:false,jwt:first.jwt});emit({kind:'original-called',status:response.status,at:Date.now()});
   }else if(config.role==='receiver'&&q.command==='attack'){
    need(current);let privateRead=false,dockerSocket=false,issuerApi=false,wrongPeerAccepted=false;
    try{fs.readFileSync('/signing/private/issuer.pem');privateRead=true;}catch{}try{fs.statSync('/var/run/docker.sock');dockerSocket=true;}catch{}
    try{await request('issuer','/sign','{}',{pin:config.issuerPin});issuerApi=true;}catch{}
    try{const r=await request('receiver','/credentials',canonical(current),{pin:config.receiverPin});wrongPeerAccepted=r.status===200;}catch{}
    const parts=current.jwt.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));claims.role='service_role';parts[1]=Buffer.from(JSON.stringify(claims)).toString('base64url');const forged={...current,jwt:parts.join('.')};
    // Root CAN alter its own handoff file. Only the independent verifier, not
    // Unix mode bits on this host, is credited with refusing the forged JWT.
    fs.writeFileSync(filePolicy.directory+'/runtime.json',canonical(forged));const response=await request('gateway','/rpc','{}',{pin:config.gatewayPin,client:false,jwt:forged.jwt});fs.writeFileSync(filePolicy.directory+'/runtime.json',canonical(current));
    emit({kind:'attack-result',rootCanRewriteCredentialFile:true,privateKeyRead:privateRead,dockerSocketExposed:dockerSocket,issuerApiReachable:issuerApi,wrongMtlsPeerAccepted:wrongPeerAccepted,forgedCapabilityStatus:response.status});
   }else emit({kind:'control-refused'});
  }
 }catch{emit({kind:'worker-failed',role:config.role});process.exitCode=1;}
 finally{if(server)await new Promise(r=>server.close(r));}
}
