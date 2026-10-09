import { handleRuleCaptureHistory } from "./route-handler";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleRuleCaptureHistory(request);
