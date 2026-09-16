import type { NextRequest } from "next/server";
import { middleware as handleAuthEntry } from "../middleware";

// Next discovers its proxy beside src/app, not at the repository root.
// Restore only the authentication boundary in this hotfix. Activating the
// legacy public/tenant routing rules requires its own rollout and validation.
export async function proxy(request: NextRequest) {
  const response = await handleAuthEntry(request);
  // OAuth codes and password recovery links must never be cached in redirects.
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

// Keep literal matchers here: Next must statically extract the entry config.
export const config = {
  matcher: ["/login/:path*", "/reset-password/:path*", "/enterprise/:path*", "/api/auth/:path*"],
};
