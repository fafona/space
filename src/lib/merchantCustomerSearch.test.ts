import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyMerchantCustomerProfile,
  filterMerchantCustomerDirectory,
  MERCHANT_CUSTOMER_SOURCES,
  type MerchantCustomerDirectoryItem,
} from "@/lib/merchantCustomers";
import {
  compileMerchantCustomerSearch,
  MERCHANT_CUSTOMER_SEARCH_CACHE_CODE_UNITS,
  type MerchantCustomerSearchFilter,
} from "@/lib/merchantCustomerSearch";
import { toMerchantCustomerListItem } from "@/lib/merchantCustomerListView";

function customer(overrides: Partial<MerchantCustomerDirectoryItem> = {}): MerchantCustomerDirectoryItem {
  return {
    ...createEmptyMerchantCustomerProfile("10000000"),
    id: "same-id",
    activity: { orderCount: 0, bookingCount: 0, firstActivityAt: null, lastActivityAt: null,
      lastOrderAt: null, lastBookingAt: null, lastOrderNote: "", lastBookingNote: "", orderTotals: [] },
    incomplete: false,
    ...overrides,
  };
}
function parity(rows: MerchantCustomerDirectoryItem[], inputs: MerchantCustomerSearchFilter[]) {
  const before = JSON.stringify(rows);
  const corpus = compileMerchantCustomerSearch(rows);
  const listRows = rows.map(toMerchantCustomerListItem);
  const listCorpus = compileMerchantCustomerSearch(listRows);
  for (const input of inputs) {
    const expected = filterMerchantCustomerDirectory(rows, input);
    const actual = corpus.filter(input);
    assert.deepEqual(actual, expected, JSON.stringify(input));
    actual.forEach((row, ordinal) => assert.equal(row, expected[ordinal], "preserve original object references"));
    assert.notEqual(actual, rows, "return a new filtered array even without a query");
    const listMatches = listCorpus.filter(input);
    assert.deepEqual(listMatches, expected.map(toMerchantCustomerListItem), "list view searches all the same profile fields");
    assert.deepEqual(listMatches, listRows.filter((row, index) => expected.includes(rows[index])), "preserve occurrence order");
    listMatches.forEach((row) => assert.ok(listRows.includes(row), "list search returns the original row references"));
  }
  assert.equal(JSON.stringify(rows), before, "search never mutates its loaded snapshot");
}
function countNormalization() {
  const original = String.prototype.normalize;
  let count = 0;
  String.prototype.normalize = function (this: string, form?: string) { count += 1; return original.call(this, form); };
  return { count: () => count, restore: () => { String.prototype.normalize = original; } };
}

test("compiled search matches legacy field coverage, source/status intersections, duplicates and original order", () => {
  const shared = customer({ displayName: "ＦＯＯ\tBar", sources: ["order", "booking"], status: "archived" });
  const rows = [
    customer({ referenceCode: "ref-marker", memberNo: "member-marker", displayName: "Café Σ İstanbul", sources: ["manual"] }),
    shared,
    customer({ phone: "+34 600-111", email: "USER@EXAMPLE.TEST", sources: ["membership"] }),
    customer({ address: { country: "country-marker", province: "province-marker", city: "city-marker",
      postalCode: "postal-marker", line1: "lineone-marker", line2: "linetwo-marker" }, sources: ["import"] }),
    customer({ tax: { country: "not-searched-tax-country", province: "not-searched-tax-province", city: "not-searched-tax-city",
      name: "taxname-marker", number: "taxnumber-marker", address: "taxaddress-marker" }, sources: ["order"] }),
    customer({ notes: "notes-marker", tags: ["tag-one", "tag-two"], customFields: { "field-key": "field-value" }, sources: ["booking"] }),
    customer({ displayName: "No sources", sources: [] }),
    shared,
  ];
  const queries = [undefined, "", "  \n", "foo bar", "café", "Σ", "İSTANBUL", "cafe", "ref-marker",
    "member-marker", "+34", "user@example", "country-marker", "province-marker", "city-marker",
    "postal-marker", "lineone-marker", "linetwo-marker", "taxname-marker", "taxnumber-marker",
    "taxaddress-marker", "notes-marker", "tag-one tag-two", "field-key field-value", "%", "_",
    "not-searched-tax-country", "not-searched-tax-province", "not-searched-tax-city"];
  const inputs: MerchantCustomerSearchFilter[] = [];
  for (const query of queries) for (const source of [undefined, "all", ...MERCHANT_CUSTOMER_SOURCES] as const) {
    for (const status of [undefined, "all", "active", "archived"] as const) inputs.push({ query, source, status });
  }
  parity(rows, inputs);
  assert.deepEqual(compileMerchantCustomerSearch(rows).filter({ query: "foo bar" }), [shared, shared]);
});

test("literal cross-field matching keeps empty separators and never searches unrelated profile/activity fields", () => {
  const included = customer({ referenceCode: "end", memberNo: "start", displayName: "name", notes: "100%_literal" });
  const gap = customer({ referenceCode: "end", displayName: "start", notes: "anything" });
  const hidden = customer({ accountId: "hidden-account", authUserId: "hidden-auth", guestHash: "hidden-guest",
    birthday: "hidden-birthday", gender: "hidden-gender", allergens: ["hidden-allergen"], identityAliases: ["hidden-alias"] });
  hidden.activity.lastOrderNote = "hidden-order-note";
  hidden.activity.lastBookingNote = "hidden-booking-note";
  const corpus = compileMerchantCustomerSearch([included, gap, hidden]);
  assert.deepEqual(corpus.filter({ query: "end start" }), [included]);
  assert.deepEqual(corpus.filter({ query: "%_" }), [included]);
  assert.deepEqual(corpus.filter({ query: "hidden" }), []);
  assert.deepEqual(corpus.filter({ query: "10000000" }), [], "site id is not a search field");
  parity([included, gap, hidden], ["end start", "end  start", "%", "_", "hidden", "10000000"]
    .map((query) => ({ query })));
});

