import type { Block, BlockBorderStyle } from "./homeBlocks";
import { BLOCKS_SCHEMA_VERSION } from "@/lib/blocksSchema";

const DESKTOP_WIDTH = 1120;
const MOBILE_WIDTH = 340;

const PAGE_IDS = {
  discover: "page-1",
  merchantTools: "page-merchant-tools",
  businessCard: "page-business-card",
} as const;

const PAGE_BACKGROUND =
  "linear-gradient(180deg, #f8fafc 0%, #eef6f5 36%, #fff7ed 68%, #ffffff 100%)";

const LABELS = {
  discover: "\u53d1\u73b0\u5546\u6237",
  merchantTools: "\u5546\u6237\u5de5\u5177",
  businessCard: "\u6570\u5b57\u540d\u7247",
  portalName: "Faolla \u603b\u7ad9",
  mobilePortalName: "Faolla \u624b\u673a\u7aef",
  portalTagline: "\u672c\u5730\u5546\u6237\u5165\u53e3\u4e0e\u7ecf\u8425\u5de5\u5177",
  searchMerchants: "\u67e5\u627e\u5546\u6237",
  searchNearby: "\u641c\u7d22\u9644\u8fd1\u5546\u6237",
  chooseCity: "\u9009\u62e9\u57ce\u5e02",
  keywordPlaceholder: "\u5546\u6237\u540d\u79f0 / \u884c\u4e1a / \u5730\u533a",
  locate: "\u5b9a\u4f4d",
  search: "\u641c\u7d22",
  noMerchants: "\u6682\u65e0\u5546\u6237",
  recommended: "\u63a8\u8350",
  catering: "\u9910\u996e",
  retail: "\u96f6\u552e",
  service: "\u670d\u52a1",
  entertainment: "\u5a31\u4e50",
  organization: "\u7ec4\u7ec7",
  merchantLogin: "\u5546\u6237\u767b\u5f55",
  personalCenter: "\u4e2a\u4eba\u4e2d\u5fc3",
} as const;

const NAV_ITEMS = [
  { id: "nav-discover", label: LABELS.discover, pageId: PAGE_IDS.discover },
  { id: "nav-tools", label: LABELS.merchantTools, pageId: PAGE_IDS.merchantTools },
  { id: "nav-card", label: LABELS.businessCard, pageId: PAGE_IDS.businessCard },
];

type CommonTextBox = NonNullable<Extract<Block, { type: "common" }>["props"]["commonTextBoxes"]>[number];

function span(text: string, style: string) {
  return `<span style="${style}">${text}</span>`;
}

function box(id: string, html: string, x: number, y: number, width: number, height: number): CommonTextBox {
  return { id, html, x, y, width, height };
}

function ctaLink(href: string, label: string, variant: "dark" | "light") {
  if (variant === "dark") {
    return `<a href="${href}" style="display:inline-flex;height:44px;align-items:center;justify-content:center;border-radius:8px;background:#0f172a;color:#ffffff;padding:0 18px;font-size:15px;font-weight:900;text-decoration:none;">${label}</a>`;
  }
  return `<a href="${href}" style="display:inline-flex;height:44px;align-items:center;justify-content:center;border-radius:8px;border:1px solid #cbd5e1;background:#ffffff;color:#0f172a;padding:0 18px;margin-left:10px;font-size:15px;font-weight:900;text-decoration:none;">${label}</a>`;
}

function commonBlock(
  id: string,
  options: {
    width: number;
    height: number;
    boxes: CommonTextBox[];
    bgColor?: string;
    bgImageUrl?: string;
    bgImageOpacity?: number;
    mobileFitScreenWidth?: boolean;
    blockBorderStyle?: BlockBorderStyle;
  },
): Block {
  return {
    id,
    type: "common",
    props: {
      schemaVersion: BLOCKS_SCHEMA_VERSION,
      blockWidth: options.width,
      blockHeight: options.height,
      mobileFitScreenWidth: options.mobileFitScreenWidth,
      bgColor: options.bgColor ?? "#ffffff",
      bgColorOpacity: options.bgColor ? 1 : 0,
      bgImageUrl: options.bgImageUrl,
      bgImageOpacity: options.bgImageOpacity ?? 1,
      bgFillMode: "cover",
      bgPosition: "center",
      blockBorderStyle: options.blockBorderStyle ?? "soft",
      blockBorderColor: "#dbe4ee",
      commonTextBoxes: options.boxes,
    },
  };
}

