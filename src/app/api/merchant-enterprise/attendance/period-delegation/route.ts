import { handlePeriodDelegation } from "./route-handler";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePeriodDelegation(request);
export const POST = (request: Request) => handlePeriodDelegation(request);
