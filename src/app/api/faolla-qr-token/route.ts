import { handleFaollaQrTokenGet, handleFaollaQrTokenPost } from "@/lib/faollaQrTokenRoute.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleFaollaQrTokenGet(request);
}

export async function POST(request: Request) {
  return handleFaollaQrTokenPost(request);
}
