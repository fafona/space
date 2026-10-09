import type { OutageInterval } from "./merchantAttendanceOutageTime";
export type OutageLinkReference =
  | { kind: "session"; startEventId: string; lastEventId: string; lastSequence: number; effectOperationId: string | null; effectRevision: number | null }
  | { kind: "missing"; requestId: string; rootRequestId: string; approvalOperationId: string };
type Scope = { siteId: string; access: "owner" | "self"; declarationId: string };
export type OutageLinksQuery = Scope & (
  | { mode: "detail" }
  | { mode: "preview"; sources: OutageLinkReference[] }
  | { mode: "history"; beforeRevision: number | null }
  | { mode: "recover"; operationId: string }
);
type BaseCommand = { operationId: string; expectedRevision: number; expectedFingerprint: string; reason: string };
export type OutageLinksCommand = BaseCommand & ({ action: "apply"; sources: OutageLinkReference[] } | { action: "revoke" });
export type OutageLinkSpan = { startAt: string; endAt: string | null };
export type OutageLinkSnapshot = { reference: OutageLinkReference; locationId: string; timeZone: string;
  original: OutageLinkSpan | null; selected: OutageLinkSpan; evidenceFingerprint: string; pending: boolean; open: boolean };
export type OutageLinkEvidence = { protocol: "outage-link-evidence-v1"; siteId: string; declarationId: string;
  workerId: string; employeeId: string; employeeAuthUserId: string; workerVersion: number; employeeVersion: number;
  generation: number; declaredInterval: OutageInterval; items: OutageLinkSnapshot[] };
export type OutageLinkEntry = { operationId: string; revision: number; action: "apply" | "revoke"; actorId: string;
  reason: string; sources: OutageLinkReference[]; evidence: OutageLinkEvidence | null; fingerprint: string; recordedAt: string };
export type OutageLinkSummary = Pick<OutageLinkEntry, "operationId" | "revision" | "action" | "actorId" | "reason" | "fingerprint" | "recordedAt"> & { sourceCount: number };
export type OutageLinkObservation = { reference: OutageLinkReference; current: OutageLinkSnapshot | null; available: boolean; changed: boolean; open: boolean; pending: boolean };
export const OUTAGE_LINK_BLOCKERS = ["source_open", "pending_source", "source_changed", "source_unavailable", "identity_changed", "source_outside_declaration", "duplicate_source"] as const;
export type OutageLinkPreview = { fingerprint: string | null; evidence: OutageLinkEvidence | null; eligible: boolean;
  observations: OutageLinkObservation[]; blockers: (typeof OUTAGE_LINK_BLOCKERS[number])[] };
export type OutageLinksReceipt = { operationId: string; commandFingerprint: string; entry: OutageLinkEntry };
export type OutageLinksResult = { protocol: "attendance-outage-links-v1"; siteId: string; access: "owner" | "self";
  mode: OutageLinksQuery["mode"]; actorId: string; declarationId: string; readAt: string; canWrite: boolean; revision: number;
  current: OutageLinkEntry | null; preview: OutageLinkPreview | null; history: OutageLinkSummary[]; historyTruncated: boolean; receipt: OutageLinksReceipt | null };
