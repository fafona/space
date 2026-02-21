import type { CustomGalleryLayout, GalleryLayoutPreset } from "@/lib/galleryLayout";

export type ImageFillMode = "cover" | "contain" | "fill" | "repeat" | "repeat-x" | "repeat-y";
export type BlockBorderStyle = "none" | "glass" | "soft" | "solid" | "dashed" | "double" | "accent";

export type BackgroundEditableProps = {
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

type HeroProps = BackgroundEditableProps & TypographyEditableProps & { title: string; subtitle?: string };
type TextProps = BackgroundEditableProps & TypographyEditableProps & { heading: string; text: string };
type ListProps = BackgroundEditableProps & TypographyEditableProps & { heading: string; items: string[] };
type ContactProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading: string;
    phone: string;
    address: string;
    addresses?: string[];
    mapZoom?: number;
    mapType?: "roadmap" | "satellite";
    mapShowMarker?: boolean;
    email?: string;
    whatsapp?: string;
    wechat?: string;
    tiktok?: string;
    xiaohongshu?: string;
    facebook?: string;
    instagram?: string;
    contactLayout?: Partial<
      Record<
        "phone" | "email" | "whatsapp" | "wechat" | "tiktok" | "xiaohongshu" | "facebook" | "instagram",
        {
          x?: number;
          y?: number;
          width?: number;
        }
      >
    >;
  };
type CommonProps = BackgroundEditableProps &
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
    navItems?: Array<{
      id: string;
      label: string;
      pageId: string;
    }>;
  };

export type Block =
  | { id: string; type: "common"; props: CommonProps }
  | { id: string; type: "gallery"; props: GalleryProps }
  | { id: string; type: "chart"; props: ChartProps }
  | { id: string; type: "nav"; props: NavProps }
  | { id: string; type: "hero"; props: HeroProps }
  | { id: string; type: "text"; props: TextProps }
  | { id: string; type: "list"; props: ListProps }
  | { id: string; type: "contact"; props: ContactProps }
  | { id: string; type: "music"; props: MusicProps };

export const homeBlocks: Block[] = [
  {
    id: "b-common",
    type: "common",
    props: {
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

