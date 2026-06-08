const DEFAULT_MARKER_SCOPE = "mutation";
const MAX_OPERATION_ID_LENGTH = 120;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeMutationOperationId(value: unknown, maxLength = MAX_OPERATION_ID_LENGTH) {
  return trimText(value, maxLength).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export function buildMutationOperationMarker(scope: string, operationId: unknown) {
  const normalizedScope = normalizeMutationOperationId(scope || DEFAULT_MARKER_SCOPE, 40) || DEFAULT_MARKER_SCOPE;
  const normalizedOperationId = normalizeMutationOperationId(operationId);
  return normalizedOperationId ? `[op:${normalizedScope}:${normalizedOperationId}]` : "";
}

export function hasMutationOperationMarker(text: unknown, marker: string) {
  return Boolean(marker && trimText(text).includes(marker));
}

export function appendMutationOperationMarker(note: unknown, marker: string, maxLength = 500) {
  const normalizedNote = trimText(note, maxLength);
  if (!marker) return normalizedNote;
  if (normalizedNote.includes(marker)) return normalizedNote;
  const maxNoteLength = Math.max(0, maxLength - marker.length - 1);
  const visibleNote = normalizedNote.slice(0, maxNoteLength).trim();
  return `${visibleNote}${visibleNote ? " " : ""}${marker}`.slice(0, maxLength);
}

export function createClientMutationOperationId(scope: string) {
  const normalizedScope = normalizeMutationOperationId(scope, 32) || DEFAULT_MARKER_SCOPE;
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 14);
  return `${normalizedScope}:${Date.now().toString(36)}:${normalizeMutationOperationId(random, 64)}`;
}
