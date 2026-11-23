import { handleSingleIntentCheckout } from "../../route-handler";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function POST(request: Request, { params }: { params: Promise<{ method: string; action: string }> }) {
  const { method, action } = await params; return handleSingleIntentCheckout(method, action, request);
}
