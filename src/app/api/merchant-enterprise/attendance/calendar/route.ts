import { handleCalendar } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleCalendar(request);
export const POST = (request: Request) => handleCalendar(request);
