import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { shouldApplyEnterpriseAuthEvent as accepts } from "./merchantEnterpriseAuthEvents";
import { createEnterpriseLogoutBoundary } from "./merchantEnterpriseLogout";

const a = { access_token: "a-access", refresh_token: "a-refresh", user: { id: "employee-a" } };
const b = { access_token: "b-access", refresh_token: "b-refresh", user: { id: "employee-b" } };
const unblocked = () => false;
const savedA = () => JSON.stringify(a);

test("only an exact current-tab credential is accepted, never another account or same-user token", () => {
  assert.equal(accepts(a, savedA, unblocked), true);
  for (const incoming of [b, { ...a, access_token: "other-tab-access" }, { ...a, refresh_token: "other-tab-refresh" },
    { ...a, user: b.user }, undefined, false, {}, { ...a, user: null }, { ...a, refresh_token: "" }]) {
    assert.equal(accepts(incoming, savedA, unblocked), false);
  }
  assert.equal(accepts(null, savedA, unblocked), false, "foreign SIGNED_OUT/old INITIAL_SESSION cannot clear this tab");
});

test("storage is checked on every notification including rotation and account replacement", () => {
  let raw: string | null = JSON.stringify(a);
  const read = () => raw;
  assert.equal(accepts(a, read, unblocked), true);
  const refreshed = { ...a, access_token: "a-refreshed-access", refresh_token: "a-refreshed-refresh" };
  raw = JSON.stringify(refreshed);
  assert.equal(accepts(a, read, unblocked), false);
  assert.equal(accepts(refreshed, read, unblocked), true);
  raw = JSON.stringify(b);
  assert.equal(accepts(refreshed, read, unblocked), false);
  assert.equal(accepts(b, read, unblocked), true);
  raw = null;
  assert.equal(accepts(b, read, unblocked), false);
  assert.equal(accepts(null, read, unblocked), true);
});

test("missing, malformed and inaccessible persistence never permits a signed-in event", () => {
  for (const read of [() => null, () => "", () => "{", () => "null", () => "[]", () => "{}",
    () => JSON.stringify({ ...a, user: {} }), () => { throw Error("storage unavailable"); }]) {
    assert.equal(accepts(a, read, unblocked), false);
    assert.equal(accepts(undefined, read, unblocked), false);
    assert.equal(accepts(null, read, unblocked), true, "null remains fail closed");
  }
});

test("logout blocking is checked before reading the SDK-only revocation snapshot", () => {
  let reads = 0;
  const read = () => { reads++; return JSON.stringify(a); };
  assert.equal(accepts(a, read, () => true), false);
  assert.equal(accepts(null, read, () => true), true);
  assert.equal(accepts(undefined, read, () => true), false);
  assert.equal(reads, 0);
});

test("real logout boundary preserves blocking during remote revocation then permits explicit new login", async () => {
  const key = "synthetic-enterprise-auth-token", values = new Map([[key, JSON.stringify(a)]]);
  const boundary = createEnterpriseLogoutBoundary({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  }, key);
  const read = () => boundary.storage.getItem(key);
  await boundary.signOut(async () => {
    assert.equal(read(), JSON.stringify(a));
    assert.equal(accepts(a, read, boundary.isBlocked), false);
    assert.equal(accepts(null, read, boundary.isBlocked), true);
    return { error: null };
  });
  assert.equal(accepts(a, read, boundary.isBlocked), false);
  await boundary.signIn(async () => {
    boundary.storage.setItem(key, JSON.stringify(b));
    assert.equal(accepts(b, read, boundary.isBlocked), true);
    return { error: null };
  });
  assert.equal(accepts(a, read, boundary.isBlocked), false);
});

test("every employee auth subscriber passes through the common filter before UI/generation callbacks", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  for (const path of ["src/app/enterprise/EnterpriseSelectorClient.tsx", "src/app/enterprise/[siteId]/EnterprisePortalClient.tsx",
    "src/components/enterprise/MerchantAttendanceOnsitePhone.tsx"]) {
    const source = read(path);
    assert.match(source, /onEnterpriseAuthStateChange\(\(_event, session\) =>/);
    assert.doesNotMatch(source, /\.auth\.onAuthStateChange\(/);
  }
  const source = read("src/lib/merchantEnterpriseSupabase.ts");
  assert.match(source, /return merchantEnterpriseSupabase\.auth\.onAuthStateChange\(\(event, session\) => \{/);
  assert.match(source, /if \(!shouldApplyEnterpriseAuthEvent\([\s\S]*enterpriseLogout\.storage\.getItem\(enterpriseStorageKey\)[\s\S]*\)\) return;\s*callback\(event, session\)/);
  assert.match(source, /persistSession: true/);
  const predicate = read("src/lib/merchantEnterpriseAuthEvents.ts");
  assert.doesNotMatch(predicate, /\.auth\.|\.setItem\(|\.removeItem\(|setTimeout\(|async |await |BroadcastChannel\(/);
});
