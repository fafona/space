import { handleTrafficCampaign } from "./route-handler";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleTrafficCampaign(request); }
