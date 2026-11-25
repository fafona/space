// Independent delivery revision, not imported by the frozen application yet.
// Stores/reads already-issued capabilities only: NO signing key or issuer API.
import {constants, type BigIntStats} from "node:fs";
import {open,lstat,realpath,rename,type FileHandle} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {isProxy} from "node:util/types";
export type CredentialFilePolicy={directory:string;ownerUid:number;ownerGid:number;access:"owner"|"group";algorithm:"HS256"|"RS256"|"ES256"|"EdDSA";issuer:string;audience:string};
export type CredentialEnvelope={version:1;purpose:"faolla-checkout-runtime-v1";generation:string;jwt:string};
const maximum=32768,mask=BigInt(0o7777),limit=300_000,margin=2000;
const unavailable=():never=>{throw Error("checkout_runtime_unavailable");};
function need(value:unknown):asserts value{if(!value)unavailable();}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const dataObject=(v:unknown):v is Record<string,unknown>=>object(v)&&!isProxy(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&!Object.getOwnPropertySymbols(v).length&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>d.enumerable&&Object.hasOwn(d,"value"));
const uid=()=>process.getuid?.()??unavailable(),gid=()=>process.getgid?.()??unavailable(),groups=()=>process.getgroups?.()??unavailable();
const canonical=(value:unknown)=>JSON.stringify(value,(_,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const identity=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.gid,s.mode&mask].map(String).join(":");
const stable=(a:BigIntStats,b:BigIntStats)=>identity(a)===identity(b)&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function policy(input:CredentialFilePolicy){
 need(process.platform==="linux"&&typeof process.getuid==="function"&&typeof window==="undefined");
 need(dataObject(input)&&Object.keys(input).sort().join("|")===["directory","ownerUid","ownerGid","access","algorithm","issuer","audience"].sort().join("|"));
 need(typeof input.directory==="string"&&input.directory.length<4096&&!input.directory.includes("\0")&&path.posix.isAbsolute(input.directory)&&path.posix.normalize(input.directory)===input.directory&&input.directory.split("/").filter(Boolean).length>=2);
 need([input.ownerUid,input.ownerGid].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=4294967294));
 need(["owner","group"].includes(input.access)&&["HS256","RS256","ES256","EdDSA"].includes(input.algorithm));
 need([input.issuer,input.audience].every(s=>typeof s==="string"&&s.length>0&&s.length<=256&&!/[\x00-\x20\x7f]/.test(s)));
 return Object.freeze({...input});
}
export function validateCredentialEnvelope(value:unknown,p:CredentialFilePolicy,now:number,notAfter:number):CredentialEnvelope{
 try{
  need(dataObject(value)&&Object.keys(value).sort().join("|")==="generation|jwt|purpose|version"&&value.version===1&&value.purpose==="faolla-checkout-runtime-v1");
  need(typeof value.generation==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.generation));
  need(typeof value.jwt==="string"&&value.jwt.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.jwt));
  const jwt=value.jwt as string,parts=jwt.split("."),decode=(part:string)=>{need(Buffer.from(part,"base64url").toString("base64url")===part);const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(Buffer.from(part,"base64url")),parsed:unknown=JSON.parse(text);need(JSON.stringify(parsed)===text);return parsed;};
  const header=decode(parts[0]),payload=decode(parts[1]);need(object(header)&&header.alg===p.algorithm&&header.typ==="JWT"&&Object.keys(header).every(k=>["alg","typ","kid"].includes(k)));
  need(header && object(header) && (header.kid===undefined||typeof header.kid==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)));
  need(object(payload)&&payload.role==="faolla_checkout_runtime"&&payload.iss===p.issuer&&payload.aud===p.audience&&Object.keys(payload).every(k=>["role","iss","aud","iat","exp","nbf","jti"].includes(k)));
  if(!object(payload))return unavailable();
  need(Number.isSafeInteger(now)&&Number.isSafeInteger(notAfter)&&notAfter>=now&&typeof payload.iat==="number"&&Number.isSafeInteger(payload.iat)&&typeof payload.exp==="number"&&Number.isSafeInteger(payload.exp));
  const issued=(payload.iat as number)*1000,expires=(payload.exp as number)*1000;
  need(Number.isSafeInteger(issued)&&Number.isSafeInteger(expires)&&issued<=now&&expires>notAfter+margin&&expires-issued>0&&expires-issued<=limit&&now-issued<=limit);
  need(payload.nbf===undefined||typeof payload.nbf==="number"&&Number.isSafeInteger(payload.nbf)&&payload.nbf*1000<=now);
  need(payload.jti===undefined||typeof payload.jti==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(payload.jti));
  return Object.freeze({version:1,purpose:"faolla-checkout-runtime-v1",generation:value.generation as string,jwt});
 }catch{return unavailable();}
}
async function step<T>(action:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return unavailable();let stop=()=>{};
 try{const result=await Promise.race([action(),new Promise<never>((_,reject)=>{stop=()=>reject(Error("checkout_runtime_unavailable"));signal.addEventListener("abort",stop,{once:true});if(signal.aborted)stop();})]);if(signal.aborted)return unavailable();return result;}
 finally{signal.removeEventListener("abort",stop);}
}
async function handle(file:string,flags:number,signal:AbortSignal,mode?:number){
 if(signal.aborted)return unavailable();const pending=open(file,flags,mode);
 try{return await step(()=>pending,signal);}catch{void pending.then(h=>h.close()).catch(()=>{});return unavailable();}
}
const privateDirectory=(s:BigIntStats,p:CredentialFilePolicy)=>need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===BigInt(p.ownerUid)&&s.gid===BigInt(p.ownerGid)&&(s.mode&mask)===BigInt(p.access==="owner"?0o700:0o750));
const privateFile=(s:BigIntStats,p:CredentialFilePolicy)=>need(s.isFile()&&!s.isSymbolicLink()&&s.uid===BigInt(p.ownerUid)&&s.gid===BigInt(p.ownerGid)&&(s.mode&mask)===BigInt(p.access==="owner"?0o600:0o640)&&s.nlink===BigInt(1)&&s.size>BigInt(0)&&s.size<=BigInt(maximum));
async function chain(p:CredentialFilePolicy,signal:AbortSignal){
 const files=["/"],out:{file:string;identity:string}[]=[];for(const part of p.directory.split("/").filter(Boolean))files.push(path.posix.join(files.at(-1)!,part));
 for(const file of files){const s=await step(()=>lstat(file,{bigint:true}),signal);need(s.isDirectory()&&!s.isSymbolicLink()&&await step(()=>realpath(file),signal)===file);
  need([BigInt(0),BigInt(uid()),BigInt(p.ownerUid)].includes(s.uid));need((s.mode&BigInt(0o022))===BigInt(0)||s.uid===BigInt(0)&&(s.mode&BigInt(0o1000))!==BigInt(0));out.push({file,identity:identity(s)});
 }privateDirectory(await step(()=>lstat(p.directory,{bigint:true}),signal),p);return out;
}
async function checkChain(expected:{file:string;identity:string}[],signal:AbortSignal){for(const item of expected)need(identity(await step(()=>lstat(item.file,{bigint:true}),signal))===item.identity);}
export function createCredentialFileReader(input:CredentialFilePolicy){
 const p=policy(input);let pinned:{file:string;identity:string}[]|undefined;
 if(p.access==="owner")need(uid()===0||uid()===p.ownerUid);
 else need(uid()===0||uid()!==p.ownerUid&&[gid(),...groups()].includes(p.ownerGid));
 return Object.freeze({async read(signal:AbortSignal,now:()=>number,notAfter:number){
  let directory:FileHandle|undefined;
  try{
   const current=await chain(p,signal);if(pinned)need(JSON.stringify(current)===JSON.stringify(pinned));else pinned=current;
   directory=await handle(p.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW,signal);need(identity(await step(()=>directory!.stat({bigint:true}),signal))===pinned.at(-1)!.identity);
   const file="/proc/self/fd/"+directory.fd+"/runtime.json";
   for(let attempt=0;attempt<2;attempt++){
    let opened:FileHandle|undefined;
    try{
     privateFile(await step(()=>lstat(file,{bigint:true}),signal),p);opened=await handle(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,signal);
     const initial=await step(()=>opened!.stat({bigint:true}),signal);privateFile(initial,p);const bytes=Buffer.alloc(Number(initial.size)+1);let count=0;
     while(count<bytes.length){const part=await step(()=>opened!.read(bytes,count,bytes.length-count,null),signal);if(part.bytesRead===0)break;count+=part.bytesRead;}
     need(count===Number(initial.size)&&stable(initial,await step(()=>opened!.stat({bigint:true}),signal)));const latest=await step(()=>lstat(file,{bigint:true}),signal);privateFile(latest,p);
     await checkChain(pinned,signal);need(identity(await step(()=>directory!.stat({bigint:true}),signal))===pinned.at(-1)!.identity);
     if(identity(latest)!==identity(initial)){if(attempt===0)continue;return unavailable();}need(stable(initial,latest));
     const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,count)),value:unknown=JSON.parse(text);need(canonical(value)===text);
     if(signal.aborted)return unavailable();return validateCredentialEnvelope(value,p,now(),notAfter);
    }finally{await opened?.close();}
   }return unavailable();
  }catch{return unavailable();}finally{await directory?.close().catch(()=>unavailable());}
 }});
}
/** Single trusted writer only. Atomic handoff of an already-issued JWT, not an
 * issuer, scheduler, revocation service, key reader or production configuration. */
