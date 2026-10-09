import { handleAttendanceScopes } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleAttendanceScopes(request);
export const POST = (request: Request) => handleAttendanceScopes(request);
