import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { GUEST_CHAT_UUID, guestChatName } from "@/lib/guestChat";
import { configuredGuestChatStore, GuestChatError, type GuestChatStore, type GuestSession } from "@/lib/guestChatStore.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolvePublicOriginFromHeaders, resolveRequestOrigin } from "@/lib/requestOrigin";
import { isBoundMerchantServiceOrigin } from "@/lib/merchantServiceOrigin.server";
import { loadPublishedMerchantSnapshotSiteBySiteId, loadPublishedMerchantServiceStateBySiteId } from "@/lib/publishedMerchantService";
import { authorizeMerchantBusinessRequest, reauthorizeMerchantBusinessMutation, toMerchantBusinessAccessResponse } from "@/lib/merchantBusinessActor.server";

const COOKIE="__Host-faolla-guest-chat-v1", TOKEN=/^[A-Za-z0-9_-]{43}$/;
const headers={"cache-control":"private, no-store","vary":"Cookie","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
const fail=(code:string,status:number)=>NextResponse.json({ok:false,error:code,message:code==="guest_chat_rate_limited"?"发送过于频繁，请稍后再试。":code==="guest_chat_unauthorized"?"游客会话凭证已失效，请重新连接。":"会话暂时无法处理，请稍后核对后重试。"},{status,headers});
export const guestChatDependencies={
  store:configuredGuestChatStore,
  async published(request:Request,siteId:string) {
    const [site,state]=await Promise.all([loadPublishedMerchantSnapshotSiteBySiteId(siteId),loadPublishedMerchantServiceStateBySiteId(siteId)]);
    const origin=resolvePublicOriginFromHeaders(request.headers,resolveRequestOrigin(request));
    return Boolean(site&&state?.status==="online"&&!state.expired&&isBoundMerchantServiceOrigin(origin,site));
  },
  authorize:authorizeMerchantBusinessRequest,reauthorize:reauthorizeMerchantBusinessMutation,
};
type Dependencies=typeof guestChatDependencies;
async function body(request:Request) {
  const reader=request.body?.getReader();if(!reader)throw new GuestChatError("guest_chat_invalid",400);
  let bytes=0;const chunks:Uint8Array[]=[];
  try{for(;;){const result=await reader.read();if(result.done)break;bytes+=result.value.length;if(bytes>24*1024){await reader.cancel();throw new GuestChatError("guest_chat_too_large",413);}chunks.push(result.value);}}finally{reader.releaseLock();}
  try{const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw 0;return parsed as Record<string,unknown>;}catch{throw new GuestChatError("guest_chat_invalid",400);}
}
export function readGuestChatToken(request:Request) {
  const tokens=(request.headers.get("cookie")||"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+"="));
  if(tokens.length!==1)return null;const value=tokens[0].slice(COOKIE.length+1);return TOKEN.test(value)?value:null;
}
function requireUUID(value:unknown):string {if(typeof value!=="string"||!GUEST_CHAT_UUID.test(value))throw new GuestChatError("guest_chat_invalid",400);return value;}
function cursor(value:unknown) {if(value===undefined||value===null||value==="")return null;if(typeof value!=="string"||!/^\d{1,18}$/.test(value))throw new GuestChatError("guest_chat_invalid",400);return value;}
export async function handleGuestChat(request:Request,merchant=false,deps:Dependencies=guestChatDependencies) {
  try{
    if(!["GET","POST"].includes(request.method))return fail("method_not_allowed",405);
    if(request.headers.get("sec-fetch-site")==="cross-site"||!isTrustedSameOriginMutationRequest(request))return fail("forbidden_origin",403);
    if(request.method==="POST"&&!request.headers.get("content-type")?.startsWith("application/json"))return fail("guest_chat_invalid",415);
    const url=new URL(request.url),input=request.method==="POST"?await body(request):Object.fromEntries(url.searchParams);
    const siteId=typeof input.siteId==="string"?input.siteId:"";if(!/^\d{8}$/.test(siteId))return fail("guest_chat_invalid",400);
    const store=deps.store();if(!store)return fail("guest_chat_unavailable",503);
    const reader=merchant?"merchant":"guest";
    const action=request.method==="GET"?"load":input.action;
    if(!["load","session","send","read"].includes(String(action))||merchant&&action==="session")return fail("guest_chat_invalid",400);
    // No role, participant, display id or destination account is trusted from JSON.
    if(Object.keys(input).some(k=>!["siteId","action","threadId","messageId","text","through","before","offset"].includes(k)))return fail("guest_chat_invalid",400);
    const actor=merchant?await deps.authorize(request,{siteId,requiredPermission:action==="send"?"conversations.send":"conversations.view"}):null;
    if(!merchant&&!await deps.published(request,siteId))return fail("guest_chat_not_found",404);
    const token=merchant?null:readGuestChatToken(request);let session:GuestSession|null=token?await store.session(hash(token)):null;
    if(action==="session"){
      const newToken=session?token!:randomBytes(32).toString("base64url");
      if(!session){const ip=request.headers.get("cf-connecting-ip")||request.headers.get("x-real-ip")||"unknown";session=await store.createSession(hash(newToken),hash(ip));}
      const response=NextResponse.json({ok:true,guest:{guestNumber:session.guestNumber,guestName:guestChatName(session.guestNumber)}},{headers});
      response.cookies.set(COOKIE,newToken,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:90*24*60*60});return response;
    }
    if(!merchant&&!session){if(action==="load")return NextResponse.json({ok:true,guest:null,thread:null,messages:[],before:null},{headers});return fail("guest_chat_unauthorized",401);}
    const threadId=input.threadId?requireUUID(input.threadId):null;
    if(action==="load"){
      const offset=Number(input.offset??0);if(!Number.isInteger(offset)||offset<0||offset>10000)return fail("guest_chat_invalid",400);
      const list=await store.list(siteId,reader,session?.id??null,threadId,merchant?offset:0);
      if(merchant&&!threadId)return NextResponse.json({ok:true,...list},{headers});
      const thread=list.threads[0]??null;if(threadId&&!thread)return fail("guest_chat_not_found",404);
      const messages=thread?await store.messages(thread.id,cursor(input.before)):{messages:[],before:null};
      return NextResponse.json({ok:true,guest:session?{guestNumber:session.guestNumber,guestName:guestChatName(session.guestNumber)}:undefined,thread,...messages},{headers});
    }
    if(action==="send"){
      const messageId=requireUUID(input.messageId),text=typeof input.text==="string"?input.text.trim():"";
      if(!text||text.length>5000||merchant&&!threadId)return fail("guest_chat_invalid",400);
      if(actor)await deps.reauthorize(request,{actor,requiredPermissions:["conversations.view","conversations.send"]});
      const sentThread=await store.send({siteId,threadId,hash:session&&token?hash(token):null,sender:reader,requestId:messageId,text,principal:actor?.principalKey??null});
      return NextResponse.json({ok:true,threadId:sentThread,messageId},{headers});
    }
    if(!threadId)return fail("guest_chat_invalid",400);
    const through=cursor(input.through);if(!through)return fail("guest_chat_invalid",400);
    if(actor)await deps.reauthorize(request,{actor,requiredPermissions:["conversations.view"]});
    await store.read({siteId,threadId,hash:session&&token?hash(token):null,reader,through});
    return NextResponse.json({ok:true},{headers});
  }catch(error){if(error instanceof GuestChatError)return fail(error.code,error.status);const access=toMerchantBusinessAccessResponse(error);return fail(access.body.error,access.status);}
}