export async function publishCredentialFile(input:CredentialFilePolicy,value:unknown,now=Date.now()){
 let directory:FileHandle|undefined,file:FileHandle|undefined;
 try{
  const p=policy(input),envelope=validateCredentialEnvelope(value,p,now,now);need(uid()===p.ownerUid&&gid()===p.ownerGid);
  const signal=AbortSignal.timeout(5000),pinned=await chain(p,signal);directory=await handle(p.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW,signal);
  need(identity(await step(()=>directory!.stat({bigint:true}),signal))===pinned.at(-1)!.identity);
  const root="/proc/self/fd/"+directory.fd,temporary=root+"/.runtime-"+randomUUID()+".tmp",target=root+"/runtime.json",wire=canonical(envelope);
  file=await handle(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,signal,p.access==="owner"?0o600:0o640);
  await step(()=>file!.writeFile(wire,"utf8"),signal);await step(()=>file!.sync(),signal);privateFile(await step(()=>file!.stat({bigint:true}),signal),p);await file.close();file=undefined;
  try{privateFile(await step(()=>lstat(target,{bigint:true}),signal),p);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  await checkChain(pinned,signal);await step(()=>rename(temporary,target),signal);await step(()=>directory!.sync(),signal);await checkChain(pinned,signal);
  // The writer acknowledges through its own FD; it must not impersonate a
  // separate group reader to bypass the reader's identity checks.
  file=await handle(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,signal);const initial=await step(()=>file!.stat({bigint:true}),signal);privateFile(initial,p);
  const bytes=Buffer.alloc(Number(initial.size)+1);let count=0;
  while(count<bytes.length){const part=await step(()=>file!.read(bytes,count,bytes.length-count,null),signal);if(!part.bytesRead)break;count+=part.bytesRead;}
  need(count===Number(initial.size)&&stable(initial,await step(()=>file!.stat({bigint:true}),signal))&&stable(initial,await step(()=>lstat(target,{bigint:true}),signal)));
  need(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,count))===wire);await checkChain(pinned,signal);
  return Object.freeze({generation:envelope.generation,published:true,productionAuthorized:false});
 }catch{return unavailable();}finally{const closed=await Promise.allSettled([file?.close(),directory?.close()]);if(closed.some(v=>v.status==="rejected"))unavailable();}
}
