import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformSnapshotWriteMode, PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID } from "./platformSnapshotAtomicMode.server";

test("atomic writes are an exact explicit opt-in, never inferred from production or other rollout flags", () => {
  for (const value of [undefined, "", "off"]) assert.equal(getPlatformSnapshotWriteMode({ FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE: value }), "off");
  assert.equal(getPlatformSnapshotWriteMode({ FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE: "atomic" }), "atomic");
  assert.equal(getPlatformSnapshotWriteMode({ NODE_ENV: "production", MERCHANT_STAFF_BUSINESS_RBAC_MODE: "enforce" }), "off");
});
test("misspelled, whitespace, booleans and legacy mode aliases fail closed", () => {
  for (const value of ["ATOMIC", " atomic", "atomic ", "OFF", " off ", "true", "false", "1", "0", "legacy", "shadow", "maintenance"])
    assert.throws(() => getPlatformSnapshotWriteMode({ FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE: value }), { message: PLATFORM_SNAPSHOT_ATOMIC_CONFIGURATION_INVALID });
});
