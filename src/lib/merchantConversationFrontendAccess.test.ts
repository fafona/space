import assert from "node:assert/strict";
import test from "node:test";
import { getMerchantConversationFrontendAccess } from "@/lib/merchantConversationFrontendAccess";

test("conversation frontend remains closed without the menu root", () => {
  assert.deepEqual(
    getMerchantConversationFrontendAccess([
      "conversations.search",
      "conversations.start",
      "conversations.send",
    ]),
    { view: false, search: false, start: false, send: false },
  );
});

test("conversation frontend exposes only explicitly granted actions", () => {
  assert.deepEqual(
    getMerchantConversationFrontendAccess([
      "conversations.view",
      "conversations.search",
    ]),
    { view: true, search: true, start: false, send: false },
  );
  assert.deepEqual(
    getMerchantConversationFrontendAccess([
      "conversations.view",
      "conversations.search",
      "conversations.start",
      "conversations.send",
    ]),
    { view: true, search: true, start: true, send: true },
  );
});
