import assert from "node:assert/strict";
import test from "node:test";

import { shouldPersistMerchantManagerPreferences } from "@/lib/useMerchantManagerPreferences";

test("manager preferences retain owner persistence by default", () => {
  assert.equal(shouldPersistMerchantManagerPreferences(undefined), true);
});

test("disabled employee cache policy keeps manager preferences memory-only", () => {
  assert.equal(
    shouldPersistMerchantManagerPreferences({
      mode: "disabled",
      allowPersistentRead: false,
      allowPersistentWrite: false,
      allowStaleOnError: false,
    }),
    false,
  );
});

test("partial persistence is rejected instead of mixing local and remote state", () => {
  assert.equal(
    shouldPersistMerchantManagerPreferences({
      mode: "default",
      allowPersistentRead: true,
      allowPersistentWrite: false,
      allowStaleOnError: false,
    }),
    false,
  );
});
