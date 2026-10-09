import type { OutageInterval } from "./merchantAttendanceOutageTime";

export const OUTAGE_TYPES = ["network", "device", "service", "other"] as const;
export const OUTAGE_CHANNELS = ["web", "location", "onsite", "pin", "other"] as const;
export type OutageType = typeof OUTAGE_TYPES[number];
export type OutageChannel = typeof OUTAGE_CHANNELS[number];
export type OutageAccess = "owner" | "self";
type Scope = { siteId: string; access: OutageAccess };
export type OutageQuery = Scope & (
  | { mode: "incidents"; afterId: string | null }
  | { mode: "declarations"; incidentId: string; afterId: string | null }
  | { mode: "incident"; incidentId: string }
  | { mode: "declaration"; declarationId: string }
  | { mode: "recover"; operationId: string }
);
export type OutageCommand =
  | { action: "create_incident"; operationId: string; incidentId: string; type: OutageType; channel: OutageChannel;
      locationId: string | null; interval: OutageInterval; reason: string }
  | { action: "declare"; operationId: string; declarationId: string; incidentId: string; workerId: string;
      employeeId: string; employeeAuthUserId: string; expectedWorkerVersion: number; expectedEmployeeVersion: number;
      expectedGeneration: number; interval: OutageInterval; statement: string; originalOperationId: string | null;
      originalChannel: OutageChannel | null; paperReference: string | null };
export type OutageIncident = {
  kind: "incident"; id: string; operationId: string; type: OutageType; channel: OutageChannel;
  locationId: string | null; interval: OutageInterval; reason: string; actorId: string; recordedAt: string;
};
export type OutageDeclaration = {
  kind: "declaration"; id: string; operationId: string; incidentId: string; workerId: string; employeeId: string;
  employeeAuthUserId: string; workerVersion: number; employeeVersion: number; generation: number;
  interval: OutageInterval; statement: string; originalOperationId: string | null; originalChannel: OutageChannel | null;
  paperReference: string | null; recordedBy: OutageAccess; actorId: string; actorEmployeeId: string | null; recordedAt: string;
};
export type OutageRecord = OutageIncident | OutageDeclaration;
export type OutageReceipt = {
  operationId: string; action: OutageCommand["action"]; recordId: string; incidentId: string;
  actorId: string; commandFingerprint: string; recordedAt: string;
};
export type OutageResult = {
  protocol: "attendance-outage-v1"; siteId: string; access: OutageAccess; mode: OutageQuery["mode"]; actorId: string;
  readAt: string; canWrite: boolean; items: OutageRecord[]; detail: OutageRecord | null;
  receipt: OutageReceipt | null; nextId: string | null;
};
