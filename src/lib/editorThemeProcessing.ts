import type {
  Block,
  BlockBorderStyle,
  TypographyEditableProps,
} from "@/data/homeBlocks";

export type EditorThemePresetKey =
  | "none"
  | "cartoon"
  | "retro"
  | "minimal"
  | "future"
  | "luxury"
  | "magazine"
  | "commerce"
  | "cinema";

type ThemeTone = {
  bgColor?: string;
  bgOpacity?: number;
  imageOpacity?: number;
  borderStyle?: BlockBorderStyle;
  borderColor?: string;
};

type ThemePreset = {
  label: string;
  noop?: boolean;
  fontFamily?: string;
  fontColor?: string;
  blockTone?: ThemeTone;
  pageTone?: ThemeTone;
  productCardTone?: Omit<ThemeTone, "imageOpacity">;
  productTagTone?: {
    bgColor?: string;
    bgOpacity?: number;
    activeBgColor?: string;
    activeBgOpacity?: number;
  };
  merchantCardTone?: Omit<ThemeTone, "imageOpacity">;
  merchantTabTone?: Omit<ThemeTone, "imageOpacity">;
  merchantTabActiveTone?: Omit<ThemeTone, "imageOpacity">;
  merchantPagerTone?: Omit<ThemeTone, "imageOpacity">;
  merchantPagerDisabledTone?: Omit<ThemeTone, "imageOpacity">;
};

