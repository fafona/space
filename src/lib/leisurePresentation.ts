import type { Block } from "@/data/homeBlocks";

export const LEISURE_PRESENTATIONS = ["leisure-home-v1", "leisure-games-v1", "leisure-visit-v1"] as const;
export type LeisurePresentation = (typeof LEISURE_PRESENTATIONS)[number];
const ROLE_TYPES: Readonly<Record<string, readonly Block["type"][]>> = {
  header: ["nav"], hero: ["gallery", "button"], "hero-copy": ["text"],
  primary: ["button"], secondary: ["button"], intro: ["text"],
  "feature-one": ["text"], "feature-two": ["text"], "feature-three": ["text"],
  "section-title": ["text"], "photo-one": ["common"], "photo-two": ["common"],
  "copy-one": ["text"], "copy-two": ["text"], "copy-one-link": ["button"], "copy-two-link": ["button"],
  "panel-one": ["text"], "panel-two": ["text"], "panel-three": ["text"],
  "panel-one-link": ["button"], "panel-two-link": ["button"], "panel-three-link": ["button"],
  "video-title": ["text"], "video-one": ["button", "common"], "video-two": ["button", "common"],
  visit: ["text"], "visit-link": ["button"], booking: ["booking"], contact: ["contact"],
  "before-visit": ["text"], "map-link": ["button"], footer: ["text"], "footer-link": ["button"],
};
/** An explicit, inert presentation opt-in. Never infer a theme from a merchant ID or hostname. */
export function getLeisurePresentation(blocks: readonly Block[]): LeisurePresentation | null {
  const requested = blocks.find(b => b.props && Object.hasOwn(b.props, "pagePresentation"))?.props.pagePresentation;
  return LEISURE_PRESENTATIONS.includes(requested as LeisurePresentation) ? requested as LeisurePresentation : null;
}
export function getLeisureRole(block: Block): string | undefined {
  const role = Object.hasOwn(block.props, "leisureRole") ? block.props.leisureRole : undefined;
  return typeof role === "string" && Object.hasOwn(ROLE_TYPES, role) && ROLE_TYPES[role].includes(block.type) ? role : undefined;
}
export function getLeisureBlockStyle(block: Block, index: number) {
  // Newly inserted ordinary editor blocks remain visible, after the designed sections.
  return getLeisureRole(block) ? undefined : { gridColumn: "1 / -1", gridRow: 40 + index };
}