function navBlock(id: string, width: number, options: { mobile?: boolean } = {}): Block {
  const brandSize = options.mobile ? 22 : 26;
  const taglineSize = options.mobile ? 11 : 13;
  return {
    id,
    type: "nav",
    props: {
      schemaVersion: BLOCKS_SCHEMA_VERSION,
      heading: `<span style="display:inline-flex;align-items:center;gap:10px;color:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:${brandSize}px;font-weight:800;line-height:1;"><img src="/faolla-app-icon-192.png" alt="Faolla" style="width:${options.mobile ? 28 : 34}px;height:${options.mobile ? 28 : 34}px;border-radius:8px;vertical-align:middle;" />Faolla</span><br /><span style="color:#64748b;font-family:Arial,Helvetica,sans-serif;font-size:${taglineSize}px;font-weight:500;">${LABELS.portalTagline}</span>`,
      navItems: NAV_ITEMS,
      navOrientation: "horizontal",
      mobileNavDisplayMode: options.mobile ? "hidden" : "inline",
      mobileFitScreenWidth: options.mobile,
      blockWidth: width,
      pageBgColor: PAGE_BACKGROUND,
      pageBgColorOpacity: 1,
      bgColor: "#ffffff",
      bgColorOpacity: 0.92,
      blockBorderStyle: "soft",
      blockBorderColor: "#dbe4ee",
      navItemBgColor: "#ffffff",
      navItemBgOpacity: 0,
      navItemBorderStyle: "none",
      navItemBorderColor: "#dbe4ee",
      navItemActiveBgColor: "#0f172a",
      navItemActiveBgOpacity: 1,
      navItemActiveBorderStyle: "solid",
      navItemActiveBorderColor: "#0f172a",
      navItemActiveTextColor: "#ffffff",
      mobileNavButtonBgColor: "#ffffff",
      mobileNavButtonBgOpacity: 1,
      mobileNavButtonBorderStyle: "solid",
      mobileNavButtonLineColor: "#0f172a",
    },
  };
}

function searchBlock(id: string, width: number, options: { mobile?: boolean } = {}): Block {
  const mobile = options.mobile === true;
  return {
    id,
    type: "search-bar",
    props: {
      schemaVersion: BLOCKS_SCHEMA_VERSION,
      blockWidth: width,
      mobileFitScreenWidth: mobile,
      heading: mobile ? LABELS.searchNearby : LABELS.searchMerchants,
      text: mobile ? "Filter by location, category or name." : "Find active merchant sites by country, city and keyword.",
      cityPlaceholder: LABELS.chooseCity,
      searchPlaceholder: LABELS.keywordPlaceholder,
      locateLabel: LABELS.locate,
      actionLabel: LABELS.search,
      bgColor: "#ffffff",
      bgColorOpacity: 0.96,
      blockBorderStyle: "soft",
      blockBorderColor: "#dbe4ee",
      fontFamily: "Arial, Helvetica, sans-serif",
      searchButtonBgColor: "#f8fafc",
      searchButtonBgOpacity: 1,
      searchButtonBorderStyle: "solid",
      searchButtonBorderColor: "#dbe4ee",
      searchButtonActiveBgColor: "#0f172a",
      searchButtonActiveBgOpacity: 1,
      searchButtonActiveBorderStyle: "solid",
      searchButtonActiveBorderColor: "#0f172a",
      searchLayout: mobile
        ? {
            locate: { x: 0, y: 0, width: 72, height: 38 },
            country: { x: 80, y: 0, width: 240, height: 38 },
            province: { x: 0, y: 48, width: 154, height: 38 },
            city: { x: 166, y: 48, width: 154, height: 38 },
            keyword: { x: 0, y: 96, width: 232, height: 38 },
            action: { x: 244, y: 96, width: 76, height: 38 },
          }
        : {
            locate: { x: 0, y: 0, width: 82, height: 42 },
            country: { x: 94, y: 0, width: 220, height: 42 },
            province: { x: 326, y: 0, width: 220, height: 42 },
            city: { x: 558, y: 0, width: 220, height: 42 },
            keyword: { x: 0, y: 54, width: 860, height: 42 },
            action: { x: 872, y: 54, width: 88, height: 42 },
          },
    },
  };
}

