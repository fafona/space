function formatOrdinal(value: number) {
  const normalized = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  return String(normalized).padStart(2, "0");
}

export function buildPublicBlockId(pageIndex: number, blockIndex: number) {
  return `${formatOrdinal(pageIndex + 1)}${formatOrdinal(blockIndex + 1)}`;
}
