import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./page.tsx", import.meta.url);

test("login entry selection exposes the isolated enterprise employee sign-in", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const viewportStart = source.indexOf("const formViewportClassName = shouldShowEntrySelection");
  const entryViewportEnd = source.indexOf("\n    :", viewportStart);
  assert.ok(viewportStart >= 0 && entryViewportEnd > viewportStart, "entry viewport should remain auditable");
  const entryViewport = source.slice(viewportStart, entryViewportEnd);

  assert.match(source, /const employeeEntryLabel =/);
  assert.match(source, /window\.location\.assign\("\/enterprise"\)/);
  assert.match(source, /employee email invited by an owner/);
  assert.match(entryViewport, /overflow-y-auto overscroll-contain/);
  assert.doesNotMatch(entryViewport, /overflow-hidden/);
});

test("staff identities keep the owner-session security boundary and receive actionable guidance", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const staffIdentityGuard = source.indexOf("if (/merchant_staff_identity_forbidden/i.test(message))");
  const genericMerchantFailure = source.indexOf("if (/merchant_(login|signup)_");

  assert.ok(staffIdentityGuard >= 0, "staff identity failures should be recognized explicitly");
  assert.ok(
    genericMerchantFailure > staffIdentityGuard,
    "staff identity guidance should be selected before generic merchant backend errors",
  );
  assert.match(source, /msg === merchantStaffIdentityMessage/);
  assert.match(source, /Employee accounts cannot be converted directly into owner accounts/);
});

test("Google OAuth uses the production allow-listed callback bridge", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const oauthStart = source.indexOf("async function signInWithGoogle");
  const oauthEnd = source.indexOf("signInWithGoogleRef.current = signInWithGoogle", oauthStart);

  assert.ok(oauthStart >= 0 && oauthEnd > oauthStart, "Google OAuth start flow should remain auditable");
  const oauthFlow = source.slice(oauthStart, oauthEnd);
  assert.match(oauthFlow, /resolveGoogleOAuthRedirectOrigin\(window\.location\.origin\)/);
  assert.match(oauthFlow, /callbackUrl\.searchParams\.set\("oauth", "google"\)/);
  assert.match(oauthFlow, /redirectTo: callbackUrl\.toString\(\)/);
});

test("personal and merchant sign-in share one entry and registration lives in the entry footer", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const userEntryLabel = .*"用户登录入口"/);
  assert.match(source, /data-login-entry-footer className="mt-auto/);
  assert.match(source, /onClick=\{\(\) => selectSignupView\("personal"\)\}/);
  assert.doesNotMatch(source, /personalEntryDescription|merchantEntryDescription|showAutoSwitchedEntryNotice/);
  assert.match(source, /signInViaServer\(account, password, requestedEntryAccountType\)/);
  assert.match(source, /\.\.\.\(preferredAccountType \? \{ preferredAccountType \} : \{\}\)/);
});

test("registration and verification never render the sign-in action group", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const isRegistrationFlow = authView !== "signin" \|\| Boolean\(pendingSignupVerificationEmail\)/);
  assert.match(source, /!isRegistrationFlow \? <div data-login-signin-actions/);
  assert.match(source, /!pendingSignupVerificationEmail \? \(\s*<button\s*data-auth-primary-action=/);
  assert.match(source, /activeSignupAccountType && !pendingSignupVerificationEmail \? \(/);
  const signUpStart = source.indexOf("async function signUp(");
  const signUpEnd = source.indexOf("function selectSignupView(", signUpStart);
  assert.ok(signUpStart >= 0 && signUpEnd > signUpStart);
  const signUp = source.slice(signUpStart, signUpEnd);
  assert.match(signUp, /if \(needsConfirmation\) \{\s*setPendingSignupVerificationEmail/);
  assert.doesNotMatch(signUp, /setAuthView\("signin"\)/, "sending a verification code must not switch back to login");
});
