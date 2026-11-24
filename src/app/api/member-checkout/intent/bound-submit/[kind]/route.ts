import { handleBoundCheckoutSubmit } from "@/lib/merchantCheckoutBoundSubmit.server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (kind !== "points" && kind !== "on-site" && kind !== "cart") return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
  return handleBoundCheckoutSubmit(kind, request);
}
