import { handleCheckoutIntent } from "@/lib/merchantCheckoutIntentHttp.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleCheckoutIntent("review", request);
