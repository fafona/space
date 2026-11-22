import { handleMemberCheckoutResult } from "../result/route-handler";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleMemberCheckoutResult(request);
