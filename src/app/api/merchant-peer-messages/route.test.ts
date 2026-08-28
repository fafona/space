import assert from "node:assert/strict";
import test from "node:test";
import {
  getMerchantPeerActionRequiredPermissions,
  getMerchantPeerSendRequiredPermissions,
  projectMerchantPeerContactForEmployee,
  projectMerchantPeerThreadForEmployee,
} from "@/app/api/merchant-peer-messages/route";
import type { MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";

test("conversation actions map to the narrow business permission", () => {
  assert.deepEqual(getMerchantPeerActionRequiredPermissions("mark_read"), [
    "conversations.view",
  ]);
  assert.deepEqual(getMerchantPeerActionRequiredPermissions("lookup"), [
    "conversations.search",
  ]);
  assert.deepEqual(getMerchantPeerActionRequiredPermissions("search"), [
    "conversations.start",
  ]);
  assert.deepEqual(
    getMerchantPeerActionRequiredPermissions("ensure_contact"),
    ["conversations.start"],
  );
  assert.deepEqual(getMerchantPeerActionRequiredPermissions("send"), [
    "conversations.send",
  ]);
});

test("official support and unsupported actions never gain a conversation write permission", () => {
  assert.deepEqual(getMerchantPeerActionRequiredPermissions("support"), [
    "conversations.view",
  ]);
  assert.deepEqual(getMerchantPeerActionRequiredPermissions("attachment"), [
    "conversations.view",
  ]);
  assert.deepEqual(getMerchantPeerActionRequiredPermissions(""), [
    "conversations.view",
  ]);
});

test("employee conversation projection removes contact PII and optional profile data", () => {
  const projected = projectMerchantPeerContactForEmployee({
    merchantId: "10000002",
    merchantName: "person@example.com",
    merchantEmail: "person@example.com",
    accountType: "personal",
    avatarImageUrl: "https://example.com/avatar.png",
    signature: "private signature",
    contactPhone: "+34 600 000 000",
    contactAddress: "private address",
    contactCard: "private card",
    savedAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:01.000Z",
    lastMessage: null,
  });

  assert.deepEqual(projected, {
    merchantId: "10000002",
    merchantName: "10000002",
    merchantEmail: "",
    accountType: "personal",
    savedAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:01.000Z",
    lastMessage: null,
  });
  assert.equal("contactPhone" in projected, false);
  assert.equal("contactAddress" in projected, false);
  assert.equal("contactCard" in projected, false);
  assert.equal("signature" in projected, false);
});

test("employee conversation projection removes participant emails from threads", () => {
  const projected = projectMerchantPeerThreadForEmployee({
    threadKey: "10000001::10000002",
    merchantAId: "10000001",
    merchantAName: "Store",
    merchantAEmail: "owner@example.com",
    merchantBId: "10000002",
    merchantBName: "person@example.com",
    merchantBEmail: "person@example.com",
    updatedAt: "2026-08-28T00:00:01.000Z",
    messages: [],
  });

  assert.equal(projected?.merchantAName, "Store");
  assert.equal(projected?.merchantAEmail, "");
  assert.equal(projected?.merchantBName, "10000002");
  assert.equal(projected?.merchantBEmail, "");
});

test("employee sending to a new peer also requires start permission", () => {
  const actor: MerchantBusinessActor = {
    type: "employee" as const,
    siteId: "10000000",
    authUserId: "auth-1",
    employeeId: "employee-1",
    roleId: "role-1",
    employeeVersion: 1,
    roleVersion: 1,
    principalKey: "employee:employee-1" as const,
    authorizationVersion: "1:1",
    displayName: "Employee",
    email: "employee@example.com",
    collaborationPermissions: [],
    businessPermissions: ["conversations.view", "conversations.send"],
  };
  assert.deepEqual(getMerchantPeerSendRequiredPermissions(actor, true), [
    "conversations.send",
  ]);
  assert.deepEqual(getMerchantPeerSendRequiredPermissions(actor, false), [
    "conversations.send",
    "conversations.start",
  ]);
  assert.deepEqual(getMerchantPeerSendRequiredPermissions(undefined, false), [
    "conversations.send",
  ]);
});
