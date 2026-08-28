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
