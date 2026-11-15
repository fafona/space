import type { NavProps, NavSubItem } from "@/data/homeBlocks";

/** Submenus only link to existing navigation pages; never create pages or external URLs. */
export function getSiteNavigationItems(props: NavProps) {
  const ids = new Set<string>();
  return (Array.isArray(props.navItems) ? props.navItems : []).filter(item => {
    if (!item || typeof item.pageId !== "string" || !item.pageId.trim() || typeof item.label !== "string" || ids.has(item.pageId)) return false;
    ids.add(item.pageId);
    return true;
  });
}

export function getSiteNavigationSubItems(props: NavProps): NavSubItem[] {
  const pages = new Set(getSiteNavigationItems(props).map(item => item.pageId));
  const ids = new Set<string>();
  return (Array.isArray(props.navSubItems) ? props.navSubItems : []).slice(0, 32).filter(item => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
      typeof item.label !== "string" || !item.label.trim() ||
      !pages.has(item.parentPageId) || !pages.has(item.pageId) || item.parentPageId === props.navCtaPageId) return false;
    ids.add(item.id);
    return true;
  });
}

export function siteNavigationColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/** Only an explicit compact preset changes existing header dimensions. */
export function siteNavigationDensity(value: unknown) {
  return value === "compact" ? "compact" : undefined;
}
