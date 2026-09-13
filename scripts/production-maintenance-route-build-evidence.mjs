import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

/** Incident-specific source proof, not a broad src allowlist or a TS compiler.
 * read is the caller's fixed, bounded, read-only git reader. The caller must
 * separately validate current clean HEAD/ancestor and every NON-route change.
 * No I/O, import of route code, build, module resolution or mutation is done.
 */
const ROUTES = Object.freeze([
  Object.freeze(["src/app/api/assets/upload/route.ts","export const runtime = \"nodejs\";\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/auth/merchant-signup/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/auth/reset-password/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/bookings/calendar/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/bookings/workbench/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/business-card-share/route.ts","export { POST, DELETE } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/membership-settings/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, PUT, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/memberships/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport const maxDuration = 60;\n\nexport { GET, POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-admin/redemption-cashier/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-admin/redemption-checkout/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-business/capabilities/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-chat-business-card/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-domain-binding/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/audit-events/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/boards/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/columns/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/employees/accept/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/employees/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/invitations/exchange/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/invitations/initial-password/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/linked-order-summary/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/memberships/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/notifications/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/order-sources/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/order-tasks/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/overview/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/published-workflows/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/roles/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/task-checklist/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/task-events/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/task-workflow/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/tasks/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/todos/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-automations/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-executions/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-permission-gaps/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-revisions/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-enterprise/workflows/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/merchant-peer-messages/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/orders/catalog/public/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/orders/catalog/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/orders/export/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/orders/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET, POST, PATCH } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/orders/workbench/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\n\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/platform-published/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/site-published/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/site-resolve/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { GET } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/super-admin/auth/request/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/super-admin/legacy-personal-recovery/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { GET, POST } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/api/super-admin/merchant-accounts/route.ts","export const dynamic = \"force-dynamic\";\nexport const revalidate = 0;\nexport { GET, POST, PATCH, DELETE } from \"./route-handler\";\n"]),
  Object.freeze(["src/app/card/[card]/image/route.ts","export { GET } from \"./route-handler\";\n"]),
]);
const TESTS = Object.freeze([
  Object.freeze(["scripts/merchant-account-deletion-security-contract.test.mjs", Object.freeze([["\"../src/app/api/super-admin/merchant-accounts/route.ts\"","\"../src/app/api/super-admin/merchant-accounts/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["scripts/merchant-business-owner-authorization-contract.test.mjs", Object.freeze([["\"../src/app/api/merchant-enterprise/roles/route.ts\"","\"../src/app/api/merchant-enterprise/roles/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["scripts/merchant-enterprise-invitation-application-contract.test.mjs", Object.freeze([["\"src/app/api/merchant-enterprise/employees/accept/route.ts\"","\"src/app/api/merchant-enterprise/employees/accept/route-handler.ts\""],["\"src/app/api/merchant-enterprise/memberships/route.ts\"","\"src/app/api/merchant-enterprise/memberships/route-handler.ts\""],["\"src/app/api/merchant-enterprise/invitations/initial-password/route.ts\"","\"src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts\""],["\"src/app/api/merchant-enterprise/employees/route.ts\"","\"src/app/api/merchant-enterprise/employees/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["scripts/merchant-member-redemption-recovery-contract.test.mjs", Object.freeze([["\"src/app/api/memberships/route.ts\"","\"src/app/api/memberships/route-handler.ts\""],["\"src/app/api/merchant-admin/redemption-checkout/route.ts\"","\"src/app/api/merchant-admin/redemption-checkout/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["scripts/merchant-order-employee-frontend-contract.test.mjs", Object.freeze([["\"src/app/api/assets/upload/route.ts\"","\"src/app/api/assets/upload/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/assets/upload/route.test.ts", Object.freeze([["\"@/app/api/assets/upload/route\"","\"@/app/api/assets/upload/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/auth/legacy-personal-recovery/route.test.ts", Object.freeze([["\"@/app/api/super-admin/legacy-personal-recovery/route\"","\"@/app/api/super-admin/legacy-personal-recovery/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/auth/merchant-signup/route.test.ts", Object.freeze([["\"@/app/api/auth/merchant-signup/route\"","\"@/app/api/auth/merchant-signup/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/auth/reset-password/route.test.ts", Object.freeze([["\"@/app/api/auth/reset-password/route\"","\"@/app/api/auth/reset-password/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/bookings/calendar/route.test.ts", Object.freeze([["\"@/app/api/bookings/calendar/route\"","\"@/app/api/bookings/calendar/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/bookings/workbench/route.test.ts", Object.freeze([["\"@/app/api/bookings/workbench/route\"","\"@/app/api/bookings/workbench/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/business-card-share/route.test.ts", Object.freeze([["\"@/app/api/business-card-share/route\"","\"@/app/api/business-card-share/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/membership-settings/route.test.ts", Object.freeze([["\"@/app/api/membership-settings/route\"","\"@/app/api/membership-settings/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/memberships/route.patch.test.ts", Object.freeze([["\"./route\"","\"./route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/memberships/route.test.ts", Object.freeze([["\"@/app/api/memberships/route\"","\"@/app/api/memberships/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-admin/redemption-cashier/route.test.ts", Object.freeze([["\"@/app/api/merchant-admin/redemption-cashier/route\"","\"@/app/api/merchant-admin/redemption-cashier/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-admin/redemption-checkout/route.test.ts", Object.freeze([["\"@/app/api/merchant-admin/redemption-checkout/route\"","\"@/app/api/merchant-admin/redemption-checkout/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-business/capabilities/route.test.ts", Object.freeze([["\"@/app/api/merchant-business/capabilities/route\"","\"@/app/api/merchant-business/capabilities/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-chat-business-card/route.test.ts", Object.freeze([["\"./route\"","\"./route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-domain-binding/route.test.ts", Object.freeze([["\"@/app/api/merchant-domain-binding/route\"","\"@/app/api/merchant-domain-binding/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/audit-events/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/audit-events/route\"","\"@/app/api/merchant-enterprise/audit-events/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/invitations/exchange/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/invitations/exchange/route\"","\"@/app/api/merchant-enterprise/invitations/exchange/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/invitations/initial-password/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/invitations/initial-password/route\"","\"@/app/api/merchant-enterprise/invitations/initial-password/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/linked-order-summary/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/linked-order-summary/route\"","\"@/app/api/merchant-enterprise/linked-order-summary/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/memberships/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/memberships/route\"","\"@/app/api/merchant-enterprise/memberships/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/notifications/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/notifications/route\"","\"@/app/api/merchant-enterprise/notifications/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/published-workflows/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/published-workflows/route\"","\"@/app/api/merchant-enterprise/published-workflows/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/overview/route\"","\"@/app/api/merchant-enterprise/overview/route-handler\""],["\"@/app/api/merchant-enterprise/boards/route\"","\"@/app/api/merchant-enterprise/boards/route-handler\""],["\"@/app/api/merchant-enterprise/columns/route\"","\"@/app/api/merchant-enterprise/columns/route-handler\""],["\"@/app/api/merchant-enterprise/employees/route\"","\"@/app/api/merchant-enterprise/employees/route-handler\""],["\"@/app/api/merchant-enterprise/employees/accept/route\"","\"@/app/api/merchant-enterprise/employees/accept/route-handler\""],["\"@/app/api/merchant-enterprise/roles/route\"","\"@/app/api/merchant-enterprise/roles/route-handler\""],["\"@/app/api/merchant-enterprise/tasks/route\"","\"@/app/api/merchant-enterprise/tasks/route-handler\""],["\"@/app/api/merchant-enterprise/order-tasks/route\"","\"@/app/api/merchant-enterprise/order-tasks/route-handler\""],["\"@/app/api/merchant-enterprise/order-sources/route\"","\"@/app/api/merchant-enterprise/order-sources/route-handler\""],["\"@/app/api/merchant-enterprise/task-events/route\"","\"@/app/api/merchant-enterprise/task-events/route-handler\""],["\"@/app/api/merchant-enterprise/task-checklist/route\"","\"@/app/api/merchant-enterprise/task-checklist/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/task-workflow/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/task-workflow/route\"","\"@/app/api/merchant-enterprise/task-workflow/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/todos/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/todos/route\"","\"@/app/api/merchant-enterprise/todos/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-automations/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/workflow-automations/route\"","\"@/app/api/merchant-enterprise/workflow-automations/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-executions/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/workflow-executions/route\"","\"@/app/api/merchant-enterprise/workflow-executions/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-permission-gaps/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/workflow-permission-gaps/route\"","\"@/app/api/merchant-enterprise/workflow-permission-gaps/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/workflow-revisions/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/workflow-revisions/route\"","\"@/app/api/merchant-enterprise/workflow-revisions/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-enterprise/workflows/route.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/workflows/route\"","\"@/app/api/merchant-enterprise/workflows/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/merchant-peer-messages/route.test.ts", Object.freeze([["\"@/app/api/merchant-peer-messages/route\"","\"@/app/api/merchant-peer-messages/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/orders/catalog/public/route.test.ts", Object.freeze([["\"./route\"","\"./route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/orders/catalog/route.test.ts", Object.freeze([["\"@/app/api/orders/catalog/route\"","\"@/app/api/orders/catalog/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/orders/export/route.test.ts", Object.freeze([["\"@/app/api/orders/export/route\"","\"@/app/api/orders/export/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/orders/route.test.ts", Object.freeze([["\"@/app/api/orders/route\"","\"@/app/api/orders/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/orders/workbench/route.test.ts", Object.freeze([["\"@/app/api/orders/workbench/route\"","\"@/app/api/orders/workbench/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/site-published/route.test.ts", Object.freeze([["\"@/app/api/site-published/route\"","\"@/app/api/site-published/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/site-resolve/route.test.ts", Object.freeze([["\"@/app/api/site-resolve/route\"","\"@/app/api/site-resolve/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/super-admin/auth/request/route.test.ts", Object.freeze([["\"@/app/api/super-admin/auth/request/route\"","\"@/app/api/super-admin/auth/request/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/super-admin/merchant-accounts/route.test.ts", Object.freeze([["\"./route\"","\"./route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/app/api/super-admin/serverSupabaseRouting.contract.test.ts", Object.freeze([["\"./merchant-accounts/route.ts\"","\"./merchant-accounts/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/lib/merchantBusinessCardImageRoute.test.ts", Object.freeze([["\"@/app/card/[card]/image/route\"","\"@/app/card/[card]/image/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/lib/merchantEnterpriseInvitationStore.server.test.ts", Object.freeze([["\"@/app/api/merchant-enterprise/employees/accept/route\"","\"@/app/api/merchant-enterprise/employees/accept/route-handler\""],["\"@/app/api/merchant-enterprise/employees/route\"","\"@/app/api/merchant-enterprise/employees/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/lib/merchantMembershipRouteContract.test.ts", Object.freeze([["\"src/app/api/memberships/route.ts\"","\"src/app/api/memberships/route-handler.ts\""],["\"src/app/api/membership-settings/route.ts\"","\"src/app/api/membership-settings/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/lib/merchantMembershipRoutesSecurity.test.ts", Object.freeze([["\"@/app/api/merchant-admin/redemption-cashier/route\"","\"@/app/api/merchant-admin/redemption-cashier/route-handler\""],["\"@/app/api/memberships/route\"","\"@/app/api/memberships/route-handler\""],["\"@/app/api/membership-settings/route\"","\"@/app/api/membership-settings/route-handler\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/lib/merchantStaffPrincipal.server.test.ts", Object.freeze([["\"src/app/api/merchant-domain-binding/route.ts\"","\"src/app/api/merchant-domain-binding/route-handler.ts\""],["\"src/app/api/merchant-chat-business-card/route.ts\"","\"src/app/api/merchant-chat-business-card/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
  Object.freeze(["src/lib/platformSnapshotAtomicWriterBoundaries.security.test.ts", Object.freeze([["\"../app/api/merchant-domain-binding/route.ts\"","\"../app/api/merchant-domain-binding/route-handler.ts\""]].map(pair => Object.freeze(pair)))]),
]);

export const MAINTENANCE_ROUTE_BUILD_ROUTE_PATHS = Object.freeze(ROUTES.map(([file]) => file));
export const MAINTENANCE_ROUTE_BUILD_TEST_PATHS = Object.freeze(TESTS.map(([file]) => file));
export const MAINTENANCE_ROUTE_BUILD_SOURCE_PATHS = Object.freeze([
  ...ROUTES.flatMap(([file]) => [file, file.replace(/route\.ts$/, "route-handler.ts")]),
  ...MAINTENANCE_ROUTE_BUILD_TEST_PATHS,
].sort());
const PREVIOUS = "46f007fbd9e417f93c01e398c77cf38ec814547d", SHA = /^[0-9a-f]{40}$/, ZERO = "0".repeat(40);
const KEYS = ["path", "oldMode", "newMode", "oldBlob", "newBlob", "status"];
const OWNED = new Set(MAINTENANCE_ROUTE_BUILD_SOURCE_PATHS);
const fail = () => { throw new Error("maintenance_route_build_evidence_unverified"); };
const blobHash = text => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0").update(text).digest("hex");
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length ||
      keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
}
function captureChanges(value) {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 256 || value.length < OWNED.size) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail();
  const rows = new Map();
  for (let i = 0; i < value.length; i++) {
    if (!descriptors[i]?.enumerable || !Object.hasOwn(descriptors[i], "value")) fail();
    const row = descriptors[i].value; exact(row, KEYS);
    const captured = Object.fromEntries(KEYS.map(key => [key, row[key]]));
    if (typeof captured.path !== "string" || captured.path.trim() !== captured.path || captured.path.length > 256 ||
        !/^(?:(?:src|scripts|docs|\.github)\/[A-Za-z0-9_.[\]/-]+|package(?:-lock)?\.json)$/.test(captured.path) ||
        captured.path.split("/").some(part => part === "." || part === "..") || rows.has(captured.path) ||
        !["A", "M"].includes(captured.status) || !["000000", "100644", "100755"].includes(captured.oldMode) ||
        !["100644", "100755"].includes(captured.newMode) || typeof captured.oldBlob !== "string" || captured.oldBlob.length !== 40 ||
        typeof captured.newBlob !== "string" || captured.newBlob.length !== 40 || !SHA.test(captured.oldBlob) || !SHA.test(captured.newBlob) ||
        captured.newBlob === ZERO || captured.oldBlob === captured.newBlob ||
        (captured.status === "A" ? captured.oldMode !== "000000" || captured.oldBlob !== ZERO :
          captured.oldMode !== captured.newMode || captured.oldBlob === ZERO)) fail();
    if (captured.path.startsWith("src/") && !OWNED.has(captured.path)) fail();
    rows.set(captured.path, captured);
  }
  for (const file of OWNED) if (!rows.has(file)) fail();
  return rows;
}
function requireChange(rows, file, status) {
  const row = rows.get(file);
  if (!row || row.status !== status || row.newMode !== "100644" ||
      row.oldMode !== (status === "A" ? "000000" : "100644")) fail();
  return row;
}
function originalExportsMatch(old, facade) {
  const oldConfig = old.match(/^export const (?:runtime|dynamic|revalidate|maxDuration) = [^\n]+;$/gm) ?? [];
  const newConfig = facade.match(/^export const [^\n]+;$/gm) ?? [];
  if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) fail();
  const methods = [...old.matchAll(/^export (?:(?:async )?function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm)].map(match => match[1]);
  const exposed = /^export \{ ([A-Z, ]+) \} from "\.\/route-handler";$/m.exec(facade)?.[1].split(", ");
  if (JSON.stringify(methods) !== JSON.stringify(exposed)) fail();
}

export function verifyMaintenanceRouteBuildDelta(read, previousTargetSha, targetSha, changes) {
  try {
    if (typeof read !== "function" || previousTargetSha !== PREVIOUS || typeof targetSha !== "string" ||
        targetSha.length !== 40 || !SHA.test(targetSha) || targetSha === previousTargetSha) fail();
    const rows = captureChanges(changes);
    let totalBytes = 0;
    const body = (sha, file, expectedBlob) => {
      const text = read(["show", sha + ":" + file]);
      if (typeof text !== "string" || text.length < 1 || text.includes("\0") || text.includes("\ufffd") ||
          Buffer.byteLength(text) > 262144 || (totalBytes += Buffer.byteLength(text)) > 16 * 1024 * 1024 ||
          blobHash(text) !== expectedBlob) fail();
      return text;
    };
    for (const [file, facade] of ROUTES) {
      const route = requireChange(rows, file, "M"), handlerFile = file.replace(/route\.ts$/, "route-handler.ts");
      const handler = requireChange(rows, handlerFile, "A");
      if (handler.newBlob !== route.oldBlob) fail();
      const original = body(previousTargetSha, file, route.oldBlob);
      if (body(targetSha, handlerFile, handler.newBlob) !== original || body(targetSha, file, route.newBlob) !== facade) fail();
      originalExportsMatch(original, facade);
    }
    for (const [file, replacements] of TESTS) {
      const change = requireChange(rows, file, "M");
      let expected = body(previousTargetSha, file, change.oldBlob);
      for (const [from, to] of replacements) {
        if (!expected.includes(from)) fail();
        expected = expected.split(from).join(to);
      }
      if (body(targetSha, file, change.newBlob) !== expected) fail();
    }
  } catch { fail(); }
}
