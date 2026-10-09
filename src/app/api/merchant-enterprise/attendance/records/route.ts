import { handleAttendanceRecords } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleAttendanceRecords(request);
