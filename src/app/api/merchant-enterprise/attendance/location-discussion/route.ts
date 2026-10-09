import { handleAttendanceDiscussion } from "./route-handler";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleAttendanceDiscussion(request); }
export async function POST(request: Request) { return handleAttendanceDiscussion(request); }