function merchantListBlock(id: string, width: number, options: { mobile?: boolean } = {}): Block {
  const mobile = options.mobile === true;
  return {
    id,
    type: "merchant-list",
    props: {
      schemaVersion: BLOCKS_SCHEMA_VERSION,
      blockWidth: width,
      blockHeight: mobile ? 760 : 780,
      mobileFitScreenWidth: mobile,
      heading: LABELS.discover,
      text: mobile ? "Merchants are sorted by location, category and recommendation." : "Browse published merchant sites, offers, bookings and contact cards.",
      maxItems: mobile ? 4 : 6,
      emptyText: LABELS.noMerchants,
      bgColor: "#ffffff",
      bgColorOpacity: 0.96,
      blockBorderStyle: "soft",
      blockBorderColor: "#dbe4ee",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontWeight: "bold",
      industryTabs: [
        { id: "tab-recommended", label: LABELS.recommended, industry: "all" },
        { id: "tab-catering", label: LABELS.catering, industry: LABELS.catering },
        { id: "tab-retail", label: LABELS.retail, industry: LABELS.retail },
        { id: "tab-service", label: LABELS.service, industry: LABELS.service },
        { id: "tab-entertainment", label: LABELS.entertainment, industry: LABELS.entertainment },
        { id: "tab-organization", label: LABELS.organization, industry: LABELS.organization },
      ],
      merchantCardLayout: mobile
        ? {
            tabs: { x: 0, y: 0, width: 320, height: 84 },
            card1: { x: 0, y: 108, width: 320, height: 116 },
            card2: { x: 0, y: 236, width: 320, height: 116 },
            card3: { x: 0, y: 364, width: 320, height: 116 },
            card4: { x: 0, y: 492, width: 320, height: 116 },
            prev: { x: 110, y: 632, width: 96, height: 36 },
            next: { x: 214, y: 632, width: 96, height: 36 },
          }
        : {
            tabs: { x: 0, y: 0, width: 620, height: 42 },
            card1: { x: 0, y: 84, width: 340, height: 150 },
            card2: { x: 354, y: 84, width: 340, height: 150 },
            card3: { x: 708, y: 84, width: 340, height: 150 },
            card4: { x: 0, y: 252, width: 340, height: 150 },
            card5: { x: 354, y: 252, width: 340, height: 150 },
            card6: { x: 708, y: 252, width: 340, height: 150 },
            prev: { x: 840, y: 446, width: 96, height: 36 },
            next: { x: 948, y: 446, width: 96, height: 36 },
          },
      merchantCardBgColor: "#ffffff",
      merchantCardBgOpacity: 1,
      merchantCardBorderStyle: "solid",
      merchantCardBorderColor: "#dbe4ee",
      merchantCardTextBoxVisible: true,
      merchantCardTextLayout: {
        name: { x: 14, y: 14 },
        industry: { x: 14, y: 52 },
        domain: { x: 14, y: 86 },
      },
      merchantCardTypography: {
        name: { fontSize: mobile ? 15 : 16, fontColor: "#0f172a", fontWeight: "bold" },
        industry: { fontSize: 12, fontColor: "#0f766e" },
        domain: { fontSize: 12, fontColor: "#475569" },
      },
      merchantCardIndustryStyles: {
        all: { bgColor: "#ffffff", bgOpacity: 1, borderStyle: "solid", borderColor: "#dbe4ee" },
        [LABELS.catering]: { bgColor: "#ecfdf5", bgOpacity: 1, borderStyle: "solid", borderColor: "#86efac" },
        [LABELS.retail]: { bgColor: "#eff6ff", bgOpacity: 1, borderStyle: "solid", borderColor: "#93c5fd" },
        [LABELS.service]: { bgColor: "#f8fafc", bgOpacity: 1, borderStyle: "solid", borderColor: "#cbd5e1" },
        [LABELS.entertainment]: { bgColor: "#fff7ed", bgOpacity: 1, borderStyle: "solid", borderColor: "#fdba74" },
        [LABELS.organization]: { bgColor: "#f0fdfa", bgOpacity: 1, borderStyle: "solid", borderColor: "#5eead4" },
      },
      merchantTabButtonBgColor: "#ffffff",
      merchantTabButtonBgOpacity: 0,
      merchantTabButtonBorderStyle: "solid",
      merchantTabButtonBorderColor: "#dbe4ee",
      merchantTabButtonActiveBgColor: "#0f172a",
      merchantTabButtonActiveBgOpacity: 1,
      merchantTabButtonActiveBorderStyle: "solid",
      merchantTabButtonActiveBorderColor: "#0f172a",
      merchantPagerButtonBgColor: "#ffffff",
      merchantPagerButtonBgOpacity: 1,
      merchantPagerButtonBorderStyle: "solid",
      merchantPagerButtonBorderColor: "#dbe4ee",
      merchantPagerButtonDisabledBgColor: "#f1f5f9",
      merchantPagerButtonDisabledBgOpacity: 1,
      merchantPagerButtonDisabledBorderStyle: "solid",
      merchantPagerButtonDisabledBorderColor: "#e2e8f0",
    },
  };
}

