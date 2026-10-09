import { handleIndependentTerminal } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleIndependentTerminal(request); }
export async function POST(request: Request) { return handleIndependentTerminal(request); }
