import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { handleGuestChat, guestChatDependencies } from "./guestChatHandlers.server";
import { GuestChatError, type GuestChatStore } from "./guestChatStore.server";
import { MerchantBusinessAccessError, type MerchantBusinessActor } from "./merchantBusinessActor.server";
import { guestChatName, type GuestChatMessage, type GuestChatThread } from "./guestChat";

function fixture(){
  const sessions=new Map<string,{id:string;guestNumber:string}>(),threads=new Map<string,GuestChatThread&{sessionId:string;messages:GuestChatMessage[]}>();
  let writes=0,revoked=false;const actors:MerchantBusinessActor[]=[];
  const store:GuestChatStore={
    async session(hash){return sessions.get(hash)??null;},
    async createSession(hash){++writes;const session={id:randomUUID(),guestNumber:String(10000001+sessions.size)};sessions.set(hash,session);return session;},
    async list(site,reader,sessionId,id){assert.equal(reader==="merchant"?sessionId:null,null,"merchant listing must never be filtered by an incidental visitor cookie");return{threads:[...threads.values()].filter(t=>t.siteId===site&&(!sessionId||t.sessionId===sessionId)&&(!id||t.id===id)).map(({messages,sessionId,...t})=>t),nextOffset:null};},
    async messages(id){return{messages:threads.get(id)?.messages??[],before:null};},
    async send(input){
      const session=input.hash?sessions.get(input.hash):null;
      if(input.sender==="guest"&&!session)throw new GuestChatError("guest_chat_unauthorized",401);
      let thread=input.sender==="merchant"?threads.get(input.threadId!):[...threads.values()].find(t=>t.siteId===input.siteId&&t.sessionId===session!.id);
      if(input.sender==="merchant"&&(!thread||thread.siteId!==input.siteId))throw new GuestChatError("guest_chat_not_found",404);
      if(!thread){thread={id:randomUUID(),siteId:input.siteId,sessionId:session!.id,guestNumber:session!.guestNumber,guestName:guestChatName(session!.guestNumber),updatedAt:new Date().toISOString(),unread:0,lastMessage:null,messages:[]};threads.set(thread.id,thread);}
      const old=thread.messages.find(m=>m.requestId===input.requestId&&m.sender===input.sender);if(old){if(old.text!==input.text)throw new GuestChatError("guest_chat_idempotency_conflict",409);return thread.id;}
      const message={id:String(++writes),requestId:input.requestId,sender:input.sender,text:input.text,createdAt:new Date().toISOString()};thread.messages.push(message);thread.lastMessage=message;return thread.id;
    },
    async read(input){const t=threads.get(input.threadId);if(!t||t.siteId!==input.siteId)throw new GuestChatError("guest_chat_not_found",404);if(input.reader==="guest"&&sessions.get(input.hash??"")?.id!==t.sessionId)throw new GuestChatError("guest_chat_unauthorized",401);},
  };
  const deps:typeof guestChatDependencies={store:()=>store,published:async()=>true,authorize:async(request,input)=>{
    if(request.headers.get("x-test-site")!==input.siteId)throw new MerchantBusinessAccessError("permission_denied",403);
    if(input.requiredPermission==="conversations.send"&&request.headers.get("x-test-readonly"))throw new MerchantBusinessAccessError("permission_denied",403);
    const actor:MerchantBusinessActor={type:"owner",siteId:input.siteId,authUserId:"synthetic-owner",principalKey:"owner:synthetic",authorizationVersion:"owner",displayName:"Synthetic",email:"test@example.invalid",authorizationSource:"database",collaborationPermissions:[],businessPermissions:["conversations.view","conversations.send"]};actors.push(actor);return actor;
  },reauthorize:async(_request,{actor})=>{if(revoked)throw new MerchantBusinessAccessError("permission_denied",403);return actor;}};
  const call=(body:Record<string,unknown>|null=null,cookie="",merchant=false,extra:HeadersInit={},query="")=>handleGuestChat(new Request("https://synthetic.faolla.com/api/"+(merchant?"merchant-guest-chat":"guest-chat")+(body?"":"?siteId=99990001"+query),{method:body?"POST":"GET",headers:{origin:"https://synthetic.faolla.com","content-type":"application/json",cookie,...extra},...(body?{body:JSON.stringify({siteId:"99990001",...body})}:{})}),merchant,deps);
  return{call,deps,sessions,threads,actors,writes:()=>writes,revoke:()=>{revoked=true;}};
}

