"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BackgroundEditableProps, TypographyEditableProps } from "@/data/homeBlocks";
import { trackContactClick } from "@/lib/analytics";
import { useI18n } from "@/components/I18nProvider";
import { resolveLocalizedSystemDefaultText } from "@/lib/editorSystemDefaults";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";
import { toRichHtml } from "./richText";

type ContactLayoutKey =
  | "phone"
  | "address"
  | "map"
  | "email"
  | "whatsapp"
  | "wechat"
  | "twitter"
  | "weibo"
  | "telegram"
  | "linkedin"
  | "discord"
  | "tiktok"
  | "xiaohongshu"
  | "facebook"
  | "instagram";

type ContactBlockProps = BackgroundEditableProps &
  TypographyEditableProps & {
  heading?: string;
  phone?: string;
  phones?: string[];
  address?: string;
  addresses?: string[];
  mapZoom?: number;
  mapType?: "roadmap" | "satellite";
  mapShowMarker?: boolean;
  email?: string;
  whatsapp?: string;
  wechat?: string;
  twitter?: string;
  weibo?: string;
  telegram?: string;
  linkedin?: string;
  discord?: string;
  tiktok?: string;
  xiaohongshu?: string;
  facebook?: string;
  instagram?: string;
  contactLayout?: Partial<Record<ContactLayoutKey, { x?: number; y?: number; width?: number; height?: number }>>;
  };

type ContactEntry = {
  key: ContactLayoutKey;
  label: string;
  value: string;
  href: string | null;
  iconUrl: string;
  buttonClass: string;
  minHeight?: number;
};

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function htmlToPlainText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function normalizeContactList(values?: string[]) {
  return Array.isArray(values) ? values.map((item) => htmlToPlainText(String(item ?? ""))).filter(Boolean) : [];
}

function buildPhoneHref(rawPhone?: string) {
  const text = htmlToPlainText(rawPhone ?? "");
  if (!text) return null;
  const hasPlus = text.trim().startsWith("+");
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length < 3) return null;
  return `tel:${hasPlus ? "+" : ""}${digits}`;
}

