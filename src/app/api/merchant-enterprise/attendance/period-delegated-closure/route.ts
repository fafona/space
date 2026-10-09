import { handlePeriodDelegatedClosures } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handlePeriodDelegatedClosures(request);
export const POST = (request: Request) => handlePeriodDelegatedClosures(request);
