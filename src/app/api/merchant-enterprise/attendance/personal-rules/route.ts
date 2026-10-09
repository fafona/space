import { handlePersonalRules } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePersonalRules(request);
export const POST = (request: Request) => handlePersonalRules(request);
