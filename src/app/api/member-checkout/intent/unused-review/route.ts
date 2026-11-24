import { handleUnusedCheckoutReference } from "@/lib/merchantCheckoutUnusedReference.server";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleUnusedCheckoutReference(false, request);
