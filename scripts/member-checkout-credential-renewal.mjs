// Independent, opt-in signing-boundary component. No key loader, public API,
// environment selection, database, application integration or service installer.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isProxy} from 'node:util/types';
import credentialFile from './fixtures/merchant-checkout-credential-file.ts';
const {publishCredentialFile,validateCredentialEnvelope}=credentialFile;

const fail=code=>{throw Object.assign(Error('checkout_credential_renewal_unavailable'),{code});};
const need=(v,code='RENEWAL_CONFIGURATION_REFUSED')=>{if(!v)fail(code);};
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)&&!isProxy(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&!Object.getOwnPropertySymbols(v).length&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));
const exact=(v,keys)=>record(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');

export function createCredentialRenewalController(input,dependencies={}){
 need(exact(input,['filePolicy','ttlSeconds','renewAheadMs','pollMs','issueTimeoutMs']));
 need(exact(input.filePolicy,['directory','ownerUid','ownerGid','access','algorithm','issuer','audience']));
 const p=Object.freeze({...input.filePolicy});
 need(typeof p.directory==='string'&&!p.directory.endsWith('/')&&path.posix.isAbsolute(p.directory)&&path.posix.normalize(p.directory)===p.directory&&p.directory.split('/').filter(Boolean).length>=2&&!p.directory.includes('\0'));
 need([p.ownerUid,p.ownerGid].every(v=>integer(v,0,4294967294))&&['owner','group'].includes(p.access));
 need(['HS256','RS256','ES256','EdDSA'].includes(p.algorithm)&&[p.issuer,p.audience].every(v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x20\x7f]/.test(v)));
 const config=Object.freeze({...input,filePolicy:p});
 need(integer(config.ttlSeconds,30,300)&&integer(config.pollMs,50,5000)&&integer(config.issueTimeoutMs,50,5000));
 // Original maximum HTTP budget + reader margin + issue + existing publisher's
 // five-second bound + poll + JWT second quantization. Never lengthen a write.
 need(integer(config.renewAheadMs,12000+2000+config.issueTimeoutMs+5000+config.pollMs+1000,config.ttlSeconds*1000-2000));
 need(record(dependencies)&&Object.keys(dependencies).every(k=>['sign','publish','wallNow','monotonicNow'].includes(k))&&typeof dependencies.sign==='function');
 for(const k of ['publish','wallNow','monotonicNow'])need(dependencies[k]===undefined||typeof dependencies[k]==='function');
 const sign=dependencies.sign,publish=dependencies.publish??publishCredentialFile,wall=dependencies.wallNow??Date.now,mono=dependencies.monotonicNow??(()=>performance.now());
 let initial,previous,pending=null,runner=null,signAbort=null,stopped=false,running=false;
 const shutdown=new AbortController(),state={published:0,failures:0,generation:null,expiresAt:null,nextRenewalAt:null,reason:null};
 const snapshot=()=>Object.freeze({...state,stopped,running,productionAuthorized:false,deploymentReady:false});
 function sample(){
  const value={wall:wall(),mono:mono()};need(integer(value.wall,0,Number.MAX_SAFE_INTEGER)&&Number.isFinite(value.mono)&&value.mono>=0,'RENEWAL_CLOCK_REFUSED');
  if(initial)need(value.wall>=previous.wall&&value.mono>=previous.mono&&Math.abs((value.wall-initial.wall)-(value.mono-initial.mono))<=2000,'RENEWAL_CLOCK_REFUSED');
  else initial=value;previous=value;return value.wall;
 }
 async function issue(){
  try{
   const now=sample();if(stopped||state.nextRenewalAt!==null&&now<state.nextRenewalAt)return snapshot();
   const issued=Math.floor(now/1000),generation=randomUUID();
   const claims=Object.freeze({role:'faolla_checkout_runtime',iss:p.issuer,aud:p.audience,iat:issued,exp:issued+config.ttlSeconds,jti:generation});
   const wire=encode({alg:p.algorithm,typ:'JWT'})+'.'+encode(claims);
   signAbort=new AbortController();let timer;
   try{
    const signature=await Promise.race([
     Promise.resolve().then(()=>sign(Buffer.from(wire,'ascii'),signAbort.signal)),
     new Promise((_,reject)=>{timer=setTimeout(()=>{signAbort.abort();reject(Object.assign(Error('checkout_credential_renewal_unavailable'),{code:'RENEWAL_ISSUER_TIMEOUT'}));},config.issueTimeoutMs);signAbort.signal.addEventListener('abort',()=>reject(Object.assign(Error('checkout_credential_renewal_unavailable'),{code:'RENEWAL_ISSUER_ABORTED'})),{once:true});}),
    ]);
    if(stopped||signAbort.signal.aborted)return snapshot();
    need(Buffer.isBuffer(signature)&&({HS256:signature.length===32,RS256:signature.length>=256&&signature.length<=1024,ES256:signature.length===64,EdDSA:signature.length===64})[p.algorithm],'RENEWAL_SIGNATURE_REFUSED');
    const current=sample();need(current-now<=config.issueTimeoutMs+1,'RENEWAL_ISSUER_TIMEOUT');
    const value=validateCredentialEnvelope({version:1,purpose:'faolla-checkout-runtime-v1',generation,jwt:wire+'.'+signature.toString('base64url')},p,current,current+12000);
    if(stopped)return snapshot();
    const ack=await publish(p,value,current);
    need(ack?.published===true&&ack.generation===generation&&ack.productionAuthorized===false,'RENEWAL_PUBLICATION_UNCONFIRMED');
    state.published++;state.generation=generation;state.expiresAt=claims.exp*1000;state.nextRenewalAt=state.expiresAt-config.renewAheadMs;state.reason=null;
   }finally{clearTimeout(timer);signAbort=null;}
  }catch(error){
   state.failures++;state.reason=['RENEWAL_CLOCK_REFUSED','RENEWAL_ISSUER_TIMEOUT','RENEWAL_ISSUER_ABORTED','RENEWAL_SIGNATURE_REFUSED','RENEWAL_PUBLICATION_UNCONFIRMED'].includes(error?.code)?error.code:'RENEWAL_ISSUE_FAILED';
   // An uncooperative signer must not overlap a second signing attempt. A new
   // externally supervised controller is required after a timeout/clock fault.
   if(['RENEWAL_CLOCK_REFUSED','RENEWAL_ISSUER_TIMEOUT','RENEWAL_ISSUER_ABORTED'].includes(state.reason)){stopped=true;shutdown.abort();}
  }
  return snapshot();
 }
 function tick(){if(stopped)return Promise.resolve(snapshot());if(!pending)pending=issue().finally(()=>{pending=null;});return pending;}
 function run(){
  need(!runner&&!stopped,'RENEWAL_ALREADY_STARTED');running=true;
  runner=(async()=>{try{while(!stopped){await tick();if(stopped)break;await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);shutdown.signal.removeEventListener('abort',done);resolve();};timer=setTimeout(done,config.pollMs);shutdown.signal.addEventListener('abort',done,{once:true});if(shutdown.signal.aborted)done();});}}finally{running=false;}})();
  return runner;
 }
 async function stop(){stopped=true;shutdown.abort();signAbort?.abort();await pending;await runner;return snapshot();}
 return Object.freeze({tick,run,stop,snapshot});
}
