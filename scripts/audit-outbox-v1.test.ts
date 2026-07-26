import assert from "node:assert/strict";
import test from "node:test";

import { parseOutboxAuditOptions } from "./audit-outbox-v1";

test("outbox audit options are read-only and global by default", () => {
  assert.deepEqual(parseOutboxAuditOptions([]), {
    windowHours: 24,
    maximumDueAgeSeconds: 300,
  });
});

test("outbox audit accepts one exact merchant scope and bounded thresholds", () => {
  assert.deepEqual(
    parseOutboxAuditOptions([
      "--site=10000000",
      "--window-hours=48",
      "--max-due-age-seconds=900",
    ]),
    {
      merchantId: "10000000",
      windowHours: 48,
      maximumDueAgeSeconds: 900,
    },
  );
});

test("outbox audit rejects wildcard, duplicate and write-like arguments", () => {
  assert.throws(
    () => parseOutboxAuditOptions(["--site=*"]),
    /site_must_be_exact_8_digit_id/,
  );
  assert.throws(
    () => parseOutboxAuditOptions(["--window-hours=24", "--window-hours=48"]),
    /duplicate_argument:window-hours/,
  );
  assert.throws(
    () => parseOutboxAuditOptions(["--write=true"]),
    /unknown_argument:write/,
  );
});
