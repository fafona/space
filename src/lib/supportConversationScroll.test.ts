import assert from "node:assert/strict";
import test from "node:test";

import {
  findFirstNewIncomingSupportMessageKey,
  findFirstUnreadSupportMessageKey,
  type SupportConversationScrollMessage,
} from "@/lib/supportConversationScroll";

const messages: SupportConversationScrollMessage[] = [
  { key: "self-1", createdAt: "2026-07-21T08:00:00.000Z", isSelf: true },
  { key: "incoming-1", createdAt: "2026-07-21T08:01:00.000Z", isSelf: false },
  { key: "incoming-2", createdAt: "2026-07-21T08:02:00.000Z", isSelf: false },
];

test("finds the first unread incoming message and ignores self messages", () => {
  assert.equal(
    findFirstUnreadSupportMessageKey(messages, "2026-07-21T08:00:30.000Z"),
    "incoming-1",
  );
  assert.equal(
    findFirstUnreadSupportMessageKey(messages, "2026-07-21T08:02:00.000Z"),
    "",
  );
});

test("finds the first incoming message appended after the last known message", () => {
  const nextMessages = [
    ...messages,
    { key: "incoming-3", createdAt: "2026-07-21T08:03:00.000Z", isSelf: false },
    { key: "incoming-4", createdAt: "2026-07-21T08:04:00.000Z", isSelf: false },
  ];
  assert.equal(
    findFirstNewIncomingSupportMessageKey(nextMessages, messages.map((message) => message.key)),
    "incoming-3",
  );
});

test("finds the first incoming message when an initially empty conversation receives a batch", () => {
  assert.equal(findFirstNewIncomingSupportMessageKey(messages, []), "incoming-1");
});

test("prepended history is not mistaken for newly received messages", () => {
  const nextMessages = [
    { key: "older", createdAt: "2026-07-21T07:59:00.000Z", isSelf: false },
    ...messages,
  ];
  assert.equal(
    findFirstNewIncomingSupportMessageKey(nextMessages, messages.map((message) => message.key)),
    "",
  );
});

test("new self messages do not become an incoming-message target", () => {
  const nextMessages = [
    ...messages,
    { key: "self-2", createdAt: "2026-07-21T08:03:00.000Z", isSelf: true },
  ];
  assert.equal(
    findFirstNewIncomingSupportMessageKey(nextMessages, messages.map((message) => message.key)),
    "",
  );
});
