import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), ...relativePath.split("/")), "utf8");
}

const selectorPath = "src/app/enterprise/EnterpriseSelectorClient.tsx";
const selectorPagePath = "src/app/enterprise/page.tsx";
const portalPath = "src/app/enterprise/[siteId]/EnterprisePortalClient.tsx";
const portalPagePath = "src/app/enterprise/[siteId]/page.tsx";
const authGenerationPath = "src/lib/merchantEnterpriseAuthGeneration.ts";
const membershipNormalizerPath = "src/lib/merchantEnterpriseMembershipSelector.ts";
const selector = read(selectorPath);
const selectorPage = read(selectorPagePath);
const portal = read(portalPath);
const portalPage = read(portalPagePath);
const authGeneration = read(authGenerationPath);
const membershipNormalizer = read(membershipNormalizerPath);

test("enterprise selector reuses the isolated employee session and supports login recovery", () => {
  assert.match(selector, /merchantEnterpriseSupabase\s+as\s+supabase/);
  assert.match(selector, /supabase\.auth\.signInWithPassword\(/);
  assert.match(selector, /supabase\.auth\.resetPasswordForEmail\(/);
  assert.match(selector, /`\$\{window\.location\.origin\}\/enterprise`/);
  assert.match(selector, /supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(selector, /supabase\.auth\.setSession\(/);
  assert.match(selectorPage, /referrer:\s*["']no-referrer["']/);
});

test("membership discovery is a private no-store request with an explicit employee token", () => {
  const request = selector.match(
    /fetch\(["']\/api\/merchant-enterprise\/memberships["'],\s*\{[\s\S]{0,700}?\}\)/,
  )?.[0];
  assert.ok(request, "membership request is missing");
  assert.match(request, /method:\s*["']GET["']/);
  assert.match(request, /["']x-merchant-access-token["']:\s*requestToken/);
  assert.match(request, /credentials:\s*["']omit["']/);
  assert.match(request, /cache:\s*["']no-store["']/);
  assert.match(request, /signal:\s*controller\.signal/);
  assert.match(selector, /setMemberships\(\[\]\)[\s\S]{0,180}setMembershipLoadState\(["']loading["']\)/);
  const normalizePayload = selector.indexOf(
    "normalizeMerchantEnterpriseMembershipPayload(payload)",
  );
  const publishReady = selector.indexOf('setMembershipLoadState("ready")', normalizePayload);
  assert.ok(normalizePayload >= 0 && normalizePayload < publishReady);
  assert.match(
    selector,
    /catch \(error\)[\s\S]{0,300}setMemberships\(\[\]\)[\s\S]{0,160}setMembershipLoadState\(["']error["']\)/,
    "a malformed membership item must fail the complete response instead of becoming an empty success",
  );
  assert.match(selector, /normalizeMerchantEnterpriseMembershipPayload\(payload\)/);
  assert.match(membershipNormalizer, /payload\.ok !== true/);
});

test("session initialization and auth events share a latest-wins generation", () => {
  assert.match(authGeneration, /class MerchantEnterpriseAuthGeneration/);
  assert.match(authGeneration, /generation === this\.generation/);
  assert.match(authGeneration, /this\.currentSessionToken === token/);

  for (const source of [selector, portal]) {
    assert.match(source, /const initializationGeneration = authGeneration\.begin\(\)/);
    assert.match(
      source,
      /resolveSession\(initializationGeneration\)/,
      "initial session resolution must use the same generation guard as auth events",
    );
    const callback = source.match(
      /onAuthStateChange\(\(_event, session\) => \{([\s\S]*?)\n    \}\);/,
    )?.[1];
    assert.ok(callback, "auth callback is missing");
    if (source === portal) {
      assert.match(
        callback,
        /if \(authCallbackInProgressRef\.current\) return;\s*const generation = authGeneration\.begin\(\);/,
        "a stale INITIAL_SESSION must be ignored while the callback resolver owns the generation",
      );
    } else {
      assert.match(
        callback.trimStart(),
        /^const generation = authGeneration\.begin\(\);/,
        "every ordinary auth event, including sign-out, must invalidate older async work first",
      );
    }
    assert.match(callback, /authGeneration\.bindSessionToken\(generation, token\)/);
  }

  assert.match(
    portal,
    /ensureMembershipAccepted\(token\)[\s\S]{0,280}authGeneration\.isCurrent\(generation, token, cancelled\)[\s\S]{0,120}setAuthContext\(\{ siteId, token, generation \}\)/,
  );
  assert.match(
    selector,
    /authGenerationRef\.current\.isCurrent\(authGeneration, requestToken\)/,
    "membership results must not publish after their employee token is replaced",
  );

  const selectorCallback = selector.match(
    /onAuthStateChange\(\(_event, session\) => \{([\s\S]*?)\n    \}\);/,
  )?.[1];
  assert.ok(selectorCallback);
  assert.ok(
    selectorCallback.indexOf("clearMembershipScopeForAuthTransition") <
      selectorCallback.indexOf("setAuthContext"),
    "token A cards must be cleared in the same transition before token B is rendered",
  );
});

test("tenant navigation is locally constructed, explicit and remounts the destination", () => {
  assert.match(selector, /buildMerchantEnterpriseSitePath\(membership\.siteId\)/);
  assert.match(selector, /window\.location\.assign\(path\)/);
  assert.match(selector, /disabled=\{!membership\.enterable\}/);
  assert.match(selector, /当前有 1 家企业可以进入，请点击下方按钮继续/);
  assert.doesNotMatch(selector, /useRouter|router\.(?:push|replace)/);
  assert.doesNotMatch(
    selector,
    /useEffect\([\s\S]{0,400}enterMembership\(/,
    "a single membership must not create an automatic redirect loop",
  );
  assert.match(
    portal,
    /window\.location\.assign\(["']\/enterprise["']\)[\s\S]{0,180}切换企业/,
  );
  assert.match(portal, /if \(checking \|\| portalContextMismatch\)/);
  assert.ok(
    portal.includes('key={`${siteId}:${authContext?.generation ?? 0}`}'),
    "the manager must remount for a new auth generation even on the same site",
  );
  assert.match(portalPage, /<EnterprisePortalClient\s+key=\{siteId\}/);
});

test("enterprise authentication fields have explicit labels and errors are announced", () => {
  for (const [labelId, source] of [
    ["enterprise-portal-email", portal],
    ["enterprise-portal-password", portal],
    ["enterprise-portal-new-password", portal],
    ["enterprise-selector-new-password", selector],
  ]) {
    assert.match(source, new RegExp(`htmlFor=["']${labelId}["']`));
    assert.match(source, new RegExp(`id=["']${labelId}["']`));
  }
  assert.ok((portal.match(/role=["']alert["']/g) ?? []).length >= 2);
  assert.ok((selector.match(/role=["']alert["']/g) ?? []).length >= 3);
});

test("invitation acceptance coalesces only the same token, tenant and invitation version", () => {
  assert.match(
    portal,
    /invitationAcceptanceKey\(token,\s*siteId,\s*invitationVersion\)/,
  );
  assert.match(
    portal,
    /JSON\.stringify\(\[accessToken,\s*siteId,\s*invitationVersion\]\)/,
  );
  assert.match(
    portal,
    /acceptedAcceptanceKeysRef\.current\.has\(acceptanceKey\)/,
  );
  assert.match(
    portal,
    /acceptanceInFlightRef\.current\.get\(acceptanceKey\)/,
  );
  assert.match(
    portal,
    /acceptanceInFlightRef\.current\.set\(acceptanceKey,\s*acceptance\)/,
  );
});
