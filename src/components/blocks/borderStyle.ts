import type { CSSProperties } from "react";
import type { BlockBorderStyle } from "@/data/homeBlocks";

export const BLOCK_BORDER_STYLE_OPTIONS: Array<{ value: BlockBorderStyle; label: string }> = [
  { value: "none", label: "无边框" },
  { value: "glass", label: "玻璃状" },
  { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线" },
  { value: "double", label: "双线" },
  { value: "accent", label: "强调" },
];

const DEFAULT_BORDER_COLOR = "#6b7280";

function isGradient(input?: string) {
  return /^linear-gradient\(/i.test((input ?? "").trim());
}

function normalizeHexColor(input?: string) {
  const value = (input ?? "").trim();
  return /^#([0-9a-fA-F]{6})$/.test(value) ? value : DEFAULT_BORDER_COLOR;
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = normalizeHexColor(hex);
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

export function getBlockBorderClass(style?: BlockBorderStyle) {
  switch (style ?? "glass") {
    case "none":
      return "!border-0 !shadow-none";
    case "solid":
      return "border-2";
    case "dashed":
      return "border-2 border-dashed";
    case "double":
      return "border-4 border-double";
    case "accent":
      return "border-2";
    case "glass":
    case "soft":
    default:
      return "border shadow-sm backdrop-blur-[1px]";
  }
}

export function getBlockBorderInlineStyle(style?: BlockBorderStyle, color?: string): CSSProperties {
  const rawColor = (color ?? "").trim();
  const borderColor = normalizeHexColor(rawColor);
  const gradient = isGradient(rawColor) ? rawColor : null;
  const gradientBorderStyle: CSSProperties = gradient
    ? {
        borderColor: "transparent",
        borderImageSource: gradient,
        borderImageSlice: 1,
        backgroundClip: "padding-box",
      }
    : {};
  switch (style ?? "glass") {
    case "none":
      return {};
    case "solid":
    case "dashed":
    case "double":
      return {
        ...gradientBorderStyle,
        borderColor: gradient ? "transparent" : borderColor,
        backgroundClip: "padding-box",
      };
    case "accent":
      return {
        ...gradientBorderStyle,
        borderColor: gradient ? "transparent" : borderColor,
        backgroundClip: "padding-box",
        boxShadow: gradient ? undefined : `0 0 0 3px ${hexToRgba(borderColor, 0.2)}`,
      };
    case "glass":
    case "soft":
    default:
      return {
        ...gradientBorderStyle,
        borderColor: gradient ? "transparent" : hexToRgba(borderColor, 0.35),
        backgroundClip: "padding-box",
      };
  }
}
