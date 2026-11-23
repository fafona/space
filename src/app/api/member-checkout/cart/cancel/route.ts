import { handleCartCheckout } from "@/lib/merchantCheckoutCartHttp.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleCartCheckout("cancel", request);
