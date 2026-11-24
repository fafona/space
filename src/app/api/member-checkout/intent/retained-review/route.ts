import { handleRetainedCheckoutIntent } from "@/lib/merchantCheckoutRetainedIntent.server";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleRetainedCheckoutIntent(false, request);
