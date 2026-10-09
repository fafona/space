import {handleTimesheetExport} from "./route-handler";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request){return handleTimesheetExport(request);}
