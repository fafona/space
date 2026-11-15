"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import type { NavBlockProps } from "./NavBlock";
import { useI18n } from "@/components/I18nProvider";
import { localizeSystemDefaultText } from "@/lib/editorSystemDefaults";
import { getSiteNavigationItems, getSiteNavigationSubItems, siteNavigationColor } from "@/lib/siteNavigation";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { toPlainRichText } from "@/lib/richTextSafety";
import { toRichHtml } from "./richText";

/** Shared by the public renderer and inline editor. Opt-in only; no legacy navigation changes. */
export default function BrandedNavigation(props: NavBlockProps) {
  const { locale } = useI18n();
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId().replace(/:/g, "");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = getSiteNavigationItems(props);
  const subItems = getSiteNavigationSubItems(props);
  const logo = normalizePublicAssetUrl(props.navLogoUrl ?? "");
  const brand = localizeSystemDefaultText(props.heading || "", locale);
  const labels = locale.startsWith("zh") ? { menu: "导航菜单", open: "展开导航", close: "收起导航", sub: "展开子菜单：", home: "首页" } :
    locale.startsWith("es") ? { menu: "Navegación principal", open: "Abrir menú", close: "Cerrar menú", sub: "Abrir submenú: ", home: "Inicio" } :
      { menu: "Main navigation", open: "Open navigation", close: "Close navigation", sub: "Open submenu: ", home: "Home" };
  const style = {
    "--site-nav-bg": siteNavigationColor(props.bgColor, "#303136"),
    "--site-nav-text": siteNavigationColor(props.fontColor, "#ffffff"),
    "--site-nav-accent": siteNavigationColor(props.navAccentColor, "#f5888e"),
    "--site-nav-panel": siteNavigationColor(props.navPanelColor, "#303136"),
    fontFamily: props.fontFamily || undefined,
    fontSize: typeof props.fontSize === "number" && Number.isFinite(props.fontSize) ? Math.min(24, Math.max(12, props.fontSize)) : undefined,
  } as CSSProperties;

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setMobileOpen(false); setExpanded(null);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  // A resized editor/phone must never retain an invisible open menu on return.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let previous: boolean | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const compact = props.forceMobileViewport === true || entry.contentRect.width <= 900;
      if (previous !== undefined && previous !== compact) { setMobileOpen(false); setExpanded(null); }
      previous = compact;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.forceMobileViewport]);

  function navigate(pageId: string) {
    setMobileOpen(false); setExpanded(null);
    props.onNavigatePage?.(pageId);
  }

  return (
    <section ref={root} data-site-navigation data-force-mobile={props.forceMobileViewport || undefined}
      data-utility-space={props.navUtilitySpace || undefined} className="faolla-site-navigation" style={style}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (expanded) {
          root.current?.querySelector<HTMLButtonElement>(`[data-submenu-toggle][aria-expanded="true"]`)?.focus();
          setExpanded(null);
        } else if (mobileOpen) { setMobileOpen(false); toggle.current?.focus(); }
      }}>
      <div className="faolla-site-navigation-inner">
        <button type="button" className="faolla-site-brand" onClick={() => items[0] && navigate(items[0].pageId)} aria-label={toPlainRichText(brand) || labels.home}>
          {logo ? <Image src={logo} alt={props.navLogoAlt || ""} width={72} height={72} unoptimized className="faolla-site-logo" /> : null}
          {brand ? <span dangerouslySetInnerHTML={{ __html: toRichHtml(brand, "") }} /> : null}
        </button>
        <button ref={toggle} type="button" className="faolla-site-menu-toggle" aria-label={mobileOpen ? labels.close : labels.open}
          aria-expanded={mobileOpen} aria-controls={id} onClick={() => { setMobileOpen(!mobileOpen); setExpanded(null); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={mobileOpen ? "m6 6 12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"} /></svg>
        </button>
        <nav id={id} aria-label={labels.menu} className="faolla-site-menu" data-open={mobileOpen || undefined}>
          <ul className="faolla-site-links">
            {items.map((item, index) => {
              const children = subItems.filter(child => child.parentPageId === item.pageId);
              const open = expanded === item.pageId;
              const label = localizeSystemDefaultText(item.label, locale);
              const active = props.currentPageId === item.pageId;
              return <li key={item.id || item.pageId} className="faolla-site-menu-item" data-expanded={open || undefined}
                data-cta={props.navCtaPageId === item.pageId || undefined}
                onPointerEnter={event => { if (event.pointerType === "mouse" && window.matchMedia("(hover:hover)").matches && (root.current?.clientWidth ?? 0) > 900 && !props.forceMobileViewport) setExpanded(children.length ? item.pageId : null); }}
                onPointerLeave={event => { if (event.pointerType === "mouse" && (root.current?.clientWidth ?? 0) > 900 && !props.forceMobileViewport && !event.currentTarget.contains(document.activeElement)) setExpanded(null); }}
                onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setExpanded(current => current === item.pageId ? null : current); }}>
                <div className="faolla-site-link-row">
                  <button type="button" className="faolla-site-link" aria-current={active ? "page" : undefined} onClick={() => navigate(item.pageId)}
                    dangerouslySetInnerHTML={{ __html: toRichHtml(label, "") }} />
                  {children.length ? <button type="button" data-submenu-toggle className="faolla-site-submenu-toggle" aria-expanded={open}
                    aria-controls={`${id}-sub-${index}`} aria-label={labels.sub + toPlainRichText(label)}
                    onClick={() => setExpanded(open ? null : item.pageId)}
                    onKeyDown={event => {
                      if (event.key !== "ArrowDown") return;
                      event.preventDefault(); setExpanded(item.pageId);
                      requestAnimationFrame(() => document.getElementById(`${id}-sub-${index}`)?.querySelector<HTMLButtonElement>("button")?.focus());
                    }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button> : null}
                </div>
                {children.length ? <ul id={`${id}-sub-${index}`} className="faolla-site-submenu" hidden={!open}>
                  {children.map(child => <li key={child.id}><button type="button" onClick={() => navigate(child.pageId)}
                    dangerouslySetInnerHTML={{ __html: toRichHtml(localizeSystemDefaultText(child.label, locale), "") }} /></li>)}
                </ul> : null}
              </li>;
            })}
          </ul>
        </nav>
      </div>
    </section>
  );
}
