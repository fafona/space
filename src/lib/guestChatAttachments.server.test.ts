import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {handleGuestChatAttachment,guestChatAttachmentDependencies,storeGuestChatAttachment} from "./guestChatAttachments.server";
import {MerchantBusinessAccessError,type MerchantBusinessActor} from "./merchantBusinessActor.server";
import type {GuestChatStore} from "./guestChatStore.server";
import {createGuestChatUploadGate} from "./guestChatUploadRateLimit.server";
const site="99990001",thread=randomUUID(),token="a".repeat(43),png=Uint8Array.of(137,80,78,71,13,10,26,10,0);
function fixture(){
 let allowed=true,published=true,revoked=false,checks=0;const puts:Array<{path:string;bytes:Uint8Array;mime:string}>=[];
 const actor:MerchantBusinessActor={type:"owner",siteId:site,authUserId:"synthetic",principalKey:"owner:synthetic",authorizationVersion:"owner",displayName:"Synthetic",email:"test@example.invalid",authorizationSource:"database",collaborationPermissions:[],businessPermissions:["conversations.view","conversations.send"]};
 const store={session:async(hash:string)=>hash===createHash("sha256").update(token).digest("hex")&&!revoked?{id:"synthetic-session",guestNumber:"12345678"}:null,list:async(s:string)=>({threads:s===site?[{id:thread,siteId:site}]:[]})} as unknown as GuestChatStore;
 const deps:typeof guestChatAttachmentDependencies={store:()=>store,published:async()=>published,authorize:async(request,input)=>{assert.equal(input.requiredPermission,"conversations.send");if(request.headers.get("x-test-owner")!==site||request.headers.has("x-readonly"))throw new MerchantBusinessAccessError("permission_denied",403);return actor;},reauthorize:async()=>{++checks;if(revoked)throw new MerchantBusinessAccessError("permission_denied",403);return actor;},allow:()=>allowed,acquire:createGuestChatUploadGate(),put:async(path,bytes,mime)=>{puts.push({path,bytes,mime});return "/storage/v1/object/public/page-assets/"+path;}};
 const call=async({merchant=false,cookie=true,query="",headers={},bytes=png,name="photo.png",extra=false}:{merchant?:boolean;cookie?:boolean;query?:string;headers?:Record<string,string>;bytes?:Uint8Array;name?:string;extra?:boolean}={})=>{
 const form=new FormData();form.set("file",new Blob([new Uint8Array(bytes)],{type:name.endsWith(".png")?"image/png":"text/plain"}),name);if(extra)form.set("siteId","99990002");
 return handleGuestChatAttachment(new Request(`https://synthetic.faolla.com/api/${merchant?"merchant-guest-chat":"guest-chat"}/attachments?siteId=${site}${merchant?"&threadId="+thread:""}${query}`,{method:"POST",headers:{origin:"https://synthetic.faolla.com",...(cookie?{cookie:`__Host-faolla-guest-chat-v1=${token}`} :{}),...(merchant?{"x-test-owner":site}:{}),...headers},body:form}),merchant,deps);};
 return{call,deps,puts,revoke:()=>{revoked=true;},set published(v:boolean){published=v;},set allowed(v:boolean){allowed=v;},checks:()=>checks};
}
test("guest and merchant upload without message/data writes; content-addressed paths isolate identities and tenants",async()=>{
 const f=fixture();for(const merchant of[false,true]){const response=await f.call({merchant}),body=await response.json();assert.equal(response.status,200);assert.equal(body.image,true);assert.equal(body.name,"photo.png");assert.match(body.url,/^\/storage\/v1\/object\/public\/page-assets\/guest-chat\/99990001\/[a-f0-9]{64}\/[a-f0-9]{64}\.png$/);assert.equal(response.headers.get("cache-control"),"private, no-store");}
 assert.notEqual(f.puts[0].path,f.puts[1].path);await f.call();assert.equal(f.puts[0].path,f.puts[2].path,"byte-identical retry is immutable and scoped");assert.ok(f.checks()>=3);
});
test("anonymous spoofing, cross-origin, unpublished sites, foreign threads and readonly merchant fail closed before storage",async()=>{
 const f=fixture();assert.equal((await f.call({cookie:false})).status,401);assert.equal((await f.call({headers:{origin:"https://evil.invalid"}})).status,403);assert.equal((await f.call({headers:{"sec-fetch-site":"cross-site"}})).status,403);
 for(const query of["&guestNumber=12345678","&threadId=","&siteId=99990002"])assert.equal((await f.call({query})).status,400);
 assert.equal((await f.call({merchant:true,headers:{"x-readonly":"1"}})).status,403);
 const denied=await handleGuestChatAttachment(new Request(`https://synthetic.faolla.com/api/merchant-guest-chat/attachments?siteId=${site}&threadId=${randomUUID()}`,{method:"POST",headers:{origin:"https://synthetic.faolla.com","content-type":"multipart/form-data; boundary=x","x-test-owner":site}}),true,f.deps);assert.equal(denied.status,404);
 f.published=false;assert.equal((await f.call()).status,404);assert.equal(f.puts.length,0);
});
test("bad file bytes, extra fields, quotas and revocation never write assets; safe error payloads",async()=>{
 const f=fixture();assert.equal((await f.call({bytes:Uint8Array.of(1,2,3)})).status,415);assert.equal((await f.call({extra:true})).status,400);f.allowed=false;assert.equal((await f.call()).status,429);f.allowed=true;
 const original=f.deps.put;f.deps.put=async()=>{throw new Error("SECRET backend credentials");};const unavailable=await f.call();assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/SECRET|credentials/);f.deps.put=original;
 const authorize=f.deps.reauthorize;f.deps.reauthorize=async(...args)=>{f.revoke();return authorize(...args);};assert.equal((await f.call({merchant:true})).status,403);assert.equal(f.puts.length,0);
});
test("uploads have bounded memory/concurrency, release failed slots and recheck revoked credentials after reading",async()=>{
 const f=fixture();f.deps.acquire=createGuestChatUploadGate(1);const release=f.deps.acquire()!;
 assert.equal((await f.call()).status,429);release();release();assert.equal((await f.call()).status,200);
 const before=f.puts.length;assert.equal((await f.call({headers:{"content-length":String(9*1024*1024)}})).status,413);assert.equal(f.puts.length,before);assert.equal((await f.call()).status,200,"oversize body does not leak a concurrency slot");
 const allow=f.deps.allow;f.deps.allow=(...args)=>{f.revoke();return allow(...args);};assert.equal((await f.call()).status,401);assert.equal(f.puts.length,before+1);
});
test("real Storage SDK uses only existing buckets, content-addressed retry and a bounded cancellable transport",async t=>{
 const keys=["SUPABASE_INTERNAL_URL","NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"] as const,old=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,index)=>{if(old[index]===undefined)delete process.env[key];else process.env[key]=old[index];}));
 process.env.SUPABASE_INTERNAL_URL="https://synthetic-storage.invalid";process.env.NEXT_PUBLIC_SUPABASE_URL="https://synthetic-storage.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-service-key";
 const calls:string[]=[],signals:AbortSignal[]=[];let denied=false;
 t.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));assert.equal(url.origin,"https://synthetic-storage.invalid");calls.push(url.pathname);signals.push(init!.signal!);
  assert.equal(new Headers(init?.headers).get("x-upsert"),"true");assert.equal(new Headers(init?.headers).get("content-type"),"image/png");
  if(denied)return Response.json({statusCode:"403",error:"Forbidden",message:"Synthetic access rejected"},{status:403});
  if(url.pathname.includes("/page-assets/"))return Response.json({statusCode:"404",error:"not_found",message:"Bucket not found"},{status:404});
  return Response.json({Key:"synthetic",Id:thread});
 });
 const path=`guest-chat/${site}/${"a".repeat(64)}/${"b".repeat(64)}.png`,controller=new AbortController();
 const url=await storeGuestChatAttachment(path,png,"image/png",controller.signal);assert.equal(url,"/storage/v1/object/public/assets/"+path);assert.equal(calls.length,2);assert.ok(calls[0].endsWith("/page-assets/"+path));assert.ok(calls[1].endsWith("/assets/"+path));
 controller.abort();assert.ok(signals.every(signal=>signal.aborted));
 denied=true;const before=calls.length;await assert.rejects(storeGuestChatAttachment(path,png,"image/png",new AbortController().signal),/chat_attachment_unavailable/);assert.equal(calls.length,before+1,"a permission failure never retries another bucket");
});
