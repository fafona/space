import { handleShiftRuleView } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleShiftRuleView(request);
