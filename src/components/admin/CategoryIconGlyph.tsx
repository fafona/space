"use client";

import type { ReactNode } from "react";

export const CATEGORY_ICON_OPTIONS = [
  { value: "", label: "无" },
  { value: "tag", label: "标签" },
  { value: "tags", label: "分类" },
  { value: "package", label: "商品" },
  { value: "gift", label: "礼品" },
  { value: "hot", label: "热卖" },
  { value: "new", label: "新品" },
  { value: "recommend", label: "推荐" },
  { value: "equipment", label: "装备" },
  { value: "bundle", label: "套餐" },
  { value: "required", label: "必选" },
  { value: "souvenir", label: "纪念品" },
  { value: "figure", label: "手办" },
  { value: "toy", label: "玩具" },
  { value: "stationery", label: "文具" },
  { value: "sparkles", label: "精选" },
  { value: "ticket", label: "门票" },
  { value: "door-open", label: "入场" },
  { value: "coffee", label: "咖啡" },
  { value: "cup-soda", label: "饮料" },
  { value: "utensils", label: "餐饮" },
  { value: "sandwich", label: "轻食" },
  { value: "pizza", label: "披萨" },
  { value: "ice-cream", label: "甜品" },
  { value: "candy", label: "零食" },
  { value: "apple", label: "水果" },
  { value: "beef", label: "肉类" },
  { value: "beer", label: "啤酒" },
  { value: "wine", label: "酒水" },
  { value: "gamepad", label: "游戏" },
  { value: "dumbbell", label: "运动" },
  { value: "baby", label: "儿童" },
  { value: "heart-pulse", label: "健康" },
  { value: "scissors", label: "服务" },
  { value: "wrench", label: "维修" },
  { value: "key", label: "钥匙" },
  { value: "home", label: "家居" },
  { value: "sofa", label: "包间" },
  { value: "car", label: "汽车" },
  { value: "bike", label: "骑行" },
  { value: "bus", label: "巴士" },
  { value: "plane", label: "旅行" },
  { value: "music", label: "音乐" },
  { value: "camera", label: "摄影" },
  { value: "book", label: "书籍" },
  { value: "phone", label: "数码" },
  { value: "headphones", label: "耳机" },
  { value: "watch", label: "手环" },
  { value: "shirt", label: "服饰" },
] as const;

const LEGACY_ICON_ALIASES: Record<string, string> = {
  none: "",
  category: "tags",
  box: "package",
  like: "recommend",
  cluster: "equipment",
  check: "required",
  badge: "souvenir",
  pen: "stationery",
  spark: "sparkles",
  door: "door-open",
  drink: "cup-soda",
  food: "utensils",
  light: "sandwich",
  dessert: "ice-cream",
};

export function normalizeCategoryIconName(value: unknown) {
  const key = String(value ?? "").trim();
  return LEGACY_ICON_ALIASES[key] ?? key;
}

export function getCategoryIconLabel(value: unknown) {
  const key = normalizeCategoryIconName(value);
  return CATEGORY_ICON_OPTIONS.find((item) => item.value === key)?.label ?? CATEGORY_ICON_OPTIONS[0].label;
}

function fallbackIcon() {
  return (
    <>
      <rect x="5" y="5" width="6" height="6" rx="1.2" />
      <rect x="13" y="5" width="6" height="6" rx="1.2" />
      <rect x="5" y="13" width="6" height="6" rx="1.2" />
      <rect x="13" y="13" width="6" height="6" rx="1.2" />
    </>
  );
}

