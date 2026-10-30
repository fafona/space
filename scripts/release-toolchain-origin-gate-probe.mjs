// Per-worker coverage MUST reach the origin over a fresh connection. A CDN
// may multiplex every external probe onto one origin HTTP/2 connection.
// The separate two-public-origin gate verification remains mandatory.
import {request} from 'node:https';
import {setMaxListeners} from 'node:events';
import {isDeepStrictEqual} from 'node:util';
import {ORIGIN_PROBE_LISTENER} from './release-toolchain-origin-probe-ingress.mjs';
import {assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
export function activeBookingOriginProbeOptions(window,index){
 assertActiveBookingWindow(window);need(Number.isSafeInteger(index)&&index>=0&&index<256,'invalid_contract');
 return{host:ORIGIN_PROBE_LISTENER.address,port:ORIGIN_PROBE_LISTENER.port,servername:'faolla.com',method:'GET',path:'/api/bookings?activeGate='+window.id+'&probe='+index,agent:false,rejectUnauthorized:true,headers:{Host:'faolla.com',Connection:'close',Accept:'application/json'}};
}
// IO-only body reader, no admission/control authority. Shared with the owned
// TLS fixture; the formal entry above accepts no target, CA or IO override.
export function readBoundedOriginGateResponse(requester,options){
 return new Promise((resolve,reject)=>{
  let settled=false,req;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){req?.destroy();reject(error);}else resolve(value);},timer=setTimeout(()=>finish(Error('release_toolchain_gate_not_confirmed')),3000);
  try{req=requester(options,response=>{const parts=[];let bytes=0;response.on('data',part=>{bytes+=part.length;if(bytes>4096)finish(Error('release_toolchain_evidence_invalid'));else parts.push(part);});response.once('error',error=>finish(error));response.once('aborted',()=>finish(Error('release_toolchain_gate_not_confirmed')));response.once('end',()=>{let value=null;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{}finish(null,{status:response.statusCode,value});});});req.once('error',error=>finish(error));req.end();}catch(error){finish(error);}
 });
}
export async function probeActiveBookingOriginGate(window,index){
 const result=await readBoundedOriginGateResponse(request,activeBookingOriginProbeOptions(window,index));assertActiveBookingWindow(window);return result;
}
// Bounded fresh connections on the dedicated per-worker reuseport listener.
// Concurrency alone did NOT solve starvation on the original shared listener.
// Each request still has its own verified TLS connection; no retry occurs.
// It stops launching when all captured workers have answered, awaits EVERY
// already started request, and never sends more than the original 256 budget.
export async function collectFixedOriginProbeResponses(requestOne,cohort,window,observe=()=>{},deadlineAtMs=Math.min(Date.now()+45000,Date.parse(window.deadlineAt))){
 assertActiveBookingWindow(window);need(Array.isArray(cohort)&&cohort.length>0&&cohort.length<=128&&new Set(cohort.map(w=>w.pid)).size===cohort.length,'invalid_contract');
 need(Number.isSafeInteger(deadlineAtMs)&&deadlineAtMs<=Date.parse(window.deadlineAt)&&deadlineAtMs>Date.now()&&deadlineAtMs-Date.now()<=45000,'invalid_contract');
 const controller=new AbortController(),responses=[],seen=new Set();setMaxListeners(16,controller.signal);let next=0,failure=null,complete=false;
 const deadlineTimer=setTimeout(()=>{failure??=Error('release_toolchain_gate_not_confirmed');controller.abort();},deadlineAtMs-Date.now());
 const run=async()=>{while(!failure&&!complete&&next<256){const index=next++;let observed=false;try{const response=await requestOne(index,controller.signal);observed=true;observe(index,response);need(response?.status===503&&response.value?.ok===false&&response.value.error==='booking_temporarily_paused'&&response.value.operation===window.id&&cohort.some(w=>w.pid===response.value.workerPid),'gate_not_confirmed');responses.push(response);seen.add(response.value.workerPid);complete=cohort.every(w=>seen.has(w.pid));}catch(error){if(!failure)failure=error;controller.abort();if(!observed)try{observe(index,null);}catch{}}}};
 try{await Promise.all(Array.from({length:16},run));}finally{clearTimeout(deadlineTimer);}assertActiveBookingWindow(window);if(failure)throw failure;need(complete&&responses.length<=256,'gate_not_confirmed');
 // Unique worker responses first avoids spending the unchanged proof's time
 // budget re-consuming duplicates. All responses remain available to audit.
 const unique=[],duplicates=[],pids=new Set();for(const response of responses){if(pids.has(response.value.workerPid))duplicates.push(response);else{pids.add(response.value.workerPid);unique.push(response);}}return{responses:[...unique,...duplicates],requestsSent:next,distinctWorkers:seen.size};
}
export function createActiveOriginCoverageProbe({window,verify,workers,expectedWorkerCount,verifyListener}){
 need(Number.isSafeInteger(expectedWorkerCount)&&expectedWorkerCount>0&&expectedWorkerCount<=128,'invalid_contract');
 let batch,index=0,captured,started=false;const observations=[];
 need(typeof verifyListener==='function','invalid_contract');
 const unchanged=()=>{verify();need(isDeepStrictEqual(workers(),captured),'gate_not_confirmed');verifyListener(captured);assertActiveBookingWindow(window);};
 return{async probe(){
  assertActiveBookingWindow(window);if(!batch){
   need(!started,'attempt_replay_forbidden');started=true;verify();const deadline=Math.min(Date.now()+45000,Date.parse(window.deadlineAt));
   for(;;){captured=workers();if(captured.length===expectedWorkerCount)break;need(Date.now()<deadline,'gate_not_confirmed');await new Promise(resolve=>setTimeout(resolve,25));verify();}
   unchanged();batch=await collectFixedOriginProbeResponses((probeIndex,signal)=>readBoundedOriginGateResponse(request,{...activeBookingOriginProbeOptions(window,probeIndex),signal}),captured,window,(probeIndex,response)=>observations.push({index:probeIndex,status:response?.status??null,workerPid:Number.isSafeInteger(response?.value?.workerPid)?response.value.workerPid:null,operationMatches:response?.value?.operation===window.id,gated:response?.value?.ok===false&&response?.value?.error==='booking_temporarily_paused'}),deadline);unchanged();
  }unchanged();need(index<batch.responses.length,'gate_not_confirmed');return batch.responses[index++];
 },evidence(){return{kind:'active-origin-fresh-tls-probe-observations',window,requestsSent:observations.length,distinctWorkers:new Set(observations.filter(v=>v.workerPid!==null).map(v=>v.workerPid)).size,cohort:captured??null,observations,allStartedRequestsAwaited:true,publicGateCheckStillRequired:true,publicationAuthority:false};}};
}
