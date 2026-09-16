import { readFileSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export function assertAuthMiddlewareBuild(buildDir = ".next") {
  const root = resolve(buildDir);
  const manifest = JSON.parse(readFileSync(resolve(root, "server/functions-config-manifest.json"), "utf8"));
  const entry = manifest.functions?.["/_middleware"];
  if (!entry || entry.runtime !== "nodejs") throw new Error("auth_middleware_build_missing");
  for (const file of ["server/middleware.js"]) {
    const target = resolve(root, file);
    const rel = relative(root, target);
    if (isAbsolute(rel) || rel.startsWith("..") || !statSync(target).isFile()) {
      throw new Error("auth_middleware_file_invalid");
    }
  }
  const matchers = entry.matchers?.map((matcher) => new RegExp(matcher.regexp));
  if (!matchers?.length) throw new Error("auth_middleware_matchers_missing");
  const matches = (path) => matchers.some((matcher) => matcher.test(path));
  for (const path of ["/login", "/reset-password", "/enterprise", "/enterprise/10000000", "/api/auth/merchant-session"]) {
    if (!matches(path)) throw new Error("auth_middleware_route_missing");
  }
  for (const path of ["/", "/site/10000000", "/10000000", "/auth/v1/callback", "/_next/static/test.js"]) {
    if (matches(path)) throw new Error("auth_middleware_scope_expanded");
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertAuthMiddlewareBuild(process.argv[2]);
  console.log("[build] authentication middleware present, files verified, scope verified");
}
