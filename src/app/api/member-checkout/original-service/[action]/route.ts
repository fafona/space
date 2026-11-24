import { handleCheckoutOriginalService } from "@/lib/merchantCheckoutOriginalService.server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action !== "review" && action !== "cancel") return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
  return handleCheckoutOriginalService(action === "cancel", request);
}