test("UTF-16 truncation happens before normalization for each field and query, including expanded and split characters", () => {
  const rows = [
    customer({ displayName: "a".repeat(319) + "ﬃ" + "TAIL" }),
    customer({ notes: "b".repeat(319) + "😀" + "TAIL" }),
    customer({ notes: "  spaced\n\twords\u00a0end  " }),
    customer({ displayName: "a".repeat(320) + "not-searched-tail" }),
  ];
  parity(rows, ["ffi", "a".repeat(319) + "ﬃ", "a".repeat(319) + "ﬃTAIL", "\ud83d", "😀",
    "b".repeat(319) + "😀", "not-searched-tail", "spaced words end", "  spaced\twords\nend  "]
    .map((query) => ({ query })));
  const corpus = compileMerchantCustomerSearch(rows);
  assert.deepEqual(corpus.filter({ query: "ffi" }), [rows[0]]);
  assert.deepEqual(corpus.filter({ query: "😀" }), []);
  assert.deepEqual(corpus.filter({ query: "\ud83d" }), [rows[1]]);
});

test("tags and custom fields are each joined before their single 320-unit truncation; key iteration order stays exact", () => {
  const rows = [
    customer({ tags: ["t".repeat(319), "tag-tail"] }),
    customer({ customFields: { first: "v".repeat(313), "second-key": "second-value" } }),
    customer({ customFields: { "10": "ten", "2": "two", alpha: "alpha-value" } }),
  ];
  parity(rows, ["tag-tail", "t".repeat(319), "second-key", "second-value", "first", "2 two 10 ten alpha alpha-value"]
    .map((query) => ({ query })));
  assert.deepEqual(compileMerchantCustomerSearch(rows).filter({ query: "tag-tail" }), []);
  assert.deepEqual(compileMerchantCustomerSearch(rows).filter({ query: "second-key" }), []);
});

test("empty queries and excluded rows never materialize haystacks; repeated keystrokes reuse each eligible occurrence", () => {
  const rows = [customer({ displayName: "Alpha", sources: ["order"] }), customer({ displayName: "Beta", sources: ["booking"] })];
  const counter = countNormalization();
  try {
    const corpus = compileMerchantCustomerSearch(rows);
    assert.equal(counter.count(), 0);
    corpus.filter();
    corpus.filter({ query: " \t ", source: "order" });
    assert.equal(counter.count(), 2, "only normalize the two queries");
    corpus.filter({ query: "a", source: "order" });
    assert.equal(counter.count(), 20, "one query plus exactly seventeen fields for one eligible row");
    corpus.filter({ query: "al", source: "order" });
    corpus.filter({ query: "alpha", source: "order" });
    assert.equal(counter.count(), 22);
    corpus.filter({ query: "b", source: "booking" });
    assert.equal(counter.count(), 40);
    corpus.filter({ query: "a" });
    assert.equal(counter.count(), 41);
    const replacement = compileMerchantCustomerSearch([...rows]);
    replacement.filter({ query: "a" });
    assert.equal(counter.count(), 76, "a new response snapshot cannot reuse old derived strings");
  } finally { counter.restore(); }
});

test("corpora are independent for array membership, new response objects and equal customer IDs across merchants", () => {
  const first = customer({ displayName: "First" });
  const input = [first];
  const corpus = compileMerchantCustomerSearch(input);
  input.push(customer({ displayName: "Appended" }));
  assert.deepEqual(corpus.filter(), [first], "the corpus owns array membership for its snapshot");
  const second = customer({ displayName: "Second", siteId: "20000000" });
  const replacement = compileMerchantCustomerSearch([second]);
  assert.deepEqual(corpus.filter({ query: "first" }), [first]);
  assert.deepEqual(replacement.filter({ query: "first" }), []);
  assert.deepEqual(replacement.filter({ query: "second" }), [second]);
  const sparse = [first, , first] as MerchantCustomerDirectoryItem[];
  parity(sparse, [{}, { query: "first" }]);
});

test("cache budget falls back to full legacy matching instead of truncating or dropping overflow rows", () => {
  const text = "x".repeat(320);
  const rows = Array.from({ length: 1000 }, (_, index) => customer({
    referenceCode: text, memberNo: text, displayName: text, phone: text, email: text,
    address: { country: text, province: text, city: text, postalCode: text, line1: text, line2: text },
    tax: { name: text, number: text, address: text, country: "", province: "", city: "" },
    notes: text, tags: [text], customFields: { key: text }, id: String(index),
  }));
  const rowUnits = 17 * 320 + 16;
  assert.ok(rows.length * rowUnits > MERCHANT_CUSTOMER_SEARCH_CACHE_CODE_UNITS);
  const corpus = compileMerchantCustomerSearch(rows);
  const counter = countNormalization();
  try {
    assert.equal(corpus.filter({ query: "x" }).length, rows.length);
    const firstCount = counter.count();
    assert.equal(corpus.filter({ query: "xx" }).length, rows.length);
    const uncached = rows.length - Math.floor(MERCHANT_CUSTOMER_SEARCH_CACHE_CODE_UNITS / rowUnits);
    assert.equal(counter.count() - firstCount, 1 + uncached * 17, "only overflow strings are recomputed");
  } finally { counter.restore(); }
  assert.deepEqual(corpus.filter({ query: "key" }), filterMerchantCustomerDirectory(rows, { query: "key" }));
});
