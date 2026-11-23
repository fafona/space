import { handleOnSiteCheckout } from "@/lib/merchantCheckoutOnSiteHttp.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleOnSiteCheckout("submit", request);
