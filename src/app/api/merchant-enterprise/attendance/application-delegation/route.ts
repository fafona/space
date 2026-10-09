import { handleApplicationDelegation } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleApplicationDelegation(request); }
export async function POST(request: Request) { return handleApplicationDelegation(request); }
