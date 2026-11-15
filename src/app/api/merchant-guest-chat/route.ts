import { handleGuestChat } from "@/lib/guestChatHandlers.server";
export const dynamic="force-dynamic";
export const revalidate=0;
export const GET=(request:Request)=>handleGuestChat(request,true);
export const POST=(request:Request)=>handleGuestChat(request,true);
