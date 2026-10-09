// 200 preparation calculator only. A checked source SHA is not database origin,
// a send grant, activation authority, acceptance, adoption, or a saved period.
// SQL must lock and recheck actual owner/delegate authority before any write.
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { resolveOperationalRuleSource, operationalRuleSourceTuple, type OperationalRuleSourceExpected, type OperationalRuleSourceIdentity } from "./merchantAttendanceOperationalRuleSource";
import { suggestOperationalCycleChoice, type OperationalCycleRange } from "./merchantAttendanceOperationalCycle";
import type { OperationalRuleChoice, OperationalTimesheetCycle } from "./merchantAttendanceOperationalRules";

export const CYCLE_PREPARATION_PROTOCOL = "attendance-cycle-preparation-v1" as const;
export type CyclePreparationInput = Readonly<{
  source: unknown; expected: OperationalRuleSourceExpected; anchorDate: string;
  activation: Readonly<{ revision: number; active: boolean }>;
}>;
export type CyclePreparation = Readonly<{
  protocol: typeof CYCLE_PREPARATION_PROTOCOL; candidateOnly: true; applied: false; authorityChecked: false;
  siteId: string; workerIdentity: OperationalRuleSourceIdentity; observedAt: string;
  settingsRef: Readonly<{ version: number; timeZone: string }>;
  anchorDate: string; activation: Readonly<{ revision: number; active: boolean }>;
  choice: OperationalRuleChoice<OperationalTimesheetCycle>;
  state: "consumer_disabled" | "unconfigured" | "disabled" | "manual" | "ready";
  range: OperationalCycleRange | null; sourceFingerprint: string; preparationFingerprint: string;
}>;
function invalid(): never { throw new MerchantAttendanceError("attendance_operational_cycle_invalid"); }
function exact(raw: unknown, keys: readonly string[]) {
  try { return captureBrowserExact(raw, keys); } catch { return invalid(); }
}
const uuid = (raw: unknown): string => typeof raw === "string" && raw.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw) ? raw : invalid();
function expected(raw: unknown): OperationalRuleSourceExpected {
  const value = exact(raw, ["siteId", "workerId", "employeeId", "employeeAuthUserId", "at"]);
  if (typeof value.siteId !== "string" || !/^[0-9]{8}$/.test(value.siteId) || value.siteId.length !== 8
    || typeof value.at !== "string" || value.at.length !== 27) invalid();
  // parseOperationalRuleSource independently validates the full UTC6 instant.
  return freeze({ siteId: value.siteId, workerId: uuid(value.workerId), employeeId: uuid(value.employeeId),
    employeeAuthUserId: uuid(value.employeeAuthUserId), at: value.at });
}
/** Own all caller inputs before the first asynchronous digest. Only the source's
 * actual settings zone is used; publication/host zones cannot change the range.
 * No UTC edge or due time is invented here: authoritative control-day/period
 * source SQL retains that responsibility, including skipped civil boundaries. */
export async function prepareOperationalCycle(raw: unknown): Promise<CyclePreparation> {
  try {
    const input = exact(raw, ["source", "expected", "anchorDate", "activation"]), want = expected(input.expected);
    const activationRaw = exact(input.activation, ["revision", "active"]);
    if (typeof activationRaw.revision !== "number" || !Number.isSafeInteger(activationRaw.revision)
      || Object.is(activationRaw.revision, -0) || activationRaw.revision < 0 || activationRaw.revision >= 9007199254740990
      || typeof activationRaw.active !== "boolean" || activationRaw.active && activationRaw.revision === 0) invalid();
    const activation = freeze({ revision: activationRaw.revision, active: activationRaw.active }), anchorDate = input.anchorDate;
    if (typeof anchorDate !== "string") invalid();
    // This call synchronously validates and snapshots source before its digest.
    const projection = await resolveOperationalRuleSource(input.source, want), { source, candidate } = projection;
    const field = candidate.fields.timesheetCycle;
    const choice: OperationalRuleChoice<OperationalTimesheetCycle> = field.state === "value"
      ? { mode: "value", value: field.value! } : { mode: field.state === "disabled" ? "disabled" : "inherit" };
    const suggestion = suggestOperationalCycleChoice({ date: anchorDate, timeZone: source.settingsRef.timeZone, choice });
    const state = !activation.active ? "consumer_disabled" : suggestion.reason ?? "ready";
    const range = state === "ready" ? suggestion.range : null;
    const tuple = operationalRuleSourceTuple(source);
    // CAS ignores only this read's observation time, never saved source refs,
    // identity/settings/group versions, baseline policy or activation revision.
    const sourceWithoutReadTime = [...tuple.slice(0, 3), ...tuple.slice(4)];
    const rangeTuple = range === null ? null : [range.fromDate, range.throughDate, range.civilDays];
    const choiceTuple = choice.mode !== "value" ? [choice.mode] : choice.value.kind === "weekly"
      ? [choice.mode, choice.value.kind, choice.value.weekStartsOn] : choice.value.kind === "fortnightly"
        ? [choice.mode, choice.value.kind, choice.value.anchorDate] : [choice.mode, choice.value.kind];
    const bytes = new TextEncoder().encode(operationalRuleLedgerEncode([CYCLE_PREPARATION_PROTOCOL, sourceWithoutReadTime,
      [activation.revision, activation.active], anchorDate, choiceTuple, state, rangeTuple]));
    const preparationFingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
    return freeze({ protocol: CYCLE_PREPARATION_PROTOCOL, candidateOnly: true, applied: false, authorityChecked: false,
      siteId: source.siteId, workerIdentity: source.workerIdentity, observedAt: source.at, settingsRef: source.settingsRef,
      anchorDate, activation, choice, state, range, sourceFingerprint: source.sourceFingerprint, preparationFingerprint });
  } catch { return invalid(); }
}
