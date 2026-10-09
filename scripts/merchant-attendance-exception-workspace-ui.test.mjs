import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
test("both exception entries are default-off and lazy, while owner config form stays mounted", () => {
  for (const file of ["Admin", "Self"]) {
    const s = read(`src/components/enterprise/MerchantAttendance${file}Panel.tsx`);
    assert.match(s, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_EXCEPTION_WORKSPACE_ENABLED === "1"/);
    assert.match(s, /lazy\(\(\) => import\("\.\/MerchantAttendanceExceptionWorkspace"\)\)/);
    assert.match(s, new RegExp(`access="${file === "Admin" ? "owner" : "self"}"`));
  }
  assert.match(read("src/components/enterprise/MerchantAttendanceAdminPanel.tsx"), /section hidden=\{missingOpen \|\| exceptionOpen \|\| correctionReviewOpen \|\| correctionControlsOpen \|\| revisionApprovalOpen \|\| \(timesheetEnabled && timesheetOpen\)\}/);
  assert.match(read("src/components/enterprise/MerchantAttendanceSelfPanel.tsx"), /if \(exceptionOpen\) return;/);
});
test("workspace guards note forms only, mounts one child, and never sends internal notes or automatic writes", () => {
  const s = read("src/components/enterprise/MerchantAttendanceExceptionWorkspace.tsx"), core = read("src/lib/merchantAttendanceExceptionWorkspace.ts");
  assert.match(s, /closest\("\[data-attendance-draft\]"\)/); assert.match(s, /StepBoundary key=\{token\}/);
  assert.match(s, /s.target.step === "review" && access === "owner" \?/); assert.match(s, /放弃未提交输入并继续/);
  assert.doesNotMatch(core, /setItem|removeItem|fetch\(|setInterval|geolocation/);
  assert.doesNotMatch(s, /method: "POST"|navigator.geolocation|dangerouslySetInnerHTML/);
});
test("same-case navigation passes IDs only and query actions cannot silently erase a dirty message", () => {
  for (const name of ["Review", "Discussion"]) {
    const s = read(`src/components/enterprise/MerchantAttendanceLocation${name}Panel.tsx`);
    assert.match(s, /data-attendance-draft/); assert.match(s, /if \(draftDirty\) return;/);
    assert.match(s, /onWorkspaceActivity\?/); assert.match(s, /onNavigate\(/);
    assert.doesNotMatch(s, /onNavigate\([^;\n]*note/);
  }
});
