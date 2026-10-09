import { executeOutageLinks, outageLinksSiteEnabled } from "@/lib/merchantAttendanceOutageLinks.server";
import { createOutageRouteDependencies, handleOutageRoute } from "@/lib/merchantAttendanceOutageRoute.server";

export const outageLinksDependencies = createOutageRouteDependencies<"links">(executeOutageLinks, outageLinksSiteEnabled);
export function handleOutageLinks(request: Request, overrides: Partial<typeof outageLinksDependencies> = {}) {
  return handleOutageRoute("links", request, { ...outageLinksDependencies, ...overrides });
}
