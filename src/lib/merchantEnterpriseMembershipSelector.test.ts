import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantEnterpriseSitePath,
  describeMerchantEnterpriseMembershipAvailability,
  normalizeMerchantEnterpriseMembershipPayload,
  normalizeMerchantEnterpriseMemberships,
} from "@/lib/merchantEnterpriseMembershipSelector";

test("enterprise site paths accept only canonical merchant ids", () => {
  assert.equal(buildMerchantEnterpriseSitePath("10000000"), "/enterprise/10000000");
  assert.equal(buildMerchantEnterpriseSitePath(" 10000000 "), "/enterprise/10000000");
  assert.equal(buildMerchantEnterpriseSitePath("../admin"), null);
  assert.equal(buildMerchantEnterpriseSitePath("10000000?next=https://evil.example"), null);
  assert.equal(buildMerchantEnterpriseSitePath("1000000"), null);
});

test("membership normalization blocks disabled and malformed tenant rows", () => {
  const employeeA = "11111111-1111-4111-8111-111111111111";
  const roleA = "22222222-2222-4222-8222-222222222222";
  const employeeB = "33333333-3333-4333-8333-333333333333";
  const roleB = "44444444-4444-4444-8444-444444444444";
  const memberships = normalizeMerchantEnterpriseMemberships([
    {
      siteId: "10000000",
      siteName: "North Shop",
      employeeId: employeeA,
      displayName: "Alice",
      roleId: roleA,
      roleName: "Manager",
      status: "active",
      enterable: true,
    },
    {
      siteId: "20000000",
      siteName: "South Shop",
      employeeId: employeeB,
      displayName: "Bob",
      roleId: roleB,
      roleName: "Staff",
      status: "disabled",
      enterable: false,
      reason: "employee_account_disabled",
    },
  ]);

  assert.deepEqual(
    memberships.map(({ siteId, enterable }) => ({ siteId, enterable })),
    [
      { siteId: "10000000", enterable: true },
      { siteId: "20000000", enterable: false },
    ],
  );
  assert.equal(
    describeMerchantEnterpriseMembershipAvailability(memberships[1]),
    "员工账号已停用，请联系企业负责人。",
  );
});

test("one malformed or duplicated membership rejects the complete response", () => {
  const valid = {
    siteId: "10000000",
    siteName: "Shop",
    employeeId: "11111111-1111-4111-8111-111111111111",
    displayName: "Alice",
    roleId: "22222222-2222-4222-8222-222222222222",
    roleName: "Staff",
    status: "active",
    enterable: true,
  };

  assert.throws(
    () =>
      normalizeMerchantEnterpriseMemberships([
        valid,
        {
          site: { id: "20000000", name: "old contract" },
          employee: { id: valid.employeeId, displayName: "Bob" },
          status: "active",
          enterable: true,
        },
      ]),
    /企业身份数据无法验证/,
  );
  assert.throws(
    () => normalizeMerchantEnterpriseMemberships([valid, { ...valid }]),
    /企业身份数据无法验证/,
  );
});

test("enterability and reason must describe one consistent membership state", () => {
  const active = {
    siteId: "10000000",
    siteName: "Shop",
    employeeId: "11111111-1111-4111-8111-111111111111",
    displayName: "Alice",
    roleId: "22222222-2222-4222-8222-222222222222",
    roleName: "Staff",
    status: "active",
    enterable: true,
  };

  for (const contradictory of [
    { ...active, reason: "merchant_access_denied" },
    { ...active, enterable: false },
    {
      ...active,
      status: "disabled",
      enterable: false,
      reason: "employee_invitation_pending",
    },
    {
      ...active,
      status: "invited",
      enterable: false,
      reason: "employee_account_disabled",
    },
    {
      ...active,
      enterable: false,
      reason: "employee_account_disabled",
    },
  ]) {
    assert.throws(
      () => normalizeMerchantEnterpriseMemberships([contradictory]),
      /企业身份数据无法验证/,
    );
  }

  const validUnavailable = normalizeMerchantEnterpriseMemberships([
    {
      ...active,
      enterable: false,
      reason: "merchant_access_denied",
    },
  ]);
  assert.equal(validUnavailable[0]?.reason, "merchant_access_denied");
});

test("membership payload accepts only a literal ok true contract", () => {
  assert.deepEqual(
    normalizeMerchantEnterpriseMembershipPayload({ ok: true, memberships: [] }),
    [],
  );
  for (const ok of [1, "true", {}, [], null, undefined, false]) {
    assert.throws(
      () => normalizeMerchantEnterpriseMembershipPayload({ ok, memberships: [] }),
      /企业身份数据无法验证/,
    );
  }
});
