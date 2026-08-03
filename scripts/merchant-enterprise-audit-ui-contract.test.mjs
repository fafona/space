import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const managerSource = readFileSync(
  path.join(root, "src", "components", "admin", "MerchantEnterpriseManager.tsx"),
  "utf8",
);
const auditSource = readFileSync(
  path.join(root, "src", "components", "admin", "MerchantEnterpriseAuditLog.tsx"),
  "utf8",
);
const adminClientSource = readFileSync(
  path.join(root, "src", "app", "admin", "AdminClient.tsx"),
  "utf8",
);

test("audit log is a permission-aware enterprise subview", () => {
  assert.match(
    managerSource,
    /export\s+type\s+MerchantEnterpriseView\s*=\s*[\s\S]{0,180}["']audit["']/,
  );
  assert.match(
    managerSource,
    /\{\s*key:\s*["']audit["'],\s*label:\s*["']操作记录["'],\s*permission:\s*["']audit\.view["']\s*\}/,
  );
  assert.match(
    managerSource,
    /tab\s*===\s*["']audit["'][\s\S]{0,500}<MerchantEnterpriseAuditLog[\s\S]{0,300}apiFetch=\{apiFetch\}/,
  );
  assert.match(
    adminClientSource,
    /\{\s*label:\s*["']操作记录["'],\s*view:\s*["']audit["']\s*\}/,
    "desktop enterprise audit must follow the contextual left-sidebar navigation pattern",
  );
});

test("audit UI exposes immutable history, bounded pagination and safe whitelisted changes", () => {
  assert.match(auditSource, /记录不可修改或删除/);
  assert.match(
    auditSource,
    /\/api\/merchant-enterprise\/audit-events\?\$\{params\.toString\(\)\}/,
  );
  assert.match(auditSource, /new\s+URLSearchParams\(\{\s*siteId,\s*limit:\s*["']50["']\s*\}\)/);
  assert.match(auditSource, /entityType\s*!==\s*["']all["'][\s\S]{0,100}params\.set\(["']entityType["']/);
  assert.match(auditSource, /append:\s*true,\s*cursor:\s*nextCursor/);
  assert.match(auditSource, /event\.actorLabel/);
  assert.match(auditSource, /event\.targetLabel/);
  assert.match(auditSource, /event\.beforeData\[field\]/);
  assert.match(auditSource, /event\.afterData\[field\]/);
  assert.doesNotMatch(auditSource, /token|token_hash|auth_user_id|email/i);
});

test("every database audit event has a user-facing description", () => {
  for (const eventType of [
    "workspace.bootstrapped",
    "role.created",
    "role.updated",
    "role.board_scope_changed",
    "board.created",
    "board.updated",
    "column.created",
    "column.updated",
    "employee.created",
    "employee.updated",
    "employee.renamed",
    "employee.role_changed",
    "employee.disabled",
    "employee.restored",
    "employee.removed",
    "invitation.reserved",
    "invitation.revoked",
    "invitation.removed",
    "invitation.accepted",
    "invitation.delivery_finalized",
    "invitation.auth_bound",
  ]) {
    assert.ok(auditSource.includes(`"${eventType}"`), `missing audit label for ${eventType}`);
  }
});
