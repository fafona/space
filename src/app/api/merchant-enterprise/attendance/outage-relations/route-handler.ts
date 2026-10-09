import { executeOutageRelations, outageRelationsSiteEnabled } from "@/lib/merchantAttendanceOutageRelations.server";
import { createOutageRouteDependencies, handleOutageRoute } from "@/lib/merchantAttendanceOutageRoute.server";

export const outageRelationsDependencies = createOutageRouteDependencies<"relations">(executeOutageRelations, outageRelationsSiteEnabled);
export function handleOutageRelations(request: Request, overrides: Partial<typeof outageRelationsDependencies> = {}) {
  return handleOutageRoute("relations", request, { ...outageRelationsDependencies, ...overrides });
}
