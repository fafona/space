import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAINTENANCE_ROUTE_BUILD_ROUTE_PATHS as ROUTES, MAINTENANCE_ROUTE_BUILD_TEST_PATHS as TESTS,
  MAINTENANCE_ROUTE_BUILD_SOURCE_PATHS as PATHS, verifyMaintenanceRouteBuildDelta } from "./production-maintenance-route-build-evidence.mjs";

const PREVIOUS = "46f007fbd9e417f93c01e398c77cf38ec814547d", TARGET = "a".repeat(40), ZERO = "0".repeat(40);
const error = /maintenance_route_build_evidence_unverified/;
const hash = value => createHash("sha1").update("blob " + Buffer.byteLength(value) + "\0").update(value).digest("hex");
const TEST_RULES = [
  [
    "scripts/merchant-account-deletion-security-contract.test.mjs",
    [
      [
        "\"../src/app/api/super-admin/merchant-accounts/route.ts\"",
        "\"../src/app/api/super-admin/merchant-accounts/route-handler.ts\""
      ]
    ]
  ],
  [
    "scripts/merchant-business-owner-authorization-contract.test.mjs",
    [
      [
        "\"../src/app/api/merchant-enterprise/roles/route.ts\"",
        "\"../src/app/api/merchant-enterprise/roles/route-handler.ts\""
      ]
    ]
  ],
  [
    "scripts/merchant-enterprise-invitation-application-contract.test.mjs",
    [
      [
        "\"src/app/api/merchant-enterprise/employees/accept/route.ts\"",
        "\"src/app/api/merchant-enterprise/employees/accept/route-handler.ts\""
      ],
      [
        "\"src/app/api/merchant-enterprise/memberships/route.ts\"",
        "\"src/app/api/merchant-enterprise/memberships/route-handler.ts\""
      ],
      [
        "\"src/app/api/merchant-enterprise/invitations/initial-password/route.ts\"",
        "\"src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts\""
      ],
      [
        "\"src/app/api/merchant-enterprise/employees/route.ts\"",
        "\"src/app/api/merchant-enterprise/employees/route-handler.ts\""
      ]
    ]
  ],
  [
    "scripts/merchant-member-redemption-recovery-contract.test.mjs",
    [
      [
        "\"src/app/api/memberships/route.ts\"",
        "\"src/app/api/memberships/route-handler.ts\""
      ],
      [
        "\"src/app/api/merchant-admin/redemption-checkout/route.ts\"",
        "\"src/app/api/merchant-admin/redemption-checkout/route-handler.ts\""
      ]
    ]
  ],
  [
    "scripts/merchant-order-employee-frontend-contract.test.mjs",
    [
      [
        "\"src/app/api/assets/upload/route.ts\"",
        "\"src/app/api/assets/upload/route-handler.ts\""
      ]
    ]
  ],
  [
    "src/app/api/assets/upload/route.test.ts",
    [
      [
        "\"@/app/api/assets/upload/route\"",
        "\"@/app/api/assets/upload/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/auth/legacy-personal-recovery/route.test.ts",
    [
      [
        "\"@/app/api/super-admin/legacy-personal-recovery/route\"",
        "\"@/app/api/super-admin/legacy-personal-recovery/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/auth/merchant-signup/route.test.ts",
    [
      [
        "\"@/app/api/auth/merchant-signup/route\"",
        "\"@/app/api/auth/merchant-signup/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/auth/reset-password/route.test.ts",
    [
      [
        "\"@/app/api/auth/reset-password/route\"",
        "\"@/app/api/auth/reset-password/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/bookings/calendar/route.test.ts",
    [
      [
        "\"@/app/api/bookings/calendar/route\"",
        "\"@/app/api/bookings/calendar/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/bookings/workbench/route.test.ts",
    [
      [
        "\"@/app/api/bookings/workbench/route\"",
        "\"@/app/api/bookings/workbench/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/business-card-share/route.test.ts",
    [
      [
        "\"@/app/api/business-card-share/route\"",
        "\"@/app/api/business-card-share/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/membership-settings/route.test.ts",
    [
      [
        "\"@/app/api/membership-settings/route\"",
        "\"@/app/api/membership-settings/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/memberships/route.patch.test.ts",
    [
      [
        "\"./route\"",
        "\"./route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/memberships/route.test.ts",
    [
      [
        "\"@/app/api/memberships/route\"",
        "\"@/app/api/memberships/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-admin/redemption-cashier/route.test.ts",
    [
      [
        "\"@/app/api/merchant-admin/redemption-cashier/route\"",
        "\"@/app/api/merchant-admin/redemption-cashier/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-admin/redemption-checkout/route.test.ts",
    [
      [
        "\"@/app/api/merchant-admin/redemption-checkout/route\"",
        "\"@/app/api/merchant-admin/redemption-checkout/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-business/capabilities/route.test.ts",
    [
      [
        "\"@/app/api/merchant-business/capabilities/route\"",
        "\"@/app/api/merchant-business/capabilities/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-chat-business-card/route.test.ts",
    [
      [
        "\"./route\"",
        "\"./route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-domain-binding/route.test.ts",
    [
      [
        "\"@/app/api/merchant-domain-binding/route\"",
        "\"@/app/api/merchant-domain-binding/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/audit-events/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/audit-events/route\"",
        "\"@/app/api/merchant-enterprise/audit-events/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/invitations/exchange/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/invitations/exchange/route\"",
        "\"@/app/api/merchant-enterprise/invitations/exchange/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/invitations/initial-password/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/invitations/initial-password/route\"",
        "\"@/app/api/merchant-enterprise/invitations/initial-password/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/linked-order-summary/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/linked-order-summary/route\"",
        "\"@/app/api/merchant-enterprise/linked-order-summary/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/memberships/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/memberships/route\"",
        "\"@/app/api/merchant-enterprise/memberships/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/notifications/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/notifications/route\"",
        "\"@/app/api/merchant-enterprise/notifications/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/published-workflows/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/published-workflows/route\"",
        "\"@/app/api/merchant-enterprise/published-workflows/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/overview/route\"",
        "\"@/app/api/merchant-enterprise/overview/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/boards/route\"",
        "\"@/app/api/merchant-enterprise/boards/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/columns/route\"",
        "\"@/app/api/merchant-enterprise/columns/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/employees/route\"",
        "\"@/app/api/merchant-enterprise/employees/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/employees/accept/route\"",
        "\"@/app/api/merchant-enterprise/employees/accept/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/roles/route\"",
        "\"@/app/api/merchant-enterprise/roles/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/tasks/route\"",
        "\"@/app/api/merchant-enterprise/tasks/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/order-tasks/route\"",
        "\"@/app/api/merchant-enterprise/order-tasks/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/order-sources/route\"",
        "\"@/app/api/merchant-enterprise/order-sources/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/task-events/route\"",
        "\"@/app/api/merchant-enterprise/task-events/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/task-checklist/route\"",
        "\"@/app/api/merchant-enterprise/task-checklist/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/task-workflow/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/task-workflow/route\"",
        "\"@/app/api/merchant-enterprise/task-workflow/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/todos/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/todos/route\"",
        "\"@/app/api/merchant-enterprise/todos/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/workflow-automations/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/workflow-automations/route\"",
        "\"@/app/api/merchant-enterprise/workflow-automations/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/workflow-executions/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/workflow-executions/route\"",
        "\"@/app/api/merchant-enterprise/workflow-executions/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/workflow-permission-gaps/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/workflow-permission-gaps/route\"",
        "\"@/app/api/merchant-enterprise/workflow-permission-gaps/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/workflow-revisions/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/workflow-revisions/route\"",
        "\"@/app/api/merchant-enterprise/workflow-revisions/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-enterprise/workflows/route.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/workflows/route\"",
        "\"@/app/api/merchant-enterprise/workflows/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/merchant-peer-messages/route.test.ts",
    [
      [
        "\"@/app/api/merchant-peer-messages/route\"",
        "\"@/app/api/merchant-peer-messages/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/orders/catalog/public/route.test.ts",
    [
      [
        "\"./route\"",
        "\"./route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/orders/catalog/route.test.ts",
    [
      [
        "\"@/app/api/orders/catalog/route\"",
        "\"@/app/api/orders/catalog/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/orders/export/route.test.ts",
    [
      [
        "\"@/app/api/orders/export/route\"",
        "\"@/app/api/orders/export/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/orders/route.test.ts",
    [
      [
        "\"@/app/api/orders/route\"",
        "\"@/app/api/orders/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/orders/workbench/route.test.ts",
    [
      [
        "\"@/app/api/orders/workbench/route\"",
        "\"@/app/api/orders/workbench/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/site-published/route.test.ts",
    [
      [
        "\"@/app/api/site-published/route\"",
        "\"@/app/api/site-published/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/site-resolve/route.test.ts",
    [
      [
        "\"@/app/api/site-resolve/route\"",
        "\"@/app/api/site-resolve/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/super-admin/auth/request/route.test.ts",
    [
      [
        "\"@/app/api/super-admin/auth/request/route\"",
        "\"@/app/api/super-admin/auth/request/route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/super-admin/merchant-accounts/route.test.ts",
    [
      [
        "\"./route\"",
        "\"./route-handler\""
      ]
    ]
  ],
  [
    "src/app/api/super-admin/serverSupabaseRouting.contract.test.ts",
    [
      [
        "\"./merchant-accounts/route.ts\"",
        "\"./merchant-accounts/route-handler.ts\""
      ]
    ]
  ],
  [
    "src/lib/merchantBusinessCardImageRoute.test.ts",
    [
      [
        "\"@/app/card/[card]/image/route\"",
        "\"@/app/card/[card]/image/route-handler\""
      ]
    ]
  ],
  [
    "src/lib/merchantEnterpriseInvitationStore.server.test.ts",
    [
      [
        "\"@/app/api/merchant-enterprise/employees/accept/route\"",
        "\"@/app/api/merchant-enterprise/employees/accept/route-handler\""
      ],
      [
        "\"@/app/api/merchant-enterprise/employees/route\"",
        "\"@/app/api/merchant-enterprise/employees/route-handler\""
      ]
    ]
  ],
  [
    "src/lib/merchantMembershipRouteContract.test.ts",
    [
      [
        "\"src/app/api/memberships/route.ts\"",
        "\"src/app/api/memberships/route-handler.ts\""
      ],
      [
        "\"src/app/api/membership-settings/route.ts\"",
        "\"src/app/api/membership-settings/route-handler.ts\""
      ]
    ]
  ],
  [
    "src/lib/merchantMembershipRoutesSecurity.test.ts",
    [
      [
        "\"@/app/api/merchant-admin/redemption-cashier/route\"",
        "\"@/app/api/merchant-admin/redemption-cashier/route-handler\""
      ],
      [
        "\"@/app/api/memberships/route\"",
        "\"@/app/api/memberships/route-handler\""
      ],
      [
        "\"@/app/api/membership-settings/route\"",
        "\"@/app/api/membership-settings/route-handler\""
      ]
    ]
  ],
  [
    "src/lib/merchantStaffPrincipal.server.test.ts",
    [
      [
        "\"src/app/api/merchant-domain-binding/route.ts\"",
        "\"src/app/api/merchant-domain-binding/route-handler.ts\""
      ],
      [
        "\"src/app/api/merchant-chat-business-card/route.ts\"",
        "\"src/app/api/merchant-chat-business-card/route-handler.ts\""
      ]
    ]
  ],
  [
    "src/lib/platformSnapshotAtomicWriterBoundaries.security.test.ts",
    [
      [
        "\"../app/api/merchant-domain-binding/route.ts\"",
        "\"../app/api/merchant-domain-binding/route-handler.ts\""
      ]
    ]
  ]
];

function fixture() {
  const blobs = new Map(), changes = [], calls = [];
  const add = (file, old, current) => {
    if (old !== null) blobs.set(PREVIOUS + ":" + file, old);
    blobs.set(TARGET + ":" + file, current);
    changes.push({ path: file, oldMode: old === null ? "000000" : "100644", newMode: "100644",
      oldBlob: old === null ? ZERO : hash(old), newBlob: hash(current), status: old === null ? "A" : "M" });
  };
  // Source is synthetic. Facade bytes come from the reviewed checkout, without
  // importing/executing any route. No git object, remote or production state IO.
  for (const file of ROUTES) {
    const facade = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const configs = facade.match(/^export const [^\n]+;$/gm) ?? [];
    const methods = /^export \{ ([A-Z, ]+) \} from "\.\/route-handler";$/m.exec(facade)[1].split(", ");
    const old = configs.join("\n") + "\n\n" + methods.map(name => "export async function " + name + '() { return "original"; }\n').join("") +
      "\nexport const helper = 123;\n";
    add(file, old, facade);
    add(file.replace(/route\.ts$/, "route-handler.ts"), null, old);
  }
  for (const [file, replacements] of TEST_RULES) {
    const old = 'import assert from "node:assert/strict";\n' + replacements.map(([from]) => "readSource(" + from + ");\n").join("") +
      "assert.equal(1, 1);\n";
    let current = old;
    for (const [from, to] of replacements) current = current.split(from).join(to);
    add(file, old, current);
  }
  const read = args => {
    calls.push(args);
    assert.equal(args.length, 2); assert.equal(args[0], "show");
    assert.ok(blobs.has(args[1]), args[1]); return blobs.get(args[1]);
  };
  const replace = (file, text, which = TARGET) => {
    blobs.set(which + ":" + file, text);
    changes.find(row => row.path === file)[which === TARGET ? "newBlob" : "oldBlob"] = hash(text);
  };
  return { blobs, changes, calls, read, replace, verify: () => verifyMaintenanceRouteBuildDelta(read, PREVIOUS, TARGET, changes) };
}

test("fixed 51 routes and 52 tests pass only paired full-old handler copies and exact facades", () => {
  assert.equal(ROUTES.length, 51); assert.equal(TESTS.length, 52); assert.equal(PATHS.length, 154);
  assert.equal(new Set(PATHS).size, 154); assert.ok(Object.isFrozen(PATHS));
  const f = fixture(); assert.equal(f.verify(), undefined);
  assert.equal(f.calls.length, 51 * 3 + 52 * 2);
  assert.ok(f.calls.every(([, object]) => object.startsWith(PREVIOUS + ":") || object.startsWith(TARGET + ":")));
});

test("every route and handler and fixed test must be present, with no partial split or extra src path", () => {
  for (const file of [ROUTES[0], ROUTES[0].replace(/route\.ts$/, "route-handler.ts"), TESTS[0]]) {
    const f = fixture(); f.changes.splice(f.changes.findIndex(row => row.path === file), 1);
    assert.throws(f.verify, error); assert.equal(f.calls.length, 0);
  }
  for (const path of ["src/app/api/not-reviewed/route.ts", "src/lib/unrelated.ts", "src/app/api/auth/reset-password/session/route-handler.ts"]) {
    const f = fixture(); f.changes.push({ ...f.changes[0], path });
    assert.throws(f.verify, error); assert.equal(f.calls.length, 0);
  }
});

test("modified business bodies or helpers are rejected even with consistent new git blob metadata", () => {
  for (const mutate of [text => text.replace('"original"', '"changed"'), text => text.replace("helper = 123", "helper = 124"),
    text => text + "\n// extra\n", text => text.replaceAll("\n", "\r\n")]) {
    const f = fixture(), file = ROUTES[0].replace(/route\.ts$/, "route-handler.ts");
    f.replace(file, mutate(f.blobs.get(TARGET + ":" + file))); assert.throws(f.verify, error);
  }
});

test("facades cannot change config, add side effects, expand exports, redirect handlers, or change whitespace", () => {
  const file = ROUTES.find(value => value.includes("/bookings/workbench/"));
  for (const mutate of [
    text => text.replace('"force-dynamic"', '"force-static"'), text => text.replace("revalidate = 0", "revalidate = 60"),
    text => text.replace("GET, PATCH", "GET, PATCH, DELETE"), text => text.replace("GET, PATCH", "PATCH"),
    text => text.replace("./route-handler", "../route-handler"), text => text.replace("export {", "console.log(1);\nexport {"),
    text => text + "\n", () => 'export * from "./route-handler";\n',
  ]) {
    const f = fixture(); f.replace(file, mutate(f.blobs.get(TARGET + ":" + file))); assert.throws(f.verify, error);
  }
});

test("facade declarations must also match the original config and original HTTP exports", () => {
  const file = ROUTES.find(value => value.includes("/bookings/workbench/")), handler = file.replace(/route\.ts$/, "route-handler.ts");
  for (const mutate of [text => text.replace("revalidate = 0", "revalidate = 60"), text => text.replace("function PATCH", "function POST")]) {
    const f = fixture(), text = mutate(f.blobs.get(PREVIOUS + ":" + file));
    f.replace(file, text, PREVIOUS); f.replace(handler, text); assert.throws(f.verify, error);
  }
});

test("existing handlers, renamed/deleted paths, executable modes and wrong hashes fail closed", () => {
  for (const patch of [{ status: "R" }, { status: "D" }, { newMode: "100755" }, { oldMode: "100755" },
    { oldBlob: ZERO }, { newBlob: ZERO }, { oldBlob: "b".repeat(40) }, { newBlob: "b".repeat(40) }]) {
    const f = fixture(); Object.assign(f.changes[0], patch); assert.throws(f.verify, error);
  }
  const f = fixture(); Object.assign(f.changes[1], { status: "M", oldMode: "100644", oldBlob: "b".repeat(40) });
  assert.throws(f.verify, error);
});

test("each test accepts only its frozen full literal route-to-handler replacements", () => {
  for (const [file] of TEST_RULES) {
    const f = fixture(), current = f.blobs.get(TARGET + ":" + file);
    f.replace(file, current.replace("assert.equal(1, 1)", "assert.equal(1, 2)")); assert.throws(f.verify, error, file);
  }
  for (const mutate of [text => text + "\n", text => text.replace("route-handler", "other-handler"), text => text.replaceAll("\n", "\r\n")]) {
    const f = fixture(), file = TESTS[0]; f.replace(file, mutate(f.blobs.get(TARGET + ":" + file))); assert.throws(f.verify, error);
  }
});

test("five untouched auth subroutes cannot accidentally become handler targets", () => {
  for (const [file, from] of [
    ["src/app/api/auth/merchant-signup/route.test.ts", "@/app/api/auth/merchant-signup/request-code/route"],
    ["src/app/api/auth/merchant-signup/route.test.ts", "@/app/api/auth/merchant-signup/verify-code/route"],
    ["src/app/api/auth/reset-password/route.test.ts", "@/app/api/auth/reset-password/session/route"],
    ["src/app/api/auth/reset-password/route.test.ts", "src/app/api/auth/reset-password/request/route.ts"],
    ["src/app/api/auth/reset-password/route.test.ts", "src/app/api/auth/reset-password/request-code/route.ts"],
  ]) {
    const f = fixture(); const suffix = 'readSource("' + from + '");\n';
    f.replace(file, f.blobs.get(PREVIOUS + ":" + file) + suffix, PREVIOUS);
    f.replace(file, f.blobs.get(TARGET + ":" + file) + suffix); assert.doesNotThrow(f.verify);
    f.replace(file, f.blobs.get(TARGET + ":" + file).replace(from, from.replace(/route(\.ts)?$/, "route-handler$1")));
    assert.throws(f.verify, error);
  }
});

test("wrong context, duplicate paths, traversal and oversized inventories reject before reads", () => {
  const f = fixture();
  for (const [previous, target] of [["b".repeat(40), TARGET], [PREVIOUS, PREVIOUS], [PREVIOUS, TARGET + "\n"], [PREVIOUS, null]])
    assert.throws(() => verifyMaintenanceRouteBuildDelta(f.read, previous, target, f.changes), error);
  assert.equal(f.calls.length, 0);
  for (const path of [f.changes[1].path, "src/../scripts/other.mjs", "scripts/other.mjs\n", "src\\app\\api\\x\\route.ts"]) {
    const g = fixture(); g.changes[0].path = path; assert.throws(g.verify, error); assert.equal(g.calls.length, 0);
  }
  assert.throws(() => verifyMaintenanceRouteBuildDelta(f.read, PREVIOUS, TARGET, Array(257).fill(f.changes[0])), error);
});

test("descriptor getters, proxies, sparse arrays and coercible hashes are inertly rejected", () => {
  let touched = 0;
  const f = fixture();
  const accessor = { ...f.changes[0] }; Object.defineProperty(accessor, "path", { enumerable: true, get() { touched++; return ROUTES[0]; } });
  for (const changes of [new Proxy(f.changes, { get() { touched++; throw Error("proxy"); } }),
    Object.assign([...f.changes], { extra: true }), [accessor, ...f.changes.slice(1)], [, ...f.changes.slice(1)]]) {
    assert.throws(() => verifyMaintenanceRouteBuildDelta(f.read, PREVIOUS, TARGET, changes), error);
  }
  f.changes[0].oldBlob = { toString() { touched++; return "b".repeat(40); } };
  assert.throws(f.verify, error); assert.equal(touched, 0); assert.equal(f.calls.length, 0);
});

test("returned bytes are bounded and bound to git blob metadata, not blindly trusted", () => {
  for (const read of [() => "", () => null, () => "\0", () => "\ufffd", () => "x".repeat(262145), () => { throw Error("PRIVATE"); }]) {
    const f = fixture(); assert.throws(() => verifyMaintenanceRouteBuildDelta(read, PREVIOUS, TARGET, f.changes), error);
  }
  const f = fixture(), read = args => f.read(args) + "\n";
  assert.throws(() => verifyMaintenanceRouteBuildDelta(read, PREVIOUS, TARGET, f.changes), error);
});

test("non-route operational paths remain the outer source guard's responsibility and are never read here", () => {
  const f = fixture(), paths = ["scripts/production-maintenance-control.mjs", "package.json", "package-lock.json"];
  for (const path of paths) f.changes.push({ path, oldMode: "100644", newMode: "100644", oldBlob: "b".repeat(40), newBlob: "c".repeat(40), status: "M" });
  assert.doesNotThrow(f.verify); assert.ok(f.calls.every(([, key]) => paths.every(path => !key.endsWith(":" + path))));
  for (const path of ["package-lock2.json", "package.json.bak", "package.json/child", "next.config.ts", ".env.local"]) {
    const g = fixture();
    g.changes.push({ path, oldMode: "100644", newMode: "100644", oldBlob: "b".repeat(40), newBlob: "c".repeat(40), status: "M" });
    assert.throws(g.verify, error); assert.equal(g.calls.length, 0);
  }
});
