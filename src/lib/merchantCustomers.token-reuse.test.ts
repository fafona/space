import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, Script } from "node:vm";
import ts from "typescript";

// Observe the work count without adding hooks, counters or caches to runtime.
// This module has only erased type imports and executes with no IO dependencies.
function observedReducer() {
  const source = readFileSync(new URL("./merchantCustomers.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import (?!type )|\brequire\s*\(|\bimport\s*\(/m);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const marker = "function getMerchantCustomerIdentityTokens(profile) {";
  assert.equal(compiled.split(marker).length, 2, "instrument exactly the token function");
  const exports = {} as {
    buildMerchantCustomerDirectory: (input: unknown) => unknown[];
    readCalls: () => number;
  };
  const context = createContext({ exports });
  new Script(
    "let tokenCalls = 0;\n" + compiled.replace(marker, marker + " tokenCalls++; ") +
    "\nexports.readCalls = () => tokenCalls;",
  ).runInContext(context);
  return exports;
}

const siteId = "99990001";
const date = "2032-06-01T00:00:00.000Z";

function inputFor(count: number) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `synthetic-${index}`, siteId, name: `Customer ${index}`, email: `${index}@example.test`,
    createdAt: date, updatedAt: date,
  }));
  return {
    siteId,
    storedCustomers: rows.map((row) => ({ ...row, displayName: row.name, sources: ["manual"] })),
    memberships: rows.map((row) => ({ ...row, memberNo: `member-${row.id}`, joinedAt: date })),
    orders: rows.map((row) => ({ ...row, customer: { name: row.name, email: row.email }, totalAmount: 1 })),
    bookings: rows.map((row) => ({ ...row, customerName: row.name })),
  };
}

test("directory computes identity tokens once per normalized candidate, not once per consumer", () => {
  const observed = observedReducer();
  const input = inputFor(100);
  const original = JSON.stringify(input);
  const first = observed.buildMerchantCustomerDirectory(input);
  assert.equal(first.length, 100);
  assert.equal(observed.readCalls(), 400, "four sources, one token computation each");
  const second = observed.buildMerchantCustomerDirectory(input);
  assert.equal(observed.readCalls(), 800, "each call recomputes its own current identities");
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(JSON.stringify(input), original);

  const foreign = { ...input, siteId: "99990002" };
  assert.equal(observed.buildMerchantCustomerDirectory(foreign).length, 0);
  assert.equal(observed.readCalls(), 800, "foreign source rows do not participate");
});

test("dense and repeated aliases retain one token computation per candidate", () => {
  const observed = observedReducer();
  const input = inputFor(3);
  const dense = {
    ...input,
    storedCustomers: input.storedCustomers.map((row, index) => ({
      ...row,
      identityAliases: Array.from({ length: 40 }, (_, token) => `legacy:${index}:${token % 30}`),
    })),
  };
  const original = JSON.stringify(dense);
  assert.equal(observed.buildMerchantCustomerDirectory(dense).length, 3);
  assert.equal(observed.readCalls(), 12);
  assert.equal(JSON.stringify(dense), original);
});
