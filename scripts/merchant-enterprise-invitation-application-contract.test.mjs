import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath.split("/")), "utf8");
}

const portalPath =
  "src/app/enterprise/[siteId]/EnterprisePortalClient.tsx";
const portalPagePath = "src/app/enterprise/[siteId]/page.tsx";
const acceptRoutePath =
  "src/app/api/merchant-enterprise/employees/accept/route.ts";
const employeeRoutePath =
  "src/app/api/merchant-enterprise/employees/route.ts";

test("acceptance hashes the URL bearer token before the service-role RPC", () => {
  const source = read(acceptRoutePath);
  assert.match(
    source,
    /createHash\("sha256"\)\.update\(token,\s*"utf8"\)\.digest\("hex"\)/,
  );
  assert.match(
    source,
    /service\.rpc\("faolla_accept_merchant_employee_invitation_v1",[\s\S]*invitation_version:\s*invitationVersion,[\s\S]*token_hash:\s*invitationTokenHash\(invitationToken\)/,
  );
  assert.doesNotMatch(
    source,
    /p_input:\s*\{[\s\S]{0,400}invitation_token:\s*invitationToken/,
  );
});

test("delivery URLs carry the raw credential only to the enterprise callback", () => {
  const source = read(employeeRoutePath);
  assert.match(
    source,
    /new URL\(\s*`\/enterprise\/\$\{encodeURIComponent\(siteId\)\}`,[\s\S]*redirect\.searchParams\.set\("iv",\s*String\(invitationVersion\)\)[\s\S]*redirect\.searchParams\.set\("it",\s*invitationToken\)/,
  );
  assert.match(
    source,
    /reserveMerchantEnterpriseEmployeeInvitation\(store,[\s\S]*tokenHash:\s*secret\.tokenHash/,
  );
  assert.doesNotMatch(
    source,
    /reserveMerchantEnterpriseEmployeeInvitation\(store,[\s\S]{0,400}(?:token|tokenHash):\s*secret\.token(?:,|\s*\})/,
  );
});

test("portal captures credentials before scrubbing them and before exchanging the auth code", () => {
  const source = read(portalPath);
  const captureVersion = source.indexOf(
    'const invitationVersionText = url.searchParams.get("iv")',
  );
  const captureToken = source.indexOf(
    'const invitationToken = url.searchParams.get("it")',
  );
  const retainCredential = source.indexOf(
    "invitationCredentialRef.current = {",
  );
  const deleteVersion = source.indexOf('url.searchParams.delete("iv")');
  const deleteToken = source.indexOf('url.searchParams.delete("it")');
  const replaceUrl = source.indexOf("window.history.replaceState(");
  const exchangeCode = source.indexOf(
    "supabase.auth.exchangeCodeForSession(code)",
  );

  for (const index of [
    captureVersion,
    captureToken,
    retainCredential,
    deleteVersion,
    deleteToken,
    replaceUrl,
    exchangeCode,
  ]) {
    assert.ok(index >= 0);
  }
  assert.ok(captureVersion < retainCredential);
  assert.ok(captureToken < retainCredential);
  assert.ok(retainCredential < deleteVersion);
  assert.ok(retainCredential < deleteToken);
  assert.ok(deleteVersion < replaceUrl);
  assert.ok(deleteToken < replaceUrl);
  assert.ok(replaceUrl < exchangeCode);
  assert.match(source, /url\.searchParams\.delete\("code"\)/);
  assert.doesNotMatch(
    source,
    /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\([\s\S]{0,100}(?:invitation|["']it["'])/i,
  );
});

test("portal coalesces simultaneous auth callbacks and consumes credentials only after success", () => {
  const source = read(portalPath);
  assert.match(
    source,
    /if \(!token \|\| acceptedAccessTokenRef\.current === token\) return;/,
  );
  assert.match(
    source,
    /if \(acceptanceInFlightRef\.current\) return acceptanceInFlightRef\.current;/,
  );
  const acceptCall = source.indexOf(
    "acceptEnterpriseMembership(siteId, token, invitation)",
  );
  const markAccepted = source.indexOf(
    "acceptedAccessTokenRef.current = token",
    acceptCall,
  );
  const consumeCredential = source.indexOf(
    "invitationCredentialRef.current = null",
    acceptCall,
  );
  const clearInFlight = source.indexOf(
    "acceptanceInFlightRef.current = null",
    acceptCall,
  );
  assert.ok(acceptCall >= 0);
  assert.ok(acceptCall < markAccepted);
  assert.ok(markAccepted < consumeCredential);
  assert.ok(consumeCredential < clearInFlight);
  assert.match(
    source,
    /supabase\.auth\.onAuthStateChange\([\s\S]*ensureMembershipAccepted\(token\)/,
  );
});

test("portal explains that a disabled employee account needs owner action", () => {
  const source = read(portalPath);
  assert.match(
    source,
    /payload\?\.error === "employee_account_disabled"[\s\S]{0,180}员工账号已停用，请联系企业负责人/,
  );
});

test("enterprise callback forbids credential referrer leakage", () => {
  const source = read(portalPagePath);
  assert.match(
    source,
    /export const metadata:\s*Metadata\s*=\s*\{[\s\S]*referrer:\s*"no-referrer"/,
  );
});
