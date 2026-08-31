import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/merchantBusinessActor.server.ts", import.meta.url),
  "utf8",
);
const roleRouteSource = await readFile(
  new URL("../src/app/api/merchant-enterprise/roles/route.ts", import.meta.url),
  "utf8",
);

test("business APIs authorize owners only through an exact database ownership match", () => {
  assert.doesNotMatch(source, /resolveMerchantSessionFromRequest|serverMerchantSession/);
  assert.doesNotMatch(source, /legacy-owner-compat/);
  assert.match(source, /source:\s*"database";/);

  const ownerLoader = source.match(
    /async function loadOwnerAuthorization\([\s\S]+?\n}\n\nasync function loadSite/,
  )?.[0];
  assert.ok(ownerLoader, "owner loader must remain present");
  assert.match(
    ownerLoader,
    /const authUserId = trimText\(user\.id, 80\);[\s\S]+strictOwnerFilter\(authUserId\)/,
  );
  assert.match(
    ownerLoader,
    /\.from\("merchants"\)[\s\S]+\.eq\("id", siteId\)[\s\S]+\.or\(ownerFilter\)/,
  );
  assert.match(ownerLoader, /source:\s*"database"[\s\S]+\n\s*return null;/);
  assert.doesNotMatch(
    ownerLoader,
    /user_metadata|app_metadata|metadata|merchantSession|merchantEmail|hintedMerchantId/,
  );
});

test("the strict owner filter cannot authorize by email or user-controlled metadata", () => {
  const ownerFilter = source.match(
    /function strictOwnerFilter\([\s\S]+?\n}\n\nasync function resolveAuthUser/,
  )?.[0];
  assert.ok(ownerFilter, "strict owner filter must remain present");
  assert.match(ownerFilter, /authUserId\.replace\(\/\[\^a-fA-F0-9-\]\//);
  assert.doesNotMatch(ownerFilter, /email|metadata|merchant_id|siteId/);
  for (const column of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(ownerFilter, new RegExp(`${column}\\.eq\\.\\$\\{escaped\\}`));
  }
});

test("employee business access requires password AMR from a subject-bound verified JWT", () => {
  const authResolver = source.match(
    /async function resolveAuthUser\([\s\S]+?\n}\n\nexport function readMerchantBusinessRequestAccessTokens/,
  )?.[0];
  assert.ok(authResolver, "business auth resolver must remain present");
  assert.match(authResolver, /auth\.getClaims\(accessToken\)/);
  assert.match(authResolver, /auth\.getUser\(accessToken\)/);
  assert.match(
    authResolver,
    /trimText\(claims\.sub, 80\) === trimText\(user\.id, 80\)/,
  );
  assert.match(
    authResolver,
    /jwtVerified[\s\S]+normalizeAuthenticationMethods\(claims\?\.amr\)/,
  );

  const passwordGuard = source.match(
    /function requireMerchantBusinessEmployeePasswordAuthentication\([\s\S]+?\n}/,
  )?.[0];
  assert.ok(passwordGuard, "employee password AMR guard must remain present");
  assert.match(passwordGuard, /auth\.jwtVerified !== true/);
  assert.match(
    passwordGuard,
    /!auth\.authenticationMethods\.includes\("password"\)/,
  );
  assert.match(
    passwordGuard,
    /EMPLOYEE_FORBIDDEN_AUTHENTICATION_METHODS\.has\(method\)/,
  );
  for (const method of ["invite", "magiclink", "recovery"]) {
    assert.match(
      source,
      new RegExp(`EMPLOYEE_FORBIDDEN_AUTHENTICATION_METHODS[\\s\\S]+"${method}"`),
    );
  }

  const staffPasswordGate = source.indexOf(
    "requireMerchantBusinessEmployeePasswordAuthentication(auth);",
  );
  const siteLoad = source.indexOf("const site = await dependencies.loadSite(siteId);");
  assert.match(
    source,
    /if \(staffPrincipal\) \{\s+requireMerchantBusinessEmployeePasswordAuthentication\(auth\);\s+}/,
  );
  assert.ok(staffPasswordGate >= 0 && siteLoad > staffPasswordGate);
});

test("role writes cannot retain staff business permissions while the exact-site rollout is off", () => {
  assert.match(
    roleRouteSource,
    /import \{ isMerchantStaffBusinessRolloutEnabled \} from "@\/lib\/merchantStaffBusinessRollout\.server";/,
  );
  assert.match(
    roleRouteSource,
    /canMerchantEnterpriseRoleRetainBusinessPermissions\([\s\S]+nextPermissions \?\? currentPermissions/,
  );
  const checks = [...roleRouteSource.matchAll(
    /canMerchantEnterpriseRoleRetainBusinessPermissions\([\s\S]{0,220}?isMerchantStaffBusinessRolloutEnabled\(siteId\)[\s\S]{0,180}?staff_business_access_disabled/g,
  )];
  assert.equal(checks.length, 2, "both role create and update must enforce the rollout");
});

test("a drift-tolerant business permission strip is normalized to one permissions-only RPC", () => {
  assert.match(
    roleRouteSource,
    /const stripsBusinessPermissions =[\s\S]+isMerchantEnterpriseBusinessPermissionStrip/,
  );
  assert.match(
    roleRouteSource,
    /business_permission_strip_requires_separate_update/,
  );
  assert.match(
    roleRouteSource,
    /!stripsBusinessPermissions && body\?\.name[\s\S]+!stripsBusinessPermissions && body\?\.description[\s\S]+\(permissions \? \{ permissions \} : \{\}\)[\s\S]+!stripsBusinessPermissions && access[\s\S]+!stripsBusinessPermissions &&/,
  );
});