function heroBlock(id: string, mobile = false): Block {
  const title = mobile ? "Find merchants<br />run daily tools" : "Local merchant sites<br />and daily tools";
  const copy = mobile
    ? "One entry for sites, cards, bookings, orders, members and coupons."
    : "Customers search merchants, save contact cards, claim offers and book services. Merchants manage content, orders, members and coupons from one workspace.";
  const mockCard = `<div style="height:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,0.42);border-radius:18px;background:rgba(255,255,255,0.94);box-shadow:0 22px 60px rgba(15,23,42,0.26);padding:${mobile ? "18px" : "24px"};font-family:Arial,Helvetica,sans-serif;color:#0f172a;"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;"><div style="font-size:12px;font-weight:900;color:#64748b;">Contact card</div><img src="/faolla-app-icon-192.png" alt="Faolla" style="width:${mobile ? 36 : 46}px;height:${mobile ? 36 : 46}px;border-radius:12px;box-shadow:0 10px 24px rgba(15,23,42,0.14);" /></div><div style="margin-top:${mobile ? "8px" : "14px"};font-size:${mobile ? 22 : 28}px;font-weight:900;line-height:1;">faolla</div><div style="margin-top:${mobile ? "12px" : "20px"};display:grid;gap:${mobile ? "7px" : "12px"};font-size:${mobile ? 11 : 13}px;font-weight:700;color:#334155;"><div><span style="color:#0f172a;">Phone:</span> +34 633130577</div><div><span style="color:#0f172a;">WhatsApp:</span> +34 633130577</div><div><span style="color:#0f172a;">Google:</span> Review link</div><div><span style="color:#0f172a;">Address:</span> Sevilla / Spain</div></div></div>`;
  return commonBlock(id, {
    width: mobile ? MOBILE_WIDTH : DESKTOP_WIDTH,
    height: mobile ? 530 : 520,
    mobileFitScreenWidth: mobile,
    bgColor: "linear-gradient(135deg, #0f172a 0%, #134e4a 55%, #f97316 100%)",
    blockBorderStyle: "soft",
    boxes: [
      box("hero-chip", span("FAOLLA PORTAL", "font-size:12px;font-weight:800;letter-spacing:0;color:#5eead4;"), mobile ? 22 : 52, mobile ? 24 : 56, 220, 28),
      box("hero-title", span(title, `font-size:${mobile ? 29 : 48}px;line-height:1.1;font-weight:900;letter-spacing:0;color:#ffffff;`), mobile ? 22 : 52, mobile ? 58 : 96, mobile ? 292 : 520, mobile ? 74 : 116),
      box("hero-copy", span(copy, `font-size:${mobile ? 14 : 16}px;line-height:1.65;font-weight:600;color:#dbeafe;`), mobile ? 22 : 52, mobile ? 146 : 232, mobile ? 292 : 500, mobile ? 72 : 86),
      box("hero-actions", `${ctaLink("/login", mobile ? LABELS.merchantLogin : "Merchant login", mobile ? "dark" : "light")}${ctaLink("/me", mobile ? LABELS.personalCenter : "Personal center", "light")}`, mobile ? 22 : 52, mobile ? 234 : 346, mobile ? 292 : 500, 54),
      box("hero-card", mockCard, mobile ? 22 : 640, mobile ? 314 : 82, mobile ? 292 : 360, mobile ? 170 : 300),
    ],
  });
}

