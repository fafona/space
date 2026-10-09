import { handleCorrectionContext } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Reuse the same read-only identity RPC without coupling corrections to GPS enablement.
export const GET = (request: Request) => handleCorrectionContext(request);
