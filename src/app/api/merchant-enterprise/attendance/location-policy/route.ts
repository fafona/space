import { handleAttendanceLocationPolicy } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleAttendanceLocationPolicy(request);
export const POST = (request: Request) => handleAttendanceLocationPolicy(request);
