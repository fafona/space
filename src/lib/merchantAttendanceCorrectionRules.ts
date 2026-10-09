import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";

export const CORRECTION_RULE_LABELS = {
  policy_missing: "负责人尚未设置申请期限，暂不能新建申请。",
  window_expired: "已超过原始上班日期对应的申请期限。",
  period_locked: "原班次或声明时段涉及已锁定周期；需负责人核查。",
  legacy_unbound: "旧申请未绑定规则版本，不自动套用新规则，不能批准；未作决定的申请可按当前权限撤回。",
  unsupported_dates: "日期超出当前支持范围，需要负责人核查。",
  period_limit: "相关锁定周期超出核对上限，暂不能新建申请。",
} as const;
export type CorrectionRules = { binding: "preparation" | "bound" | "legacy"; checkedAt: string; approvalAvailable: false;
  policy: { revision: number; recordedAt: string; submissionWindowDays: number; timeZone: string } | null;
  deadlineAt: string | null; lockedPeriodCount: number; issues: (keyof typeof CORRECTION_RULE_LABELS)[] };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const obj = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? fail() : v as Record<string, unknown>;
// Old SQL fixtures can still be parsed explicitly; all live server/client paths require this contract.
export function parseCorrectionRules(raw: unknown, context: { mode: "prepare" | "detail"; asOf: string; startAt: string; submittedAt?: string }): CorrectionRules {
  const v = obj(raw), checkedAt = attendanceRecordInstant(v.checkedAt);
  if (checkedAt !== context.asOf || v.approvalAvailable !== false
    || (context.mode === "prepare" ? v.binding !== "preparation" : v.binding !== "bound" && v.binding !== "legacy")
    || !Number.isSafeInteger(v.lockedPeriodCount) || Number(v.lockedPeriodCount) < 0 || Number(v.lockedPeriodCount) > 200
    || !Array.isArray(v.issues) || v.issues.length > 6 || new Set(v.issues).size !== v.issues.length
    || v.issues.some(i => typeof i !== "string" || !Object.hasOwn(CORRECTION_RULE_LABELS, i))) fail();
  const issues = v.issues as CorrectionRules["issues"], at = context.submittedAt ?? context.asOf;
  let policy: CorrectionRules["policy"] = null;
  if (v.policy !== null) {
    const p = obj(v.policy), recordedAt = attendanceRecordInstant(p.recordedAt);
    if (!Number.isSafeInteger(p.revision) || Number(p.revision) < 1 || Number(p.revision) > 9007199254740989
      || !Number.isInteger(p.submissionWindowDays) || Number(p.submissionWindowDays) < 0 || Number(p.submissionWindowDays) > 365 || recordedAt > at) fail();
    policy = { revision: Number(p.revision), recordedAt, submissionWindowDays: Number(p.submissionWindowDays), timeZone: attendanceTimeZone(p.timeZone as string) };
  }
  const deadlineAt = v.deadlineAt === null ? null : attendanceRecordInstant(v.deadlineAt);
  if ((v.binding === "legacy") !== issues.includes("legacy_unbound") || v.binding === "legacy" && (policy !== null || deadlineAt !== null)
    || v.binding === "bound" && !policy || issues.includes("policy_missing") !== (v.binding === "preparation" && policy === null)
    || !policy && deadlineAt !== null || policy && deadlineAt === null && !issues.includes("unsupported_dates")
    || issues.includes("window_expired") !== (deadlineAt !== null && at >= deadlineAt)
    || issues.includes("period_locked") !== (Number(v.lockedPeriodCount) > 0 && !issues.includes("period_limit"))
    || issues.includes("period_limit") && Number(v.lockedPeriodCount) !== 200) fail();
  // The deadline is a local natural-day boundary, not N*24 hours after the declaration.
  if (policy && deadlineAt) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: policy.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(context.startAt));
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? fail();
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + policy.submissionWindowDays + 1);
    // The deadline date itself may have been skipped (Apia); choose the first actual instant after it.
    if (next.getUTCFullYear() <= 2100) {
      let expected: string | null = null;
      for(let n=0;n<4;n++) {
        try { expected=attendanceDayUtcRange(next.toISOString().slice(0,10),policy.timeZone).startAt;break; }
        catch(e) { if(!(e instanceof MerchantAttendanceError)||e.code!=="attendance_local_date_does_not_exist")throw e;next.setUTCDate(next.getUTCDate()+1); }
      }
      if(!expected||deadlineAt!==attendanceRecordInstant(expected))fail();
    }
  }
  return { binding: v.binding as CorrectionRules["binding"], checkedAt, approvalAvailable: false, policy, deadlineAt, issues, lockedPeriodCount: Number(v.lockedPeriodCount) };
}
