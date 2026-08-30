import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeanRedemptionCashierMembership,
  buildRedemptionCashierMembershipList,
  searchRedemptionCashierMemberships,
} from "./merchantRedemptionCashier";

function buildSearchMembership(
  index: number,
  overrides: Partial<{
    id: string;
    status: string;
    profileVisible: boolean;
    memberNo: string;
    nickname: string;
    name: string;
    accountId: string;
    email: string;
    phone: string;
    joinedAt: string;
    leftAt: string;
    birthday: string;
    gender: string;
    country: string;
    province: string;
    city: string;
    address: string;
    taxName: string;
    taxNumber: string;
    taxCountry: string;
    taxProvince: string;
    taxCity: string;
    taxAddress: string;
  }> = {},
) {
  return {
    id: `member-${index}`,
    status: "active",
    profileVisible: true,
    memberNo: `CARD-${String(index).padStart(4, "0")}`,
    nickname: `nickname-${index}`,
    name: `Member ${index}`,
    accountId: `account-${index}`,
    email: `member-${index}@example.com`,
    phone: `600${String(index).padStart(6, "0")}`,
    joinedAt: "2026-01-01T00:00:00.000Z",
    leftAt: "",
    birthday: "1990-01-01",
    gender: "unspecified",
    country: "Spain",
    province: "Madrid",
    city: "Madrid",
    address: `Customer Street ${index}`,
    taxName: `Tax Name ${index}`,
    taxNumber: `TAX-${String(index).padStart(4, "0")}`,
    taxCountry: "Spain",
    taxProvince: "Madrid",
    taxCity: "Madrid",
    taxAddress: `Tax Street ${index}`,
    transactions: [{ type: "recharge" }],
    insight: { marker: index },
    ...overrides,
  };
}

test("cashier list is capped and strips transaction-heavy details", () => {
  const memberships = Array.from({ length: 305 }, (_, index) => ({
    id: `member-${index}`,
    status: "active",
    transactions: [{ type: "recharge", note: "large history row" }],
    insight: { couponHistory: ["claim"] },
  }));

  const result = buildRedemptionCashierMembershipList(memberships, {
    mode: "cashier",
    limit: 300,
  });

  assert.equal(result.length, 300);
  assert.deepEqual(result[0]?.transactions, []);
  assert.equal(result[0]?.insight, undefined);
  assert.equal(memberships[0]?.transactions.length, 1);
  assert.notEqual(result[0], memberships[0]);
});

test("record views preserve matching transaction history", () => {
  const memberships = [
    {
      id: "recharge",
      status: "active",
      transactions: [{ type: "recharge", adjustmentKind: "" }],
      insight: { marker: true },
    },
    {
      id: "adjustment-only",
      status: "active",
      transactions: [{ type: "recharge", adjustmentKind: "manual_adjustment" }],
      insight: { marker: true },
    },
    {
      id: "redeem",
      status: "inactive",
      transactions: [{ type: "redeem", adjustmentKind: "" }],
      insight: { marker: true },
    },
  ];

  const rechargeRecords = buildRedemptionCashierMembershipList(memberships, {
    mode: "rechargeRecords",
    limit: 1,
  });
  const redemptionRecords = buildRedemptionCashierMembershipList(memberships, {
    mode: "records",
    limit: 1,
  });

  assert.deepEqual(rechargeRecords.map((membership) => membership.id), ["recharge"]);
  assert.deepEqual(redemptionRecords.map((membership) => membership.id), ["redeem"]);
  assert.equal(rechargeRecords[0]?.transactions.length, 1);
  assert.deepEqual(buildLeanRedemptionCashierMembership(memberships[0]!).transactions, []);
});

test("cashier search finds an eligible member beyond the initial 300-member list", () => {
  const memberships = Array.from({ length: 305 }, (_, index) => buildSearchMembership(index));

  const result = searchRedemptionCashierMemberships(memberships, {
    query: "  card-0304  ",
    canViewCustomerData: false,
    limit: 30,
  });

  assert.deepEqual(result.map((membership) => membership.id), ["member-304"]);
});

