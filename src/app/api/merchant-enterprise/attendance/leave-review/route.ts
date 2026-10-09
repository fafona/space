import { handleLeaveReview } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleLeaveReview(request);
export const POST = (request: Request) => handleLeaveReview(request);
