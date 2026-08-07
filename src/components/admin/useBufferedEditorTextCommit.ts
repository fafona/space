"use client";

import { useCallback, useEffect, useRef } from "react";

import { registerEditorTextFlush } from "@/lib/editorTextCommitBuffer";

const NO_PENDING_VALUE = Symbol("no-pending-editor-text");

type BufferedEditorTextCommitOptions = {
  delayMs?: number;
  maxWaitMs?: number;
};

export function useBufferedEditorTextCommit<T>(
  onCommit: (value: T) => void,
  options: BufferedEditorTextCommitOptions = {},
) {
  const delayMs = Math.max(0, Math.round(options.delayMs ?? 140));
  const maxWaitMs = Math.max(delayMs, Math.round(options.maxWaitMs ?? 700));
  const onCommitRef = useRef(onCommit);
  const pendingValueRef = useRef<T | typeof NO_PENDING_VALUE>(NO_PENDING_VALUE);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unregisterFlushRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const flushCommit = useCallback(() => {
    if (trailingTimerRef.current !== null) {
      clearTimeout(trailingTimerRef.current);
      trailingTimerRef.current = null;
    }
    if (maxWaitTimerRef.current !== null) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
    unregisterFlushRef.current?.();
    unregisterFlushRef.current = null;

    const pendingValue = pendingValueRef.current;
    pendingValueRef.current = NO_PENDING_VALUE;
    if (pendingValue !== NO_PENDING_VALUE) {
      onCommitRef.current(pendingValue as T);
    }
  }, []);

  const scheduleCommit = useCallback(
    (value: T) => {
      pendingValueRef.current = value;
      if (!unregisterFlushRef.current) {
        unregisterFlushRef.current = registerEditorTextFlush(flushCommit);
      }

      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
      }
      trailingTimerRef.current = setTimeout(flushCommit, delayMs);
      if (maxWaitTimerRef.current === null) {
        maxWaitTimerRef.current = setTimeout(flushCommit, maxWaitMs);
      }
    },
    [delayMs, flushCommit, maxWaitMs],
  );

  useEffect(() => () => flushCommit(), [flushCommit]);

  return { scheduleCommit, flushCommit };
}
