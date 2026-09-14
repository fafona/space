import test from "node:test";
import assert from "node:assert/strict";
import { PREFLIGHT_MIN_FREE_BYTES, validatePreflightDiskHeadroom, assertPreflightDiskHeadroom } from "./production-maintenance-preflight-disk.mjs";
const good = () => ({ bsize: 4096n, blocks: 10_000_000n, bfree: 2_000_000n, bavail: 1_500_000n });
test("preflight disk preserves 5 GiB / 90% gates and rejects invalid observations", () => {
  assert.equal(validatePreflightDiskHeadroom(good()), true);
  const boundary = { ...good(), bavail: PREFLIGHT_MIN_FREE_BYTES / 4096n };
  assert.equal(validatePreflightDiskHeadroom(boundary), true);
  for (const bad of [null, {}, { ...boundary, bavail: boundary.bavail - 1n }, { ...good(), bsize: 0n },
    { ...good(), bavail: -1n }, { ...good(), bfree: 1n }, { ...good(), bsize: 4096 },
    { ...good(), blocks: 20_000_000n }, { ...good(), blocks: 1n }]) {
    assert.throws(() => validatePreflightDiskHeadroom(bad), /headroom_unverified/);
  }
  assert.throws(() => assertPreflightDiskHeadroom({ appDir: "/", version: 11 }), /headroom_unverified/);
  assert.throws(() => assertPreflightDiskHeadroom({ appDir: "/www/wwwroot/merchant-space", version: 8 }), /headroom_unverified/);
});
