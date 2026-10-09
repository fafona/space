import { handleGroups } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleGroups(request);
export const POST = (request: Request) => handleGroups(request);
