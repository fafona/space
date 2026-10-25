import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { beginBookingSubmission, finishBookingSubmission, isBookingRequestNonce } from "./merchantBookingSubmission";

function storage() { const map = new Map<string,string>(); return { map, getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string,value: string) => { map.set(key,value); }, removeItem: (key: string) => { map.delete(key); } }; }
test("same uncertain submission reuses its random nonce across retries, without storing customer data", async () => {
  const local = storage(), payload = { customerName: "Private Name", email: "private@example.invalid" };
  const first = await beginBookingSubmission("test", payload, local, webcrypto as unknown as Crypto);
  const retry = await beginBookingSubmission("test", payload, local, webcrypto as unknown as Crypto);
  assert.equal(retry, first); assert.ok(isBookingRequestNonce(first));
  assert.ok(!JSON.stringify([...local.map.values()]).includes("Private Name"));
  assert.ok(!JSON.stringify([...local.map.values()]).includes("private@example.invalid"));
  assert.equal(await beginBookingSubmission("test", { ...payload, customerName: "Changed" }, local, webcrypto as unknown as Crypto), first);
  finishBookingSubmission("test", false, local);
  assert.equal(await beginBookingSubmission("test", payload, local, webcrypto as unknown as Crypto), first);
  finishBookingSubmission("test", true, local);
  assert.notEqual(await beginBookingSubmission("test", payload, local, webcrypto as unknown as Crypto), first);
});
test("malformed and non-v4 client request IDs are not accepted by the server", () => {
  for (const value of [null, "", "counter-1", "647e0a78-2eb8-1874-a9d6-ced4f5878450", "647e0a78-2eb8-4874-a9d6-ced4f5878450\r\n"]) assert.equal(isBookingRequestNonce(value), false);
});
test("blocked browser storage keeps the same ID in memory instead of duplicating submissions", async () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  const first = await beginBookingSubmission("blocked-test", { test: true }, blocked, webcrypto as unknown as Crypto);
  assert.equal(await beginBookingSubmission("blocked-test", { test: true }, blocked, webcrypto as unknown as Crypto), first);
  finishBookingSubmission("blocked-test", true, blocked);
});
