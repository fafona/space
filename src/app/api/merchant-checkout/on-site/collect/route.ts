import { handleOnSiteCollection } from "@/lib/merchantCheckoutOnSiteCollection.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleOnSiteCollection(request);