test("search without customer-data permission only accepts an exact member number", () => {
  const memberships = [
    buildSearchMembership(1, {
      memberNo: "CARD-SECRET-001",
      name: "Unique Private Name",
      email: "private.person@example.com",
      phone: "+34 612 345 678",
    }),
  ];

  for (const query of [
    "CARD-SECRET",
    "SECRET-001",
    "Unique Private",
    "private.person@example.com",
    "612 345",
  ]) {
    assert.deepEqual(
      searchRedemptionCashierMemberships(memberships, {
        query,
        canViewCustomerData: false,
        limit: 30,
      }),
      [],
    );
  }

  const exactResult = searchRedemptionCashierMemberships(memberships, {
    query: "  card-secret-001 ",
    canViewCustomerData: false,
    limit: 30,
  });
  assert.deepEqual(exactResult.map((membership) => membership.id), ["member-1"]);
});

test("search with customer-data permission supports case-insensitive partial PII matches", () => {
  const membership = buildSearchMembership(2, {
    memberNo: "MEMBER-ALPHA-002",
    nickname: "SunFlower",
    name: "Ada Lovelace",
    accountId: "Account-Visible-42",
    email: "Ada.Lovelace@Example.com",
    phone: "+34 699 123 456",
  });

  for (const query of ["alpha-00", "FLOWER", "lovel", "visible-4", "@EXAMPLE", "699 123"]) {
    const result = searchRedemptionCashierMemberships([membership], {
      query,
      canViewCustomerData: true,
      limit: 30,
    });
    assert.deepEqual(result.map((candidate) => candidate.id), ["member-2"]);
  }
});

test("authorized search preserves the former extended cashier search fields beyond the initial list", () => {
  const memberships = Array.from({ length: 305 }, (_, index) =>
    buildSearchMembership(index, {
      id: index === 304 ? "legacy-internal-id-304" : `member-${index}`,
      birthday: index === 304 ? "1988-12-24" : "1990-01-01",
      address: index === 304 ? "Compatibility Avenue 304" : `Customer Street ${index}`,
      taxNumber: index === 304 ? "OWNER-TAX-UNIQUE-304" : `TAX-${index}`,
    }),
  );

  for (const query of ["internal-id-304", "1988-12", "compatibility avenue", "tax-unique-304"]) {
    assert.deepEqual(
      searchRedemptionCashierMemberships(memberships, {
        query,
        canViewCustomerData: true,
        limit: 30,
      }).map((membership) => membership.id),
      ["legacy-internal-id-304"],
    );
    assert.deepEqual(
      searchRedemptionCashierMemberships(memberships, {
        query,
        canViewCustomerData: false,
        limit: 30,
      }),
      [],
    );
  }
});

test("cashier search excludes inactive and profile-hidden memberships", () => {
  const memberships = [
    buildSearchMembership(1, { memberNo: "MATCH-1", status: "inactive" }),
    buildSearchMembership(2, { memberNo: "MATCH-2", profileVisible: false }),
    buildSearchMembership(3, { memberNo: "MATCH-3" }),
  ];

  const result = searchRedemptionCashierMemberships(memberships, {
    query: "match",
    canViewCustomerData: true,
    limit: 30,
  });

  assert.deepEqual(result.map((membership) => membership.id), ["member-3"]);
});

test("cashier search respects its caller-provided limit and returns lean copies", () => {
  const memberships = Array.from({ length: 4 }, (_, index) =>
    buildSearchMembership(index, { nickname: "Shared Search Value" }),
  );

  const result = searchRedemptionCashierMemberships(memberships, {
    query: "shared search",
    canViewCustomerData: true,
    limit: 2,
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((membership) => membership.id), ["member-0", "member-1"]);
  assert.deepEqual(result[0]?.transactions, []);
  assert.equal(result[0]?.insight, undefined);
  assert.equal(memberships[0]?.transactions.length, 1);
  assert.notEqual(result[0], memberships[0]);
  assert.deepEqual(
    searchRedemptionCashierMemberships(memberships, {
      query: "shared search",
      canViewCustomerData: true,
      limit: 0,
    }),
    [],
  );
});
