import { handleLeave } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleLeave(request);
export const POST = (request: Request) => handleLeave(request);
