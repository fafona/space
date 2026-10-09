import type { OutageLinkEvidence } from "./merchantAttendanceOutageLinksContract";
export const OUTAGE_REVIEW_ACTIONS = ["propose", "confirm", "dispute", "resolve", "reopen"] as const;
export type OutageReviewAction = (typeof OUTAGE_REVIEW_ACTIONS)[number];
export type OutageReviewQuery = { siteId: string; access: "owner" | "self"; declarationId: string } & (
  { mode: "detail" } | { mode: "history"; beforeRevision: number | null } | { mode: "recover"; operationId: string }
);
export type OutageReviewCommand = { action: OutageReviewAction; operationId: string; expectedRevision: number;
  expectedResultVersion: number; expectedFingerprint: string; reason: string };
export type OutageReviewOriginal = { status: "not_required" | "verified" | "unresolved"; operationId: string | null;
  channel: "web" | "location" | "onsite" | "pin" | "other" | null; eventId: string | null };
export type OutageReviewEvidence = { protocol: "outage-review-evidence-v1"; siteId: string; declarationId: string;
  linkOperationId: string; linkRevision: number; linkFingerprint: string; linkEvidence: OutageLinkEvidence; original: OutageReviewOriginal };
export type OutageReviewEntry = { operationId: string; revision: number; action: OutageReviewAction; actorId: string;
  resultVersion: number; resultFingerprint: string; reason: string; recordedAt: string };
export type OutageReviewProposal = OutageReviewEntry & { evidence: OutageReviewEvidence };
export const OUTAGE_REVIEW_BLOCKERS = ["source_open", "pending_source", "source_changed", "source_unavailable", "identity_changed", "source_outside_declaration", "duplicate_source",
  "link_missing", "link_revoked", "link_changed", "original_unknown", "employee_unavailable", "account_suspended", "result_missing", "result_changed", "unconfirmed", "disputed", "reopened"] as const;
export type OutageReviewStatus = { basisFingerprint: string | null; linkOperationId: string | null; linkRevision: number; linkFingerprint: string | null;
  blockers: (typeof OUTAGE_REVIEW_BLOCKERS)[number][]; canPropose: boolean; canConfirm: boolean; canResolve: boolean; resolved: boolean };
export type OutageReviewReceipt = { operationId: string; commandFingerprint: string; entry: OutageReviewEntry; proposal: OutageReviewProposal };
export type OutageReviewResult = { protocol: "attendance-outage-review-v1"; siteId: string; access: "owner" | "self"; mode: OutageReviewQuery["mode"];
  actorId: string; declarationId: string; readAt: string; canWrite: boolean; revision: number; resultVersion: number;
  current: OutageReviewEntry | null; proposal: OutageReviewProposal | null; response: OutageReviewEntry | null; status: OutageReviewStatus | null;
  history: OutageReviewEntry[]; historyTruncated: boolean; receipt: OutageReviewReceipt | null };