function iconPath(name: string): ReactNode {
  switch (name) {
    case "tag":
      return <path d="M4 12V5h7l9 9-6 6-10-8Z" />;
    case "tags":
      return fallbackIcon();
    case "package":
    case "equipment":
      return (
        <>
          <path d="m4 8 8-4 8 4-8 4-8-4Z" />
          <path d="M4 8v9l8 4 8-4V8M12 12v9" />
        </>
      );
    case "gift":
      return (
        <>
          <path d="M4 10h16v10H4V10ZM12 10v10M4 14h16" />
          <path d="M8 10c-2 0-3-1-3-2s1-2 2.4-2C9 6 10 8 12 10c2-2 3-4 4.6-4C18 6 19 7 19 8s-1 2-3 2" />
        </>
      );
    case "hot":
      return <path d="M13 3c1 4-4 5-1 9 1-2 4-2 5 1 1.5 4-1.4 8-5 8s-6-2.5-6-6c0-3 2-5 4-7 1.2-1.2 2-2.5 3-5Z" />;
    case "new":
    case "sparkles":
      return (
        <>
          <path d="m12 3 2.5 5.7 6.1.6-4.6 4.2 1.3 6.1L12 16.5 6.7 19.6 8 13.5 3.4 9.3l6.1-.6L12 3Z" />
          <path d="M19 3v4M17 5h4" />
        </>
      );
    case "recommend":
      return <path d="M7 11v9H4v-9h3Zm0 0 4-7c1.2.4 1.8 1.5 1.4 3l-.5 2H19c1 0 1.8.9 1.6 2l-1.2 6.8c-.2 1.2-1.2 2.2-2.5 2.2H7" />;
    case "bundle":
      return (
        <>
          <path d="m5 9 7-4 7 4-7 4-7-4Z" />
          <path d="M5 9v7l7 4 7-4V9" />
          <path d="m8 5 7 4" />
        </>
      );
    case "required":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 12 2.5 2.5L16 9" />
        </>
      );
    case "souvenir":
      return (
        <>
          <path d="M6 9h12l-1 12H7L6 9Z" />
          <path d="M9 9a3 3 0 0 1 6 0" />
        </>
      );
    case "figure":
      return (
        <>
          <circle cx="12" cy="6" r="2.5" />
          <path d="M8 21v-5l-2-2 3-6h6l3 6-2 2v5M10 13h4" />
        </>
      );
    case "toy":
      return (
        <>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <path d="M16 13v7M13 16h7" />
        </>
      );
    case "stationery":
      return (
        <>
          <path d="M5 19 18.5 5.5l2 2L7 21H5v-2Z" />
          <path d="m15 8 2 2" />
        </>
      );
    case "ticket":
      return <path d="M4 8h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V8Zm8 1v10" />;
    case "door-open":
      return (
        <>
          <path d="M5 21h14M7 21V5l8-2v18M15 5h4v16" />
          <path d="M12 12h.01" />
        </>
      );
    case "coffee":
      return <path d="M7 8h9v8a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4V8Zm9 2h2a2 2 0 0 1 0 4h-2M6 4h12" />;
    case "cup-soda":
      return <path d="M7 7h10l-1 14H8L7 7ZM6 3h12M10 3l1 4M10 12h6" />;
    case "utensils":
      return <path d="M7 3v18M4 3v6a3 3 0 0 0 6 0V3M17 3v18M17 3c2 2 3 4 3 7 0 2-1 3-3 3" />;
    case "sandwich":
      return (
        <>
          <path d="M4 12 12 5l8 7v6H4v-6Z" />
          <path d="M4 15h16" />
        </>
      );
    case "pizza":
      return (
        <>
          <path d="M5 20 19 6c-5-2-10-1-14 4v10Z" />
          <path d="M9 13h.01M13 10h.01M10 17h.01" />
        </>
      );
    case "ice-cream":
      return (
        <>
          <path d="M8 11a4 4 0 0 1 8 0v2H8v-2Z" />
          <path d="m9 13 3 8 3-8" />
        </>
      );
    case "candy":
      return (
        <>
          <rect x="8" y="8" width="8" height="8" rx="2" />
          <path d="m8 10-4-2 2 4-2 4 4-2M16 10l4-2-2 4 2 4-4-2" />
        </>
      );
    case "apple":
      return (
        <>
          <path d="M12 7c-3-3-8 0-7 6 1 6 5 8 7 5 2 3 6 1 7-5 1-6-4-9-7-5Z" />
          <path d="M12 7c0-2 1-3 3-4" />
        </>
      );
    case "beef":
      return (
        <>
          <path d="M6 13c-3-4 1-8 6-7 6 1 9 5 7 10-2 4-9 6-13-3Z" />
          <circle cx="10" cy="11" r="2" />
        </>
      );
    case "beer":
      return <path d="M6 8h10v13H6V8Zm10 3h2a2 2 0 0 1 0 4h-2M8 8V5h6v3M8 12h6" />;
    case "wine":
      return (
        <>
          <path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM12 12v9M9 21h6" />
          <path d="M8 7h8" />
        </>
      );
    case "gamepad":
      return <path d="M7 10h10a5 5 0 0 1 4 8l-1 1-4-3H8l-4 3-1-1a5 5 0 0 1 4-8Zm1 4h4M10 12v4M16 14h.01M18 12h.01" />;
    case "dumbbell":
      return <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />;
    case "baby":
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M8 15c2 2 6 2 8 0M9 8h.01M15 8h.01M10 18h4" />
        </>
      );
    case "heart-pulse":
      return <path d="M20 8c0 6-8 11-8 11S4 14 4 8a4 4 0 0 1 7-2 4 4 0 0 1 7 0 4 4 0 0 1 2 2ZM6 12h3l1.5-3L13 15l1.5-3H18" />;
    case "scissors":
      return (
        <>
          <circle cx="6" cy="7" r="3" />
          <circle cx="6" cy="17" r="3" />
          <path d="M8.5 8.5 20 20M8.5 15.5 20 4" />
        </>
      );
    case "wrench":
      return <path d="M14 6a5 5 0 0 0 6 6L10 22l-4-4 10-10a5 5 0 0 0-6-6" />;
    case "key":
      return (
        <>
          <circle cx="8" cy="14" r="4" />
          <path d="m11 11 8-8M16 4l3 3M14 6l2 2" />
        </>
      );
    case "home":
      return <path d="m4 11 8-7 8 7v9H6v-7h6v7" />;
    case "sofa":
      return <path d="M5 12V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M4 13h16v6H4v-6ZM7 19v2M17 19v2" />;
    case "car":
      return <path d="M5 13 7 7h10l2 6v5H5v-5ZM7 18v2M17 18v2M7 13h10M8 16h.01M16 16h.01" />;
    case "bike":
      return (
        <>
          <circle cx="6" cy="17" r="3" />
          <circle cx="18" cy="17" r="3" />
          <path d="M8 17h4l3-7H9l3 7 3-7M14 7h3" />
        </>
      );
    case "bus":
      return <path d="M6 4h12a2 2 0 0 1 2 2v11H4V6a2 2 0 0 1 2-2ZM4 10h16M7 17v2M17 17v2M8 14h.01M16 14h.01" />;
    case "plane":
      return <path d="M3 11 21 3l-5 18-4-8-9-2ZM12 13l4-4" />;
    case "music":
      return (
        <>
          <path d="M9 18V5l10-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="16" cy="16" r="3" />
        </>
      );
    case "camera":
      return (
        <>
          <path d="M4 8h4l2-3h4l2 3h4v13H4V8Z" />
          <circle cx="12" cy="14" r="4" />
        </>
      );
    case "book":
      return <path d="M5 4h8a3 3 0 0 1 3 3v17a3 3 0 0 0-3-3H5V4Zm11 3h3v14h-3" />;
    case "phone":
      return <path d="M8 3h8v18H8V3Zm3 15h2" />;
    case "headphones":
      return <path d="M5 17v-5a7 7 0 0 1 14 0v5M5 17a3 3 0 0 0 3 3v-6a3 3 0 0 0-3 3ZM19 17a3 3 0 0 1-3 3v-6a3 3 0 0 1 3 3Z" />;
    case "watch":
      return (
        <>
          <path d="M9 3h6l1 5a6 6 0 0 1 0 8l-1 5H9l-1-5a6 6 0 0 1 0-8l1-5Z" />
          <circle cx="12" cy="12" r="4" />
        </>
      );
    case "shirt":
      return <path d="M7 4h3a2 2 0 0 0 4 0h3l4 4-3 4-2-1v10H8V11l-2 1-3-4 4-4Z" />;
    default:
      return fallbackIcon();
  }
}

export function CategoryIconGlyph({
  name,
  className = "h-5 w-5",
  emptyClassName = "grid h-5 w-5 place-items-center text-xs font-semibold leading-none",
  emptyLabel = "无",
}: {
  name: unknown;
  className?: string;
  emptyClassName?: string;
  emptyLabel?: string;
}) {
  const key = normalizeCategoryIconName(name);
  if (!key) return <span className={emptyClassName}>{emptyLabel}</span>;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{getCategoryIconLabel(key)}</title>
      {iconPath(key)}
    </svg>
  );
}
