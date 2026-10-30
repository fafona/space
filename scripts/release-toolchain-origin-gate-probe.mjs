// Per-worker coverage MUST reach the origin over a fresh connection. A CDN
// may multiplex every external probe onto one origin HTTP/2 connection.
// The separate two-public-origin gate verification remains mandatory.
import {request} from 'node:https';
import {assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {requireToolchain as need} from './release-toolchain-contracts.mjs';
export function activeBookingOriginProbeOptions(window,index){
 assertActiveBookingWindow(window);need(Number.isSafeInteger(index)&&index>=0&&index<256,'invalid_contract');
 return{host:'127.0.0.1',port:443,servername:'faolla.com',method:'GET',path:'/api/bookings?activeGate='+window.id+'&probe='+index,agent:false,rejectUnauthorized:true,headers:{Host:'faolla.com',Connection:'close',Accept:'application/json'}};
}
// IO-only body reader, no admission/control authority. Shared with the owned
// TLS fixture; the formal entry above accepts no target, CA or IO override.
export function readBoundedOriginGateResponse(requester,options){
 return new Promise((resolve,reject)=>{
  let settled=false,req;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)req?.destroy();error?reject(error):resolve(value);},timer=setTimeout(()=>finish(Error('release_toolchain_gate_not_confirmed')),3000);
  try{req=requester(options,response=>{const parts=[];let bytes=0;response.on('data',part=>{bytes+=part.length;if(bytes>4096)finish(Error('release_toolchain_evidence_invalid'));else parts.push(part);});response.once('error',error=>finish(error));response.once('aborted',()=>finish(Error('release_toolchain_gate_not_confirmed')));response.once('end',()=>{let value=null;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{}finish(null,{status:response.statusCode,value});});});req.once('error',error=>finish(error));req.end();}catch(error){finish(error);}
 });
}
export async function probeActiveBookingOriginGate(window,index){
 const result=await readBoundedOriginGateResponse(request,activeBookingOriginProbeOptions(window,index));assertActiveBookingWindow(window);return result;
}
