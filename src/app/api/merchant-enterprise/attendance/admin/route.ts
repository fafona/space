import { handleAttendanceAdmin } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = (request: Request) => handleAttendanceAdmin(request);
export const POST = (request: Request) => handleAttendanceAdmin(request);
