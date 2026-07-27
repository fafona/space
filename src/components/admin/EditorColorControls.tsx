"use client";

import { useEffect, useRef, useState } from "react";
import {
  GRADIENT_DIRECTION_OPTIONS,
  buildLinearGradient,
  isGradientToken,
  normalizeHexColor,
  parseGradientValue,
  type GradientDirection,
} from "@/lib/editorColors";

export function RecentColorBar({
  colors,
  onPick,
  onClear,
  allowGradients = true,
  selectedValue,
  compact = false,
}: {
  colors: string[];
  onPick: (color: string) => void;
  onClear?: () => void;
  allowGradients?: boolean;
  selectedValue?: string;
  compact?: boolean;
}) {
  const shownColors = allowGradients ? colors : colors.filter((item) => !isGradientToken(item));
  const swatchSize = 24;
  const swatchGap = 6;
  const visibleSwatchCount = 10;
  if (compact) {
    return shownColors.length > 0 ? (
      <div className="flex w-full items-center gap-2">
        <div
          className="overflow-hidden"
          style={{ width: `${visibleSwatchCount * swatchSize + (visibleSwatchCount - 1) * swatchGap}px` }}
        >
          <div className="flex flex-nowrap gap-1.5">
            {shownColors.slice(0, visibleSwatchCount).map((color) => {
              const isSelected = selectedValue?.trim().toLowerCase() === color.trim().toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  aria-pressed={isSelected}
                  className={`h-6 w-6 shrink-0 rounded border transition ${
                    isSelected ? "border-slate-900 ring-2 ring-sky-500/70" : "border-gray-300"
                  }`}
                  style={isGradientToken(color) ? { backgroundImage: color } : { backgroundColor: color }}
                  title={color}
                  onClick={() => onPick(color)}
                />
              );
            })}
          </div>
        </div>
      </div>
    ) : (
      <div className="rounded border border-dashed px-2 py-2 text-xs text-gray-400">暂无最近颜色</div>
    );
  }
  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">最近颜色</div>
        {onClear ? (
          <button
            type="button"
            className="rounded border bg-white px-2 py-1 text-xs hover:bg-gray-50"
            onClick={onClear}
          >
            清空
          </button>
        ) : null}
      </div>
      {shownColors.length > 0 ? (
        <div style={{ width: `${visibleSwatchCount * swatchSize + (visibleSwatchCount - 1) * swatchGap}px` }}>
          <div className="flex flex-nowrap gap-1.5">
            {shownColors.slice(0, visibleSwatchCount).map((color) => {
              const isSelected = selectedValue?.trim().toLowerCase() === color.trim().toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  aria-pressed={isSelected}
                  className={`h-6 w-6 shrink-0 rounded border transition ${
                    isSelected ? "border-slate-900 ring-2 ring-sky-500/70" : "border-gray-300"
                  }`}
                  style={isGradientToken(color) ? { backgroundImage: color } : { backgroundColor: color }}
                  title={color}
                  onClick={() => onPick(color)}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed px-2 py-2 text-xs text-gray-400">暂无最近颜色</div>
      )}
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
  return (
    <ColorOrGradientPickerInner
      key={`${allowGradient ? "g" : "s"}:${value}`}
      value={value}
      onChange={onChange}
      allowGradient={allowGradient}
    />
  );
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
        className="w-full rounded border bg-white px-2 py-2 text-left text-sm hover:bg-gray-50"
        onClick={() => {
          if (open) {
            cancelDraft();
            return;
          }
          resetDraftFromValue();
          setOpen(true);
        }}
      >
        <span className="flex items-center gap-2">
          <span className="h-6 w-10 rounded border border-gray-300" style={committedPreview} />
          <span className="min-w-0 flex-1 truncate text-xs text-gray-700" title={value}>
            {value || "#ffffff"}
          </span>
          <span className="shrink-0 rounded border px-2 py-0.5 text-xs">{open ? "关闭" : "编辑"}</span>
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-[14000] mt-1 w-[min(560px,calc(100vw-2rem))] space-y-2 rounded border bg-white p-2 shadow-xl">
          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded border px-2 py-1 text-xs ${
                mode === "solid" ? "border-black bg-black text-white" : "bg-white"
              }`}
              onClick={() => setMode("solid")}
            >
              纯色
            </button>
            {allowGradient ? (
              <button
                type="button"
                className={`rounded border px-2 py-1 text-xs ${
                  mode === "gradient" ? "border-black bg-black text-white" : "bg-white"
                }`}
                onClick={() => setMode("gradient")}
              >
                渐变
              </button>
            ) : null}
          </div>
          {mode === "solid" || !allowGradient ? (
            <div className="grid grid-cols-[120px_1fr] items-end gap-2">
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
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="grid grid-cols-[44px_1fr] gap-2">
                    <input
                      className="h-10 w-11 rounded border p-1"
                      type="color"
                      value={normalizeHexColor(startColor) ?? "#ffffff"}
                      onChange={(event) => setStartColor(event.target.value)}
                    />
                    <input
                      className="w-full rounded border p-2 text-sm"
                      value={startColor}
                      onChange={(event) => setStartColor(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="grid grid-cols-[44px_1fr] gap-2">
                    <input
                      className="h-10 w-11 rounded border p-1"
                      type="color"
                      value={normalizeHexColor(endColor) ?? "#000000"}
                      onChange={(event) => setEndColor(event.target.value)}
                    />
                    <input
                      className="w-full rounded border p-2 text-sm"
                      value={endColor}
                      onChange={(event) => setEndColor(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <select
                  className="w-full rounded border p-2 text-sm"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as GradientDirection)}
                >
                  {GRADIENT_DIRECTION_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="h-8 rounded border" style={{ backgroundImage: draftGradientPreview }} />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
              onClick={cancelDraft}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded bg-black px-3 py-1.5 text-xs text-white"
              onClick={commitDraft}
            >
              确认
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
