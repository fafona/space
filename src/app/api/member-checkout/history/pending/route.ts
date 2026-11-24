import { handleCheckoutHistoryPending } from "@/lib/merchantCheckoutHistoryPending.server";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export function POST(request: Request) { return handleCheckoutHistoryPending(request); }
