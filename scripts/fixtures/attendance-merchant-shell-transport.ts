// Explicitly synthetic, read-only merchant bootstrap for actual AdminClient.
// Attendance requests must continue to real handlers and the isolated SQL RPCs.
import assert from "node:assert/strict";
import { createDefaultMerchantPermissionConfig, createDefaultMerchantSortConfig } from "../../src/data/platformControlStore";
import { databaseActors } from "./attendance-database-transport";

export function serveAttendanceMerchantBootstrap(request: Request, authUserId: string): Response | null {
  const url = new URL(request.url);
  if (![
    "/api/auth/merchant-session", "/api/merchant-chat-business-card",
    "/api/site-published", "/api/merchant-draft",
    "/api/app-web-version", "/api/support-messages", "/api/merchant-peer-messages",
    "/api/bookings", "/api/orders", "/api/merchant-operation-logs",
  ].includes(url.pathname)) return null;
  assert.equal(authUserId, databaseActors[0].id);
  if (url.pathname === "/api/merchant-operation-logs") {
    assert.equal(request.method, "POST");
    // AdminClient's generic fetch observer also emits a log request. Explicitly
    // deny it: this acceptance must not write to a separate business/log API.
    return Response.json({ ok: false, error: "synthetic_log_write_disabled" }, { status: 403 });
  }
  assert.equal(request.method, "GET", "merchant_bootstrap_writes_forbidden");
  const siteId = "99990001";
  const permissionConfig = { ...createDefaultMerchantPermissionConfig(), allowEnterpriseManagement: true, allowEmployeeAttendance: true };
  if (url.pathname === "/api/auth/merchant-session") return Response.json({
    authenticated: true, merchantId: siteId, merchantIds: [siteId],
    user: { id: authUserId, email: databaseActors[0].email },
  });
  if (url.pathname === "/api/app-web-version") return Response.json({ ok: true, buildId: "attendance-synthetic", releasedAt: null });
  assert.equal(url.searchParams.get("siteId"), siteId);
  if (url.pathname === "/api/support-messages") return Response.json({ ok: true, messages: [], unreadCount: 0 });
  if (url.pathname === "/api/merchant-peer-messages") return Response.json({ ok: true, contacts: [], messages: [], unreadCount: 0 });
  if (url.pathname === "/api/bookings") return Response.json({ ok: true, bookings: [] });
  if (url.pathname === "/api/orders") return Response.json({ ok: true, orders: [] });
  if (url.pathname === "/api/merchant-chat-business-card") {
    assert.equal(url.searchParams.get("merchantId"), siteId);
    return Response.json({ profile: {
      id: siteId, name: "合成企业", merchantName: "合成企业", domainPrefix: "attendance-qa",
      domain: "attendance-qa.example.test", category: "企业", industry: "其他",
      location: { country: "ES", province: "Madrid", city: "Madrid" },
      contactName: "合成负责人", contactEmail: databaseActors[0].email,
      contactPhone: "000000000", contactAddress: "Synthetic test address",
      permissionConfig, sortConfig: createDefaultMerchantSortConfig(),
      createdAt: "2026-01-01T00:00:00Z", status: "active", serviceExpiresAt: null,
    }, chatBusinessCard: null });
  }
  return Response.json({ siteId, blocks: [], updatedAt: null });
}
