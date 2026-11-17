// Layout viewport height can stay unchanged when an Android/iOS keyboard opens.
// Only the visible viewport is safe for a fixed conversation sheet.
export function serviceSheetViewport(height: number, offsetTop: number, layoutHeight: number) {
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(layoutHeight) || layoutHeight <= 0) return null;
  return {
    height: Math.round(height),
    top: Math.max(0, Math.round(Number.isFinite(offsetTop) ? offsetTop : 0)),
    keyboardOpen: layoutHeight - height > 120,
    compact: layoutHeight - height > 120 || height < 500,
  };
}