const THEME_PRESETS: Record<EditorThemePresetKey, ThemePreset> = {
  none: {
    label: "无效果",
    noop: true,
  },
  cartoon: {
    label: "卡通活动",
    fontFamily: "Trebuchet MS, sans-serif",
    fontColor: "#1f2937",
    blockTone: {
      bgColor: "linear-gradient(135deg, #fff8cc 0%, #ffe4e6 52%, #dbeafe 100%)",
      bgOpacity: 0.94,
      imageOpacity: 0.88,
      borderStyle: "accent",
      borderColor: "#fb7185",
    },
    pageTone: {
      bgColor: "linear-gradient(135deg, #dbeafe 0%, #fce7f3 45%, #fff7cc 100%)",
      bgOpacity: 0.9,
      imageOpacity: 0.86,
    },
    productCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.92,
      borderStyle: "soft",
      borderColor: "#fb7185",
    },
    productTagTone: {
      bgColor: "#334155",
      bgOpacity: 0.86,
      activeBgColor: "#fb7185",
      activeBgOpacity: 0.96,
    },
    merchantCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.88,
      borderStyle: "soft",
      borderColor: "#93c5fd",
    },
    merchantTabTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.9,
      borderStyle: "soft",
      borderColor: "#93c5fd",
    },
    merchantTabActiveTone: {
      bgColor: "#fb7185",
      bgOpacity: 0.94,
      borderStyle: "accent",
      borderColor: "#fb7185",
    },
    merchantPagerTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.9,
      borderStyle: "soft",
      borderColor: "#93c5fd",
    },
    merchantPagerDisabledTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.45,
      borderStyle: "soft",
      borderColor: "#cbd5e1",
    },
  },
  retro: {
    label: "经典",
    fontFamily: "Georgia, serif",
    fontColor: "#4a3f35",
    blockTone: {
      bgColor: "linear-gradient(180deg, #fff7eb 0%, #ead7bc 100%)",
      bgOpacity: 0.92,
      imageOpacity: 0.9,
      borderStyle: "double",
      borderColor: "#8b5a2b",
    },
    pageTone: {
      bgColor: "linear-gradient(180deg, #efe2c8 0%, #dcc3a5 100%)",
      bgOpacity: 0.94,
      imageOpacity: 0.9,
    },
    productCardTone: {
      bgColor: "#fff8ef",
      bgOpacity: 0.95,
      borderStyle: "solid",
      borderColor: "#b08968",
    },
    productTagTone: {
      bgColor: "#6b4f3a",
      bgOpacity: 0.9,
      activeBgColor: "#8b5a2b",
      activeBgOpacity: 0.95,
    },
    merchantCardTone: {
      bgColor: "#fff8ef",
      bgOpacity: 0.93,
      borderStyle: "solid",
      borderColor: "#c6a27d",
    },
    merchantTabTone: {
      bgColor: "#f9efe1",
      bgOpacity: 0.93,
      borderStyle: "solid",
      borderColor: "#c6a27d",
    },
    merchantTabActiveTone: {
      bgColor: "#ead7bc",
      bgOpacity: 0.95,
      borderStyle: "solid",
      borderColor: "#8b5a2b",
    },
    merchantPagerTone: {
      bgColor: "#f9efe1",
      bgOpacity: 0.93,
      borderStyle: "solid",
      borderColor: "#c6a27d",
    },
    merchantPagerDisabledTone: {
      bgColor: "#f9efe1",
      bgOpacity: 0.5,
      borderStyle: "solid",
      borderColor: "#d6c1a6",
    },
  },
  minimal: {
    label: "极简风格",
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
    fontColor: "#111827",
    blockTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.9,
      imageOpacity: 0.96,
      borderStyle: "none",
      borderColor: "#d1d5db",
    },
    pageTone: {
      bgColor: "linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)",
      bgOpacity: 0.96,
      imageOpacity: 0.94,
    },
    productCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.86,
      borderStyle: "soft",
      borderColor: "#e5e7eb",
    },
    productTagTone: {
      bgColor: "#e5e7eb",
      bgOpacity: 0.88,
      activeBgColor: "#111827",
      activeBgOpacity: 0.96,
    },
    merchantCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.84,
      borderStyle: "soft",
      borderColor: "#e5e7eb",
    },
    merchantTabTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.88,
      borderStyle: "solid",
      borderColor: "#d1d5db",
    },
    merchantTabActiveTone: {
      bgColor: "#e5e7eb",
      bgOpacity: 0.96,
      borderStyle: "solid",
      borderColor: "#111827",
    },
    merchantPagerTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.88,
      borderStyle: "solid",
      borderColor: "#d1d5db",
    },
    merchantPagerDisabledTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.42,
      borderStyle: "solid",
      borderColor: "#d1d5db",
    },
  },
  future: {
    label: "未来科技",
    fontFamily: "Verdana, Geneva, sans-serif",
    fontColor: "#e0f2fe",
    blockTone: {
      bgColor: "linear-gradient(135deg, #082f49 0%, #0f172a 55%, #164e63 100%)",
      bgOpacity: 0.78,
      imageOpacity: 0.68,
      borderStyle: "glass",
      borderColor: "#22d3ee",
    },
    pageTone: {
      bgColor: "linear-gradient(135deg, #020617 0%, #0f172a 45%, #0f766e 100%)",
      bgOpacity: 0.86,
      imageOpacity: 0.6,
    },
    productCardTone: {
      bgColor: "linear-gradient(135deg, #082f49 0%, #0f172a 100%)",
      bgOpacity: 0.82,
      borderStyle: "glass",
      borderColor: "#22d3ee",
    },
    productTagTone: {
      bgColor: "#164e63",
      bgOpacity: 0.9,
      activeBgColor: "#06b6d4",
      activeBgOpacity: 0.94,
    },
    merchantCardTone: {
      bgColor: "linear-gradient(135deg, #082f49 0%, #0f172a 100%)",
      bgOpacity: 0.76,
      borderStyle: "glass",
      borderColor: "#22d3ee",
    },
    merchantTabTone: {
      bgColor: "#082f49",
      bgOpacity: 0.86,
      borderStyle: "glass",
      borderColor: "#22d3ee",
    },
    merchantTabActiveTone: {
      bgColor: "#155e75",
      bgOpacity: 0.92,
      borderStyle: "solid",
      borderColor: "#67e8f9",
    },
    merchantPagerTone: {
      bgColor: "#082f49",
      bgOpacity: 0.86,
      borderStyle: "glass",
      borderColor: "#22d3ee",
    },
    merchantPagerDisabledTone: {
      bgColor: "#082f49",
      bgOpacity: 0.45,
      borderStyle: "glass",
      borderColor: "#155e75",
    },
  },
  luxury: {
    label: "高端奢华",
    fontFamily: "Times New Roman, Times, serif",
    fontColor: "#fef3c7",
    blockTone: {
      bgColor: "linear-gradient(180deg, #1f1a14 0%, #111111 100%)",
      bgOpacity: 0.84,
      imageOpacity: 0.72,
      borderStyle: "solid",
      borderColor: "#d4af37",
    },
    pageTone: {
      bgColor: "linear-gradient(180deg, #111111 0%, #1f1b14 42%, #4b3b12 100%)",
      bgOpacity: 0.92,
      imageOpacity: 0.68,
    },
    productCardTone: {
      bgColor: "linear-gradient(180deg, #1f1a14 0%, #111111 100%)",
      bgOpacity: 0.9,
      borderStyle: "solid",
      borderColor: "#d4af37",
    },
    productTagTone: {
      bgColor: "#5b4612",
      bgOpacity: 0.92,
      activeBgColor: "#d4af37",
      activeBgOpacity: 0.95,
    },
    merchantCardTone: {
      bgColor: "linear-gradient(180deg, #1f1a14 0%, #111111 100%)",
      bgOpacity: 0.88,
      borderStyle: "solid",
      borderColor: "#d4af37",
    },
    merchantTabTone: {
      bgColor: "#1f1a14",
      bgOpacity: 0.92,
      borderStyle: "solid",
      borderColor: "#8c6b1f",
    },
    merchantTabActiveTone: {
      bgColor: "#3f3113",
      bgOpacity: 0.94,
      borderStyle: "solid",
      borderColor: "#d4af37",
    },
    merchantPagerTone: {
      bgColor: "#1f1a14",
      bgOpacity: 0.9,
      borderStyle: "solid",
      borderColor: "#8c6b1f",
    },
    merchantPagerDisabledTone: {
      bgColor: "#1f1a14",
      bgOpacity: 0.48,
      borderStyle: "solid",
      borderColor: "#8c6b1f",
    },
  },
  magazine: {
    label: "杂志风格",
    fontFamily: "Arial Narrow, Helvetica, Arial, sans-serif",
    fontColor: "#111827",
    blockTone: {
      bgColor: "linear-gradient(180deg, #fffdf8 0%, #f6efe4 100%)",
      bgOpacity: 0.92,
      imageOpacity: 0.9,
      borderStyle: "solid",
      borderColor: "#111827",
    },
    pageTone: {
      bgColor: "linear-gradient(180deg, #fcfaf7 0%, #f5efe6 100%)",
      bgOpacity: 0.96,
      imageOpacity: 0.9,
    },
    productCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.9,
      borderStyle: "solid",
      borderColor: "#111827",
    },
    productTagTone: {
      bgColor: "#111827",
      bgOpacity: 0.84,
      activeBgColor: "#dc2626",
      activeBgOpacity: 0.94,
    },
    merchantCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.88,
      borderStyle: "solid",
      borderColor: "#111827",
    },
    merchantTabTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.9,
      borderStyle: "solid",
      borderColor: "#111827",
    },
    merchantTabActiveTone: {
      bgColor: "#f3f4f6",
      bgOpacity: 0.96,
      borderStyle: "solid",
      borderColor: "#111827",
    },
    merchantPagerTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.9,
      borderStyle: "solid",
      borderColor: "#111827",
    },
    merchantPagerDisabledTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.45,
      borderStyle: "solid",
      borderColor: "#9ca3af",
    },
  },
  commerce: {
    label: "电商风格",
    fontFamily: "Microsoft YaHei, SimHei, sans-serif",
    fontColor: "#111827",
    blockTone: {
      bgColor: "linear-gradient(135deg, #ffffff 0%, #fff1f2 52%, #ffedd5 100%)",
      bgOpacity: 0.94,
      imageOpacity: 0.84,
      borderStyle: "soft",
      borderColor: "#fb7185",
    },
    pageTone: {
      bgColor: "linear-gradient(180deg, #fff1f2 0%, #ffe4e6 58%, #ffedd5 100%)",
      bgOpacity: 0.96,
      imageOpacity: 0.82,
    },
    productCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.92,
      borderStyle: "soft",
      borderColor: "#fb7185",
    },
    productTagTone: {
      bgColor: "#334155",
      bgOpacity: 0.84,
      activeBgColor: "#ef4444",
      activeBgOpacity: 0.96,
    },
    merchantCardTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.9,
      borderStyle: "soft",
      borderColor: "#fb7185",
    },
    merchantTabTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.92,
      borderStyle: "soft",
      borderColor: "#fda4af",
    },
    merchantTabActiveTone: {
      bgColor: "#fda4af",
      bgOpacity: 0.94,
      borderStyle: "accent",
      borderColor: "#ef4444",
    },
    merchantPagerTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.92,
      borderStyle: "soft",
      borderColor: "#fda4af",
    },
    merchantPagerDisabledTone: {
      bgColor: "#ffffff",
      bgOpacity: 0.45,
      borderStyle: "soft",
      borderColor: "#fecdd3",
    },
  },
  cinema: {
    label: "电影感",
    fontFamily: "Trebuchet MS, Gill Sans, sans-serif",
    fontColor: "#f8fafc",
    blockTone: {
      bgColor: "linear-gradient(180deg, #0f172a 0%, #111827 100%)",
      bgOpacity: 0.82,
      imageOpacity: 0.72,
      borderStyle: "glass",
      borderColor: "#374151",
    },
    pageTone: {
      bgColor: "linear-gradient(180deg, #020617 0%, #111827 45%, #312e81 100%)",
      bgOpacity: 0.9,
      imageOpacity: 0.64,
    },
    productCardTone: {
      bgColor: "linear-gradient(180deg, #0f172a 0%, #111827 100%)",
      bgOpacity: 0.88,
      borderStyle: "glass",
      borderColor: "#475569",
    },
    productTagTone: {
      bgColor: "#1e293b",
      bgOpacity: 0.88,
      activeBgColor: "#f59e0b",
      activeBgOpacity: 0.92,
    },
    merchantCardTone: {
      bgColor: "linear-gradient(180deg, #0f172a 0%, #111827 100%)",
      bgOpacity: 0.84,
      borderStyle: "glass",
      borderColor: "#475569",
    },
    merchantTabTone: {
      bgColor: "#111827",
      bgOpacity: 0.9,
      borderStyle: "solid",
      borderColor: "#475569",
    },
    merchantTabActiveTone: {
      bgColor: "#312e81",
      bgOpacity: 0.92,
      borderStyle: "solid",
      borderColor: "#818cf8",
    },
    merchantPagerTone: {
      bgColor: "#111827",
      bgOpacity: 0.88,
      borderStyle: "solid",
      borderColor: "#475569",
    },
    merchantPagerDisabledTone: {
      bgColor: "#111827",
      bgOpacity: 0.42,
      borderStyle: "solid",
      borderColor: "#334155",
    },
  },
};

