import type { CSSProperties } from "react";
import type { TypographyEditableProps } from "@/data/homeBlocks";

export function getTypographyStyle(props: TypographyEditableProps): CSSProperties {
  const style: CSSProperties = {};

  if (props.fontFamily?.trim()) {
    style.fontFamily = props.fontFamily.trim();
  }
  if (props.fontColor?.trim()) {
    style.color = props.fontColor.trim();
  }
  if (typeof props.fontSize === "number" && Number.isFinite(props.fontSize) && props.fontSize > 0) {
    style.fontSize = props.fontSize;
  }
  if (props.fontWeight) {
    style.fontWeight = props.fontWeight;
  }
  if (props.fontStyle) {
    style.fontStyle = props.fontStyle;
  }
  if (props.textDecoration) {
    style.textDecoration = props.textDecoration;
  }

  return style;
}
