import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "./platform-merchant-snapshot/route.ts",
  "./platform-merchant-config-archive/route.ts",
  "./merchant-id-rules/route.ts",
  "./merchant-accounts/route.ts",
] as const;

test("super-admin service routes use the shared internal-first Supabase client", async () => {
  for (const routePath of routePaths) {
    const source = await readFile(new URL(routePath, import.meta.url), "utf8");
    assert.match(
      source,
      /createServerSupabaseServiceClient/,
      `${routePath} must use the shared service client`,
    );
    assert.doesNotMatch(
      source,
      /readEnv\("NEXT_PUBLIC_SUPABASE_URL"\)/,
      `${routePath} must not bypass the server-only Supabase URL`,
    );
  }
});
