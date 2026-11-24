import { handleCheckoutHistoryRecovery } from "@/lib/merchantCheckoutHistoryRecovery.server";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export function POST(request: Request) { return handleCheckoutHistoryRecovery(request); }
