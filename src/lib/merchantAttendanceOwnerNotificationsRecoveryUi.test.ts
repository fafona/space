import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

// These checks cover wiring, not a real Supabase login. Client and route tests
// exercise pending-ID recovery independently of this actual-auth page wrapper.
test("owner-notification recovery verifies actual Auth before mounting any local slot reader", () => {
  const page = source("../components/enterprise/MerchantAttendanceOwnerNotificationsRecoveryPage.tsx");
  for (const guard of ["boundedDelegationRecoveryAuth(() => supabase.auth.getSession())",
    "boundedDelegationRecoveryAuth(() => supabase.auth.getUser(session.access_token), timeoutMs)",
    "result.data.user?.id !== session.user.id", "generation.current !== epoch", "isEnterpriseLogoutBlocked()",
    "currentAuth.current === auth", "generation.current === auth.generation", "queueMicrotask",
    "credentials: \"omit\"", "redirect: \"error\"", "x-merchant-access-token", "isCurrentAuth={isCurrentAuth}"])
    assert.ok(page.includes(guard), guard);
  assert.match(page, /checking \? [\s\S]*? : auth\s*\? <RecoverySelection/);
  assert.match(page, /key=\{auth.generation\}/);
  assert.doesNotMatch(page, /localStorage|Object\.keys\(sessionStorage|\.key\(|\.removeItem\(|\.setItem\(/);
});

test("recovery page selects only one account-and-site slot and cannot enable inbox reads or a new mark", () => {
  const page = source("../components/enterprise/MerchantAttendanceOwnerNotificationsRecoveryPage.tsx");
  assert.match(page, /isCurrentAuth\(\) && \/\^\[0-9\]\{8\}\$\/\.test\(site\)/);
  assert.match(page, /siteId=\{selected\} actorId=\{actorId\}/);
  assert.match(page, /enabled=\{false\} recoveryOnly/);
  assert.match(page, /onClose=\{\(\) => setSelected\(null\)\}/);
  assert.doesNotMatch(page, /NEXT_PUBLIC_FAOLLA_ATTENDANCE|memberships|\.markRead\(|\.load\(|\.recover\(|method: "POST"/);
});

test("independent dynamic noindex route is reachable from existing recovery and owner launcher", () => {
  const route = source("../app/enterprise/attendance-owner-notifications-recovery/page.tsx");
  for (const setting of ['dynamic = "force-dynamic"', "revalidate = 0", 'referrer: "no-referrer"', "index: false, follow: false", "<MerchantAttendanceOwnerNotificationsRecoveryPage/>"])
    assert.ok(route.includes(setting), setting);
  for (const path of ["../components/enterprise/MerchantAttendanceDelegationRecoveryPage.tsx", "../components/enterprise/MerchantAttendanceOwnerNotificationsLauncher.tsx"])
    assert.match(source(path), /href="\/enterprise\/attendance-owner-notifications-recovery"/);
  assert.doesNotMatch(route, /isOwner|moduleEnabled|NEXT_PUBLIC_FAOLLA_ATTENDANCE/);
});
