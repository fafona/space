// Independent local prototype. Trusted issuer-side composition only: no key
// loader, HTTP listener, environment lookup, installer, database or app wiring.
// The unchanged renewal factory is injected so its native/tsx loader boundary
// stays explicit. Never use the old controller's unattended run() directly.
import {isProxy} from 'node:util/types';
import {createIsolatedDeliveryPublisher} from './member-checkout-isolated-delivery.mjs';

const fail=()=>{throw Error('isolated_supervision_unavailable');};
const need=v=>{if(!v)fail();};
const data=v=>v&&typeof v==='object'&&!Array.isArray(v)&&!isProxy(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&!Object.getOwnPropertySymbols(v).length&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));
const exact=(v,keys)=>data(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const reasons=['RENEWAL_CLOCK_REFUSED','RENEWAL_ISSUER_TIMEOUT','RENEWAL_ISSUER_ABORTED','RENEWAL_SIGNATURE_REFUSED','RENEWAL_PUBLICATION_UNCONFIRMED','RENEWAL_ISSUE_FAILED'];
function controllerState(value){
 need(exact(value,['published','failures','generation','expiresAt','nextRenewalAt','reason','stopped','running','productionAuthorized','deploymentReady']));
 need([value.published,value.failures].every(v=>Number.isSafeInteger(v)&&v>=0)&&[value.stopped,value.running].every(v=>typeof v==='boolean')&&!value.running&&value.productionAuthorized===false&&value.deploymentReady===false);
 need(value.generation===null||typeof value.generation==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.generation));
 need([value.expiresAt,value.nextRenewalAt].every(v=>v===null||Number.isSafeInteger(v)&&v>=0)&&(value.reason===null||reasons.includes(value.reason)));
 return Object.freeze({...value});
}

export function createIsolatedRenewalSupervisor(input,dependencies){
 need(exact(input,['renewal','delivery'])&&exact(input.renewal,['filePolicy','ttlSeconds','renewAheadMs','pollMs','issueTimeoutMs'])&&exact(input.renewal.filePolicy,['directory','ownerUid','ownerGid','access','algorithm','issuer','audience'])&&exact(input.delivery,['recipientId','peerFingerprint','timeoutMs']));
 need(exact(dependencies,['createController','sign','send','wallNow','monotonicNow'])&&Object.values(dependencies).every(v=>typeof v==='function'));
 const deps=Object.freeze({...dependencies});
 const renewal=Object.freeze({...input.renewal,filePolicy:Object.freeze({...input.renewal.filePolicy})}),delivery=Object.freeze({...input.delivery});
 const transport=createIsolatedDeliveryPublisher({filePolicy:renewal.filePolicy,...delivery},{send:deps.send,now:deps.wallNow});
 need(Number.isInteger(renewal.pollMs)&&renewal.pollMs>=50&&renewal.pollMs<=5000);
 let controller,last,pending=null,runner=null,stopPromise=null,loopRunning=false,runStarted=false,stopRequested=false,stopConfirmed=false,reason=null,signRequests=0,signerPending=0,deliveryAttempts=0;
 const shutdown=new AbortController();
 const snapshot=()=>Object.freeze({phase:reason?'faulted':stopRequested?(stopConfirmed?'stopped':'stopping'):loopRunning?'running':'idle',reason,busy:pending!==null,loopRunning,stopRequested,stopConfirmed,signRequests,signerPending,deliveryAttempts,published:last?.published??0,generation:last?.generation??null,expiresAt:last?.expiresAt??null,controllerReason:last?.reason??null,transport:transport.snapshot(),automaticRestart:false,persistentRecovery:false,physicalSignerStopProven:false,productionAuthorized:false,deploymentReady:false});
 function requestStop(){
  stopRequested=true;shutdown.abort();
  if(!stopPromise)stopPromise=Promise.resolve().then(async()=>{await controller.stop();last=controllerState(controller.snapshot());need(last.stopped);stopConfirmed=true;}).catch(()=>{reason??='STOP_UNCONFIRMED';stopConfirmed=false;});
  return stopPromise;
 }
 function fault(code){reason??=code;void requestStop();}
 const sign=async(bytes,signal)=>{
  need(!stopRequested&&!signal.aborted);signRequests++;signerPending++;
  try{const signature=await deps.sign(bytes,signal);need(!stopRequested&&!signal.aborted);return signature;}
  catch{if(!stopRequested)fault('SIGNING_REFUSED');return fail();}finally{signerPending--;}
 };
 const publish=async(p,value,now)=>{
  need(!stopRequested);deliveryAttempts++;
  try{return await transport.publish(p,value,now,shutdown.signal);}
  catch{fault('DELIVERY_UNCONFIRMED');return fail();}
 };
 controller=deps.createController(renewal,{sign,publish,wallNow:deps.wallNow,monotonicNow:deps.monotonicNow});
 need(exact(controller,['tick','run','stop','snapshot'])&&Object.values(controller).every(v=>typeof v==='function'));
 last=controllerState(controller.snapshot());need(!last.stopped&&last.published===0&&last.failures===0);
 function tick(){
  if(pending)return pending;
  if(stopRequested)return requestStop().then(snapshot);
  pending=(async()=>{
   try{await controller.tick();last=controllerState(controller.snapshot());if(!stopRequested&&(last.failures>0||last.stopped))fault(last.reason??'CONTROLLER_REFUSED');}
   catch{fault('CONTROLLER_REFUSED');}
   if(stopRequested)await requestStop();return snapshot();
  })().finally(()=>{pending=null;});
  return pending;
 }
 function wait(){return new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);shutdown.signal.removeEventListener('abort',done);resolve();};timer=setTimeout(done,renewal.pollMs);shutdown.signal.addEventListener('abort',done,{once:true});if(shutdown.signal.aborted)done();});}
 function run(){
  need(!runStarted&&!stopRequested);runStarted=true;loopRunning=true;
  runner=(async()=>{try{while(!stopRequested){await tick();if(!stopRequested)await wait();}}finally{loopRunning=false;if(stopRequested)await requestStop();}return snapshot();})();
  return runner;
 }
 async function stop(){await requestStop();await pending;await runner;return snapshot();}
 return Object.freeze({tick,run,stop,snapshot});
}