function featureBlock(id: string, mobile = false): Block {
  const width = mobile ? MOBILE_WIDTH : DESKTOP_WIDTH;
  const cardWidth = mobile ? 292 : 244;
  const cardHeight = mobile ? 112 : 138;
  const startX = mobile ? 24 : 44;
  const startY = mobile ? 170 : 126;
  const gap = mobile ? 0 : 24;
  const features = [
    ["Merchant site", "Product, booking, coupon and contact sections arranged as editable blocks.", "#0f766e"],
    ["Contact card", "Phone, WhatsApp, map, Google review and QR sharing in one card.", "#2563eb"],
    ["Member operation", "Points, top-up, coupon redemption and order history in the admin workspace.", "#ea580c"],
    ["Multi-device", "Web, PWA, mobile shell and merchant subdomains share the same public entry.", "#7c3aed"],
  ];
  const boxes = [
    box("feature-title", span(mobile ? "Merchant tools" : "A practical system for local merchants", `font-size:${mobile ? 23 : 30}px;line-height:1.18;font-weight:900;color:#0f172a;`), mobile ? 24 : 44, 34, mobile ? 292 : 520, mobile ? 38 : 42),
    box("feature-copy", span("Faolla keeps discovery, contact and daily operations in one lightweight flow.", `font-size:${mobile ? 13 : 15}px;line-height:1.6;font-weight:500;color:#64748b;`), mobile ? 24 : 44, mobile ? 86 : 80, mobile ? 292 : 520, mobile ? 58 : 38),
    ...features.map(([title, copy, color], index) => {
      const x = mobile ? startX : startX + index * (cardWidth + gap);
      const y = mobile ? startY + index * (cardHeight + 14) : startY;
      return box(
        `feature-${index + 1}`,
        `<div style="height:100%;box-sizing:border-box;border:1px solid #dbe4ee;border-radius:8px;background:#ffffff;padding:18px 18px 16px 18px;"><div style="height:6px;width:36px;border-radius:3px;background:${color};margin-bottom:16px;"></div><div style="font-size:17px;font-weight:900;color:#0f172a;line-height:1.25;">${title}</div><div style="margin-top:8px;font-size:13px;line-height:1.55;color:#64748b;font-weight:500;">${copy}</div></div>`,
        x,
        y,
        cardWidth,
        cardHeight,
      );
    }),
  ];
  return commonBlock(id, {
    width,
    height: mobile ? 750 : 330,
    mobileFitScreenWidth: mobile,
    bgColor: "#f8fafc",
    blockBorderStyle: "soft",
    boxes,
  });
}

function toolsPageBlocks(mobile = false): Block[] {
  const width = mobile ? MOBILE_WIDTH : DESKTOP_WIDTH;
  return [
    navBlock(mobile ? "m-nav-tools" : "d-nav-tools", width, { mobile }),
    commonBlock(mobile ? "m-tools-hero" : "d-tools-hero", {
      width,
      height: mobile ? 520 : 430,
      mobileFitScreenWidth: mobile,
      bgColor: "#ffffff",
      boxes: [
        box("tools-title", span("From site building<br />to daily operation", `font-size:${mobile ? 30 : 44}px;line-height:1.12;font-weight:900;color:#0f172a;`), mobile ? 24 : 52, mobile ? 42 : 52, mobile ? 292 : 520, mobile ? 86 : 110),
        box("tools-copy", span("Start with a public merchant page, then enable bookings, orders, members, coupons and contact cards as the business grows.", `font-size:${mobile ? 14 : 16}px;line-height:1.7;font-weight:500;color:#475569;`), mobile ? 24 : 52, mobile ? 146 : 182, mobile ? 292 : 520, mobile ? 112 : 86),
        box("tools-grid", `<div style="display:grid;grid-template-columns:${mobile ? "1fr" : "1fr 1fr"};gap:12px;font-size:14px;color:#0f172a;font-weight:800;"><div style="border:1px solid #dbe4ee;border-radius:8px;padding:14px;background:#ecfdf5;">Bookings & orders</div><div style="border:1px solid #dbe4ee;border-radius:8px;padding:14px;background:#eff6ff;">Members & points</div><div style="border:1px solid #dbe4ee;border-radius:8px;padding:14px;background:#fff7ed;">Coupons & redemption</div><div style="border:1px solid #dbe4ee;border-radius:8px;padding:14px;background:#f8fafc;">Logs & contact cards</div></div>`, mobile ? 24 : 610, mobile ? 286 : 64, mobile ? 292 : 420, mobile ? 190 : 180),
        box("tools-action", ctaLink("/login", "Open merchant workspace", "dark"), mobile ? 24 : 52, mobile ? 438 : 304, 260, 50),
      ],
    }),
    featureBlock(mobile ? "m-tools-features" : "d-tools-features", mobile),
  ];
}

