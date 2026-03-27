"use client";

import { useEffect, useRef, useState } from "react";

export type GradientDirection =
  | "to right"
  | "to left"
  | "to bottom"
  | "to top"
  | "to bottom right"
  | "to bottom left"
  | "to top right"
  | "to top left";

const GRADIENT_DIRECTION_OPTIONS: Array<{ value: GradientDirection; label: string }> = [
  { value: "to right", label: "向右" },
  { value: "to left", label: "向左" },
  { value: "to bottom", label: "向下" },
  { value: "to top", label: "向上" },
  { value: "to bottom right", label: "右下" },
  { value: "to bottom left", label: "左下" },
  { value: "to top right", label: "右上" },
  { value: "to top left", label: "左上" },
];

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{6})$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function buildLinearGradient(direction: GradientDirection, start: string, end: string) {
  const startHex = normalizeHexColor(start) ?? "#ffffff";
  const endHex = normalizeHexColor(end) ?? "#000000";
  return `linear-gradient(${direction}, ${startHex} 0%, ${endHex} 100%)`;
}

function parseGradientValue(value: string | undefined) {
  const raw = (value ?? "").trim();
  const solidHex = normalizeHexColor(raw);
  if (solidHex) {
    return {
      mode: "solid" as const,
      solidColor: solidHex,
      startColor: solidHex,
      endColor: "#000000",
      direction: "to right" as GradientDirection,
    };
  }

  const gradientMatch = raw.match(
    /^linear-gradient\(\s*(to\s+(?:left|right|top|bottom)(?:\s+(?:left|right|top|bottom))?)\s*,\s*(#[0-9a-fA-F]{6})(?:\s+\d+%?)?\s*,\s*(#[0-9a-fA-F]{6})(?:\s+\d+%?)?\s*\)$/i,
  );
  if (gradientMatch) {
    const parsedDirection = gradientMatch[1].toLowerCase() as GradientDirection;
    const direction = GRADIENT_DIRECTION_OPTIONS.some((item) => item.value === parsedDirection)
      ? parsedDirection
      : "to right";
    return {
      mode: "gradient" as const,
      solidColor: "#ffffff",
      startColor: gradientMatch[2].toLowerCase(),
      endColor: gradientMatch[3].toLowerCase(),
      direction,
    };
  }

  return {
    mode: "solid" as const,
    solidColor: "#ffffff",
    startColor: "#ffffff",
    endColor: "#000000",
    direction: "to right" as GradientDirection,
  };
}

export function isGradientToken(value: string) {
  return /^linear-gradient\(/i.test(value.trim());
}

export function ColorSwatchPalette({
  colors,
  selectedValue,
  onPick,
}: {
  colors: string[];
  selectedValue?: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((color) => {
        const normalizedSelected = (selectedValue ?? "").trim().toLowerCase();
        const normalizedColor = color.trim().toLowerCase();
        const isSelected = normalizedSelected === normalizedColor;
        return (
          <button
            key={color}
            type="button"
            aria-pressed={isSelected}
            className={`h-8 w-8 rounded-full border transition ${isSelected ? "border-slate-900 ring-2 ring-sky-500/70" : "border-slate-300 hover:border-slate-400"}`}
            style={isGradientToken(color) ? { backgroundImage: color } : { backgroundColor: color }}
            title={color}
            onClick={() => onPick(color)}
          />
        );
      })}
    </div>
  );
}

export function ColorOrGradientPicker({
  value,
  onChange,
  allowGradient = true,
}: {
  value: string;
  onChange: (next: string) => void;
  allowGradient?: boolean;
}) {
  return <ColorOrGradientPickerInner key={`${allowGradient ? "g" : "s"}:${value}`} value={value} onChange={onChange} allowGradient={allowGradient} />;
}

function ColorOrGradientPickerInner({
  value,
  onChange,
  allowGradient = true,
}: {
  value: string;
  onChange: (next: string) => void;
  allowGradient?: boolean;
}) {
  const parsed = parseGradientValue(value);
  const [mode, setMode] = useState<"solid" | "gradient">(allowGradient ? parsed.mode : "solid");
  const [solidColor, setSolidColor] = useState(parsed.solidColor);
  const [startColor, setStartColor] = useState(parsed.startColor);
  const [endColor, setEndColor] = useState(parsed.endColor);
  const [direction, setDirection] = useState<GradientDirection>(parsed.direction);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const resetDraftFromValue = () => {
    const nextParsed = parseGradientValue(value);
    setMode(allowGradient ? nextParsed.mode : "solid");
    setSolidColor(nextParsed.solidColor);
    setStartColor(nextParsed.startColor);
    setEndColor(nextParsed.endColor);
    setDirection(nextParsed.direction);
  };

  const commitDraft = () => {
    if (mode === "solid" || !allowGradient) {
      onChange(normalizeHexColor(solidColor) ?? "#ffffff");
      setOpen(false);
      return;
    }
    onChange(buildLinearGradient(direction, startColor, endColor));
    setOpen(false);
  };

  const cancelDraft = () => {
    resetDraftFromValue();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!target || !(target instanceof Node)) return;
      if (pickerRef.current?.contains(target)) return;
      const nextParsed = parseGradientValue(value);
      setMode(allowGradient ? nextParsed.mode : "solid");
      setSolidColor(nextParsed.solidColor);
      setStartColor(nextParsed.startColor);
      setEndColor(nextParsed.endColor);
      setDirection(nextParsed.direction);
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, value, allowGradient]);

  const committedPreview = isGradientToken(value)
    ? { backgroundImage: value }
    : { backgroundColor: normalizeHexColor(value) ?? "#ffffff" };
  const draftGradientPreview = buildLinearGradient(direction, startColor, endColor);

  return (
    <div ref={pickerRef} className="relative space-y-2">
      <button
        type="button"
        className="w-full rounded border bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
        onClick={() => {
          if (open) {
            cancelDraft();
            return;
          }
          resetDraftFromValue();
          setOpen(true);
        }}
      >
        <span className="flex items-center gap-3">
          <span className="h-8 w-12 rounded border border-slate-300" style={committedPreview} />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={value}>
            {value || "#ffffff"}
          </span>
          <span className="shrink-0 rounded border px-2 py-0.5 text-xs">{open ? "关闭" : "编辑"}</span>
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-[14000] mt-1 w-[min(560px,calc(100vw-2rem))] space-y-3 rounded-xl border bg-white p-3 shadow-xl">
          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded border px-2 py-1 text-xs ${mode === "solid" ? "border-black bg-black text-white" : "bg-white"}`}
              onClick={() => setMode("solid")}
            >
              纯色
            </button>
            {allowGradient ? (
              <button
                type="button"
                className={`rounded border px-2 py-1 text-xs ${mode === "gradient" ? "border-black bg-black text-white" : "bg-white"}`}
                onClick={() => setMode("gradient")}
              >
                渐变
              </button>
            ) : null}
          </div>
          {mode === "solid" || !allowGradient ? (
            <div className="grid items-end gap-2 sm:grid-cols-[120px_1fr]">
              <input
                className="h-10 w-full rounded border p-1"
                type="color"
                value={normalizeHexColor(solidColor) ?? "#ffffff"}
                onChange={(event) => setSolidColor(event.target.value)}
              />
              <input
                className="w-full rounded border p-2 text-sm"
                value={solidColor}
                placeholder="#ffffff"
                onChange={(event) => setSolidColor(event.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid grid-cols-[44px_1fr] gap-2">
                  <input
                    className="h-10 w-11 rounded border p-1"
                    type="color"
                    value={normalizeHexColor(startColor) ?? "#ffffff"}
                    onChange={(event) => setStartColor(event.target.value)}
                  />
                  <input className="w-full rounded border p-2 text-sm" value={startColor} onChange={(event) => setStartColor(event.target.value)} />
                </div>
                <div className="grid grid-cols-[44px_1fr] gap-2">
                  <input
                    className="h-10 w-11 rounded border p-1"
                    type="color"
                    value={normalizeHexColor(endColor) ?? "#000000"}
                    onChange={(event) => setEndColor(event.target.value)}
                  />
                  <input className="w-full rounded border p-2 text-sm" value={endColor} onChange={(event) => setEndColor(event.target.value)} />
                </div>
              </div>
              <select className="w-full rounded border p-2 text-sm" value={direction} onChange={(event) => setDirection(event.target.value as GradientDirection)}>
                {GRADIENT_DIRECTION_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="h-9 rounded border" style={{ backgroundImage: draftGradientPreview }} />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-slate-50" onClick={cancelDraft}>
              取消
            </button>
            <button type="button" className="rounded bg-black px-3 py-1.5 text-xs text-white" onClick={commitDraft}>
              确认
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
