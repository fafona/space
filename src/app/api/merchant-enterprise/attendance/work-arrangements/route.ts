import { handleWorkArrangement } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleWorkArrangement(request);
export const POST = (request: Request) => handleWorkArrangement(request);
