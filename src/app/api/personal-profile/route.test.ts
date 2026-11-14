import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

const requireModule = createRequire(path.resolve("package.json"));
async function profileRoute(authenticated = true) {
  const writes: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  const user = { id: "synthetic-user", user_metadata: { unrelated: "preserve", personal_profile: { favoriteSites: [{ id: "saved", url: "https://example.invalid/merchant" }] } } };
  const fixture = { session: authenticated ? { user, accountId: "50010105", serviceConfig: {}, permissionConfig: {}, servicePaused: false,
    adminSupabase: { auth: { admin: { updateUserById: async (id: string, patch: { user_metadata: Record<string, unknown> }) => { writes.push({ id, metadata: patch.user_metadata }); return { data: { user: { ...user, user_metadata: patch.user_metadata } }, error: null }; } } } } } : null };
  const stubs: Record<string, string> = {
    "@/lib/personalAccountSession.server": "export async function resolvePersonalAccountSessionFromRequest(){return __fixture.session}",
    "@/lib/personalBusinessCardStore": "export async function loadStoredPersonalBusinessCards(){return {cards:[]}};export async function saveStoredPersonalBusinessCards(){throw new Error('unexpected card write')}",
    "@/lib/merchantPermissionGuards": "export function getMerchantBusinessCardPermissionViolation(){throw new Error('unexpected card mutation')}",
  };
  const output = await build({ entryPoints: ["src/app/api/personal-profile/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
    plugins: [{ name: "synthetic-profile-io", setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: "synthetic" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents: stubs[args.path], loader: "ts" }));
    } }] });
  const routeModule = { exports: {} };
  new Function("__fixture", "require", "module", "exports", output.outputFiles[0].text)(fixture, requireModule, routeModule, routeModule.exports);
  const route = routeModule.exports as { POST: (request: Request) => Promise<Response> };
  return { route, writes };
}
const request = (profile: Record<string, string>, origin = "https://launch.faolla.com") => new Request("https://launch.faolla.com/api/personal-profile", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ profile }),
});
test("profile saves retain a bounded guest raster avatar intact and preserve unrelated metadata and bookmarks", async () => {
  const { route, writes } = await profileRoute();
  const avatarUrl = "data:image/jpeg;base64," + "a".repeat(4000);
  const response = await route.POST(request({ displayName: "Synthetic person", avatarUrl, gender: "male", country: "Spain", province: "Sevilla", city: "Sevilla", birthday: "2000-01-01", contactCard: "" }));
  assert.equal(response.status, 200);const result = await response.json();
  assert.equal(result.profile.avatarUrl, avatarUrl);assert.equal(result.profile.contactCard, "");assert.equal(writes.length, 1);
  assert.equal(writes[0].metadata.unrelated, "preserve");assert.deepEqual(result.profile.favoriteSites, [{ id: "saved", url: "https://example.invalid/merchant" }]);
});
test("ordinary uploaded avatar URLs still save through the original normalization", async () => {
  const { route } = await profileRoute();
  const response = await route.POST(request({ avatarUrl: "https://example.invalid/avatar.jpg", contactCard: "https://faolla.com/card/synthetic-card-01" }));
  assert.equal(response.status, 200);const result = await response.json();assert.equal(result.profile.avatarUrl, "https://example.invalid/avatar.jpg");assert.equal(result.profile.contactCard, "https://faolla.com/card/synthetic-card-01");
});
test("the avatar change leaves real same-origin and authenticated-profile guards intact", async () => {
  const privateRoute = await profileRoute(false);
  assert.equal((await privateRoute.route.POST(request({ avatarUrl: "" }))).status, 401);assert.deepEqual(privateRoute.writes, []);
  const crossOrigin = await profileRoute();
  assert.equal((await crossOrigin.route.POST(request({ avatarUrl: "" }, "https://untrusted.invalid"))).status, 403);assert.deepEqual(crossOrigin.writes, []);
});
