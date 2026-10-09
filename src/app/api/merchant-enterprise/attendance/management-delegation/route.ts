import { handleManagementDelegation } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleManagementDelegation(request); }
export async function POST(request: Request) { return handleManagementDelegation(request); }
