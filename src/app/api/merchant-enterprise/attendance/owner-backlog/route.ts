import { handleOwnerBacklog } from "./route-handler";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleOwnerBacklog(request); }
