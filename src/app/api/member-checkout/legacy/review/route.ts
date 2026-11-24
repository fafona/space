import { handleCheckoutLegacyReview } from "@/lib/merchantCheckoutLegacyReview.server";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleCheckoutLegacyReview(request); }
