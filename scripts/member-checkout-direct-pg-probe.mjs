// Isolated transport prototype only. Not imported by the application or installer.
// The trusted harness supplies a fresh, explicitly configured restricted Client.
import {readFileSync} from 'node:fs';
const methods=JSON.parse(readFileSync(new URL('../src/lib/merchantCheckoutRuntimeMethods.json',import.meta.url),'utf8'));
const maximum=33554432;
export const directPgQuery='SELECT public.faolla_checkout_runtime_v1($1::text,$2::jsonb) AS result';
const unavailable=()=>({data:null,error:{message:'checkout_runtime_unavailable'}});
const invalid=()=>{throw Error('checkout_runtime_unavailable');};
function json(value,seen=new Set(),depth=0){
 if(depth>100)return invalid();
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(!value||typeof value!=='object'||seen.has(value)||Object.getOwnPropertySymbols(value).length)return invalid();
 const array=Array.isArray(value);
 if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid();
 seen.add(value);
 try{
  const properties=Object.getOwnPropertyDescriptors(value),keys=Object.keys(properties).filter(k=>!(array&&k==='length'));
  if(array&&(keys.length!==value.length||keys.some((k,i)=>k!==String(i))))return invalid();
  const next=array?[]:Object.create(null);
  for(const key of keys){const p=properties[key];if(!p.enumerable||!Object.hasOwn(p,'value'))return invalid();Object.defineProperty(next,key,{value:json(p.value,seen,depth+1),enumerable:true});}
  return next;
 }finally{seen.delete(value);}
}
function envelope(name,args){
 if(typeof name!=='string'||!Object.hasOwn(methods,name))return invalid();
 const copied=json(args),expected=methods[name];
 if(!copied||Array.isArray(copied)||typeof copied!=='object'||Object.keys(copied).length!==expected.length||expected.some(k=>!Object.hasOwn(copied,k)))return invalid();
 const body=JSON.stringify(copied);if(Buffer.byteLength(body)>maximum)return invalid();return body;
}
class Call{
 constructor(run){this.run=run;this.signals=[];}
 abortSignal(signal){if(this.promise||!(signal instanceof AbortSignal))return invalid();this.signals.push(signal);return this;}
 then(ok,fail){this.promise??=this.run(this.signals);return this.promise.then(ok,fail);}
}
/** No credentials/env defaults, role switching, query text input, retries, pool
 * reuse or fallback. A timed-out call discards its own connection; it does not
 * assert that the server rolled back. Recovery must retain the original key. */
export function createDirectPgProbe({clientFactory,timeoutMs=12000,maxActive=4}={}){
 if(typeof clientFactory!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>12000||!Number.isInteger(maxActive)||maxActive<1||maxActive>4)return invalid();
 let active=0;
 return Object.freeze({rpc(name,args){
  const body=envelope(name,args);
  return new Call(async signals=>{
   if(active>=maxActive||signals.some(s=>s.aborted))return unavailable();active++;
   const controller=new AbortController(),signal=AbortSignal.any([...signals,controller.signal]);
   let client,ending,stop,closed=false;
   const end=()=>{if(!ending&&client){ending=Promise.resolve().then(()=>client.end()).then(()=>{closed=true;},()=>{});}return ending;};
   const stopped=new Promise((_,reject)=>{stop=()=>{void end();reject(Error('checkout_runtime_unavailable'));};signal.addEventListener('abort',stop,{once:true});});
   // Attach a rejection observer even if a synchronous factory error occurs.
   void stopped.catch(()=>{});
   const timer=setTimeout(()=>controller.abort(),timeoutMs);
   try{
    client=clientFactory();if(!client||typeof client.connect!=='function'||typeof client.query!=='function'||typeof client.end!=='function')return unavailable();
    if(signal.aborted){stop();return unavailable();}
    await Promise.race([client.connect(),stopped]);
    if(signal.aborted)return unavailable();
    const response=await Promise.race([client.query({text:directPgQuery,values:[name,body],queryMode:'extended'}),stopped]);
    if(signal.aborted||response?.rows?.length!==1||!Object.hasOwn(response.rows[0],'result'))return unavailable();
    const responseBody=JSON.stringify(json(response.rows[0].result));if(Buffer.byteLength(responseBody)>maximum)return unavailable();
    return {data:JSON.parse(responseBody),error:null};
   }catch(error){
    if(!signal.aborted&&error?.code==='P0001'&&typeof error.message==='string'&&/^(?:checkout_[a-z0-9_]{1,80}|booking_atomic_[a-z0-9_]{1,80}|order_update_conflict|merchant_memberships_conflict|merchant_membership_settings_conflict|merchant_coupons_conflict)$/.test(error.message))return {data:null,error:{message:error.message}};
    return unavailable();
   }finally{
    clearTimeout(timer);signal.removeEventListener('abort',stop);
    const pending=end();
    if(pending){let cleanupTimer;await Promise.race([pending,new Promise(resolve=>{cleanupTimer=setTimeout(resolve,500);})]).finally(()=>clearTimeout(cleanupTimer));}
    // Do not recycle a slot while its client remains unconfirmed closed.
    if(!client||closed)active--;
   }
  });
 }});
}
