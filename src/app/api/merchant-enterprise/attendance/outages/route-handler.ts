import { executeOutage, outageSiteEnabled } from "@/lib/merchantAttendanceOutage.server";
import { createOutageRouteDependencies, handleOutageRoute } from "@/lib/merchantAttendanceOutageRoute.server";

export const outageDependencies = createOutageRouteDependencies<"outages">(executeOutage, outageSiteEnabled);
export function handleOutage(request: Request, overrides: Partial<typeof outageDependencies> = {}) {
  return handleOutageRoute("outages", request, { ...outageDependencies, ...overrides });
}
