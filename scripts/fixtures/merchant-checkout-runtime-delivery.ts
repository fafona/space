// Independent, default-off delivery revision. Frozen src client remains intact;
// this module is NOT wired into Next.js until a separately bound candidate.
import {isProxy} from "node:util/types";
import {createServerMerchantCheckoutRuntimeClient as legacy,type CheckoutRuntimeResponse} from "../../src/lib/merchantCheckoutRuntime.server";
import methods from "../../src/lib/merchantCheckoutRuntimeMethods.json";
import {createCredentialFileReader,validateCredentialEnvelope,type CredentialFilePolicy,type CredentialEnvelope} from "./merchant-checkout-credential-file";
type Environment=Record<string,string|undefined>;
type Options={environment?:Environment;fetch?:typeof fetch;now?:()=>number;timeoutMs?:number;
 /** Trusted test seam only, never selected from browser input or environment. */
 readCredential?:(signal:AbortSignal,now:()=>number,notAfter:number)=>Promise<CredentialEnvelope>};
const unavailable=():CheckoutRuntimeResponse=>({data:null,error:{message:"checkout_runtime_unavailable"}});
const fail=():never=>{throw Error("checkout_runtime_unavailable");};
function copy(value:unknown,seen=new Set<object>(),depth=0):unknown{
 if(depth>100)return fail();if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))return value;
 if(!value||typeof value!=="object"||isProxy(value)||seen.has(value)||Object.getOwnPropertySymbols(value).length)return fail();
 if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();seen.add(value);
 try{
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Object.keys(descriptors).filter(k=>!(Array.isArray(value)&&k==="length"));
  if(Array.isArray(value)&&(keys.length!==value.length||keys.some((k,i)=>k!==String(i))))return fail();const out:Record<string,unknown>|unknown[]=Array.isArray(value)?[]:Object.create(null);
  for(const key of keys){const d=descriptors[key];if(!d.enumerable||!("value" in d))return fail();Object.defineProperty(out,key,{value:copy(d.value,seen,depth+1),enumerable:true,configurable:true,writable:true});}return out;
 }finally{seen.delete(value);}
}
async function bounded<T>(promise:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return fail();let stop=()=>{};
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{stop=()=>reject(Error("checkout_runtime_unavailable"));signal.addEventListener("abort",stop,{once:true});if(signal.aborted)stop();})]);}
 finally{signal.removeEventListener("abort",stop);}
}
class DeliveryCall implements PromiseLike<CheckoutRuntimeResponse>{
 private promise?:Promise<CheckoutRuntimeResponse>;private signals:AbortSignal[]=[];
 constructor(private readonly run:(signals:AbortSignal[])=>Promise<CheckoutRuntimeResponse>){}
 abortSignal(signal:AbortSignal){if(this.promise)return fail();this.signals.push(signal);return this;}
 then<T=CheckoutRuntimeResponse,E=never>(fulfilled?:((v:CheckoutRuntimeResponse)=>T|PromiseLike<T>)|null,rejected?:((e:unknown)=>E|PromiseLike<E>)|null):Promise<T|E>{this.promise??=this.run(this.signals);return this.promise.then(fulfilled,rejected);}
}
function filePolicy(environment:Environment):CredentialFilePolicy{
 const number=(key:string)=>{const v=environment[key]??"";if(!/^(0|[1-9][0-9]{0,9})$/.test(v))return fail();return Number(v);};
 return {directory:environment.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_DIRECTORY??"",ownerUid:number("FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_UID"),ownerGid:number("FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_OWNER_GID"),
  access:environment.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ACCESS as CredentialFilePolicy["access"],algorithm:environment.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ALGORITHM as CredentialFilePolicy["algorithm"],issuer:environment.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_ISSUER??"",audience:environment.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_AUDIENCE??""};
}
export function createFileDeliveryRuntimeClient(options:Options={}){
 const environment=options.environment??process.env,source=environment.FAOLLA_CHECKOUT_RUNTIME_CREDENTIAL_SOURCE;
 if(source===undefined||source==="env")return legacy(options);if(source!=="file"||typeof window!=="undefined")return null;
 const timeout=options.timeoutMs??12000,now=options.now??Date.now,transport=options.fetch??globalThis.fetch;
 if(!Number.isInteger(timeout)||timeout<1||timeout>12000)return null;
 let policy:CredentialFilePolicy,read:NonNullable<Options["readCredential"]>;
 try{policy=filePolicy(environment);read=options.readCredential??createCredentialFileReader(policy).read;
  // Even a trusted test read seam must not bypass platform/policy validation.
  if(options.readCredential)createCredentialFileReader(policy);
 }catch{return null;}
 const publicEnvironment:Environment={SUPABASE_INTERNAL_URL:environment.SUPABASE_INTERNAL_URL,NEXT_PUBLIC_SUPABASE_URL:environment.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:environment.NEXT_PUBLIC_SUPABASE_ANON_KEY};
 return {rpc(name:string,args:Record<string,unknown>){
  const expected=Object.hasOwn(methods,name)?(methods as Record<string,string[]>)[name]:null;
  if(!expected||!args||typeof args!=="object"||Array.isArray(args)||isProxy(args)||Object.keys(args).length!==expected.length||expected.some(k=>!Object.hasOwn(args,k)))return fail();
  const snapshot=copy(args) as Record<string,unknown>;if(Buffer.byteLength(JSON.stringify({p_function:name,p_arguments:snapshot}),"utf8")>33554432)return fail();
  return new DeliveryCall(async signals=>{
   const start=performance.now(),deadline=start+timeout,notAfter=now()+timeout,abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout),signal=AbortSignal.any([...signals,abort.signal]);
   try{
    if(signal.aborted)return unavailable();const value=await bounded(read(signal,now,notAfter),signal);
    const credential=validateCredentialEnvelope(value,policy,now(),notAfter),remaining=Math.ceil(deadline-performance.now());if(signal.aborted||remaining<=0)return unavailable();
    const guarded:typeof fetch=async(input,init)=>{if(signal.aborted||performance.now()>=deadline)return fail();return transport(input,init);};
    const client=legacy({environment:{...publicEnvironment,FAOLLA_CHECKOUT_RUNTIME_JWT:credential.jwt},now,timeoutMs:remaining,fetch:guarded});if(!client||signal.aborted)return unavailable();
    return await bounded(Promise.resolve(client.rpc(name,snapshot).abortSignal(signal)),signal);
   }catch{return unavailable();}finally{clearTimeout(timer);}
  });
 }};
}
