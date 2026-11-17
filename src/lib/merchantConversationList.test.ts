import test from "node:test";
import assert from "node:assert/strict";
import { guestConversationId, mergeMerchantConversations, type MerchantConversationRow } from "./merchantConversationList";
import type { GuestChatThread } from "./guestChat";

const id = "11111111-1111-4111-8111-111111111111";
const account: MerchantConversationRow = { key: "merchant:12345678", name: "Registered", unreadCount: 2, subtitle: "12345678", preview: "Account message", updatedAt: "2026-11-16T10:00:00Z", unread: true, avatarLabel: "R", isOfficial: false };
const guest: GuestChatThread = { id, siteId: "99990001", guestNumber: "12345678", guestName: "游客12345678", updatedAt: "2026-11-16T11:00:00Z", unread: 3, lastMessage: { id: "7", requestId: id, sender: "guest", text: "Guest message", createdAt: "2026-11-16T11:00:00Z" } };

test("one chronological inbox keeps official support pinned and preserves each unread count", () => {
  const official = { ...account, key: "official", name: "Faolla", isOfficial: true, updatedAt: "" };
  const accounts = [account, official];
  const before = structuredClone({ accounts, guest });
  const rows = mergeMerchantConversations(accounts, [guest]);
  assert.deepEqual(rows.map(row => row.key), ["official", `guest:${id}`, "merchant:12345678"]);
  assert.equal(rows[1].name, "访客12345678");
  assert.equal(rows[1].preview, "Guest message");
  assert.deepEqual(rows.map(row => row.unreadCount), [2, 3, 2]);
  assert.deepEqual({ accounts, guest }, before, "rendering must not mutate either source");
});

test("matching display numbers never route visitor replies to an account", () => {
  assert.equal(guestConversationId(`guest:${id}`), id);
  for (const key of ["merchant:12345678", "guest:12345678", "12345678", `merchant:${id}`, "guest:../other", "official"]) assert.equal(guestConversationId(key), "");
  assert.equal(mergeMerchantConversations([account], [guest]).length, 2);
});

test("empty inboxes, equal timestamps and missing message previews are deterministic", () => {
  assert.deepEqual(mergeMerchantConversations([], []), []);
  const rows = mergeMerchantConversations([account], [{ ...guest, lastMessage: null, unread: 0, updatedAt: account.updatedAt }]);
  assert.deepEqual(rows.map(row => row.key), [`guest:${id}`, account.key]);
  assert.equal(rows[0].unread, false);
  assert.equal(rows[0].preview, "暂无消息。");
});
