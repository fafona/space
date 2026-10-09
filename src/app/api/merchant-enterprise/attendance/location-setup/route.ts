import { handleLocationSetup } from "./route-handler";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleLocationSetup(request); }
export async function POST(request: Request) { return handleLocationSetup(request); }
