type EditorTextFlush = () => void;

const pendingEditorTextFlushes = new Set<EditorTextFlush>();

export function registerEditorTextFlush(flush: EditorTextFlush) {
  pendingEditorTextFlushes.add(flush);
  return () => {
    pendingEditorTextFlushes.delete(flush);
  };
}

export function flushBufferedEditorTextCommits() {
  const flushes = Array.from(pendingEditorTextFlushes);
  pendingEditorTextFlushes.clear();
  flushes.forEach((flush) => flush());
}
