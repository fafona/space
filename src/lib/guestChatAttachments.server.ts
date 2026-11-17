import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {guestChatDependencies,readGuestChatToken} from "./guestChatHandlers.server";
import {GUEST_CHAT_UUID} from "./guestChat";
import {CHAT_ATTACHMENT_MAX_BYTES,validateChatAttachment} from "./chatAttachments";
import {acquireGuestChatUpload,allowGuestChatUpload} from "./guestChatUploadRateLimit.server";
import {createServerSupabaseServiceClient,readRequestClientIp} from "./superAdminServer";
import {isTrustedSameOriginMutationRequest} from "./requestMutationGuard";
import {toMerchantBusinessAccessResponse,type MerchantBusinessActor} from "./merchantBusinessActor.server";
import {normalizePublicAssetResponseUrl} from "./publicAssetUrl";
const headers={"cache-control":"private, no-store","vary":"Cookie","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const hash=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
class UploadError extends Error {constructor(readonly code:string,readonly status:number){super(code);}}
export async function storeGuestChatAttachment(objectPath:string,bytes:Uint8Array,mime:string,signal:AbortSignal) {
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
  const client=createServerSupabaseServiceClient({fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([deadline,init.signal]):deadline})});if(!client)throw new UploadError("chat_attachment_unavailable",503);
  for(const bucket of ["page-assets","assets","uploads","public"]) {
    // Content-addressed paths include the authenticated principal, tenant and
    // complete filename/type/byte digest. A retry can only write identical
    // bytes to its own path, never replace somebody else's asset or message.
    const result=await client.storage.from(bucket).upload(objectPath,bytes,{contentType:mime,upsert:true,cacheControl:"3600"});
    if(result.error){if(String(result.error.statusCode)==="404"||/bucket.*not.*found/i.test(result.error.message))continue;throw new UploadError("chat_attachment_unavailable",503);}
    const url=normalizePublicAssetResponseUrl(client.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl);
    if(!url||!/^https:\/\//.test(url)&&!/^\/(?!\/)/.test(url))throw new UploadError("chat_attachment_unavailable",503);
    return url;
  }
  throw new UploadError("chat_attachment_unavailable",503);
}
export const guestChatAttachmentDependencies={...guestChatDependencies,put:storeGuestChatAttachment,allow:allowGuestChatUpload,acquire:acquireGuestChatUpload};
async function readUpload(request:Request) {
  const maximum=CHAT_ATTACHMENT_MAX_BYTES+32768,length=request.headers.get("content-length");
  if(length&&(!/^\d+$/.test(length)||Number(length)>maximum))throw new UploadError("chat_attachment_size",413);
  if(!request.body)throw new UploadError("chat_attachment_invalid",400);
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new UploadError("chat_attachment_timeout",408));void reader.cancel().catch(()=>{});},15000);});
  try {
    for(;;){const result=await Promise.race([reader.read(),timeout]);if(result.done)break;size+=result.value.length;if(size>maximum){await reader.cancel();throw new UploadError("chat_attachment_size",413);}chunks.push(result.value);}
    const form=await new Response(Buffer.concat(chunks),{headers:{"content-type":request.headers.get("content-type")!}}).formData();
    if([...form.keys()].some(key=>key!=="file")||form.getAll("file").length!==1)throw new UploadError("chat_attachment_invalid",400);
    const file=form.get("file");if(!file||typeof file==="string")throw new UploadError("chat_attachment_invalid",400);
    return {file,bytes:new Uint8Array(await file.arrayBuffer())};
  }catch(error){if(error instanceof UploadError)throw error;throw new UploadError("chat_attachment_invalid",400);}finally{clearTimeout(timer);reader.releaseLock();}
}
export async function handleGuestChatAttachment(request:Request,merchant=false,deps=guestChatAttachmentDependencies) {
  let release:(()=>void)|null=null;
  try {
    if(request.method!=="POST")throw new UploadError("method_not_allowed",405);
    if(request.headers.get("sec-fetch-site")==="cross-site"||!isTrustedSameOriginMutationRequest(request))throw new UploadError("forbidden_origin",403);
    if(!request.headers.get("content-type")?.startsWith("multipart/form-data;"))throw new UploadError("chat_attachment_invalid",415);
    const query=new URL(request.url).searchParams,siteId=query.get("siteId")??"",threadId=query.get("threadId");
    if(!/^\d{8}$/.test(siteId)||[...query.keys()].some(key=>!["siteId","threadId"].includes(key))||query.getAll("siteId").length!==1||query.getAll("threadId").length>1||merchant&&(!threadId||!GUEST_CHAT_UUID.test(threadId))||!merchant&&query.has("threadId"))throw new UploadError("chat_attachment_invalid",400);
    const store=deps.store();if(!store)throw new UploadError("chat_attachment_unavailable",503);
    let actor:MerchantBusinessActor|null=null,identity="",token:string|null=null;
    if(merchant) {
      actor=await deps.authorize(request,{siteId,requiredPermission:"conversations.send"});
      await deps.reauthorize(request,{actor,requiredPermissions:["conversations.view","conversations.send"]});
      const list=await store.list(siteId,"merchant",null,threadId);if(!list.threads.some(thread=>thread.id===threadId&&thread.siteId===siteId))throw new UploadError("guest_chat_not_found",404);
      identity=actor.principalKey;
    }else {
      token=readGuestChatToken(request);const session=token?await store.session(hash(token)):null;
      if(!session)throw new UploadError("guest_chat_unauthorized",401);
      if(!await deps.published(request,siteId))throw new UploadError("guest_chat_not_found",404);
      identity=`guest:${session.id}`;
    }
    if(!deps.allow(identity,readRequestClientIp(request)||"unknown"))throw new UploadError("chat_attachment_rate_limited",429);
    release=deps.acquire();if(!release)throw new UploadError("chat_attachment_busy",429);
    const {file,bytes}=await readUpload(request);let metadata;
    try{metadata=validateChatAttachment(file.name,file.type,bytes);}catch(error){throw new UploadError(error instanceof Error?error.message:"chat_attachment_invalid",error instanceof Error&&error.message==="chat_attachment_size"?413:415);}
    const recheck=async()=>{
      if(request.signal.aborted)throw new UploadError("chat_attachment_cancelled",408);
      if(actor)await deps.reauthorize(request,{actor,requiredPermissions:["conversations.view","conversations.send"]});
      else if(!token||!await store.session(hash(token))||!await deps.published(request,siteId))throw new UploadError("guest_chat_unauthorized",401);
    };
    await recheck();
    const digest=hash(Buffer.concat([Buffer.from(metadata.name+"\n"+metadata.mime+"\n"),bytes]));
    const objectPath=`guest-chat/${siteId}/${hash(identity)}/${digest}.${metadata.extension}`;
    const url=await deps.put(objectPath,bytes,metadata.mime,request.signal);await recheck();
    return NextResponse.json({ok:true,url,name:metadata.name,image:metadata.image},{headers});
  }catch(error){const access=toMerchantBusinessAccessResponse(error),code=error instanceof UploadError?error.code:access.body.error,status=error instanceof UploadError?error.status:access.status;return NextResponse.json({ok:false,error:code,message:status===413?"请选择不超过 8 MB 的文件。":status===415?"请选择常用图片、PDF、文本、Office 或 ZIP 文件；不支持可执行或网页文件。":status===429?"附件上传过于频繁，请稍后再试。":status===401?"会话凭证已失效，请重新连接。":"附件上传未确认，请稍后重试。"},{status,headers});}finally{release?.();}
}
