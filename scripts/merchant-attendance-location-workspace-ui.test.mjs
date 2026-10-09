import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("owner location workspace entry is lazy, opt-in, selected from bounded admin locations and independent of write entitlement", () => {
  const admin = read("src/components/enterprise/MerchantAttendanceAdminPanel.tsx");
  assert.match(admin, /lazy\(\(\) => import\("\.\/MerchantAttendanceLocationWorkspace"\)\)/);
  assert.match(admin, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_LOCATION_WORKSPACE_ENABLED === "1"/);
  assert.match(admin, /locationWorkspaceEnabled && view === "locations" && !chooser/);
  assert.match(admin, /disabled=\{busy \|\| !!state.pending \|\| !!editor \|\| state.phase !== "ready"\}/);
  assert.match(admin, /locationId=\{locationWorkspace.id\}/);
  assert.match(admin, /onClose=.*client.load\("locations", null, search\)/);
});
test("workspace mounts only one step and late callbacks are token-bound; no hidden polling, writes or coordinates", () => {
  const panel = read("src/components/enterprise/MerchantAttendanceLocationWorkspace.tsx"), core = read("src/lib/merchantAttendanceLocationWorkspace.ts");
  for (const step of ["policy", "setup", "notice"]) assert.ok(panel.includes(`target?.step === "${step}" &&`));
  assert.match(panel, /key=\{s.token\}/); assert.match(core, /token !== this.state.token/);
  assert.match(panel, /onChangeCapture=\{workspace.edit\}/); assert.match(panel, /放弃未保存输入并继续/);
  assert.match(panel, /window.addEventListener\("beforeunload"/);
  assert.doesNotMatch(core, /setItem|removeItem|sessionStorage|localStorage|fetch\(|setInterval|geolocation/);
  assert.doesNotMatch(panel, /setInterval|navigator.geolocation|method: "POST"|dangerouslySetInnerHTML/);
});
test("all real child panels report uncertainty and receipt identity without changing their mutation clients", () => {
  for (const file of ["Policy", "Setup", "Notice"]) {
    const panel = read(`src/components/enterprise/MerchantAttendanceLocation${file}Panel.tsx`);
    assert.match(panel, /onWorkspaceActivity\?: AttendanceWorkspaceReporter/);
    assert.match(panel, /useAttendanceLocationWorkspaceActivity\(onWorkspaceActivity/);
  }
  const hook = read("src/components/enterprise/useAttendanceLocationWorkspaceActivity.ts");
  assert.match(hook, /phase === "idle" \|\| phase === "loading" \|\| phase === "saving"/);
  assert.match(hook, /report\?\.\(\{ busy, pendingId, receiptId \}\)/);
});
