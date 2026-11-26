// LOCAL-ONLY isolated-domain protocol prototype. No listener, connector,
// environment/key loader, installer, app integration or production authority.
// Existing envelope/file validation remains unchanged; TLS/signature/publisher
// adapters must be independently trusted and are injected by owned fixtures.
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import path from 'node:path';
import {validateCredentialEnvelope} from './fixtures/merchant-checkout-credential-file.ts';
const reject=()=>{throw Error('isolated_delivery_unavailable');};
const need=v=>{if(!v)reject();};
const data=v=>v&&typeof v==='object'&&!Array.isArray(v)&&!isProxy(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&!Object.getOwnPropertySymbols(v).length&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));
const exact=(v,keys)=>data(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function policy(input){
 need(exact(input,['filePolicy','recipientId','peerFingerprint','timeoutMs']));
 need(exact(input.filePolicy,['directory','ownerUid','ownerGid','access','algorithm','issuer','audience']));
 const p=input.filePolicy;need(typeof p.directory==='string'&&path.posix.isAbsolute(p.directory)&&path.posix.normalize(p.directory)===p.directory&&!p.directory.endsWith('/')&&p.directory.split('/').filter(Boolean).length>=2&&!p.directory.includes('\0'));
 need([p.ownerUid,p.ownerGid].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=4294967294)&&['owner','group'].includes(p.access));
 // This prototype's application-side verifier may hold PUBLIC material only.
 // A symmetric verifier in that root domain would undo the isolation claim.
 need(['RS256','ES256','EdDSA'].includes(p.algorithm)&&[p.issuer,p.audience].every(v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x20\x7f]/.test(v)));
 need(typeof input.recipientId==='string'&&/^[a-z0-9-]{1,64}$/.test(input.recipientId));
 need(typeof input.peerFingerprint==='string'&&/^[a-f0-9]{64}$/.test(input.peerFingerprint));
 need(Number.isInteger(input.timeoutMs)&&input.timeoutMs>=50&&input.timeoutMs<=5000);
 return Object.freeze({...input,filePolicy:Object.freeze({...input.filePolicy})});
}
function envelope(wire,p,now){
 need(typeof wire==='string'&&Buffer.byteLength(wire)<=32768);let v;try{v=JSON.parse(wire);}catch{reject();}
 need(data(v)&&canonical(v)===wire);const result=validateCredentialEnvelope(v,p,now,now+12000);
 const payload=JSON.parse(Buffer.from(result.jwt.split('.')[1],'base64url'));
 // Existing renewal uses its generation as jti. Do not accept a collision under
 // a new unsigned outer label; no caller role/claims/algorithm are accepted.
 need(payload.jti===result.generation);return {value:result,issuedAt:payload.iat,wireSha256:hash(wire)};
}
async function deadline(action,timeoutMs,outer){
 const abort=new AbortController();let timer,stop;
 try{
  need(!outer?.aborted);stop=()=>abort.abort();outer?.addEventListener('abort',stop,{once:true});if(outer?.aborted)abort.abort();
  return await Promise.race([Promise.resolve().then(()=>{need(!abort.signal.aborted);return action(abort.signal);}),new Promise((_,bad)=>{timer=setTimeout(()=>{abort.abort();bad(Error('isolated_delivery_unavailable'));},timeoutMs);abort.signal.addEventListener('abort',()=>bad(Error('isolated_delivery_unavailable')),{once:true});if(abort.signal.aborted)bad(Error('isolated_delivery_unavailable'));})]);
 }finally{clearTimeout(timer);outer?.removeEventListener('abort',stop);}
}
export function createIsolatedDeliveryPublisher(input,dependencies){
 const p=policy(input);need(exact(dependencies,['send','now'])&&typeof dependencies.send==='function'&&typeof dependencies.now==='function');
 let busy=false,halted=false,sends=0,confirmed=0;
 return Object.freeze({
  snapshot:()=>Object.freeze({busy,halted,sends,confirmed,automaticRetry:false,productionAuthorized:false,deploymentReady:false}),
  async publish(filePolicy,value,now,signal){
   const observed=dependencies.now();need(!halted&&!busy&&exact(filePolicy,['directory','ownerUid','ownerGid','access','algorithm','issuer','audience'])&&Object.keys(p.filePolicy).every(k=>filePolicy[k]===p.filePolicy[k])&&Number.isSafeInteger(now)&&Number.isSafeInteger(observed)&&observed>=now&&observed-now<=2000);
   const clean=validateCredentialEnvelope(value,p.filePolicy,observed,observed+12000),wire=canonical(clean),v=envelope(wire,p.filePolicy,observed);busy=true;let dispatched=false;
   try{
    const r=await deadline(async stop=>{dispatched=true;sends++;return dependencies.send(Object.freeze({recipientId:p.recipientId,body:wire,contentType:'application/json',signal:stop}));},p.timeoutMs,signal);
    need(exact(r,['status','peerFingerprint','body'])&&r.status===200&&r.peerFingerprint===p.peerFingerprint&&typeof r.body==='string'&&Buffer.byteLength(r.body)<=1024);
    const ack=JSON.parse(r.body);need(canonical(ack)===r.body&&exact(ack,['version','purpose','recipientId','generation','wireSha256','published'])&&ack.version===1&&ack.purpose==='faolla-checkout-delivery-ack-v1'&&ack.recipientId===p.recipientId&&ack.generation===v.value.generation&&ack.wireSha256===v.wireSha256&&ack.published===true);
    need(!signal?.aborted);envelope(wire,p.filePolicy,dependencies.now());confirmed++;return Object.freeze({published:true,generation:v.value.generation,productionAuthorized:false});
   }catch{if(dispatched)halted=true;return reject();}finally{busy=false;}
  }
 });
}
export function createIsolatedDeliveryReceiver(input,dependencies){
 const p=policy(input);need(exact(dependencies,['verify','publish','now'])&&['verify','publish','now'].every(k=>typeof dependencies[k]==='function'));
 let busy=false,halted=false,published=0,last=null;
 const snapshot=()=>Object.freeze({busy,halted,published,generation:last?.generation??null,issuedAt:last?.issuedAt??null,wireSha256:last?.wireSha256??null,persistentWatermark:false,productionAuthorized:false,deploymentReady:false});
 return Object.freeze({snapshot,async receive(wire,peer,signal){
  need(!busy&&!halted&&peer===p.peerFingerprint);const now=dependencies.now();need(Number.isSafeInteger(now));const v=envelope(wire,p.filePolicy,now);busy=true;let publicationStarted=false;
  try{
   const verified=await deadline(stop=>dependencies.verify(v.value.jwt,stop),p.timeoutMs,signal);need(verified===true&&!signal?.aborted);envelope(wire,p.filePolicy,dependencies.now());
   if(last?.generation===v.value.generation)need(last.wireSha256===v.wireSha256);
   else{
    need(last===null||v.issuedAt>last.issuedAt);publicationStarted=true;
    const ack=await deadline(stop=>dependencies.publish(p.filePolicy,v.value,now,stop),p.timeoutMs,signal);
    need(ack?.published===true&&ack.generation===v.value.generation&&ack.productionAuthorized===false&&!signal?.aborted);
    last={generation:v.value.generation,issuedAt:v.issuedAt,wireSha256:v.wireSha256};published++;
   }
   envelope(wire,p.filePolicy,dependencies.now());return canonical({version:1,purpose:'faolla-checkout-delivery-ack-v1',recipientId:p.recipientId,generation:v.value.generation,wireSha256:v.wireSha256,published:true});
  }catch{if(publicationStarted)halted=true;return reject();}finally{busy=false;}
 }});
}
