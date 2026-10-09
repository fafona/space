import { handlePlanRuleApprovals } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePlanRuleApprovals(request);
export const POST = (request: Request) => handlePlanRuleApprovals(request);
