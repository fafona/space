import { handleAttendanceLocationReview } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleAttendanceLocationReview(request);
export const POST = (request: Request) => handleAttendanceLocationReview(request);
