import { handlePlanCoverageAdoptions } from "./route-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request) { return handlePlanCoverageAdoptions(request); }

