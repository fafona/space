import { handleAttendanceNotice } from "./route-handler";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleAttendanceNotice(request); }
export async function POST(request: Request) { return handleAttendanceNotice(request); }