test("visitor identity is server-issued, HttpOnly and separate from platform accounts; opening chat does not allocate or write",async()=>{
 const f=fixture();const fresh=await f.call();assert.equal(fresh.status,200);assert.equal((await fresh.json()).guest,null);assert.equal(f.writes(),0);assert.equal(fresh.headers.get("set-cookie"),null);
 const response=await f.call({action:"session"}),body=await response.json(),cookie=response.headers.get("set-cookie")!;
 assert.match(body.guest.guestName,/^游客[1-9]\d{7}$/);assert.match(cookie,/^__Host-faolla-guest-chat-v1=[A-Za-z0-9_-]{43};/);for(const flag of [/HttpOnly/i,/Secure/i,/SameSite=strict/i,/Path=\//])assert.match(cookie,flag);assert.doesNotMatch(cookie,/Domain=/i);assert.doesNotMatch(JSON.stringify(body),/token|hash|accountId|membership/i);
 const token=cookie.split(";")[0].split("=")[1];assert.ok(f.sessions.has(createHash("sha256").update(token).digest("hex")));assert.equal(response.headers.get("cache-control"),"private, no-store");
});
test("visitor send is durably acknowledged, merchant replies are readable only with the same private visitor credential",async()=>{
 const f=fixture(),cookie=(await f.call({action:"session"})).headers.get("set-cookie")!.split(";")[0],id=randomUUID();
 const send=await f.call({action:"send",messageId:id,text:"hello merchant"},cookie);assert.equal(send.status,200);const tid=(await send.json()).threadId;
 assert.equal((await f.call({action:"send",messageId:id,text:"hello merchant"},cookie)).status,200);assert.equal(f.threads.get(tid)!.messages.length,1);
 assert.equal((await f.call({action:"send",messageId:id,text:"different content"},cookie)).status,409);
 const list=await f.call(null,cookie,true,{"x-test-site":"99990001"});assert.equal((await list.json()).threads[0].guestName,"游客10000001");
 assert.equal((await f.call({action:"send",threadId:tid,messageId:randomUUID(),text:"merchant reply"},cookie,true,{"x-test-site":"99990001"})).status,200);
 const read=await f.call(null,cookie);assert.deepEqual((await read.json()).messages.map((m:GuestChatMessage)=>m.text),["hello merchant","merchant reply"]);
 const other=(await f.call({action:"session"})).headers.get("set-cookie")!.split(";")[0];assert.equal((await f.call(null,other,false,{},"&threadId="+tid)).status,404);
 assert.equal((await f.call({action:"read",threadId:tid,through:"999"},other)).status,401);
 assert.equal((await f.call({action:"send",threadId:tid,messageId:randomUUID(),text:"stolen"},"",true,{"x-test-site":"99990002"})).status,403);
 assert.equal((await f.call({action:"send",siteId:"99990002",threadId:tid,messageId:randomUUID(),text:"stolen"},"",true,{"x-test-site":"99990002"})).status,404);
});
test("origin, payload, visitor-number forgery and merchant permissions fail closed without sending",async()=>{
 const f=fixture(),cookie=(await f.call({action:"session"})).headers.get("set-cookie")!.split(";")[0],payload={action:"send",messageId:randomUUID(),text:"must not send"};const before=f.writes();
 assert.equal((await f.call(payload,cookie,false,{origin:"https://evil.invalid"})).status,403);
 assert.equal((await f.call(payload,cookie,false,{"sec-fetch-site":"cross-site"})).status,403);
 assert.equal((await f.call({...payload,guestNumber:"12345678"},cookie)).status,400);
 assert.equal((await f.call({...payload,text:"x".repeat(30000)},cookie)).status,413);
 assert.equal((await f.call({...payload,text:"x".repeat(5001)},cookie)).status,400);
 assert.equal((await f.call(payload)).status,401);
 assert.equal((await f.call({...payload,threadId:randomUUID()},"",true,{"x-test-site":"99990001","x-test-readonly":"1"})).status,403);
 f.revoke();assert.equal((await f.call({...payload,threadId:randomUUID()},"",true,{"x-test-site":"99990001"})).status,403);
 assert.equal(f.writes(),before);
 const missing=await handleGuestChat(new Request("https://synthetic.faolla.com/api/guest-chat?siteId=99990001"),false,{...f.deps,store:()=>null});assert.equal(missing.status,503);
});
