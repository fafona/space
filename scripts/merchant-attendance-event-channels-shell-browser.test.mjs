import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Parse source only: importing these executables would start a database/browser.
// These contract checks perform no network, database, build or artifact writes.
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true,
  file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
const fixture = parse("./fixtures/attendance-event-channels-shell-browser.tsx");
const harness = parse("./attendance-self-browser-harness.mjs");
const native = parse("./merchant-attendance-event-channels-native.mjs");
const journey = parse("./merchant-attendance-event-channels-shell-browser-check.mjs");
function nodes(root, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}
const calls = (root, name) => nodes(root, (node) => ts.isCallExpression(node) &&
  (ts.isIdentifier(node.expression) ? node.expression.text === name :
    ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name));
const declaration = (root, name) => nodes(root, (node) =>
  ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name)[0];
const property = (node, name) => node.properties.find((entry) =>
  ts.isPropertyAssignment(entry) && entry.name.getText().replace(/["']/g, "") === name)?.initializer;
const imports = (root) => nodes(root, ts.isImportDeclaration).map((node) => node.moduleSpecifier.text);
const literals = (root) => nodes(root, ts.isStringLiteral).map((node) => node.text);
function absentSideEffects(root) {
  const forbidden = ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "screenshot", "pdf", "storageState"];
  for (const name of forbidden) assert.equal(calls(root, name).length, 0, `must not create ${name} artifacts`);
}

test("shell fixture mounts actual selector and site-derived portal without leaf or auth injection", () => {
  const modules = imports(fixture);
  assert.ok(modules.some((name) => name.endsWith("/enterprise/EnterpriseSelectorClient")));
  assert.ok(modules.some((name) => name.endsWith("/enterprise/[siteId]/EnterprisePortalClient")));
  assert.equal(modules.some((name) => /Attendance|Supabase|Auth|fixtures\//.test(name)), false);
  const site = nodes(fixture, (node) => ts.isJsxAttribute(node) && node.name.getText() === "siteId");
  assert.equal(site.length, 1);
  assert.ok(ts.isJsxExpression(site[0].initializer));
  assert.ok(ts.isElementAccessExpression(site[0].initializer.expression), "portal tenant must come from parsed path");
  const route = declaration(fixture, "match");
  assert.ok(route);
  assert.match(route.initializer.getText(), /location\.pathname/);
  assert.match(route.initializer.getText(), /99990001\|99990002/);
  for (const name of ["fetch", "setSession", "setItem", "signInWithPassword"]) assert.equal(calls(fixture, name).length, 0);
});

test("shell harness selects its dedicated entry and bundles enabled read surfaces only in memory", () => {
  assert.ok(literals(harness).includes("--event-channels-shell"));
  assert.match(declaration(harness, "entry").initializer.getText(), /withEventChannelsShell\s*\?\s*['"]event-channels-shell['"]/);
  const build = calls(harness, "build").find((call) => ts.isObjectLiteralExpression(call.arguments[0]));
  assert.ok(build);
  assert.equal(property(build.arguments[0], "write")?.kind, ts.SyntaxKind.FalseKeyword);
  for (const feature of ["CORRECTIONS", "SCOPED_TIMESHEET"]) assert.ok(literals(harness).includes(feature));
  assert.ok(literals(harness).includes("process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED"));
  absentSideEffects(harness);
});

test("unintercepted harness remains loopback-only, GET-only and denies unknown routes", () => {
  const server = calls(harness, "createServer")[0];
  assert.ok(server && ts.isArrowFunction(server.arguments[0]));
  const body = server.arguments[0].body.getText();
  assert.match(body, /request\.headers\.host\s*!==\s*["']127\.0\.0\.1:3131["']/);
  assert.match(body, /request\.method\s*!==\s*["']GET["']/);
  assert.match(body, /Content-Security-Policy/);
  assert.match(body, /return\s+response\.writeHead\(403\)\.end\(\);\s*}$/);
  const listen = calls(harness, "listen").find((call) => call.arguments[1]?.getText() === '"127.0.0.1"');
  assert.ok(listen);
  assert.equal(listen.arguments[0].getText(), "3131");
  for (const route of ["/enterprise", "/enterprise/99990001", "/enterprise/99990002"]) assert.ok(literals(server).includes(route));
});

test("optional tenant preparation precedes immutable native baselines and browser callback", () => {
  const fn = nodes(native, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "checkEventChannels")[0];
  assert.ok(fn);
  const prepare = fn.parameters.find((parameter) => parameter.name.getText() === "prepare");
  assert.equal(prepare?.initializer?.kind, ts.SyntaxKind.NullKeyword);
  const invocation = calls(fn, "prepare");
  assert.equal(invocation.length, 1);
  assert.ok(ts.isAwaitExpression(invocation[0].parent), "setup must be fully awaited");
  const callback = calls(fn, "browserCheck")[0];
  assert.ok(callback);
  for (const name of ["rawBefore", "pinBefore", "onsiteBefore", "beforeReport"]) {
    const baseline = declaration(fn, name);
    assert.ok(baseline && invocation[0].pos < baseline.pos && baseline.pos < callback.pos, name);
  }
  assert.ok(calls(fn, "raw").some((call) => call.pos > callback.pos));
  assert.ok(calls(fn, "receipts").some((call) => call.pos > callback.pos));
  assert.ok(calls(fn, "report").some((call) => call.pos > callback.pos));
  const run = calls(journey, "checkEventChannels")[0];
  assert.equal(run.arguments.length, 3);
  assert.equal(run.arguments[2].getText(), "prepare");
});

test("browser traffic is intercepted at explicit loopback origins with no worker or real-auth connection", () => {
  assert.equal(declaration(journey, "origin").initializer.text, "https://127.0.0.1:3131");
  assert.equal(declaration(journey, "staticOrigin").initializer.text, "http://127.0.0.1:3131");
  assert.equal(declaration(journey, "localFetch").initializer.getText(), "globalThis.fetch");
  const context = calls(journey, "newContext")[0];
  assert.equal(property(context.arguments[0], "serviceWorkers")?.text, "block");
  const route = calls(journey, "route").find((call) => call.arguments[0]?.text === "**/*");
  assert.ok(route && ts.isArrowFunction(route.arguments[1]));
  const interceptor = route.arguments[1];
  const originGuard = nodes(interceptor, ts.isIfStatement).find((node) =>
    /url\.origin\s*!==\s*origin/.test(node.expression.getText()));
  assert.ok(originGuard && calls(originGuard.thenStatement, "abort").length === 1);
  const api = calls(interceptor, "fetch")[0];
  assert.ok(api && originGuard.pos < api.pos);
  assert.ok(ts.isNewExpression(api.arguments[0]));
  assert.ok(literals(api.arguments[0]).includes("https://attendance-auth.invalid"));
  const auth = calls(journey, "withAttendanceApplicationAuth")[0];
  assert.equal(auth.arguments[1].getText(), "transport.rpc");
  assert.ok(auth.pos < route.pos && route.pos < calls(journey, "newPage")[0].pos);
  assert.ok(literals(journey).includes("--event-channels-shell"));
});

test("read-only endpoint gate precedes real handler defaults, with explicit SDK principal and no cookie fallback", () => {
  const table = declaration(journey, "handlers");
  const endpoints = nodes(table, ts.isArrayLiteralExpression)
    .filter((node) => node.elements.length === 2 && node.elements.every(ts.isStringLiteral))
    .map((node) => node.elements[0].text);
  assert.deepEqual(endpoints.sort(), ["corrections", "corrections/context", "event-channels", "history", "records", "scoped-timesheet",
    "scoped-timesheet-context", "self", "session", "unified-timesheet"].sort());
  const dispatch = nodes(journey, (node) => ts.isCallExpression(node) &&
    ts.isElementAccessExpression(node.expression) && node.expression.expression.getText() === "handlers");
  assert.equal(dispatch.length, 1);
  const overrides = dispatch[0].arguments[1];
  assert.ok(ts.isObjectLiteralExpression(overrides));
  assert.deepEqual(overrides.properties.map((entry) => entry.name.getText()).sort(), ["accessEnabled", "allow", "enabled", "entitlement"].sort(),
    "authentication and execution must use unchanged production defaults");
  const gate = calls(journey, "assert").find((call) => call.arguments[1]?.text === "shell_browser_business_writes_forbidden");
  assert.ok(gate && gate.pos < dispatch[0].pos);
  assert.deepEqual(literals(gate.arguments[0]).sort(), ["GET", "event-channels", "/api/merchant-enterprise/employees/accept"].sort());
  assert.match(gate.arguments[0].getText(), /request\.method\(\)\s*===\s*['"]GET['"]/);
  const explicit = calls(journey, "assert").find((call) => call.arguments[1]?.text === "explicit_employee_token_required");
  assert.ok(explicit && explicit.pos < dispatch[0].pos);
  assert.ok(literals(explicit).includes("x-merchant-access-token"));
  const noCookie = calls(journey, "equal").find((call) =>
    literals(call.arguments[0]).includes("cookie") && call.arguments[1]?.kind === ts.SyntaxKind.NullKeyword);
  assert.ok(noCookie && noCookie.pos < dispatch[0].pos);
  const identity = calls(journey, "resolveValidatedMerchantEnterpriseAuthContext")[0];
  const shell = calls(journey, "serveShell")[0];
  assert.ok(identity && shell && identity.pos < shell.pos);
  assert.equal(shell.arguments[1].getText(), "identity.user.id");
  for (const name of ["setSession", "addCookies", "addInitScript"]) assert.equal(calls(journey, name).length, 0);
});

test("browser and held response cleanup stays in finally and does not persist artifacts", () => {
  const cleanup = nodes(journey, ts.isTryStatement).map((node) => node.finallyBlock).filter(Boolean)
    .find((block) => calls(block, "kill").length > 0);
  assert.ok(cleanup);
  assert.equal(calls(cleanup, "releaseHeld").length, 1);
  assert.equal(calls(cleanup, "close").length, 1);
  assert.equal(calls(cleanup, "kill").length, 1);
  assert.ok(calls(cleanup, "once").some((call) => call.arguments[1]?.text === "exit"));
  assert.ok(nodes(cleanup, ts.isAwaitExpression).some((node) => node.expression.getText() === "ended"));
  const child = calls(journey, "spawn")[0];
  assert.equal(property(child.arguments[2], "windowsHide")?.kind, ts.SyntaxKind.TrueKeyword);
  for (const source of [fixture, harness, journey]) absentSideEffects(source);
  assert.equal(calls(journey, "setItem").length, 0, "a browser journey must not seed auth or attendance storage");
  assert.equal(calls(journey, "download").length, 0);
});

test("logout navigation awaits server completion and SDK storage removal without clearing storage itself", () => {
  const nav = declaration(journey, "nav")?.initializer;
  assert.ok(nav && ts.isArrowFunction(nav));
  const logout = declaration(nav, "logout");
  assert.ok(logout && ts.isConditionalExpression(logout.initializer));
  const response = calls(logout, "waitForResponse")[0];
  assert.ok(response && literals(response).includes("/auth/v1/logout"));
  assert.ok(nodes(response, ts.isBinaryExpression).some((node) =>
    ts.isCallExpression(node.left) && ts.isPropertyAccessExpression(node.left.expression) &&
    node.left.expression.name.text === "status" && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isNumericLiteral(node.right) && node.right.text === "204"));
  const click = calls(nav, "click").find((call) => call.pos > logout.pos);
  assert.ok(click && ts.isAwaitExpression(click.parent));
  const branch = nodes(nav, ts.isIfStatement).find((node) => node.expression.getText() === "logout");
  assert.ok(branch && branch.pos > click.pos);
  const completion = nodes(branch, ts.isAwaitExpression).find((node) => node.expression.getText() === "logout");
  const storage = calls(branch, "waitForFunction")[0];
  assert.ok(completion && storage && completion.pos < storage.pos && ts.isAwaitExpression(storage.parent));
  const predicate = storage.arguments[0];
  assert.ok(ts.isArrowFunction(predicate) && ts.isPrefixUnaryExpression(predicate.body));
  assert.equal(predicate.body.operator, ts.SyntaxKind.ExclamationToken);
  assert.deepEqual(calls(predicate, "keys").map((call) => call.arguments[0].getText()).sort(), ["localStorage", "sessionStorage"]);
  assert.ok(calls(predicate, "endsWith").some((call) => call.arguments[0]?.text === "-enterprise-auth-token"));
  const visible = calls(branch, "waitFor").find((call) => call.pos > storage.pos);
  assert.ok(visible && ts.isAwaitExpression(visible.parent));
  assert.ok(literals(visible).includes("登录企业工作台"));
  assert.equal(nodes(nav, ts.isReturnStatement).length, 0, "helper must not return before the awaited logout fences");
  for (const name of ["removeItem", "clear", "setItem"]) assert.equal(calls(nav, name).length, 0,
    "test must observe SDK cleanup, never manufacture a signed-out storage state");
});