function buildSocialHref(label: string, rawValue?: string) {
  const value = (rawValue ?? "").trim();
  if (!value) return null;
  if (looksLikeUrl(value)) return value;
  if (/^weixin:\/\//i.test(value)) return value;

  if (label === "Email") return `mailto:${value}`;
  if (label === "WeChat") {
    const wechatId = value.replace(/^@+/, "").trim();
    return wechatId ? `weixin://dl/chat?username=${encodeURIComponent(wechatId)}` : "weixin://";
  }
  if (label === "WhatsApp") {
    const digits = value.replace(/[^\d]/g, "");
    return digits ? `https://wa.me/${digits}` : null;
  }
  if (label === "Twitter") return `https://x.com/${value.replace(/^@+/, "")}`;
  if (label === "微博") return `https://weibo.com/n/${encodeURIComponent(value.replace(/^@+/, ""))}`;
  if (label === "Telegram") return `https://t.me/${value.replace(/^@+/, "")}`;
  if (label === "LinkedIn") return `https://www.linkedin.com/in/${value.replace(/^@+/, "")}`;
  if (label === "Discord") {
    const normalized = value.replace(/^@+/, "").trim();
    if (/^\d{5,}$/.test(normalized)) return `https://discord.com/users/${normalized}`;
    if (/^[A-Za-z0-9-]+$/.test(normalized)) return `https://discord.gg/${normalized}`;
    return null;
  }
  if (label === "TikTok") return `https://www.tiktok.com/@${value.replace(/^@+/, "")}`;
  if (label === "Instagram") return `https://www.instagram.com/${value.replace(/^@+/, "")}`;
  if (label === "Facebook") return `https://www.facebook.com/${value.replace(/^@+/, "")}`;
  if (label === "小红书") return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(value)}`;
  return null;
}

function isEmbeddedFaollaShell() {
  if (typeof window === "undefined") return false;
  if (window.parent === window) return false;
  try {
    return (new URLSearchParams(window.location.search || "").get("appShell") ?? "").trim().toLowerCase() === "faolla";
  } catch {
    return false;
  }
}

function isHttpLikeHref(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function tryOpenHrefFromTopFrame(href: string) {
  const normalized = String(href ?? "").trim();
  if (!normalized || typeof window === "undefined") return false;
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = normalized;
      return true;
    }
  } catch {
    // Fall through to window.open below.
  }
  try {
    window.open(normalized, "_top");
    return true;
  } catch {
    return false;
  }
}

function getSocialIconUrl(label: string) {
  if (label === "Email") return "/social-icons/maildotru.svg";
  if (label === "WhatsApp") return "/social-icons/whatsapp.svg";
  if (label === "WeChat") return "/social-icons/wechat.svg";
  if (label === "Twitter") return "/social-icons/twitter.svg";
  if (label === "微博") return "/social-icons/weibo.svg";
  if (label === "Telegram") return "/social-icons/telegram.svg";
  if (label === "LinkedIn") return "/social-icons/linkedin.svg";
  if (label === "Discord") return "/social-icons/discord.svg";
  if (label === "TikTok") return "/social-icons/tiktok.svg";
  if (label === "小红书") return "/social-icons/xiaohongshu.svg";
  if (label === "Facebook") return "/social-icons/facebook.svg";
  if (label === "Instagram") return "/social-icons/instagram.svg";
  return "/social-icons/facebook.svg";
}

function getSocialButtonClass(label: string) {
  const base = "inline-flex h-8 w-8 items-center justify-center rounded-full shadow-sm hover:opacity-90";
  if (label === "Email") return `${base} bg-[#0A84FF]`;
  if (label === "WhatsApp") return `${base} bg-[#25D366]`;
  if (label === "WeChat") return `${base} bg-[#07C160]`;
  if (label === "Twitter") return `${base} bg-[#111827]`;
  if (label === "微博") return `${base} bg-[#E6162D]`;
  if (label === "Telegram") return `${base} bg-[#229ED9]`;
  if (label === "LinkedIn") return `${base} bg-[#0A66C2]`;
  if (label === "Discord") return `${base} bg-[#5865F2]`;
  if (label === "TikTok") return `${base} bg-black`;
  if (label === "小红书") return `${base} bg-[#FF2442]`;
  if (label === "Facebook") return `${base} bg-[#1877F2]`;
  if (label === "Instagram") return `${base} bg-[#E4405F]`;
  return `${base} bg-gray-500`;
}

function clampCoord(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function clampWidth(value: unknown, fallback = 360) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(200, Math.round(value));
}

function clampHeight(value: unknown, fallback = 42, min = 32) {
  if (typeof value !== "number" || !Number.isFinite(value)) return Math.max(min, fallback);
  return Math.max(min, Math.round(value));
}

function clampMapZoom(value: unknown, fallback = 5) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(2, Math.min(20, Math.round(value)));
}

function isGradientToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^(linear-gradient|radial-gradient|conic-gradient)\(/i.test(trimmed);
}

function buildContactTypographyStyle(props: TypographyEditableProps): CSSProperties {
  const style: CSSProperties = {};
  const fontFamily = (props.fontFamily ?? "").trim();
  const fontColor = (props.fontColor ?? "").trim();
  if (fontFamily) style.fontFamily = fontFamily;
  if (typeof props.fontSize === "number" && Number.isFinite(props.fontSize) && props.fontSize > 0) {
    style.fontSize = Math.max(8, Math.min(120, props.fontSize));
  }
  if (props.fontWeight) style.fontWeight = props.fontWeight;
  if (props.fontStyle) style.fontStyle = props.fontStyle;
  if (props.textDecoration) style.textDecoration = props.textDecoration;
  if (fontColor) {
    if (isGradientToken(fontColor)) {
      style.backgroundImage = fontColor;
      style.backgroundClip = "text";
      style.WebkitBackgroundClip = "text";
      style.color = "transparent";
    } else {
      style.color = fontColor;
    }
  }
  if (!style.color && !style.backgroundImage) style.color = "#374151";
  return style;
}

export default function ContactBlock(props: ContactBlockProps) {
  const mobileFitScreenWidth = props.mobileFitScreenWidth === true;
  const { locale } = useI18n();
  const [showMap, setShowMap] = useState(false);
  const [activeAddressIndex, setActiveAddressIndex] = useState(0);
  const [contactNotice, setContactNotice] = useState("");
  const contactNoticeTimerRef = useRef<number | null>(null);
  const cardStyle = getBackgroundStyle({
    imageUrl: props.bgImageUrl,
    fillMode: props.bgFillMode,
    position: props.bgPosition,
    color: props.bgColor,
    opacity: props.bgOpacity,
    imageOpacity: props.bgImageOpacity,
    colorOpacity: props.bgColorOpacity,
  });
  const blockWidth =
    typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth)
      ? Math.max(240, Math.round(props.blockWidth))
      : undefined;
  const blockHeight =
    typeof props.blockHeight === "number" && Number.isFinite(props.blockHeight)
      ? Math.max(120, Math.round(props.blockHeight))
      : undefined;
  const sizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    minHeight: blockHeight ? `${blockHeight}px` : undefined,
  };
  const offsetX =
    typeof props.blockOffsetX === "number" && Number.isFinite(props.blockOffsetX)
      ? Math.round(props.blockOffsetX)
      : 0;
  const offsetY =
    typeof props.blockOffsetY === "number" && Number.isFinite(props.blockOffsetY)
      ? Math.round(props.blockOffsetY)
      : 0;
  const blockLayer =
    typeof props.blockLayer === "number" && Number.isFinite(props.blockLayer)
      ? Math.max(1, Math.round(props.blockLayer))
      : 1;
  const offsetStyle = {
    position: "relative" as const,
    transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
    zIndex: blockLayer,
  };
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const addressList = (() => {
    const fromArray = Array.isArray(props.addresses)
      ? props.addresses.map((item) => htmlToPlainText(String(item ?? ""))).filter(Boolean)
      : [];
    if (fromArray.length > 0) return fromArray;
    const fallback = htmlToPlainText(props.address ?? "");
    return fallback ? [fallback] : [];
  })();
  const safeAddressIndex = Math.max(0, Math.min(activeAddressIndex, Math.max(0, addressList.length - 1)));
  const addressText = addressList[safeAddressIndex] ?? "";
  const mapZoom = clampMapZoom(props.mapZoom, 5);
  const mapType = props.mapType === "satellite" ? "k" : "m";
  const mapShowMarker = props.mapShowMarker !== false;
  const mapQuery = mapShowMarker ? addressText : `${addressText} 附近`;
  const mapEmbedUrl = addressText
    ? `https://www.google.com/maps?output=embed&hl=zh-CN&z=${mapZoom}&t=${mapType}&q=${encodeURIComponent(mapQuery)}`
    : null;
  const phoneList = normalizeContactList(props.phones);
  const fallbackPhone = htmlToPlainText(props.phone ?? "");
  const resolvedPhoneList = phoneList.length > 0 ? phoneList : fallbackPhone ? [fallbackPhone] : [];
  const phoneText = resolvedPhoneList.join(" / ");
  const primaryPhone = resolvedPhoneList[0] ?? "";
  const addressEntryMinHeight = Math.max(42, addressList.length * 44 || 42);

  const entries: ContactEntry[] = [
    {
      key: "address" as ContactLayoutKey,
      label: "地址",
      value: addressList.join("\n"),
      href: null,
      iconUrl: "",
      buttonClass: "",
      minHeight: addressEntryMinHeight,
    },
    {
      key: "phone" as ContactLayoutKey,
      label: "电话",
      value: phoneText,
      href: buildPhoneHref(primaryPhone),
      iconUrl: "",
      buttonClass: "inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm hover:bg-[#0066D6]",
    },
    {
      key: "email" as ContactLayoutKey,
      label: "Email",
      value: (props.email ?? "").trim(),
      href: buildSocialHref("Email", props.email),
      iconUrl: getSocialIconUrl("Email"),
      buttonClass: getSocialButtonClass("Email"),
    },
    {
      key: "whatsapp" as ContactLayoutKey,
      label: "WhatsApp",
      value: (props.whatsapp ?? "").trim(),
      href: buildSocialHref("WhatsApp", props.whatsapp),
      iconUrl: getSocialIconUrl("WhatsApp"),
      buttonClass: getSocialButtonClass("WhatsApp"),
    },
    {
      key: "wechat" as ContactLayoutKey,
      label: "WeChat",
      value: (props.wechat ?? "").trim(),
      href: buildSocialHref("WeChat", props.wechat),
      iconUrl: getSocialIconUrl("WeChat"),
      buttonClass: getSocialButtonClass("WeChat"),
    },
    {
      key: "twitter" as ContactLayoutKey,
      label: "Twitter",
      value: (props.twitter ?? "").trim(),
      href: buildSocialHref("Twitter", props.twitter),
      iconUrl: getSocialIconUrl("Twitter"),
      buttonClass: getSocialButtonClass("Twitter"),
    },
    {
      key: "weibo" as ContactLayoutKey,
      label: "微博",
      value: (props.weibo ?? "").trim(),
      href: buildSocialHref("微博", props.weibo),
      iconUrl: getSocialIconUrl("微博"),
      buttonClass: getSocialButtonClass("微博"),
    },
    {
      key: "telegram" as ContactLayoutKey,
      label: "Telegram",
      value: (props.telegram ?? "").trim(),
      href: buildSocialHref("Telegram", props.telegram),
      iconUrl: getSocialIconUrl("Telegram"),
      buttonClass: getSocialButtonClass("Telegram"),
    },
    {
      key: "linkedin" as ContactLayoutKey,
      label: "LinkedIn",
      value: (props.linkedin ?? "").trim(),
      href: buildSocialHref("LinkedIn", props.linkedin),
      iconUrl: getSocialIconUrl("LinkedIn"),
      buttonClass: getSocialButtonClass("LinkedIn"),
    },
    {
      key: "discord" as ContactLayoutKey,
      label: "Discord",
      value: (props.discord ?? "").trim(),
      href: buildSocialHref("Discord", props.discord),
      iconUrl: getSocialIconUrl("Discord"),
      buttonClass: getSocialButtonClass("Discord"),
    },
    {
      key: "tiktok" as ContactLayoutKey,
      label: "TikTok",
      value: (props.tiktok ?? "").trim(),
      href: buildSocialHref("TikTok", props.tiktok),
      iconUrl: getSocialIconUrl("TikTok"),
      buttonClass: getSocialButtonClass("TikTok"),
    },
    {
      key: "xiaohongshu" as ContactLayoutKey,
      label: "小红书",
      value: (props.xiaohongshu ?? "").trim(),
      href: buildSocialHref("小红书", props.xiaohongshu),
      iconUrl: getSocialIconUrl("小红书"),
      buttonClass: getSocialButtonClass("小红书"),
    },
    {
      key: "facebook" as ContactLayoutKey,
      label: "Facebook",
      value: (props.facebook ?? "").trim(),
      href: buildSocialHref("Facebook", props.facebook),
      iconUrl: getSocialIconUrl("Facebook"),
      buttonClass: getSocialButtonClass("Facebook"),
    },
    {
      key: "instagram" as ContactLayoutKey,
      label: "Instagram",
      value: (props.instagram ?? "").trim(),
      href: buildSocialHref("Instagram", props.instagram),
      iconUrl: getSocialIconUrl("Instagram"),
      buttonClass: getSocialButtonClass("Instagram"),
    },
  ].filter((item) => item.value);

  const withPos = entries.map((item, index) => {
    const p = props.contactLayout?.[item.key];
    const minHeight = typeof item.minHeight === "number" && Number.isFinite(item.minHeight) ? Math.max(32, Math.round(item.minHeight)) : 32;
    const defaultHeight = Math.max(minHeight, 42);
    return {
      ...item,
      x: clampCoord(p?.x ?? 0),
      y: clampCoord(p?.y ?? index * 48),
      width: clampWidth(p?.width),
      height: clampHeight(p?.height, defaultHeight, minHeight),
      minHeight,
    };
  });
  const contentHeight = Math.max(170, ...withPos.map((item) => item.y + item.height));
  const contentWidth = Math.max(260, ...withPos.map((item) => item.x + item.width));
  const contactTypographyStyle = buildContactTypographyStyle(props);

  useEffect(() => {
    return () => {
      if (contactNoticeTimerRef.current) {
        window.clearTimeout(contactNoticeTimerRef.current);
      }
    };
  }, []);

  const showTemporaryContactNotice = (message: string) => {
    if (contactNoticeTimerRef.current) {
      window.clearTimeout(contactNoticeTimerRef.current);
    }
    setContactNotice(message);
    contactNoticeTimerRef.current = window.setTimeout(() => {
      setContactNotice("");
      contactNoticeTimerRef.current = null;
    }, 3200);
  };

  const renderAddressRows = () => (
    <div className="min-w-0 flex-1 space-y-2 overflow-hidden">
      {addressList.map((line, idx) => {
        const isActive = idx === safeAddressIndex;
        return (
          <div key={`${line}-${idx}`} className="flex min-w-0 items-start gap-2">
            <button
              type="button"
              className={`min-w-0 flex-1 rounded px-1 py-0.5 text-left whitespace-pre-wrap break-words ${isActive ? "bg-black/5" : ""}`}
              style={contactTypographyStyle}
              onClick={() => {
                setActiveAddressIndex(idx);
              }}
            >
              {`地址${addressList.length > 1 ? idx + 1 : ""}：${line}`}
            </button>
            {mapEmbedUrl ? (
              <button
                type="button"
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm hover:opacity-90 ${
                  isActive ? "bg-[#EA4335]" : "bg-[#EA4335]/80"
                }`}
                onClick={() => {
                  trackContactClick("map");
                  setActiveAddressIndex(idx);
                  setShowMap((prev) => (isActive ? !prev : true));
                }}
                aria-label="显示地图位置"
                title="显示地图位置"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                  <path d="M12 2a7 7 0 0 0-7 7c0 4.74 6.14 11.84 6.4 12.14a.8.8 0 0 0 1.2 0C12.86 20.84 19 13.74 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
                </svg>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const renderContactEntryContent = (item: (typeof withPos)[number]) => {
    if (item.key === "address") {
      return renderAddressRows();
    }
    const opensInNewTab = !!item.href && isHttpLikeHref(item.href);
    const opensInTopFrame = !!item.href && !opensInNewTab;
    return (
      <>
        <span className="min-w-0 flex-1 break-all whitespace-pre-wrap" style={contactTypographyStyle}>
          {item.label}：{item.value}
        </span>
        {item.href ? (
          <a
            href={item.href}
            target={opensInNewTab ? "_blank" : opensInTopFrame ? "_top" : undefined}
            rel={opensInNewTab ? "noreferrer noopener" : undefined}
            className={item.buttonClass}
            onClick={(event) => {
              trackContactClick(item.key);
              if (item.key === "wechat") {
                void navigator.clipboard?.writeText(item.value).then(
                  () => {
                    showTemporaryContactNotice(`已复制微信号 ${item.value}，如未直达联系人，请在微信中粘贴搜索。`);
                  },
                  () => {
                    showTemporaryContactNotice(`请在微信中搜索：${item.value}`);
                  },
                );
              }
              if (item.href && opensInTopFrame && isEmbeddedFaollaShell() && tryOpenHrefFromTopFrame(item.href)) {
                event.preventDefault();
              }
            }}
            aria-label={item.key === "wechat" ? `打开微信并复制${item.label}` : `打开${item.label}`}
            title={item.key === "wechat" ? `打开微信并复制${item.label}` : `打开${item.label}`}
          >
            {item.key === "phone" ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z" />
              </svg>
            ) : (
              <Image src={item.iconUrl} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
            )}
          </a>
        ) : null}
      </>
    );
  };

  return (
    <section className={resolveMobileFitSectionClass("max-w-6xl mx-auto px-6 py-6", mobileFitScreenWidth)} style={offsetStyle}>
      <div
        className={resolveMobileFitCardClass(`bg-white rounded-xl shadow-sm p-6 overflow-hidden ${borderClass}`, mobileFitScreenWidth)}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <h2
          className="text-xl font-bold whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{
            __html: toRichHtml(props.heading, resolveLocalizedSystemDefaultText(props.heading, "联系方式", locale)),
          }}
        />
        <div
          className="mt-3 relative bg-transparent"
          style={{ minHeight: `${contentHeight}px`, width: `${contentWidth}px`, maxWidth: "100%" }}
        >
          {withPos.map((item) => {
            return (
              <div
                key={item.key}
                className={`absolute flex gap-2 px-1 py-1 overflow-hidden ${
                  item.key === "address" ? "items-start" : "items-center justify-between"
                }`}
                style={{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` }}
              >
                {renderContactEntryContent(item)}
              </div>
            );
          })}
        </div>
        {showMap && mapEmbedUrl ? (
          <div className="mt-3 w-full overflow-hidden rounded-lg border border-gray-200">
            <iframe
              title="地图位置"
              src={mapEmbedUrl}
              className="w-full h-[28rem] md:h-[40rem]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : null}
        {contactNotice ? <div className="mt-2 text-xs text-slate-600">{contactNotice}</div> : null}
      </div>
    </section>
  );
}
