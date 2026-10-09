import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantEmployeeRootLeaveGuard } from "./merchantEmployeeRootLeaveGuard";
import type { MerchantEmployeeWorkspaceRoot } from "./merchantBusinessCapabilities";

const businessRoots: MerchantEmployeeWorkspaceRoot[] = ["orders", "bookings", "members", "redemptions", "conversations"];

test("only explicit departure from collaboration invokes the registered guard", () => {
  const slot = createMerchantEmployeeRootLeaveGuard("site:employee:epoch-1:collaboration");
  let prompts = 0;
  slot.register(() => { prompts++; return false; });
  assert.equal(slot.allowUserRootChange("collaboration", "collaboration"), true);
  for (const current of [null, ...businessRoots]) {
    assert.equal(slot.allowUserRootChange(current, "collaboration"), true);
    for (const next of businessRoots) assert.equal(slot.allowUserRootChange(current, next), true);
  }
  assert.equal(prompts, 0);
  for (const next of businessRoots) assert.equal(slot.allowUserRootChange("collaboration", next), false);
  assert.equal(prompts, businessRoots.length);
});

test("cancel preserves navigation while acceptance permits exactly one transition", () => {
  const slot = createMerchantEmployeeRootLeaveGuard("scope"), transitions: string[] = [];
  let confirmed = false, prompts = 0;
  slot.register(() => { prompts++; return confirmed; });
  const select = (next: MerchantEmployeeWorkspaceRoot) => {
    if (!slot.allowUserRootChange("collaboration", next)) return;
    transitions.push(next);
  };
  select("orders"); assert.deepEqual(transitions, []);
  confirmed = true; select("orders");
  assert.deepEqual(transitions, ["orders"]); assert.equal(prompts, 2);
});

test("registration callback remains stable while the current manager updates or removes its guard", () => {
  const slot = createMerchantEmployeeRootLeaveGuard("scope"), register = slot.register;
  assert.equal(slot.allowUserRootChange("collaboration", "orders"), true);
  register(() => false); assert.equal(slot.allowUserRootChange("collaboration", "orders"), false);
  register(() => true); assert.equal(slot.allowUserRootChange("collaboration", "orders"), true);
  register(null); assert.equal(slot.allowUserRootChange("collaboration", "orders"), true);
  assert.equal(slot.register, register);
});

test("old authorization callback and cleanup cannot overwrite or erase a replacement guard", () => {
  const old = createMerchantEmployeeRootLeaveGuard("site:employee:epoch-1:collaboration");
  const current = createMerchantEmployeeRootLeaveGuard("site:employee:epoch-2:collaboration");
  let oldPrompts = 0, currentPrompts = 0;
  old.register(() => { oldPrompts++; return true; });
  current.register(() => { currentPrompts++; return false; });
  old.clear(); old.register(null); old.register(() => { oldPrompts++; return true; });
  assert.equal(current.allowUserRootChange("collaboration", "members"), false);
  assert.equal(oldPrompts, 0); assert.equal(currentPrompts, 1);
});

test("same-epoch re-entry also owns a fresh slot and safe cleanup never prompts", () => {
  const old = createMerchantEmployeeRootLeaveGuard("same-scope");
  const reentered = createMerchantEmployeeRootLeaveGuard("same-scope");
  let prompts = 0;
  old.register(() => { prompts++; return false; });
  reentered.register(() => { prompts++; return false; });
  old.clear(); old.register(null);
  assert.equal(prompts, 0);
  assert.equal(reentered.allowUserRootChange("collaboration", "orders"), false);
  reentered.clear();
  assert.equal(reentered.allowUserRootChange("collaboration", "orders"), true);
  assert.equal(prompts, 1);
});

test("guard failures do not accidentally authorize a user transition", () => {
  const slot = createMerchantEmployeeRootLeaveGuard("scope");
  slot.register(() => { throw Error("guard failed"); });
  assert.throws(() => slot.allowUserRootChange("collaboration", "orders"), /guard failed/);
  assert.equal(slot.allowUserRootChange("collaboration", "collaboration"), true);
  // Forced remount/revocation cleanup has no guard invocation and cannot be vetoed.
  assert.doesNotThrow(slot.clear);
  assert.equal(slot.allowUserRootChange("collaboration", "orders"), true);
});
