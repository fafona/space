import { handleRuleCaptures } from "./route-handler";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleRuleCaptures(request);
export const POST = (request: Request) => handleRuleCaptures(request);
