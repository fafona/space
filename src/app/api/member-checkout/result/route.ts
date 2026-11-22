import { handleMemberCheckoutResult } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleMemberCheckoutResult(request);
