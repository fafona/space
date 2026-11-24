import { handleCheckoutHistoryInventory } from "@/lib/merchantCheckoutHistoryInventory.server";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export function POST(request: Request) { return handleCheckoutHistoryInventory(request); }
