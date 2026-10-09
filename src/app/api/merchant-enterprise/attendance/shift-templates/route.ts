import { handleShiftTemplates } from "./route-handler";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleShiftTemplates(request);
export const POST = (request: Request) => handleShiftTemplates(request);
