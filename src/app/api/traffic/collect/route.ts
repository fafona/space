import { handleTrafficCollect } from "./route-handler";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleTrafficCollect(request); }
