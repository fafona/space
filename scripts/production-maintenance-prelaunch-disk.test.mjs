import test from "node:test";
import assert from "node:assert/strict";
import { PRELAUNCH_MIN_FREE_BYTES, validatePrelaunchDiskHeadroom, assertPrelaunchDiskHeadroom } from "./production-maintenance-prelaunch-disk.mjs";
const good = () => ({ bsize: 4096n, blocks: 10_000_000n, bfree: 2_000_000n, bavail: 1_500_000n });
test("prelaunch disk preserves 5 GiB / 90% gates and rejects invalid observations", () => {
  assert.equal(validatePrelaunchDiskHeadroom(good()), true);
  const boundary = { ...good(), bavail: PRELAUNCH_MIN_FREE_BYTES / 4096n };
  assert.equal(validatePrelaunchDiskHeadroom(boundary), true);
  for (const bad of [null, {}, { ...boundary, bavail: boundary.bavail - 1n }, { ...good(), bsize: 0n },
    { ...good(), bavail: -1n }, { ...good(), bfree: 1n }, { ...good(), bsize: 4096 },
    { ...good(), blocks: 20_000_000n }, { ...good(), blocks: 1n }]) {
    assert.throws(() => validatePrelaunchDiskHeadroom(bad), /headroom_unverified/);
  }
  assert.throws(() => assertPrelaunchDiskHeadroom({ appDir: "/", version: 10 }), /headroom_unverified/);
  assert.throws(() => assertPrelaunchDiskHeadroom({ appDir: "/www/wwwroot/merchant-space", version: 8 }), /headroom_unverified/);
});
