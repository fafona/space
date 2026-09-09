import assert from "node:assert/strict";
import test from "node:test";
import { maintenanceProbeHeaders } from "./maintenance-control-probe-headers.mjs";
import { readMaintenanceProbeContext } from "./production-maintenance-control.mjs";

const token = "a".repeat(64);
const context = () => ({ publicSupabaseUrl: "https://database.example/supabase", token });
const header = { "x-faolla-maintenance-control": token };
test("normal checks never read private host state", () => {
  assert.equal(readMaintenanceProbeContext({}), null);
  assert.deepEqual(maintenanceProbeHeaders("https://database.example/supabase/rest/v1/pages", "GET", {}), {});
});
test("partial or malformed operation markers fail closed", () => {
  assert.throws(() => readMaintenanceProbeContext({ FAOLLA_MAINTENANCE_APP_NAME: "../other" }), /maintenance_probe_binding_invalid/);
  assert.throws(() => readMaintenanceProbeContext({ FAOLLA_MAINTENANCE_TARGET_SHA: "a".repeat(40) }), /maintenance_probe_binding_invalid/);
});
test("only exact public-origin control paths receive authorization", () => {
  for (const route of ["rest/v1/", "rest/v1/pages?select=id&limit=1", "auth/v1/settings"]) {
    assert.deepEqual(maintenanceProbeHeaders(`https://database.example/supabase/${route}`, "GET", {}, context), header);
  }
  assert.deepEqual(maintenanceProbeHeaders("https://database.example/supabase/auth/v1/token?grant_type=password", "POST", {}, context), header);
});
test("never authorize unrelated hosts, prefixes, methods or writes", () => {
  for (const [url, method] of [
    ["http://database.example/supabase/rest/v1/pages", "GET"],
    ["https://database.example.evil/supabase/rest/v1/pages", "GET"],
    ["http://127.0.0.1:8000/rest/v1/pages", "GET"],
    ["https://database.example/supabase-other/rest/v1/pages", "GET"],
    ["https://database.example/supabase/rest/v1/pages", "POST"],
    ["https://database.example/supabase/rest/v1/rpc/write", "GET"],
    ["https://database.example/supabase/auth/v1/token?grant_type=refresh_token", "POST"],
    ["https://database.example/supabase/auth/v1/token?grant_type=password&x=y", "POST"],
  ]) assert.deepEqual(maintenanceProbeHeaders(url, method, {}, context), {});
});
test("reject credentials, fragment, invalid source and malformed secret", () => {
  assert.throws(() => maintenanceProbeHeaders("https://user:pass@database.example/supabase/rest/v1/pages", "GET", {}, context), /maintenance_probe_url_invalid/);
  assert.throws(() => maintenanceProbeHeaders("https://database.example/supabase/rest/v1/pages#fragment", "GET", {}, context), /maintenance_probe_url_invalid/);
  assert.throws(() => maintenanceProbeHeaders("https://database.example/rest/v1/pages", "GET", {}, () => ({ publicSupabaseUrl: "http://database.example", token })), /maintenance_probe_url_invalid/);
  assert.throws(() => maintenanceProbeHeaders("https://database.example/rest/v1/pages", "GET", {}, () => ({ publicSupabaseUrl: "https://database.example", token: "invalid" })), /maintenance_probe_context_invalid/);
});
