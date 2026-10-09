import { handleApplicationWindow } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleApplicationWindow(request); }
export async function POST(request: Request) { return handleApplicationWindow(request); }
