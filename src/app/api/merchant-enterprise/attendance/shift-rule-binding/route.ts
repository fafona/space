import { handleShiftRuleBinding } from "./route-handler";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleShiftRuleBinding(request);
