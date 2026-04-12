import type { CustomGalleryLayout, GalleryLayoutPreset } from "@/lib/galleryLayout";
import { BLOCKS_SCHEMA_VERSION } from "../lib/blocksSchema";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import type {
  MerchantContactVisibility,
  MerchantIndustry,
  MerchantServicePermissionConfig,
  MerchantSortConfig,
  MerchantSortRule,
  SiteLocation,
  SiteStatus,
} from "./platformControlStore";
import type {
  ProductContainerMode,
  ProductImageAspectRatio,
  ProductItemInput,
  ProductLayoutPreset,
  ProductPriceAlign,
  ProductTagPosition,
} from "@/lib/productBlock";

export type ImageFillMode = "cover" | "contain" | "fill" | "repeat" | "repeat-x" | "repeat-y";
export type BlockBorderStyle = "none" | "glass" | "soft" | "solid" | "dashed" | "double" | "accent";

export type BackgroundEditableProps = {
  schemaVersion?: number;
  bgImageUrl?: string;
  bgFillMode?: ImageFillMode;
  bgPosition?: string;
  bgColor?: string;
  bgOpacity?: number;
  bgImageOpacity?: number;
  bgColorOpacity?: number;
  blockWidth?: number;
  blockHeight?: number;
  blockOffsetX?: number;
  blockOffsetY?: number;
  blockLayer?: number;
  blockLocked?: boolean;
  blockBorderStyle?: BlockBorderStyle;
  blockBorderColor?: string;
  pageBgImageUrl?: string;
  pageBgFillMode?: ImageFillMode;
  pageBgPosition?: string;
  pageBgColor?: string;
  pageBgOpacity?: number;
  pageBgImageOpacity?: number;
  pageBgColorOpacity?: number;
  pagePlanConfig?: {
    activePlanId?: string;
    plans?: Array<{
      id?: string;
      name?: string;
      blocks?: Block[];
    }>;
  };
  pagePlanConfigMobile?: {
    activePlanId?: string;
    plans?: Array<{
      id?: string;
      name?: string;
      blocks?: Block[];
    }>;
  };
};

export type TypographyEditableProps = {
  fontFamily?: string;
  fontColor?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline";
};

export type MerchantCardTextRole = "name" | "industry" | "domain";
export type MerchantCardTextLayoutConfig = Partial<
  Record<
    MerchantCardTextRole,
    {
      x?: number;
      y?: number;
    }
  >
>;

type MerchantListIndustry = "all" | Exclude<MerchantIndustry, "">;

export type MerchantListPublishedSite = {
  id: string;
  merchantName?: string;
  signature?: string;
  domainPrefix?: string;
  domainSuffix?: string;
  name: string;
  domain: string;
  category: string;
  industry: MerchantIndustry;
  location: SiteLocation;
  contactAddress?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  merchantCardImageUrl?: string;
  merchantCardImageOpacity?: number;
  chatAvatarImageUrl?: string;
  contactVisibility?: MerchantContactVisibility;
  permissionConfig?: MerchantServicePermissionConfig;
  businessCards?: MerchantBusinessCardAsset[];
  chatBusinessCard?: MerchantBusinessCardAsset | null;
  status?: SiteStatus;
  serviceExpiresAt?: string | null;
  sortConfig: MerchantSortConfig;
  createdAt: string;
};

type HeroProps = BackgroundEditableProps & TypographyEditableProps & { title: string; subtitle?: string };
type TextProps = BackgroundEditableProps & TypographyEditableProps & { heading: string; text: string };
type ListProps = BackgroundEditableProps & TypographyEditableProps & { heading: string; items: string[] };
type SearchBarProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading?: string;
    text?: string;
    cityPlaceholder?: string;
    searchPlaceholder?: string;
    locateLabel?: string;
    actionLabel?: string;
    defaultCountryCode?: string;
    defaultProvinceCode?: string;
    defaultCity?: string;
    searchButtonBgColor?: string;
    searchButtonBgOpacity?: number;
    searchButtonBorderStyle?: BlockBorderStyle;
    searchButtonBorderColor?: string;
    searchButtonActiveBgColor?: string;
    searchButtonActiveBgOpacity?: number;
    searchButtonActiveBorderStyle?: BlockBorderStyle;
    searchButtonActiveBorderColor?: string;
    searchLayout?: Partial<
      Record<
        "locate" | "country" | "province" | "city" | "keyword" | "action",
        {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        }
      >
    >;
  };
type MerchantListProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading: string;
    text?: string;
    maxItems?: number;
    emptyText?: string;
    merchantTabButtonBgColor?: string;
    merchantTabButtonBgOpacity?: number;
    merchantTabButtonBorderStyle?: BlockBorderStyle;
    merchantTabButtonBorderColor?: string;
    merchantTabButtonActiveBgColor?: string;
    merchantTabButtonActiveBgOpacity?: number;
    merchantTabButtonActiveBorderStyle?: BlockBorderStyle;
    merchantTabButtonActiveBorderColor?: string;
    merchantPagerButtonBgColor?: string;
    merchantPagerButtonBgOpacity?: number;
    merchantPagerButtonBorderStyle?: BlockBorderStyle;
    merchantPagerButtonBorderColor?: string;
    merchantPagerButtonDisabledBgColor?: string;
    merchantPagerButtonDisabledBgOpacity?: number;
    merchantPagerButtonDisabledBorderStyle?: BlockBorderStyle;
    merchantPagerButtonDisabledBorderColor?: string;
    merchantCardBgColor?: string;
    merchantCardBgOpacity?: number;
    merchantCardBorderStyle?: BlockBorderStyle;
    merchantCardBorderColor?: string;
    merchantCardTypography?: Partial<Record<MerchantCardTextRole, TypographyEditableProps>>;
    merchantCardTextLayout?: MerchantCardTextLayoutConfig;
    merchantCardTextBoxVisible?: boolean;
    merchantCardIndustryStyles?: Partial<
      Record<
        MerchantListIndustry,
        {
          bgColor?: string;
          bgOpacity?: number;
          borderStyle?: BlockBorderStyle;
          borderColor?: string;
        }
      >
    >;
    industryTabs?: Array<{
      id?: string;
      label?: string;
      industry?: MerchantListIndustry;
    }>;
    publishedMerchantSnapshot?: MerchantListPublishedSite[];
    publishedMerchantDefaultSortRule?: MerchantSortRule;
    merchantCardLayout?: Partial<
      Record<
        string,
        {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        }
      >
    >;
  };
type ContactProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading: string;
    phone: string;
    phones?: string[];
    address: string;
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
    contactLayout?: Partial<
      Record<
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
        | "instagram",
        {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        }
      >
    >;
  };
export type CommonProps = BackgroundEditableProps &
  TypographyEditableProps & {
    commonTextBoxes?: Array<{
      id: string;
      html: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotateDeg?: number;
    }>;
    commonItems?: string[];
    heading?: string;
    text?: string;
  };
export type ButtonProps = BackgroundEditableProps &
  TypographyEditableProps & {
    buttonLabel?: string;
  buttonJumpTarget?: string;
    // Legacy fields kept for button blocks created before the dedicated button editor.
    commonTextBoxes?: CommonProps["commonTextBoxes"];
    commonItems?: string[];
    heading?: string;
    text?: string;
  };
type GalleryProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading: string;
    galleryFrameWidth?: number;
    galleryFrameHeight?: number;
    galleryLayoutPreset?: GalleryLayoutPreset;
    galleryCustomLayout?: CustomGalleryLayout;
    images: Array<
      | string
      | {
          id?: string;
          url?: string;
          featured?: boolean;
          fitToFrame?: boolean;
          offsetX?: number;
          offsetY?: number;
          scaleX?: number;
          scaleY?: number;
        }
    >;
    autoplayMs?: number;
  };
type ChartProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading: string;
    text?: string;
    chartType: "bar" | "line" | "pie";
    labels: string[];
    values: number[];
  };
type MusicProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading?: string;
    audioUrl?: string;
    musicPlayerStyle?: "classic" | "minimal" | "card" | "hidden";
  };
type ProductProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading?: string;
    text?: string;
    products?: ProductItemInput[];
    productSearchEnabled?: boolean;
    productSearchPlaceholder?: string;
    productLayoutPreset?: ProductLayoutPreset;
    productImageAspectRatio?: ProductImageAspectRatio;
    productImageSize?: number;
    productPricePrefix?: string;
    productShowCode?: boolean;
    productShowDescription?: boolean;
    productPriceAlign?: ProductPriceAlign;
    productTagOptions?: string[];
    productTagPosition?: ProductTagPosition;
    productTagFontSize?: number;
    productTagWidth?: number;
    productTagHideUnselected?: boolean;
    productGroupByTag?: boolean;
    productTagBgColor?: string;
    productTagBgOpacity?: number;
    productTagActiveBgColor?: string;
    productTagActiveBgOpacity?: number;
    productContainerMode?: ProductContainerMode;
    productItemsPerPage?: number;
    productDetailImageSize?: number;
    productDetailShowCode?: boolean;
    productDetailShowName?: boolean;
    productDetailShowDescription?: boolean;
    productDetailShowPrice?: boolean;
    productDetailFullImage?: boolean;
    productCardBgColor?: string;
    productCardBgOpacity?: number;
    productCardBorderStyle?: BlockBorderStyle;
    productCardBorderColor?: string;
    productCodeTypography?: TypographyEditableProps;
    productNameTypography?: TypographyEditableProps;
    productDescriptionTypography?: TypographyEditableProps;
    productPriceTypography?: TypographyEditableProps;
  };
export type BookingProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading?: string;
    text?: string;
    bookingStoreLabel?: string;
    bookingItemLabel?: string;
    bookingStoreOptions?: string[];
    bookingItemOptions?: string[];
    bookingAvailableTimeRanges?: string[];
    bookingSlotCapacityRules?: Array<{
      slot?: string;
      maxBookings?: number;
    }>;
    bookingBlockedDates?: string[];
    bookingHolidayDates?: string[];
    bookingTitleOptions?: string[];
    bookingSubmitLabel?: string;
    bookingUpdateLabel?: string;
    bookingCancelLabel?: string;
    bookingSuccessTitle?: string;
    bookingSuccessText?: string;
    bookingNamePlaceholder?: string;
    bookingNotePlaceholder?: string;
  };
type NavProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading?: string;
    navOrientation?: "horizontal" | "vertical";
    navItemBgColor?: string;
    navItemBgOpacity?: number;
    navItemBorderStyle?: BlockBorderStyle;
    navItemBorderColor?: string;
    navItemActiveBgColor?: string;
    navItemActiveBgOpacity?: number;
    navItemActiveBorderStyle?: BlockBorderStyle;
    navItemActiveBorderColor?: string;
    navItemActiveTextColor?: string;
    navItems?: Array<{
      id: string;
      label: string;
      pageId: string;
    }>;
  };

export type Block =
  | { id: string; type: "common"; props: CommonProps }
  | { id: string; type: "button"; props: ButtonProps }
  | { id: string; type: "gallery"; props: GalleryProps }
  | { id: string; type: "chart"; props: ChartProps }
  | { id: string; type: "nav"; props: NavProps }
  | { id: string; type: "hero"; props: HeroProps }
  | { id: string; type: "text"; props: TextProps }
  | { id: string; type: "list"; props: ListProps }
  | { id: string; type: "search-bar"; props: SearchBarProps }
  | { id: string; type: "merchant-list"; props: MerchantListProps }
  | { id: string; type: "contact"; props: ContactProps }
  | { id: string; type: "product"; props: ProductProps }
  | { id: string; type: "booking"; props: BookingProps }
  | { id: string; type: "music"; props: MusicProps };

export const homeBlocks: Block[] = [
  {
    id: "b-common",
    type: "common",
    props: {
      schemaVersion: BLOCKS_SCHEMA_VERSION,
      commonTextBoxes: [],
    },
  },
  {
    id: "b-gallery",
    type: "gallery",
    props: {
      heading: "相册展示",
      images: [],
      autoplayMs: 3000,
      galleryFrameHeight: 260,
      galleryLayoutPreset: "three-wide",
    },
  },
  {
    id: "b-nav",
    type: "nav",
    props: {
      heading: "页面导航",
      navOrientation: "horizontal",
      navItems: [{ id: "b-nav-item-1", label: "页面1", pageId: "page-1" }],
    },
  },
  {
    id: "b-chart",
    type: "chart",
    props: {
      heading: "数据图表",
      text: "支持图表与文字混排展示。",
      chartType: "bar",
      labels: ["一月", "二月", "三月", "四月"],
      values: [12, 18, 9, 24],
    },
  },
];



