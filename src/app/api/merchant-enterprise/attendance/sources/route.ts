import { handleSources } from "./route-handler";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleSources(request); }