function clampThemeOpacity(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function hasThemeImage(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function applyThemeTonePatch(
  patch: Record<string, unknown>,
  tone: ThemeTone | undefined,
  options: {
    imageUrl?: string;
    colorKey: string;
    colorOpacityKey: string;
    imageOpacityKey?: string;
    borderStyleKey?: string;
    borderColorKey?: string;
  },
) {
  if (!tone) return;
  if (tone.bgColor) patch[options.colorKey] = tone.bgColor;
  const bgOpacity = clampThemeOpacity(tone.bgOpacity);
  if (typeof bgOpacity === "number") patch[options.colorOpacityKey] = bgOpacity;
  if (options.borderStyleKey && tone.borderStyle) patch[options.borderStyleKey] = tone.borderStyle;
  if (options.borderColorKey && tone.borderColor) patch[options.borderColorKey] = tone.borderColor;
  const imageOpacity = clampThemeOpacity(tone.imageOpacity);
  if (options.imageOpacityKey && typeof imageOpacity === "number" && hasThemeImage(options.imageUrl)) {
    patch[options.imageOpacityKey] = imageOpacity;
  }
}

function applyThemeTypographyStyle(
  style: TypographyEditableProps | undefined,
  preset: ThemePreset,
) {
  const next: TypographyEditableProps = { ...(style ?? {}) };
  let changed = false;
  if (preset.fontFamily) {
    next.fontFamily = preset.fontFamily;
    changed = true;
  }
  if (preset.fontColor) {
    next.fontColor = preset.fontColor;
    changed = true;
  }
  return changed ? next : style;
}

export function applyEditorThemePresetToBlocks(
  blocks: Block[],
  presetKey: EditorThemePresetKey,
) {
  const preset = THEME_PRESETS[presetKey];
  if (!preset || preset.noop) {
    return {
      blocks,
      applied: false,
      label: preset?.label ?? "",
    };
  }

  const nextBlocks = blocks.map((block, index) => {
    const patch: Record<string, unknown> = {};
    if (preset.fontFamily) patch.fontFamily = preset.fontFamily;
    if (preset.fontColor) patch.fontColor = preset.fontColor;
    applyThemeTonePatch(patch, preset.blockTone, {
      imageUrl: block.props.bgImageUrl,
      colorKey: "bgColor",
      colorOpacityKey: "bgColorOpacity",
      imageOpacityKey: "bgImageOpacity",
      borderStyleKey: "blockBorderStyle",
      borderColorKey: "blockBorderColor",
    });
    if (index === 0) {
      applyThemeTonePatch(patch, preset.pageTone, {
        imageUrl: block.props.pageBgImageUrl,
        colorKey: "pageBgColor",
        colorOpacityKey: "pageBgColorOpacity",
        imageOpacityKey: "pageBgImageOpacity",
      });
    }
    if (block.type === "product") {
      applyThemeTonePatch(patch, preset.productCardTone, {
        colorKey: "productCardBgColor",
        colorOpacityKey: "productCardBgOpacity",
        borderStyleKey: "productCardBorderStyle",
        borderColorKey: "productCardBorderColor",
      });
      if (preset.productTagTone?.bgColor) patch.productTagBgColor = preset.productTagTone.bgColor;
      const productTagBgOpacity = clampThemeOpacity(preset.productTagTone?.bgOpacity);
      if (typeof productTagBgOpacity === "number") patch.productTagBgOpacity = productTagBgOpacity;
      if (preset.productTagTone?.activeBgColor) {
        patch.productTagActiveBgColor = preset.productTagTone.activeBgColor;
      }
      const productTagActiveBgOpacity = clampThemeOpacity(preset.productTagTone?.activeBgOpacity);
      if (typeof productTagActiveBgOpacity === "number") {
        patch.productTagActiveBgOpacity = productTagActiveBgOpacity;
      }
      patch.productCodeTypography = applyThemeTypographyStyle(block.props.productCodeTypography, preset) ?? {};
      patch.productNameTypography = applyThemeTypographyStyle(block.props.productNameTypography, preset) ?? {};
      patch.productDescriptionTypography =
        applyThemeTypographyStyle(block.props.productDescriptionTypography, preset) ?? {};
      patch.productPriceTypography = applyThemeTypographyStyle(block.props.productPriceTypography, preset) ?? {};
    }
    if (block.type === "merchant-list") {
      applyThemeTonePatch(patch, preset.merchantCardTone, {
        colorKey: "merchantCardBgColor",
        colorOpacityKey: "merchantCardBgOpacity",
        borderStyleKey: "merchantCardBorderStyle",
        borderColorKey: "merchantCardBorderColor",
      });
      applyThemeTonePatch(patch, preset.merchantTabTone, {
        colorKey: "merchantTabButtonBgColor",
        colorOpacityKey: "merchantTabButtonBgOpacity",
        borderStyleKey: "merchantTabButtonBorderStyle",
        borderColorKey: "merchantTabButtonBorderColor",
      });
      applyThemeTonePatch(patch, preset.merchantTabActiveTone, {
        colorKey: "merchantTabButtonActiveBgColor",
        colorOpacityKey: "merchantTabButtonActiveBgOpacity",
        borderStyleKey: "merchantTabButtonActiveBorderStyle",
        borderColorKey: "merchantTabButtonActiveBorderColor",
      });
      applyThemeTonePatch(patch, preset.merchantPagerTone, {
        colorKey: "merchantPagerButtonBgColor",
        colorOpacityKey: "merchantPagerButtonBgOpacity",
        borderStyleKey: "merchantPagerButtonBorderStyle",
        borderColorKey: "merchantPagerButtonBorderColor",
      });
      applyThemeTonePatch(patch, preset.merchantPagerDisabledTone, {
        colorKey: "merchantPagerButtonDisabledBgColor",
        colorOpacityKey: "merchantPagerButtonDisabledBgOpacity",
        borderStyleKey: "merchantPagerButtonDisabledBorderStyle",
        borderColorKey: "merchantPagerButtonDisabledBorderColor",
      });
      const merchantCardTypography = { ...(block.props.merchantCardTypography ?? {}) };
      (["name", "industry", "domain"] as const).forEach((role) => {
        merchantCardTypography[role] =
          applyThemeTypographyStyle(merchantCardTypography[role], preset) ?? {};
      });
      patch.merchantCardTypography = merchantCardTypography;
      const industryStyles = block.props.merchantCardIndustryStyles ?? {};
      patch.merchantCardIndustryStyles = Object.fromEntries(
        Object.entries(industryStyles).map(([key, currentValue]) => {
          const nextValue = { ...(currentValue ?? {}) };
          if (preset.merchantCardTone?.bgColor) nextValue.bgColor = preset.merchantCardTone.bgColor;
          const merchantCardBgOpacity = clampThemeOpacity(preset.merchantCardTone?.bgOpacity);
          if (typeof merchantCardBgOpacity === "number") nextValue.bgOpacity = merchantCardBgOpacity;
          if (preset.merchantCardTone?.borderStyle) {
            nextValue.borderStyle = preset.merchantCardTone.borderStyle;
          }
          if (preset.merchantCardTone?.borderColor) {
            nextValue.borderColor = preset.merchantCardTone.borderColor;
          }
          return [key, nextValue];
        }),
      );
    }
    return {
      ...block,
      props: {
        ...block.props,
        ...patch,
      } as never,
    } as Block;
  });

  return {
    blocks: nextBlocks,
    applied: true,
    label: preset.label,
  };
}
