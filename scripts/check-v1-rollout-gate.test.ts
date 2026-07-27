import assert from "node:assert/strict";
import test from "node:test";

import {
  parseV1RolloutGateManifestSource,
  parseV1RolloutGateOptions,
} from "./check-v1-rollout-gate";

test("V1 rollout gate options accept one file or stdin", () => {
  assert.deepEqual(parseV1RolloutGateOptions(["--file=gate.json"]), {
    file: "gate.json",
    receiptFile: null,
    auditFile: null,
    ttlMinutes: 60,
  });
  assert.deepEqual(parseV1RolloutGateOptions(["--file=-"]), {
    file: "-",
    receiptFile: null,
    auditFile: null,
    ttlMinutes: 60,
  });
  assert.deepEqual(
    parseV1RolloutGateOptions([
      "--file=gate.json",
      "--receipt-file=.runtime/approval.json",
      "--ttl-minutes=15",
    ]),
    {
      file: "gate.json",
      receiptFile: ".runtime/approval.json",
      auditFile: ".runtime/approval.json.audit.jsonl",
      ttlMinutes: 15,
    },
  );
  assert.deepEqual(
    parseV1RolloutGateOptions([
      "--file=gate.json",
      "--receipt-file=.runtime/approval.json",
      "--audit-file=.runtime/approval-audit.jsonl",
    ]),
    {
      file: "gate.json",
      receiptFile: ".runtime/approval.json",
      auditFile: ".runtime/approval-audit.jsonl",
      ttlMinutes: 60,
    },
  );
});

test("V1 rollout gate options reject missing, duplicate, and unknown values", () => {
  assert.throws(() => parseV1RolloutGateOptions([]), /file_is_required/);
  assert.throws(
    () =>
      parseV1RolloutGateOptions([
        "--file=one.json",
        "--file=two.json",
      ]),
    /duplicate_argument:file/,
  );
  assert.throws(
    () => parseV1RolloutGateOptions(["--site=10000000"]),
    /unknown_argument:site/,
  );
  assert.throws(
    () =>
      parseV1RolloutGateOptions([
        "--file=gate.json",
        "--ttl-minutes=60",
      ]),
    /ttl_minutes_requires_receipt_file/,
  );
  assert.throws(
    () =>
      parseV1RolloutGateOptions([
        "--file=gate.json",
        "--receipt-file=-",
      ]),
    /receipt_file_must_be_a_path/,
  );
  assert.throws(
    () =>
      parseV1RolloutGateOptions([
        "--file=gate.json",
        "--audit-file=approval.audit.jsonl",
      ]),
    /audit_file_requires_receipt_file/,
  );
  assert.throws(
    () =>
      parseV1RolloutGateOptions([
        "--file=gate.json",
        "--receipt-file=approval.json",
        "--audit-file=-",
      ]),
    /audit_file_must_be_a_path/,
  );
  assert.throws(
    () =>
      parseV1RolloutGateOptions([
        "--file=gate.json",
        "--receipt-file=approval.json",
        "--ttl-minutes=1441",
      ]),
    /ttl_minutes_out_of_range/,
  );
});

test("V1 rollout gate accepts UTF-8 JSON with or without a BOM", () => {
  const source = '{"schemaVersion":1,"siteId":"10000000"}';
  assert.deepEqual(parseV1RolloutGateManifestSource(source), {
    manifest: { schemaVersion: 1, siteId: "10000000" },
    source,
  });
  assert.deepEqual(parseV1RolloutGateManifestSource(`\ufeff${source}`), {
    manifest: { schemaVersion: 1, siteId: "10000000" },
    source,
  });
  assert.throws(
    () => parseV1RolloutGateManifestSource(" \r\n "),
    /manifest_is_empty/,
  );
});
