import { handleCartCollection } from "@/lib/merchantCheckoutCartCollection.server";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleCartCollection(request); }
