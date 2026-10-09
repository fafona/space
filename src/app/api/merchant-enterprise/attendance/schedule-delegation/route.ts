import { handleScheduleDelegation } from "./route-handler";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleScheduleDelegation(request);
export const POST = (request: Request) => handleScheduleDelegation(request);
