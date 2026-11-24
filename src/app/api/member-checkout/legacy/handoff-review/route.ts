import { handleCheckoutLegacyHandoffReview } from "@/lib/merchantCheckoutLegacyHandoff.server";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleCheckoutLegacyHandoffReview(request); }
