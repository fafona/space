import { buildPersonalLoginHref } from "@/lib/personalLoginNavigation";
import { cleanPublicWebsiteReturnUrl } from "@/lib/publicWebsiteNavigation";

export function readServiceWebsiteLoginReturn(value: string) {
  try {
    const url = new URL(value);
    if (url.searchParams.get("entry") !== "web") return "";
    return cleanPublicWebsiteReturnUrl(url.toString());
  } catch { return ""; }
}

export function buildServiceLoginHref(href: string) {
  try {
    const source = new URL(href);
    let target = source;
    if (source.pathname === "/service-center") {
      const origin = source.searchParams.get("parentOrigin") || "";
      const siteId = source.searchParams.get("siteId") || "";
      const returnTo = cleanPublicWebsiteReturnUrl(source.searchParams.get("returnTo") || "");
      if (returnTo && new URL(returnTo).origin === origin) target = new URL(returnTo);
      else if (/^\d{8}$/.test(siteId)) target = new URL(`/site/${siteId}`, origin);
      else return buildPersonalLoginHref("");
    }
    target.searchParams.set("entry", "web");
    return buildPersonalLoginHref(target.toString());
  } catch { return buildPersonalLoginHref(""); }
}