function businessCardPageBlocks(mobile = false): Block[] {
  const width = mobile ? MOBILE_WIDTH : DESKTOP_WIDTH;
  return [
    navBlock(mobile ? "m-nav-card" : "d-nav-card", width, { mobile }),
    commonBlock(mobile ? "m-card-hero" : "d-card-hero", {
      width,
      height: mobile ? 560 : 440,
      mobileFitScreenWidth: mobile,
      bgColor: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 52%, #14b8a6 100%)",
      boxes: [
        box("card-title", span("Contact cards<br />made for sharing", `font-size:${mobile ? 30 : 44}px;line-height:1.12;font-weight:900;color:#ffffff;`), mobile ? 24 : 52, mobile ? 40 : 54, mobile ? 292 : 480, mobile ? 90 : 110),
        box("card-copy", span("A card can hold phone, email, WhatsApp, address, Google review, QR code and intro video for in-person or chat sharing.", `font-size:${mobile ? 14 : 16}px;line-height:1.7;font-weight:600;color:#dbeafe;`), mobile ? 24 : 52, mobile ? 148 : 190, mobile ? 292 : 510, mobile ? 116 : 90),
        box("card-points", `<div style="display:flex;flex-wrap:wrap;gap:10px;"><span style="border-radius:8px;background:#ffffff;color:#0f172a;padding:9px 12px;font-size:13px;font-weight:900;">Contact card</span><span style="border-radius:8px;background:#ffffff;color:#0f172a;padding:9px 12px;font-size:13px;font-weight:900;">QR code</span><span style="border-radius:8px;background:#ffffff;color:#0f172a;padding:9px 12px;font-size:13px;font-weight:900;">Google review</span><span style="border-radius:8px;background:#ffffff;color:#0f172a;padding:9px 12px;font-size:13px;font-weight:900;">Save contact</span></div>`, mobile ? 24 : 52, mobile ? 294 : 318, mobile ? 292 : 520, mobile ? 96 : 54),
      ],
    }),
  ];
}

function discoverPageBlocks(mobile = false): Block[] {
  const width = mobile ? MOBILE_WIDTH : DESKTOP_WIDTH;
  return [
    navBlock(mobile ? "m-nav-discover" : "d-nav-discover", width, { mobile }),
    heroBlock(mobile ? "m-hero" : "d-hero", mobile),
    searchBlock(mobile ? "m-search" : "d-search", width, { mobile }),
    featureBlock(mobile ? "m-features" : "d-features", mobile),
    merchantListBlock(mobile ? "m-merchants" : "d-merchants", width, { mobile }),
  ];
}

export function createFaollaHomeBlocks(): Block[] {
  const desktopDiscover = discoverPageBlocks(false);
  const desktopTools = toolsPageBlocks(false);
  const desktopCard = businessCardPageBlocks(false);
  const mobileDiscover = discoverPageBlocks(true);
  const mobileTools = toolsPageBlocks(true);
  const mobileCard = businessCardPageBlocks(true);

  const pagePlanConfig = {
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        name: LABELS.portalName,
        activePageId: PAGE_IDS.discover,
        pages: [
          { id: PAGE_IDS.discover, name: LABELS.discover, blocks: desktopDiscover },
          { id: PAGE_IDS.merchantTools, name: LABELS.merchantTools, blocks: desktopTools },
          { id: PAGE_IDS.businessCard, name: LABELS.businessCard, blocks: desktopCard },
        ],
        blocks: desktopDiscover,
      },
    ],
  };

  const pagePlanConfigMobile = {
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        name: LABELS.mobilePortalName,
        activePageId: PAGE_IDS.discover,
        pages: [
          { id: PAGE_IDS.discover, name: LABELS.discover, blocks: mobileDiscover },
          { id: PAGE_IDS.merchantTools, name: LABELS.merchantTools, blocks: mobileTools },
          { id: PAGE_IDS.businessCard, name: LABELS.businessCard, blocks: mobileCard },
        ],
        blocks: mobileDiscover,
      },
    ],
  };

  return [
    {
      id: "__plan_meta__",
      type: "common",
      props: {
        schemaVersion: BLOCKS_SCHEMA_VERSION,
        commonTextBoxes: [],
        pagePlanConfig,
        pagePlanConfigMobile,
      },
    },
    ...desktopDiscover,
  ];
}

export const faollaHomeBlocks = createFaollaHomeBlocks();
