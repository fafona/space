import {handleAttendanceRevisionReview} from "./route-handler";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleAttendanceRevisionReview(request);}
