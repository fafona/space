import { handlePeriodClosuresV2 } from "./route-handler";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;
export async function GET(request:Request){return handlePeriodClosuresV2(request);}
export async function POST(request:Request){return handlePeriodClosuresV2(request);}
