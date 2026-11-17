import {handleGuestChatAttachment} from "@/lib/guestChatAttachments.server";
export const runtime="nodejs";
export const POST=(request:Request)=>handleGuestChatAttachment(request);
