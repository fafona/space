import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import {
  buildMerchantCustomerDirectory,
  upsertMerchantCustomerProfiles,
  type MerchantCustomerDirectoryInput,
  type MerchantCustomerProfile,
} from "@/lib/merchantCustomers";
import * as reference from "../../scripts/fixtures/merchantCustomersReference";

const SITE = "10000000";
const FOREIGN = "20000000";
const NOW = "2026-09-28T12:00:00.000Z";
const DATE = "2026-07-01T10:00:00.000Z";
const REFERENCE_SHA256 = "1a44b96f9f901b2e7edab8f7faae24ea0745fa8312ef5815418e54a35fa420e4";

function fixedClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function profile(id: string, extra: Record<string, unknown> = {}): MerchantCustomerProfile {
  const normalized = reference.normalizeMerchantCustomerProfile({
    id, siteId: SITE, displayName: id, createdAt: DATE, updatedAt: DATE, ...extra,
  });
  assert.ok(normalized);
  return normalized;
}

function order(id: string, extra: Partial<MerchantOrderRecord> = {}): MerchantOrderRecord {
  return {
    id, siteId: SITE, siteName: "Synthetic", blockId: "products",
    createdAt: DATE, updatedAt: DATE, status: "completed",
    customer: { name: id, email: "", phone: "", note: "" }, items: [],
    totalQuantity: 1, totalAmount: 1, pricePrefix: "EUR",
    confirmedAt: null, completedAt: DATE, cancelledAt: null, printedAt: null, printCount: 0,
    ...extra,
  };
}

function booking(id: string, extra: Partial<MerchantBookingRecord> = {}): MerchantBookingRecord {
  return {
    id, siteId: SITE, siteName: "Synthetic", store: "Store", item: "Item",
    appointmentAt: DATE, title: "Title", customerName: id, email: "", phone: "", note: "",
    status: "confirmed", createdAt: DATE, updatedAt: DATE, ...extra,
  };
}

function membership(id: string, extra: Partial<MerchantMembershipRecord> = {}): MerchantMembershipRecord {
  return {
    id, siteId: SITE, siteName: "Synthetic", memberNo: `member-${id}`, serial: 1,
    accountId: "", userId: "", email: "", nickname: id, name: id, phone: "", avatarUrl: "",
    birthday: "", birthdayMonthDayOnly: false, gender: "", country: "Spain", province: "Sevilla",
    city: "Sevilla", address: "", taxName: "", taxNumber: "", taxCountry: "", taxProvince: "",
    taxCity: "", taxAddress: "", allergens: [], pointBalance: 0, balanceAmount: 0, growthValue: 0,
    levelId: "", transactions: [], status: "active", joinedAt: DATE, leftAt: null, updatedAt: DATE,
    ...extra,
  };
}

function sameDirectory(input: MerchantCustomerDirectoryInput, context: string) {
  const before = structuredClone(input);
  const oldInput = freeze(structuredClone(input));
  const newInput = freeze(structuredClone(input));
  const expected = reference.buildMerchantCustomerDirectory(oldInput);
  const actual = buildMerchantCustomerDirectory(newInput);
  assert.deepEqual(actual, expected, `${context}: complete directory result`);
  // JSON comparison additionally locks property/array ordering and serialized output.
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${context}: serialized result`);
  assert.deepEqual(oldInput, before, `${context}: reference input not mutated`);
  assert.deepEqual(newInput, before, `${context}: optimized input not mutated`);
  assert.deepEqual(input, before, `${context}: caller input not mutated`);
  return actual;
}

function sameUpsert(
  existing: unknown,
  incoming: unknown,
  options: Parameters<typeof upsertMerchantCustomerProfiles>[2],
  context: string,
) {
  const before = structuredClone({ existing, incoming, options });
  const oldInput = freeze(structuredClone(before));
  const newInput = freeze(structuredClone(before));
  const expected = reference.upsertMerchantCustomerProfiles(oldInput.existing, oldInput.incoming, oldInput.options);
  const actual = upsertMerchantCustomerProfiles(newInput.existing, newInput.incoming, newInput.options);
  assert.deepEqual(actual, expected, `${context}: complete upsert result`);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${context}: serialized upsert result`);
  assert.deepEqual(oldInput, before, `${context}: reference inputs not mutated`);
  assert.deepEqual(newInput, before, `${context}: optimized inputs not mutated`);
  return actual;
}

