/** 181: explicit references only. No merge, copied confirmation, source adoption,
 * resolution exemption, period exclusion, transitive relation or hours change. */
export const OUTAGE_RELATION_KINDS = ["possible_duplicate", "complementary"] as const;
export type OutageRelationKind = typeof OUTAGE_RELATION_KINDS[number];
export type OutageRelationPair = [string, string]; // Strictly ascending UUIDs.
type Scope = { siteId: string; access: "owner" | "self"; declarationId: string };
export type OutageRelationsQuery = Scope & (
  | { mode: "list" }
  | { mode: "detail"; relatedDeclarationId: string }
  | { mode: "history"; relatedDeclarationId: string; beforeRevision: number | null }
  | { mode: "recover"; relatedDeclarationId: string; operationId: string }
);
type Command = { operationId: string; expectedRevision: number; expectedFingerprint: string; reason: string };
export type OutageRelationsCommand = Command & (
  | { action: "apply"; kind: OutageRelationKind }
  | { action: "revoke" }
);
export type OutageRelationDeclaration = { declarationId: string; operationId: string; fingerprint: string };
export type OutageRelationEvidence = {
  protocol: "outage-relation-evidence-v1"; siteId: string; workerId: string; employeeId: string; employeeAuthUserId: string;
  workerVersion: number; employeeVersion: number; generation: number;
  declarations: [OutageRelationDeclaration, OutageRelationDeclaration]; // Same order as pair.
};
export type OutageRelationEntry = {
  pair: OutageRelationPair; operationId: string; revision: number; action: "apply" | "revoke"; kind: OutageRelationKind;
  actorId: string; reason: string; evidence: OutageRelationEvidence | null; fingerprint: string; recordedAt: string;
};
// Raw SQL Entry additionally has sourceText: string|null, SHA-checked then
// stripped by the service projector. Revoke keeps head fingerprint/kind, null evidence.
export type OutageRelationSummary = Omit<OutageRelationEntry, "evidence">;
export const OUTAGE_RELATION_BLOCKERS = ["identity_changed", "worker_inactive", "employee_inactive", "account_suspended", "settings_disabled", "pair_limit", "revision_limit"] as const;
export type OutageRelationPreview = {
  fingerprint: string | null; evidence: OutageRelationEvidence | null; eligible: boolean;
  blockers: (typeof OUTAGE_RELATION_BLOCKERS[number])[];
};
export type OutageRelationReceipt = { operationId: string; commandFingerprint: string; entry: OutageRelationEntry };
export type OutageRelationsResult = {
  protocol: "attendance-outage-relations-v1"; siteId: string; access: "owner" | "self"; mode: OutageRelationsQuery["mode"];
  actorId: string; declarationId: string; relatedDeclarationId: string | null; readAt: string; canWrite: boolean;
  items: OutageRelationSummary[]; revision: number; current: OutageRelationEntry | null; preview: OutageRelationPreview | null;
  history: OutageRelationSummary[]; historyTruncated: boolean; receipt: OutageRelationReceipt | null;
};
// List: at most25 ever-associated pairs, ascending other declaration ID;
// revision=0, current/preview/receipt=null, history=[]/false, canWrite=false.
// Detail: exact pair current head + preview, including no-head revision0.
// History: <=25 contiguous descending revisions before cursor (1..101),
// current/preview/receipt=null, items=[], canWrite=false.
// POST/recover: receipt only; revision=receipt.entry.revision; all other
// collections/current/preview null/empty, historyTruncated=false, canWrite=false.
// Recover is owner-only and direction-bound to the original write query.
// Command SHA scalar tuple, JSON.stringify with no spaces:
// [siteId,'owner',declarationId,relatedDeclarationId,action,operationId,
//  expectedRevision,expectedFingerprint,action==='apply'?kind:null,reason].
// Evidence SHA = exact SQL evidence::text, raw preview also has sourceText.
// Declaration fingerprint = SHA256 of existing176 declaration_v1(declaration)::text.
// apply expectedRevision0..98; revoke1..99; pair revision1..100 (100 only revoke).
// Detail canWrite = owner && p_allow_write && (preview.eligible ||
// current.action==='apply' && revision<100). Eligible is apply-only; safe revoke
// remains available despite settings/identity/active/pause changes.
// Fresh apply errors: *_changed409 CAS, *_blocked409 eligibility;
// *_limit422 pair/revision; *_disabled403 rollout; *_not_found404 target/receipt;
// *_invalid503 malformed stored facts; *_too_large422 cap. Prefix:
// attendance_outage_relations_. Common176 errors remain unchanged.
