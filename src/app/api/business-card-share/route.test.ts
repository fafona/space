import test from "node:test";
import assert from "node:assert/strict";
import { isStorageObjectMissingError } from "@/app/api/business-card-share/route";

test("share delete treats common not-found storage errors as idempotent misses", () => {
  assert.equal(isStorageObjectMissingError("The resource was not found"), true);
  assert.equal(isStorageObjectMissingError("Object does not exist"), true);
  assert.equal(isStorageObjectMissingError("storage responded with status code 404"), true);
});

test("share delete does not hide unrelated storage failures", () => {
  assert.equal(isStorageObjectMissingError("row level security policy violation"), false);
  assert.equal(isStorageObjectMissingError("bucket unavailable"), false);
});