test("frozen reference is the complete pinned b4a7b77a source, with no runtime imports", () => {
  const file = readFileSync(new URL("../../scripts/fixtures/merchantCustomersReference.ts", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n");
  assert.match(file, /Source: b4a7b77a9f93d08cb9640da3d0b33ae2abe092d1:src\/lib\/merchantCustomers\.ts/);
  const marker = "// BEGIN FROZEN SOURCE\n";
  assert.equal(file.split(marker).length, 2);
  const original = file.slice(file.indexOf(marker) + marker.length);
  assert.equal(createHash("sha256").update(original).digest("hex"), REFERENCE_SHA256);
  assert.equal((original.match(/^import type /gm) ?? []).length, 3);
  assert.doesNotMatch(original, /^import (?!type )|\brequire\s*\(|\bimport\s*\(/m);
});

test("empty, invalid site, foreign-only and stored-container inputs preserve exact results", (t) => {
  fixedClock(t);
  const inputs: MerchantCustomerDirectoryInput[] = [
    { siteId: "" }, { siteId: "   " }, { siteId: SITE },
    { siteId: SITE, storedCustomers: null },
    { siteId: SITE, storedCustomers: { customers: [null, {}, { id: "unfilled" }] } },
    {
      siteId: SITE, storedCustomers: [profile("foreign", { siteId: FOREIGN })],
      orders: [order("foreign", { siteId: FOREIGN })],
      bookings: [booking("foreign", { siteId: FOREIGN })],
      memberships: [membership("foreign", { siteId: FOREIGN })],
    },
  ];
  inputs.forEach((input, index) => sameDirectory(input, `empty/foreign ${index}`));
});

test("transitive four-source bridges merge and removing the local bridge splits identities", (t) => {
  fixedClock(t);
  const alpha = profile("manual-alpha", { email: "alpha@example.test", tags: ["manual"], customFields: { priority: "manual" }, sources: ["manual"] });
  const beta = membership("member-beta", { email: "beta@example.test", accountId: "account-beta" });
  const localBridge = order("bridge", {
    customerAccountId: "account-beta",
    customer: { name: "Bridge", email: "ALPHA@example.test", phone: "", note: "Bridge note" },
  });
  const input: MerchantCustomerDirectoryInput = {
    siteId: SITE, storedCustomers: [alpha], memberships: [beta],
    orders: [localBridge, order("foreign-bridge", { ...localBridge, id: "foreign-bridge", siteId: FOREIGN })],
    bookings: [booking("beta-booking", { email: "beta@example.test", note: "Beta note" })],
  };
  const joined = sameDirectory(input, "four-source joined");
  assert.equal(joined.length, 1);
  assert.equal(joined[0].id, "manual-alpha");
  assert.equal(joined[0].displayName, "manual-alpha");
  assert.deepEqual(new Set(joined[0].sources), new Set(["manual", "membership", "order", "booking"]));
  assert.equal(joined[0].activity.orderCount, 1);
  assert.equal(joined[0].activity.bookingCount, 1);
  const split = sameDirectory({ ...input, orders: input.orders!.slice(1) }, "local bridge removed");
  assert.equal(split.length, 2, "foreign bridge cannot prevent the split");
});

test("stored aliases keep insertion order and 24-item cap while derived aliases use sorted identity order", (t) => {
  fixedClock(t);
  const orders = Array.from({ length: 35 }, (_, index) => order(`alias-${index}`, {
    customerAccountId: "shared-account",
    customer: { name: `Alias ${index}`, phone: "", email: `z${String(34 - index).padStart(2, "0")}@example.test`, note: "" },
  }));
  const manual = profile("manual-aliases", {
    accountId: "shared-account", email: "zz-manual@example.test",
    identityAliases: Array.from({ length: 30 }, (_, index) => `legacy:${String(29 - index).padStart(2, "0")}`),
  });
  const [stored] = sameDirectory({ siteId: SITE, storedCustomers: [manual], orders }, "stored aliases");
  assert.equal(stored.id, "manual-aliases");
  assert.equal(stored.identityAliases.length, 24);
  assert.deepEqual(stored.identityAliases.slice(0, 4), ["account:shared-account", "email:zz-manual@example.test", "legacy:29", "legacy:28"]);
  assert.notDeepEqual(stored.identityAliases, [...stored.identityAliases].sort());
  const [derived] = sameDirectory({ siteId: SITE, orders }, "derived aliases");
  assert.match(derived.id, /^customer-derived-/);
  assert.equal(derived.identityAliases.length, 24);
  assert.deepEqual(derived.identityAliases, [...derived.identityAliases].sort());
  assert.equal(derived.identityAliases[0], "account:shared-account");
  assert.equal(derived.identityAliases[23], "email:z22@example.test");
});

test("NFKC, tax and phone normalization, historical aliases and address fallback preserve identity rules", (t) => {
  fixedClock(t);
  const input: MerchantCustomerDirectoryInput = {
    siteId: SITE,
    storedCustomers: [
      profile("unicode", { accountId: " ＡＢＣ ", email: "new@example.test", identityAliases: ["email:old@example.test"] }),
      profile("tax", { tax: { number: " X-12_3.4 " } }),
      profile("address-a", { displayName: " ＡＮＡ ", address: { postalCode: " 41007 ", line1: " Calle   Uno " } }),
      profile("address-b", { displayName: "ana", address: { postalCode: "41007", line1: "calle uno" } }),
    ],
    memberships: [membership("tax-member", { taxNumber: "x1234", phone: "+34 600 000 001" })],
    orders: [
      order("unicode", { customerAccountId: "abc" }),
      order("old-email", { customer: { name: "Alias", email: "OLD@EXAMPLE.TEST", phone: "", note: "" } }),
      order("phone", { customer: { name: "Phone", email: "", phone: "0034 600 000 001", note: "" } }),
      order("name-only-a"), order("name-only-b", { customer: { name: "name-only-a", email: "", phone: "", note: "" } }),
    ],
  };
  const result = sameDirectory(input, "normalization and fallback");
  assert.equal(result.length, 5);
  assert.equal(result.find((item) => item.id === "unicode")!.activity.orderCount, 2);
  assert.equal(result.find((item) => item.id === "tax")!.activity.orderCount, 1);
});

test("24-token cap preserves excluded versus included identity bridges", (t) => {
  fixedClock(t);
  const outside = order("outside", { customer: { name: "Outside", email: "outside@example.test", phone: "", note: "" } });
  const stored = {
    id: "capped", siteId: SITE, accountId: "cap-account", displayName: "Capped",
    createdAt: DATE, updatedAt: DATE,
    identityAliases: [
      ...Array.from({ length: 23 }, (_, index) => `legacy:${index}`),
      "email:outside@example.test",
    ],
  };
  const separated = sameDirectory({ siteId: SITE, storedCustomers: [stored], orders: [outside] }, "bridge outside token cap");
  assert.equal(separated.length, 2, "account token plus 23 aliases excludes the 25th token");
  const shortened = { ...stored, identityAliases: stored.identityAliases.slice(1) };
  const joined = sameDirectory({ siteId: SITE, storedCustomers: [shortened], orders: [outside] }, "bridge inside token cap");
  assert.equal(joined.length, 1);
  assert.equal(joined[0].id, "capped");
});

test("equal timestamps, invalid/raw activity dates and default timestamps preserve ordering and fallback", (t) => {
  fixedClock(t);
  const dates = [DATE, DATE, "not-a-date", "", "2026-07-01T12:00:00+02:00", "2024-02-30", "1969-12-31T23:59:59Z"];
  const input: MerchantCustomerDirectoryInput = {
    siteId: SITE,
    storedCustomers: [{ id: "fallback", siteId: SITE, displayName: "Fallback", createdAt: "invalid", updatedAt: "" }],
    orders: dates.map((createdAt, index) => order(`dated-${index}`, {
      createdAt, updatedAt: index % 2 ? "invalid" : DATE,
      customerAccountId: index < 2 ? "same-time" : `date-${index}`,
      customer: { name: `dated-${index}`, email: "", phone: "", note: `note-${index}` },
    })),
    bookings: dates.map((createdAt, index) => booking(`date-booking-${index}`, {
      createdAt, updatedAt: "invalid", customerAccountId: index < 2 ? "same-time" : `date-${index}`,
      note: `booking-note-${index}`,
    })),
  };
  const result = sameDirectory(input, "timestamp fallback");
  const fallback = result.find((item) => item.id === "fallback")!;
  assert.equal(fallback.createdAt, NOW);
  assert.equal(fallback.updatedAt, NOW);
  const tied = result.find((item) => item.accountId === "same-time")!;
  assert.equal(tied.displayName, "dated-0");
  assert.equal(tied.activity.lastOrderNote, "note-0");
  assert.equal(tied.activity.lastBookingNote, "booking-note-0");
  assert.equal(result.find((item) => item.accountId === "date-2")!.activity.lastActivityAt, "not-a-date");
});

test("activity totals retain source insertion, per-addition rounding and note selection", (t) => {
  fixedClock(t);
  const amounts = [1.005, 0.005, -1, 0.105, 0.1, 0.2, 999.999];
  const labels = ["USD", "EUR", "USD", "", "JPY", "EUR", "USD"];
  const input: MerchantCustomerDirectoryInput = {
    siteId: SITE,
    orders: amounts.map((totalAmount, index) => order(`amount-${index}`, {
      totalAmount, pricePrefix: labels[index], customerGuestHash: "same-guest",
      customer: { name: "", email: "", phone: "", note: index === 0 ? "first tie" : `note-${index}` },
    })),
    bookings: [booking("activity", { customerGuestHash: "same-guest", customerName: "", note: "booking note" })],
  };
  const [result] = sameDirectory(input, "totals and notes");
  assert.equal(result.activity.orderCount, amounts.length);
  assert.equal(result.activity.bookingCount, 1);
  assert.deepEqual(result.activity.orderTotals.map((item) => item.label), ["USD", "EUR", "JPY"]);
  assert.equal(result.activity.lastOrderNote, "first tie");
  assert.equal(result.activity.lastBookingNote, "booking note");
});

function randomSource(seed: number) {
  let state = seed >>> 0;
  return (bound: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % bound;
  };
}

function generatedInput(seed: number): MerchantCustomerDirectoryInput {
  const next = randomSource(seed);
  const dates = [DATE, "2026-06-01T00:00:00Z", "2026-07-01T12:00:00+02:00", "", "invalid"];
  const identity = () => {
    const n = next(9);
    return {
      accountId: next(3) ? "" : `account-${n}`, authUserId: next(3) ? "" : `user-${n}`,
      guestHash: next(4) ? "" : `guest-${n}`, phone: next(3) ? `+34 600 00${n} 001` : "",
      email: next(3) ? `person${n}@example.test` : "", displayName: `Person ${next(5)}`,
    };
  };
  const stored = Array.from({ length: 1 + next(8) }, (_, index) => {
    const person = identity();
    return {
      id: `manual-${seed}-${index}`, siteId: next(7) ? SITE : FOREIGN, ...person,
      referenceCode: next(3) ? "" : `ref-${next(5)}`, memberNo: next(4) ? "" : `member-${next(5)}`,
      identityAliases: Array.from({ length: next(32) }, () => `email:person${next(9)}@example.test`),
      tags: [`tag-${next(3)}`, `tag-${next(3)}`], allergens: [`allergen-${next(3)}`],
      customFields: { priority: `manual-${index}`, [`field-${next(4)}`]: `value-${next(5)}` },
      tax: { number: next(3) ? "" : `X-${next(5)}` },
      address: { line1: `Street ${next(4)}`, postalCode: `4100${next(3)}` },
      sources: next(2) ? ["manual"] : ["import"], status: next(3) ? "active" : "archived",
      createdAt: dates[next(dates.length)], updatedAt: dates[next(dates.length)],
    };
  });
  const orders = Array.from({ length: 1 + next(28) }, (_, index) => {
    const person = identity();
    return order(`order-${seed}-${index}`, {
      siteId: next(8) ? SITE : FOREIGN, customerAccountId: person.accountId,
      customerUserId: person.authUserId, customerGuestHash: person.guestHash,
      customerLoginEmail: `login${next(5)}@example.test`,
      customer: { name: person.displayName, email: person.email, phone: person.phone, note: `order note ${next(7)}` },
      createdAt: dates[next(dates.length)], updatedAt: dates[next(dates.length)],
      totalAmount: (next(20001) - 10000) / 1000, pricePrefix: ["EUR", "USD", "", "JPY"][next(4)],
    });
  });
  const bookings = Array.from({ length: 1 + next(18) }, (_, index) => {
    const person = identity();
    return booking(`booking-${seed}-${index}`, {
      siteId: next(8) ? SITE : FOREIGN, customerAccountId: person.accountId,
      customerUserId: person.authUserId, customerGuestHash: person.guestHash,
      customerName: person.displayName, email: person.email, phone: person.phone, note: `booking note ${next(7)}`,
      createdAt: dates[next(dates.length)], updatedAt: dates[next(dates.length)],
      store: `store-${next(4)}`, item: `item-${next(5)}`, title: `title-${next(4)}`,
    });
  });
  const memberships = Array.from({ length: 1 + next(8) }, (_, index) => {
    const person = identity();
    return membership(`membership-${seed}-${index}`, {
      siteId: next(8) ? SITE : FOREIGN, accountId: person.accountId, userId: person.authUserId,
      name: person.displayName, email: person.email, phone: person.phone,
      memberNo: `member-${next(5)}`, taxNumber: next(3) ? "" : `X${next(5)}`,
      joinedAt: dates[next(dates.length)], updatedAt: dates[next(dates.length)],
      allergens: [`allergen-${next(3)}`], pointBalance: next(300), balanceAmount: next(50),
    });
  });
  return { siteId: SITE, storedCustomers: seed % 2 ? stored : { customers: stored }, orders, bookings, memberships };
}

test("256 reproducible mixed-source cases preserve complete output and immutable inputs", (t) => {
  fixedClock(t);
  for (let seed = 1; seed <= 256; seed += 1) {
    sameDirectory(generatedInput(seed), `seed ${seed}`);
  }
});

test("directory results do not retain stale identities across repeated calls and merchant changes", (t) => {
  fixedClock(t);
  const input = generatedInput(93);
  const before = sameDirectory(input, "first call");
  assert.deepEqual(sameDirectory(input, "repeat call"), before);
  const originalInput = structuredClone(input);
  const originalResult = structuredClone(before);
  before[0].identityAliases.push("email:caller-mutated@example.test");
  assert.deepEqual(input, originalInput, "mutating a returned alias list must not mutate source records");
  assert.deepEqual(sameDirectory(input, "after returned aliases mutated"), originalResult);
  const changed = structuredClone(input);
  for (const item of changed.orders ?? []) {
    item.customer.email = `${item.id}@different.test`;
    item.customer.phone = "";
    item.customerAccountId = "";
    item.customerUserId = "";
    item.customerGuestHash = "";
  }
  sameDirectory(changed, "changed identities");
  sameDirectory({ ...changed, siteId: FOREIGN }, "different merchant");
  assert.deepEqual(sameDirectory(input, "original restored"), originalResult);
});

test("shared upsert keeps default, false and true replaceEmpty semantics including duplicate merges", (t) => {
  fixedClock(t);
  const existing = [
    profile("target", { email: "old@example.test", phone: "+34600000001", identityAliases: ["email:historic@example.test"],
      address: { line1: "Old address" }, tax: { number: "TAX1" }, tags: ["VIP"], allergens: ["Milk"], customFields: { keep: "old" } }),
    profile("duplicate", { email: "alias@example.test", tags: ["duplicate"], customFields: { other: "duplicate" } }),
  ];
  const incoming = { id: "target", displayName: "Changed", email: "new@example.test", phone: "", tags: [], allergens: [],
    address: {}, tax: {}, customFields: {}, identityAliases: ["email:alias@example.test"], sources: ["manual"] };
  const results = [undefined, false, true].map((replaceEmpty) => sameUpsert(existing, incoming,
    { siteId: SITE, source: "manual", replaceEmpty, now: NOW }, `replaceEmpty ${replaceEmpty}`));
  assert.deepEqual(results[0], results[1]);
  assert.notDeepEqual(results[1], results[2]);
  assert.equal(results[0].customers.length, 1);
  assert.equal(results[0].customers[0].address.line1, "Old address");
  assert.equal(results[2].customers[0].address.line1, "");
  for (const result of results) {
    assert.ok(result.customers[0].identityAliases.includes("email:old@example.test"));
    assert.ok(result.customers[0].identityAliases.includes("email:historic@example.test"));
    assert.ok(result.customers[0].identityAliases.includes("email:alias@example.test"));
  }
});

test("64 seeded shared-upsert cases match the reference in all three replacement modes", (t) => {
  fixedClock(t);
  for (let seed = 1; seed <= 64; seed += 1) {
    const input = generatedInput(seed);
    const existing = Array.isArray(input.storedCustomers)
      ? input.storedCustomers : (input.storedCustomers as { customers: unknown[] }).customers;
    const incoming = [
      { ...(existing[0] as Record<string, unknown>), email: `updated${seed}@example.test`, tags: [], allergens: [], address: {}, customFields: {} },
      { id: `created-${seed}`, displayName: "New", guestHash: `created-guest-${seed}`, createdAt: DATE, updatedAt: DATE },
      { id: `skipped-${seed}`, displayName: "", email: "", phone: "" },
    ];
    for (const replaceEmpty of [undefined, false, true]) {
      sameUpsert(existing, incoming, { siteId: SITE, source: "import", replaceEmpty, now: NOW }, `upsert seed ${seed}, mode ${replaceEmpty}`);
    }
  }
});
