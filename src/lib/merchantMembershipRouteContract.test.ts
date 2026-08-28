import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("personal membership join, check-in and leave remain personal-session flows", () => {
  const source = readSource("src/app/api/memberships/route.ts");
  const post = source.slice(
    source.indexOf("export async function POST"),
    source.indexOf("export async function PATCH"),
  );
  const patch = source.slice(source.indexOf("export async function PATCH"));

  assert.match(post, /resolvePersonalAccountSessionFromRequest\(request\)/);
  assert.match(post, /resolvePersonalAccountSessionFromFrontendAuthProofPayload/);
  assert.match(post, /joinMerchantMembership\(\{ siteId, siteName, session, profile:/);
  assert.match(post, /toPersonalMembershipCard\(membership\)/);

  assert.match(patch, /if \(action === "member_checkin"\)/);
  assert.match(patch, /const session = await resolvePersonalAccountSessionFromRequest\(request\)/);
  assert.match(patch, /awardMerchantMembershipRulePoints\(\{[\s\S]*?session,[\s\S]*?action: "checkin"/);
  assert.match(patch, /leaveMerchantMembership\(\{ siteId, session \}\)/);
  assert.match(patch, /membership: toPersonalMembershipCard\(membership\)/);
  assert.doesNotMatch(source, /resolveMerchantSessionFromRequest/);
  assert.match(
    post,
    /headers\.has\("x-merchant-access-token"\)[\s\S]+business_scope_required[\s\S]+resolvePersonalAccountSessionFromRequest/,
  );
  assert.match(
    patch,
    /headers\.has\("x-merchant-access-token"\)[\s\S]+!merchantPermission[\s\S]+business_scope_required[\s\S]+resolvePersonalAccountSessionFromRequest/,
  );
});

test("owner settings requests retain scope-less full update compatibility", () => {
  const source = readSource("src/app/api/membership-settings/route.ts");
  assert.match(source, /if \(actor\.type === "employee"\) \{[\s\S]*?membership_settings_scope_required/);
  assert.match(source, /updateMerchantMembershipSettings\(\{[\s\S]*?settings: body\?\.settings,[\s\S]*?view: body\?\.view/);
  assert.match(source, /actor\.type === "employee" && scope[\s\S]*?selectMerchantMembershipSettingsForEmployeeScope[\s\S]*?: settings/);
  assert.match(source, /if \(actor\.type !== "owner"\)[\s\S]*?owner_required/);
});

test("employee membership reads never apply persistent scheduled point rules", () => {
  const source = readSource("src/app/api/memberships/route.ts");
  assert.match(
    source,
    /applyScheduledRules:\s*session\.actor\.type === "owner"\s*&&/,
  );
});
