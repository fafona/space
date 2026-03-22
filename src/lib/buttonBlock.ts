import type { ButtonProps } from "@/data/homeBlocks";

type LegacyButtonTextBox = NonNullable<ButtonProps["commonTextBoxes"]>[number];

export const DEFAULT_BUTTON_LABEL = "按钮";

function hasVisibleContent(value: string | undefined) {
  if (typeof value !== "string") return false;
  const normalized = value
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<\/?(div|p|span|strong|em|u|b|i)[^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return normalized.length > 0;
}

function findLegacyButtonLabel(props: ButtonProps) {
  const textBoxes = Array.isArray(props.commonTextBoxes) ? props.commonTextBoxes : [];
  const firstTextBox = textBoxes.find((item: LegacyButtonTextBox | undefined) => hasVisibleContent(item?.html));
  if (firstTextBox?.html) return firstTextBox.html;

  const commonItems = Array.isArray(props.commonItems) ? props.commonItems : [];
  const commonItem = commonItems.find((item) => hasVisibleContent(item));
  if (commonItem) return commonItem;

  if (hasVisibleContent(props.heading)) return props.heading ?? "";
  if (hasVisibleContent(props.text)) return props.text ?? "";
  return "";
}

export function resolveButtonLabel(props: ButtonProps) {
  if (hasVisibleContent(props.buttonLabel)) {
    return props.buttonLabel ?? DEFAULT_BUTTON_LABEL;
  }
  return findLegacyButtonLabel(props) || DEFAULT_BUTTON_LABEL;
}

export function buildButtonLabelPatch(buttonLabel: string): Partial<ButtonProps> {
  return {
    buttonLabel,
    commonTextBoxes: undefined,
    commonItems: undefined,
    heading: undefined,
    text: undefined,
  };
}
