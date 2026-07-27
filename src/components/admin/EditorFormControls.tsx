"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { normalizeBookingOptionList } from "@/lib/merchantBookings";

export function FontSizeComboInput({
  value,
  onChange,
  onCommit,
  options,
  className = "border p-2 rounded w-full text-sm pr-10",
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  options: readonly number[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOpen(false);
        onCommit(value);
      }}
    >
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={className}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r border-l bg-white text-gray-600 hover:bg-gray-50"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="选择字号"
          title="选择字号"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 max-h-56 min-w-full overflow-auto rounded border bg-white py-1 shadow-lg">
          {options.map((size) => (
            <button
              key={`font-size-option-${size}`}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const nextValue = String(size);
                onChange(nextValue);
                onCommit(nextValue);
                setOpen(false);
              }}
            >
              {size}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BookingOptionsTextarea({
  className,
  value,
  placeholder,
  onChange,
}: {
  className?: string;
  value: unknown;
  placeholder?: string;
  onChange: (nextOptions: string[]) => void;
}) {
  const normalizedText = useMemo(() => normalizeBookingOptionList(value).join("\n"), [value]);
  const [draftText, setDraftText] = useState<string | null>(null);
  const composingRef = useRef(false);
  const textValue = draftText ?? normalizedText;

  const commitText = useCallback(
    (nextText: string) => {
      onChange(normalizeBookingOptionList(nextText));
    },
    [onChange],
  );

  return (
    <textarea
      className={className}
      value={textValue}
      placeholder={placeholder}
      onFocus={() => {
        setDraftText((currentText) => currentText ?? normalizedText);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const nextText = event.currentTarget.value;
        setDraftText(nextText);
        commitText(nextText);
      }}
      onChange={(event) => {
        const nextText = event.target.value;
        setDraftText(nextText);
        if (!composingRef.current) {
          commitText(nextText);
        }
      }}
      onBlur={(event) => {
        composingRef.current = false;
        commitText(event.currentTarget.value);
        setDraftText(null);
      }}
    />
  );
}

export function CompositionSafeTextInput({
  className,
  value,
  placeholder,
  onChange,
}: {
  className?: string;
  value: unknown;
  placeholder?: string;
  onChange: (nextValue: string) => void;
}) {
  const normalizedValue = typeof value === "string" ? value : "";
  const [draftText, setDraftText] = useState<string | null>(null);
  const composingRef = useRef(false);
  const textValue = draftText ?? normalizedValue;

  const commitText = useCallback(
    (nextText: string) => {
      onChange(nextText);
    },
    [onChange],
  );

  return (
    <input
      className={className}
      value={textValue}
      placeholder={placeholder}
      onFocus={() => {
        setDraftText((currentText) => currentText ?? normalizedValue);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const nextText = event.currentTarget.value;
        setDraftText(nextText);
        commitText(nextText);
      }}
      onChange={(event) => {
        const nextText = event.target.value;
        setDraftText(nextText);
        if (!composingRef.current) {
          commitText(nextText);
        }
      }}
      onBlur={(event) => {
        composingRef.current = false;
        commitText(event.currentTarget.value);
        setDraftText(null);
      }}
    />
  );
}
