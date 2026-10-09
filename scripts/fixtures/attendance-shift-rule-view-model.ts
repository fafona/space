// Node-only pure fixture: derive compact evidence through the real155 byte
// validator/server projection. Browser harnesses must inject its resulting JSON,
// never bundle this fixture or the full archival/server modules.
import { projectShiftRuleView } from "../../src/lib/merchantAttendanceShiftRuleView.server";
import { shiftRuleBindingWire, shiftRuleBindingQuery, shiftRuleBindingActor, shiftRuleBindingId } from "./attendance-shift-rule-binding-model";
export const shiftRuleViewId = shiftRuleBindingId;
export const shiftRuleViewActor = shiftRuleBindingActor;
export const shiftRuleViewQuery = shiftRuleBindingQuery;
export function shiftRuleViewWire(status: "verified" | "unverified" | "missing" = "verified", withLayers = false) {
  // Consumers mutate a detached synthetic copy when testing rejected payloads.
  return structuredClone(projectShiftRuleView(shiftRuleBindingWire(status, withLayers), shiftRuleViewQuery, shiftRuleViewActor));
}
export const shiftRuleViewHttp = (status: "verified" | "unverified" | "missing" = "verified", withLayers = false, moduleEnabled = true) =>
  ({ ok: true, moduleEnabled, data: shiftRuleViewWire(status, withLayers) });
