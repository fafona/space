import { handleAttendanceChoices } from "./route-handler";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (request: Request) => handleAttendanceChoices(request);
