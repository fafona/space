import { handleRules } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleRules(request);
export const POST = (request: Request) => handleRules(request);
