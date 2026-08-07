"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";

import { useBufferedEditorTextCommit } from "@/components/admin/useBufferedEditorTextCommit";

const BUFFERED_INPUT_TYPES = new Set(["", "text", "search", "url", "email", "tel", "password", "number"]);

type BufferedCommitOptions = {
  commitDelayMs?: number;
  commitMaxWaitMs?: number;
};

type BufferedEditorInputProps = InputHTMLAttributes<HTMLInputElement> & BufferedCommitOptions;
type BufferedEditorTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & BufferedCommitOptions;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) ref.current = value;
}

function normalizeControlValue(value: unknown) {
  if (Array.isArray(value)) return value.join(",");
  return value === null || value === undefined ? "" : String(value);
}

function createDeferredChangeEvent<T extends HTMLInputElement | HTMLTextAreaElement>(
  source: ChangeEvent<T>,
  target: T | null,
  value: string,
) {
  const fallbackTarget = { value } as T;
  const deferredEvent = Object.create(source) as ChangeEvent<T>;
  Object.defineProperties(deferredEvent, {
    target: { configurable: true, enumerable: true, value: target ?? fallbackTarget },
    currentTarget: { configurable: true, enumerable: true, value: target ?? fallbackTarget },
  });
  return deferredEvent;
}

export function shouldBufferEditorInput(type: string | undefined, readOnly = false, disabled = false) {
  return !readOnly && !disabled && BUFFERED_INPUT_TYPES.has((type ?? "").toLowerCase());
}

export const BufferedEditorInput = forwardRef<HTMLInputElement, BufferedEditorInputProps>(
  function BufferedEditorInput(
    {
      disabled,
      commitDelayMs,
      commitMaxWaitMs,
      onBlur,
      onChange,
      onCompositionEnd,
      onCompositionStart,
      onFocus,
      readOnly,
      type,
      value,
      ...rest
    },
    forwardedRef,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const composingRef = useRef(false);
    const focusedRef = useRef(false);
    const resetDraftFrameRef = useRef<number | null>(null);
    const [draftValue, setDraftValue] = useState<string | null>(null);
    const shouldBuffer = Boolean(onChange) && shouldBufferEditorInput(type, readOnly, disabled);
    const normalizedValue = normalizeControlValue(value);

    const setInputRef = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        assignRef(forwardedRef, node);
      },
      [forwardedRef],
    );

    const { scheduleCommit, flushCommit } = useBufferedEditorTextCommit(
      ({ event, nextValue }: { event: ChangeEvent<HTMLInputElement>; nextValue: string }) => {
        onChange?.(createDeferredChangeEvent(event, inputRef.current, nextValue));
      },
      { delayMs: commitDelayMs, maxWaitMs: commitMaxWaitMs },
    );

    useEffect(
      () => () => {
        if (resetDraftFrameRef.current !== null) cancelAnimationFrame(resetDraftFrameRef.current);
      },
      [],
    );

    if (!shouldBuffer) {
      return (
        <input
          {...rest}
          ref={setInputRef}
          type={type}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          onBlur={onBlur}
          onChange={onChange}
          onCompositionEnd={onCompositionEnd}
          onCompositionStart={onCompositionStart}
          onFocus={onFocus}
        />
      );
    }

    return (
      <input
        {...rest}
        ref={setInputRef}
        type={type}
        value={draftValue ?? normalizedValue}
        readOnly={readOnly}
        disabled={disabled}
        onFocus={(event) => {
          focusedRef.current = true;
          if (resetDraftFrameRef.current !== null) {
            cancelAnimationFrame(resetDraftFrameRef.current);
            resetDraftFrameRef.current = null;
          }
          setDraftValue(event.currentTarget.value);
          onFocus?.(event);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const nextValue = event.currentTarget.value;
          setDraftValue(nextValue);
          scheduleCommit({ event: event as unknown as ChangeEvent<HTMLInputElement>, nextValue });
          onCompositionEnd?.(event);
        }}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setDraftValue(nextValue);
          if (!composingRef.current) scheduleCommit({ event, nextValue });
        }}
        onBlur={(event) => {
          composingRef.current = false;
          focusedRef.current = false;
          scheduleCommit({ event: event as unknown as ChangeEvent<HTMLInputElement>, nextValue: event.currentTarget.value });
          flushCommit();
          onBlur?.(event);
          resetDraftFrameRef.current = requestAnimationFrame(() => {
            resetDraftFrameRef.current = null;
            if (!focusedRef.current) setDraftValue(null);
          });
        }}
      />
    );
  },
);

export const BufferedEditorTextarea = forwardRef<HTMLTextAreaElement, BufferedEditorTextareaProps>(
  function BufferedEditorTextarea(
    {
      disabled,
      commitDelayMs,
      commitMaxWaitMs,
      onBlur,
      onChange,
      onCompositionEnd,
      onCompositionStart,
      onFocus,
      readOnly,
      value,
      ...rest
    },
    forwardedRef,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const composingRef = useRef(false);
    const focusedRef = useRef(false);
    const resetDraftFrameRef = useRef<number | null>(null);
    const [draftValue, setDraftValue] = useState<string | null>(null);
    const shouldBuffer = Boolean(onChange) && !readOnly && !disabled;
    const normalizedValue = normalizeControlValue(value);

    const setTextareaRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        assignRef(forwardedRef, node);
      },
      [forwardedRef],
    );

    const { scheduleCommit, flushCommit } = useBufferedEditorTextCommit(
      ({ event, nextValue }: { event: ChangeEvent<HTMLTextAreaElement>; nextValue: string }) => {
        onChange?.(createDeferredChangeEvent(event, textareaRef.current, nextValue));
      },
      { delayMs: commitDelayMs, maxWaitMs: commitMaxWaitMs },
    );

    useEffect(
      () => () => {
        if (resetDraftFrameRef.current !== null) cancelAnimationFrame(resetDraftFrameRef.current);
      },
      [],
    );

    if (!shouldBuffer) {
      return (
        <textarea
          {...rest}
          ref={setTextareaRef}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          onBlur={onBlur}
          onChange={onChange}
          onCompositionEnd={onCompositionEnd}
          onCompositionStart={onCompositionStart}
          onFocus={onFocus}
        />
      );
    }

    return (
      <textarea
        {...rest}
        ref={setTextareaRef}
        value={draftValue ?? normalizedValue}
        readOnly={readOnly}
        disabled={disabled}
        onFocus={(event) => {
          focusedRef.current = true;
          if (resetDraftFrameRef.current !== null) {
            cancelAnimationFrame(resetDraftFrameRef.current);
            resetDraftFrameRef.current = null;
          }
          setDraftValue(event.currentTarget.value);
          onFocus?.(event);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const nextValue = event.currentTarget.value;
          setDraftValue(nextValue);
          scheduleCommit({ event: event as unknown as ChangeEvent<HTMLTextAreaElement>, nextValue });
          onCompositionEnd?.(event);
        }}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setDraftValue(nextValue);
          if (!composingRef.current) scheduleCommit({ event, nextValue });
        }}
        onBlur={(event) => {
          composingRef.current = false;
          focusedRef.current = false;
          scheduleCommit({ event: event as unknown as ChangeEvent<HTMLTextAreaElement>, nextValue: event.currentTarget.value });
          flushCommit();
          onBlur?.(event);
          resetDraftFrameRef.current = requestAnimationFrame(() => {
            resetDraftFrameRef.current = null;
            if (!focusedRef.current) setDraftValue(null);
          });
        }}
      />
    );
  },
);
