import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import {
  MerchantEnterpriseAccessError,
  requireMerchantEnterpriseEntitlement,
} from "@/lib/merchantEnterpriseAuth.server";
import type { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";

type CurrentSnapshot = Awaited<
  ReturnType<typeof loadAuthoritativeCurrentMerchantSnapshotSites>
>;

function currentSite(
  siteId: string,
  allowEnterpriseManagement: boolean,
) {
  return {
    id: siteId,
    permissionConfig: {
      ...createDefaultMerchantPermissionConfig(),
      allowEnterpriseManagement,
    },
  } as unknown as CurrentSnapshot[number];
}

test("enterprise entitlement uses only the injected authoritative current snapshot", async () => {
  const site = await requireMerchantEnterpriseEntitlement(
    "10000000",
    async () => [currentSite("10000000", true)],
  );
  assert.equal(site.id, "10000000");

  await assert.rejects(
    () =>
      requireMerchantEnterpriseEntitlement(
        "10000000",
        async () => [currentSite("10000000", false)],
      ),
    (error: unknown) =>
      error instanceof MerchantEnterpriseAccessError &&
      error.code === "enterprise_management_disabled" &&
      error.status === 403,
  );
  await assert.rejects(
    () =>
      requireMerchantEnterpriseEntitlement("10000000", async () => {
        throw new Error("authoritative snapshot unavailable");
      }),
    (error: unknown) =>
      error instanceof MerchantEnterpriseAccessError &&
      error.code === "enterprise_entitlement_unavailable" &&
      error.status === 503,
  );
});

test("enterprise actor resolution is read-only and gates before membership lookup", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/merchantEnterpriseAuth.server.ts"),
    "utf8",
  );
  const gateIndex = source.indexOf(
    "await requireMerchantEnterpriseEntitlement(siteId)",
  );
  const employeeLookupIndex = source.indexOf(
    '.from("merchant_enterprise_employees")',
  );

  assert.ok(gateIndex >= 0);
  assert.ok(employeeLookupIndex > gateIndex);
  assert.equal(source.includes(".update({"), false);
  assert.match(source, /\.eq\("status", "active"\)/);
  assert.doesNotMatch(source, /merchant_employee_activation_failed/);
});
