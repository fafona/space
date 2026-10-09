import { handleAccountSuspension } from "./route-handler";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request) { return handleAccountSuspension(request); }
export async function POST(request: Request) { return handleAccountSuspension(request); }
