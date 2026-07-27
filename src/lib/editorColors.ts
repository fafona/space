export type GradientDirection =
  | "to right"
  | "to left"
  | "to bottom"
  | "to top"
  | "to bottom right"
  | "to bottom left"
  | "to top right"
  | "to top left";

export const GRADIENT_DIRECTION_OPTIONS: Array<{ value: GradientDirection; label: string }> = [
  { value: "to right", label: "向右" },
  { value: "to left", label: "向左" },
  { value: "to bottom", label: "向下" },
  { value: "to top", label: "向上" },
  { value: "to bottom right", label: "右下" },
  { value: "to bottom left", label: "左下" },
  { value: "to top right", label: "右上" },
  { value: "to top left", label: "左上" },
];

export function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{6})$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function buildLinearGradient(direction: GradientDirection, start: string, end: string) {
  const startHex = normalizeHexColor(start) ?? "#ffffff";
  const endHex = normalizeHexColor(end) ?? "#000000";
  return `linear-gradient(${direction}, ${startHex} 0%, ${endHex} 100%)`;
}

export function parseGradientValue(value: string | undefined) {
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

export function normalizeRecentColorToken(value: string) {
  const hex = normalizeHexColor(value);
  if (hex) return hex;
  const trimmed = value.trim();
  if (/^linear-gradient\(/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function isGradientToken(value: string) {
  return /^linear-gradient\(/i.test(value.trim());
}
