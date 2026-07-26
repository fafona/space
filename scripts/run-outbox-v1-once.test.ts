import assert from "node:assert/strict";
import test from "node:test";

import {
  isOutboxWorkerExecutionEnabled,
  parseOutboxWorkerOnceOptions,
} from "./run-outbox-v1-once";

test("one-shot outbox worker requires an exact matching merchant confirmation", () => {
  assert.deepEqual(
    parseOutboxWorkerOnceOptions([
      "--site=10000000",
      "--confirm=10000000",
      "--limit=3",
    ]),
    {
      siteId: "10000000",
      confirmSiteId: "10000000",
      limit: 3,
      leaseSeconds: 90,
      taskTimeoutMs: 60000,
    },
  );
  assert.throws(
    () =>
      parseOutboxWorkerOnceOptions([
        "--site=10000000",
        "--confirm=10000001",
      ]),
    /confirm_must_exactly_match_site/,
  );
  assert.throws(
    () => parseOutboxWorkerOnceOptions(["--site=*", "--confirm=*"]),
    /site_must_be_exact_8_digit_id/,
  );
});

test("one-shot outbox worker rejects duplicate, unknown, and unbounded options", () => {
  assert.throws(
    () =>
      parseOutboxWorkerOnceOptions([
        "--site=10000000",
        "--site=10000000",
        "--confirm=10000000",
      ]),
    /duplicate_argument:site/,
  );
  assert.throws(
    () =>
      parseOutboxWorkerOnceOptions([
        "--site=10000000",
        "--confirm=10000000",
        "--event=backup.create",
      ]),
    /unknown_argument:event/,
  );
  assert.throws(
    () =>
      parseOutboxWorkerOnceOptions([
        "--site=10000000",
        "--confirm=10000000",
        "--limit=50",
      ]),
    /limit_must_be_between_1_and_20/,
  );
});

test("one-shot outbox worker execution is disabled unless explicitly enabled", () => {
  assert.equal(isOutboxWorkerExecutionEnabled({}), false);
  assert.equal(
    isOutboxWorkerExecutionEnabled({
      MERCHANT_OUTBOX_V1_WORKER_EXECUTION_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    isOutboxWorkerExecutionEnabled({
      MERCHANT_OUTBOX_V1_WORKER_EXECUTION_ENABLED: "true",
    }),
    true,
  );
});
