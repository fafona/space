import { listKnownDelegationRecoveries, recoverKnownDelegation, type KnownDelegationRecovery, type DelegationRecoveryReceipt,
  type DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
import { listKnownAccountStatusRecoveries, recoverKnownAccountStatus, type KnownAccountStatusRecovery, type AccountStatusRecoveryReceipt,
  type AccountStatusRecoveryOptions } from "./merchantAttendanceAccountStatusRecovery";
import { listKnownEmploymentLifecycleRecoveries, recoverKnownEmploymentLifecycle, type KnownEmploymentLifecycleRecovery,
  type EmploymentLifecycleRecoveryReceipt } from "./merchantAttendanceEmploymentLifecycleRecovery";
import { listKnownScheduleDelegationRecoveries, recoverKnownScheduleDelegation, type KnownScheduleDelegationRecovery,
  type ScheduleDelegationRecoveryReceipt } from "./merchantAttendanceScheduleDelegationRecovery";
import { listKnownPeriodRecoveries, recoverKnownPeriod, type KnownPeriodRecovery, type PeriodRecoveryReceipt } from "./merchantAttendancePeriodRecovery";
import { listKnownCorrectionDelegationRecoveries, recoverKnownCorrectionDelegation, type KnownCorrectionDelegationRecovery } from "./merchantAttendanceCorrectionDelegationRecovery";
import { listKnownOperationalRulesRecoveries, recoverKnownOperationalRules, type KnownOperationalRulesRecovery } from "./merchantAttendanceOperationalRulesRecovery";
import type { OperationalRuleLedgerReceipt } from "./merchantAttendanceOperationalRuleLedger";
import { listKnownOperationalPunchActivationRecoveries, recoverKnownOperationalPunchActivation, type KnownOperationalPunchActivationRecovery } from "./merchantAttendanceOperationalPunchActivationRecovery";
import type { OperationalPunchActivationItem } from "./merchantAttendanceOperationalPunchActivation";
import { listKnownOperationalConsumerActivationRecoveries, recoverKnownOperationalConsumerActivation, type KnownOperationalConsumerActivationRecovery } from "./merchantAttendanceOperationalConsumerActivationRecovery";
import type { OperationalConsumerActivationItem } from "./merchantAttendanceOperationalConsumerActivation";
import { listKnownAdministrativeClosureRecoveries, recoverKnownAdministrativeClosure, type KnownAdministrativeClosureRecovery } from "./merchantAttendanceAdministrativeClosureRecovery";
import type { AdministrativeClosureReceipt } from "./merchantAttendanceAdministrativeClosure";
import { listKnownReviewRoutingRecoveries, recoverKnownReviewRouting, type KnownReviewRoutingRecovery } from "./merchantAttendanceReviewRoutingRecovery";
import type { ReviewRoutingReceipt } from "./merchantAttendanceReviewRouting";
import { listKnownRetentionDisposalRecoveries, recoverKnownRetentionDisposal, type KnownRetentionDisposalRecovery } from "./merchantAttendanceRetentionDisposalRecovery";
import type { DisposalExecutionReceipt } from "./merchantAttendanceRetentionDisposalExecution";

export type KnownAttendanceRecovery = KnownDelegationRecovery | KnownAccountStatusRecovery | KnownEmploymentLifecycleRecovery | KnownScheduleDelegationRecovery | KnownPeriodRecovery | KnownCorrectionDelegationRecovery | KnownOperationalRulesRecovery | KnownOperationalPunchActivationRecovery | KnownOperationalConsumerActivationRecovery | KnownAdministrativeClosureRecovery | KnownReviewRoutingRecovery | KnownRetentionDisposalRecovery;
export type AttendanceRecoveryReceipt = ({ kind: "missing" | "application" | "correction" } & DelegationRecoveryReceipt) | ({ kind: "account-status" } & AccountStatusRecoveryReceipt) | ({ kind: "employment" } & EmploymentLifecycleRecoveryReceipt) | ({ kind: "schedule" } & ScheduleDelegationRecoveryReceipt) | ({kind:"period-delegation"|"period-closure"}&PeriodRecoveryReceipt) | ({kind:"operational-rules"}&OperationalRuleLedgerReceipt) | ({kind:"operational-punch-activation"}&OperationalPunchActivationItem) | ({kind:"operational-consumer-activation"}&OperationalConsumerActivationItem) | ({kind:"administrative-closure"}&AdministrativeClosureReceipt) | ({kind:"review-routing"}&ReviewRoutingReceipt) | ({kind:"retention-disposal"}&DisposalExecutionReceipt);
export type AttendanceRecoveryStorage = DelegationRecoveryStorage;
export type AttendanceRecoveryOptions = AccountStatusRecoveryOptions;
const prefix = /^faolla:attendance:(?:(?:missing|application|schedule|period|correction)-delegation|period-delegated-closure|account-status|employment-lifecycle|operational-rule-ledger|operational-punch-activation|operational-consumer-activation|administrative-closure|review-routing|retention-disposal):v1:/;

export async function listKnownAttendanceRecoveries(storage: AttendanceRecoveryStorage, authUserId: string, isCurrentAuth: () => boolean, signal?: AbortSignal) {
  const guard = () => { if (signal?.aborted || !isCurrentAuth() || typeof document !== "undefined" && document.hidden) throw Error("recovery_scope_changed"); };
  const inventory = () => { guard(); const count = storage.length; guard(); if (!Number.isSafeInteger(count) || count < 0 || count > 2048) throw Error("recovery_storage_limit");
    const keys: string[] = []; for (let n = 0; n < count; n++) { guard(); const key = storage.key(n); guard(); if (key && prefix.test(key)) keys.push(key); }
    if (keys.length > 64 || new Set(keys).size !== keys.length) throw Error("recovery_storage_limit"); return keys.sort(); };
  const keys = inventory();
  // A bounded view fixes the inventory for the original and new parsers. No new body
  // parser for delegation, permission fallback, storage write or network call.
  const view: AttendanceRecoveryStorage = { get length() { guard(); return keys.length; }, key: n => { guard(); return keys[n] ?? null; },
    getItem: key => { guard(); if (!keys.includes(key)) throw Error("recovery_key_changed"); const value = storage.getItem(key); guard(); return value; },
    setItem: () => { throw Error("recovery_is_read_only"); }, removeItem: () => { throw Error("recovery_is_read_only"); } };
  const delegation = await listKnownDelegationRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const status = await listKnownAccountStatusRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const employment = await listKnownEmploymentLifecycleRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const schedule = await listKnownScheduleDelegationRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const period = await listKnownPeriodRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const correction = await listKnownCorrectionDelegationRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const rules = await listKnownOperationalRulesRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const activation = await listKnownOperationalPunchActivationRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const consumerActivation = await listKnownOperationalConsumerActivationRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const administrativeClosure = await listKnownAdministrativeClosureRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const reviewRouting = await listKnownReviewRoutingRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  const disposal = await listKnownRetentionDisposalRecoveries(view, authUserId, isCurrentAuth, signal); guard();
  if (JSON.stringify(inventory()) !== JSON.stringify(keys)) throw Error("recovery_record_changed");
  const entries: KnownAttendanceRecovery[] = [...delegation.entries, ...status.entries, ...employment.entries, ...schedule.entries, ...period.entries, ...correction.entries, ...rules.entries, ...activation.entries, ...consumerActivation.entries, ...administrativeClosure.entries, ...reviewRouting.entries, ...disposal.entries]; if (entries.length > 64) throw Error("recovery_storage_limit");
  guard(); return Object.freeze({ entries: Object.freeze(entries), invalid: delegation.invalid || status.invalid || employment.invalid || schedule.invalid || period.invalid || correction.invalid || rules.invalid || activation.invalid || consumerActivation.invalid || administrativeClosure.invalid || reviewRouting.invalid || disposal.invalid });
}

export async function recoverKnownAttendance(entry: KnownAttendanceRecovery, options: AttendanceRecoveryOptions): Promise<AttendanceRecoveryReceipt | null> {
  if (entry.kind === "retention-disposal") { const receipt = await recoverKnownRetentionDisposal(entry, options); return receipt ? Object.freeze({ kind: "retention-disposal", ...receipt }) : null; }
  if (entry.kind === "review-routing") { const receipt = await recoverKnownReviewRouting(entry, options); return receipt ? Object.freeze({ kind: "review-routing", ...receipt }) : null; }
  if (entry.kind === "administrative-closure") { const receipt = await recoverKnownAdministrativeClosure(entry, options); return receipt ? Object.freeze({ kind: "administrative-closure", ...receipt }) : null; }
  if (entry.kind === "operational-consumer-activation") { const receipt = await recoverKnownOperationalConsumerActivation(entry, options); return receipt ? Object.freeze({ kind: "operational-consumer-activation", ...receipt }) : null; }
  if (entry.kind === "operational-punch-activation") { const receipt = await recoverKnownOperationalPunchActivation(entry, options); return receipt ? Object.freeze({ kind: "operational-punch-activation", ...receipt }) : null; }
  if (entry.kind === "operational-rules") { const receipt=await recoverKnownOperationalRules(entry,options);return receipt?Object.freeze({kind:"operational-rules",...receipt}):null; }
  if (entry.kind === "correction") { const receipt=await recoverKnownCorrectionDelegation(entry,options);return receipt?Object.freeze({kind:"correction",...receipt}):null; }
  if (entry.kind === "period-delegation" || entry.kind === "period-closure") { const receipt=await recoverKnownPeriod(entry,options);return receipt?Object.freeze({kind:entry.kind,...receipt}):null; }
  if (entry.kind === "schedule") { const receipt = await recoverKnownScheduleDelegation(entry, options); return receipt ? Object.freeze({ kind: "schedule", ...receipt }) : null; }
  if (entry.kind === "employment") { const receipt = await recoverKnownEmploymentLifecycle(entry, options); return receipt ? Object.freeze({ kind: "employment", ...receipt }) : null; }
  if (entry.kind === "account-status") { const receipt = await recoverKnownAccountStatus(entry, options); return receipt ? Object.freeze({ kind: "account-status", ...receipt }) : null; }
  if (entry.kind !== "missing" && entry.kind !== "application") throw Error("invalid_recovery_kind");
  const receipt = await recoverKnownDelegation(entry, options); return receipt ? Object.freeze({ kind: entry.kind, ...receipt }) : null;
}
