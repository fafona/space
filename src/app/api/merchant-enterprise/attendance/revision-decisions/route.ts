import {handleRevisionDecision} from "./route-handler";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request){return handleRevisionDecision(request);}
export async function POST(request:Request){return handleRevisionDecision(request);}
