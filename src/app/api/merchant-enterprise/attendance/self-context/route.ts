import { handleAttendanceSelfContext } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = (request: Request) => handleAttendanceSelfContext(request);
