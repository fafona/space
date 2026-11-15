import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { guestChatName, type GuestChatMessage, type GuestChatThread } from "@/lib/guestChat";

type Client = NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>;
export type GuestSession = { id: string; guestNumber: string };
export class GuestChatError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function checked<T>(result: { data: unknown; error: { message?: string } | null }): T {
  if (result.error) {
    const code = ["rate_limited","unauthorized","not_found","idempotency_conflict","invalid"].find(s=>result.error!.message?.includes(`guest_chat_${s}`));
    throw new GuestChatError(code ? `guest_chat_${code}` : "guest_chat_unavailable",code === "rate_limited" ? 429 : code === "unauthorized" ? 401 : code === "not_found" ? 404 : code === "idempotency_conflict" ? 409 : code === "invalid" ? 400 : 503);
  }
  return result.data as T;
}
export function createGuestChatStore(client: Client) {
  return {
    async session(hash: string): Promise<GuestSession | null> {
      const row=checked<{id:string;guest_number:string}|null>(await client.from("merchant_guest_chat_sessions").select("id,guest_number").eq("token_hash",hash).gt("expires_at",new Date().toISOString()).maybeSingle());
      return row ? { id: row.id, guestNumber: row.guest_number } : null;
    },
    async createSession(hash:string,ipHash:string):Promise<GuestSession> {
      return checked<GuestSession>(await client.rpc("merchant_guest_chat_create_session",{p_token_hash:hash,p_ip_hash:ipHash}));
    },
    async list(siteId:string,reader:"guest"|"merchant",sessionId:string|null,threadId:string|null,offset=0) {
      const rows=checked<Array<{id:string;site_id:string;guest_number:string;updated_at:string;unread:number;last_message:GuestChatMessage|null}>>(await client.rpc("merchant_guest_chat_list",{p_site_id:siteId,p_session_id:sessionId,p_thread_id:threadId,p_reader:reader,p_offset:offset})) ?? [];
      const threads:GuestChatThread[]=rows.slice(0,50).map(r=>({id:r.id,siteId:r.site_id,guestNumber:r.guest_number,guestName:guestChatName(r.guest_number),updatedAt:r.updated_at,unread:Number(r.unread),lastMessage:r.last_message}));
      return { threads, nextOffset:rows.length>50?offset+50:null };
    },
    async messages(threadId:string,before:string|null) {
      let query=client.from("merchant_guest_chat_messages").select("sequence,request_id,sender,text,created_at").eq("thread_id",threadId).order("sequence",{ascending:false}).limit(81);
      if(before)query=query.lt("sequence",before);
      const rows=checked<Array<{sequence:string|number;request_id:string;sender:"guest"|"merchant";text:string;created_at:string}>>(await query) ?? [];
      const messages:GuestChatMessage[]=rows.slice(0,80).reverse().map(r=>({id:String(r.sequence),requestId:r.request_id,sender:r.sender,text:r.text,createdAt:r.created_at}));
      return { messages, before:rows.length>80?messages[0]?.id??null:null };
    },
    async send(input:{siteId:string;threadId:string|null;hash:string|null;sender:"guest"|"merchant";requestId:string;text:string;principal:string|null}) {
      return checked<string>(await client.rpc("merchant_guest_chat_send",{p_site_id:input.siteId,p_thread_id:input.threadId,p_token_hash:input.hash,p_sender:input.sender,p_request_id:input.requestId,p_text:input.text,p_principal:input.principal}));
    },
    async read(input:{siteId:string;threadId:string;hash:string|null;reader:"guest"|"merchant";through:string}) {
      checked(await client.rpc("merchant_guest_chat_mark_read",{p_site_id:input.siteId,p_thread_id:input.threadId,p_token_hash:input.hash,p_reader:input.reader,p_through:input.through}));
    },
  };
}
export type GuestChatStore = ReturnType<typeof createGuestChatStore>;
export function configuredGuestChatStore() { const client=createServerSupabaseServiceClient();return client?createGuestChatStore(client):null; }
