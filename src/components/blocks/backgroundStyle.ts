import type { CSSProperties } from "react";
import type { ImageFillMode } from "@/data/homeBlocks";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

export type BackgroundStyleInput = {
  imageUrl?: string;
  fillMode?: ImageFillMode;
  position?: string;
  color?: string;
  opacity?: number;
  imageOpacity?: number;
  colorOpacity?: number;
};

function colorWithOpacity(color: string, opacity: number) {
  const hex = color.trim();
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return color;
  const r = Number.parseInt(match[1].slice(0, 2), 16);
  const g = Number.parseInt(match[1].slice(2, 4), 16);
  const b = Number.parseInt(match[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity.toFixed(3)})`;
}

function isLinearGradient(value: string) {
  return /^linear-gradient\(/i.test(value.trim());
}

function linearGradientWithOpacity(gradient: string, opacity: number) {
  const alpha = Math.max(0, Math.min(1, opacity));
  let next = gradient.replace(/#([0-9a-fA-F]{6})/g, (match, hex: string) => {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return match;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  });

  next = next.replace(/rgba?\(([^)]+)\)/gi, (match, content: string) => {
    const parts = content.split(",").map((item) => item.trim());
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return match;
    }
    return `rgba(${Math.max(0, Math.min(255, Math.round(r)))}, ${Math.max(0, Math.min(255, Math.round(g)))}, ${Math.max(
      0,
      Math.min(255, Math.round(b)),
    )}, ${alpha.toFixed(3)})`;
  });

  return next;
}

export function getBackgroundStyle(input: BackgroundStyleInput): CSSProperties {
  const imageUrl = normalizePublicAssetUrl(input.imageUrl?.trim() ?? "");
  const fillMode = input.fillMode ?? "cover";
  const position = input.position?.trim() || "center";
  const color = input.color?.trim();
  const fallbackOpacity =
    typeof input.opacity === "number" && Number.isFinite(input.opacity)
      ? Math.max(0, Math.min(1, input.opacity))
      : 1;
  const imageOpacity =
    typeof input.imageOpacity === "number" && Number.isFinite(input.imageOpacity)
      ? Math.max(0, Math.min(1, input.imageOpacity))
      : fallbackOpacity;
  const colorOpacity =
    typeof input.colorOpacity === "number" && Number.isFinite(input.colorOpacity)
      ? Math.max(0, Math.min(1, input.colorOpacity))
      : fallbackOpacity;
  const style: CSSProperties = {};
  const hasColor = !!color;
  const gradientColor = hasColor && color && isLinearGradient(color) ? color : undefined;
  const solidColor = hasColor && !gradientColor && color ? colorWithOpacity(color, colorOpacity) : undefined;

  if (!imageUrl) {
    if (gradientColor) {
      if (colorOpacity <= 0) {
        style.backgroundColor = "transparent";
      } else {
        style.backgroundImage = colorOpacity < 1 ? linearGradientWithOpacity(gradientColor, colorOpacity) : gradientColor;
      }
      style.backgroundPosition = position;
      style.backgroundRepeat = "no-repeat";
      style.backgroundSize = "cover";
      return style;
    }

    if (!hasColor) {
      if (colorOpacity <= 0) {
        style.backgroundColor = "transparent";
      } else if (colorOpacity < 1) {
        style.backgroundColor = `rgba(255, 255, 255, ${colorOpacity.toFixed(3)})`;
      }
      return style;
    }

    if (hasColor) {
      if (colorOpacity <= 0) {
        style.backgroundColor = "transparent";
      } else if (solidColor) {
        style.backgroundColor = solidColor;
      } else {
        style.backgroundColor = color;
      }
    }
    return style;
  }

  const layers: string[] = [];
  const hasGradientOverlay = !!gradientColor;
  if (hasGradientOverlay) {
    if (colorOpacity > 0) {
      layers.push(colorOpacity < 1 ? linearGradientWithOpacity(gradientColor, colorOpacity) : gradientColor);
    }
  } else if (hasColor && solidColor && colorOpacity > 0) {
    layers.push(`linear-gradient(${solidColor}, ${solidColor})`);
  }
  if (imageOpacity < 1) {
    const overlayAlpha = (1 - imageOpacity).toFixed(3);
    layers.push(`linear-gradient(rgba(255,255,255,${overlayAlpha}), rgba(255,255,255,${overlayAlpha}))`);
  }
  layers.push(`url("${imageUrl}")`);

  style.backgroundImage = layers.join(", ");
  style.backgroundPosition = position;

  if (fillMode === "repeat" || fillMode === "repeat-x" || fillMode === "repeat-y") {
    style.backgroundRepeat = fillMode;
    style.backgroundSize = "auto";
    return style;
  }

  style.backgroundRepeat = "no-repeat";
  style.backgroundSize = fillMode;
  return style;
}
