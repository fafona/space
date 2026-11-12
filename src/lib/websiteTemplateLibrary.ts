import type { Block } from "@/data/homeBlocks";
import type { PlanTemplateCategory } from "@/data/platformControlStore";
import { cloneBlocks, type PagePlanConfig, type PlanId, type PlanPage } from "@/lib/pagePlans";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { getEmbeddedMobilePlanConfig } from "@/lib/planTemplateRuntime";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import type { WebsiteTemplateHomeSnapshots } from './websiteTemplateHomeSnapshots';
export const WEBSITE_TEMPLATE_CATEGORIES = ["餐饮", "娱乐", "零售", "服务", "组织", "其他"] as const;
export type WebsiteTemplateDesign = {
    desktop: PlanPage[];
    mobile: PlanPage[];
};
export type WebsiteTemplateCard = {
    id: string;
    revision: string;
    name: string;
    category: PlanTemplateCategory;
    status: "draft" | "published";
    sortOrder: number;
    coverImageUrl: string;
    desktopPageCount: number;
    mobilePageCount: number;
    updatedAt: string;
    sourceSiteId?: string;
    sourcePlanId?: PlanId;
};
export type WebsiteTemplate = WebsiteTemplateCard & {
    design: WebsiteTemplateDesign;
    homeSnapshots?: WebsiteTemplateHomeSnapshots;
};
const PRIVATE_KEYS = new Set([
    "pagePlanConfig", "pagePlanConfigMobile", "publishedMerchantSnapshot", "publishedMerchantDefaultSortRule",
    "pollId", "pollLegacyIds", "pollRoundHistory", "pollRoundDeleted", "pollOpenAt", "pollCloseAt",
    "merchantId", "merchant_id", "siteId", "site_id", "authToken", "accessToken", "refreshToken",
    "orders", "bookings", "memberships", "members", "customers", "couponClaims", "redemptions",
]);
const NATIVE_TYPES = new Set(["hero", "text", "list", "common", "button", "nav", "gallery", "chart", "music", "contact", "product", "coupon", "google-reviews", "booking", "poll", "search-bar", "merchant-list"]);
function scrub(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(scrub);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEYS.has(key)).map(([key, v]) => [key, scrub(v)]));
}
/** Publication is an explicit admin review; this additionally removes live identities and business collections. */
export function snapshotWebsiteTemplate(blocks: Block[], planId: PlanId): WebsiteTemplateDesign {
    const desktop = getPagePlanConfigFromBlocks(blocks).plans.find(p => p.id === planId);
    const mobile = getEmbeddedMobilePlanConfig(blocks)?.plans.find(p => p.id === planId);
    if (!desktop || !mobile)
        throw new Error("template_requires_desktop_and_mobile");
    const copy = (pages: PlanPage[]) => pages.map(page => ({
        id: page.id, name: page.name,
        blocks: sanitizeBlocksForRuntime(cloneBlocks(page.blocks).filter(b => b.id !== "__plan_meta__").map(block => {
            const props = scrub(block.props) as Record<string, unknown>;
            if (block.type === "product")
                props.products = [];
            if (block.type === "coupon") {
                delete props.coupons;
                delete props.couponIds;
            }
            if (block.type === "coupon")
                delete props.couponSelectedIds;
            if (block.type === "google-reviews")
                for (const key of Object.keys(props))
                    if (/^googleReview/.test(key) && !["googleReviewDisplayMode", "googleReviewMaxItems", "googleReviewShowAuthorPhoto", "googleReviewShowDates", "googleReviewShowReplies", "googleReviewEmptyText"].includes(key))
                        delete props[key];
            if (block.type === "contact")
                for (const key of ["phone", "phones", "email", "address", "addresses", "mapUrl", "whatsapp", "wechat", "contactName", "twitter", "weibo", "telegram", "linkedin", "discord", "tiktok", "xiaohongshu", "facebook", "instagram"])
                    delete props[key];
            if (typeof props.buttonJumpTarget === "string" && !/^(?:page:|block:|#)/.test(props.buttonJumpTarget))
                props.buttonJumpTarget = "";
            return { ...block, props } as Block;
        })).blocks,
    }));
    const design = { desktop: copy(desktop.pages), mobile: copy(mobile.pages) };
    validateWebsiteTemplateDesign(design);
    return structuredClone(design);
}
export function validateWebsiteTemplateDesign(design: WebsiteTemplateDesign) {
    for (const view of ["desktop", "mobile"] as const) {
        const pages = design?.[view];
        if (!Array.isArray(pages) || !pages.length || pages.length > 30)
            throw new Error("invalid_template_pages");
        const ids = new Set(pages.map(p => p.id));
        if (ids.size !== pages.length)
            throw new Error("duplicate_template_page");
        let bookings = 0;
        for (const page of pages) {
            if (!page.id || !page.name || !Array.isArray(page.blocks) || page.blocks.length > 200)
                throw new Error("invalid_template_page");
            const blockIds = new Set<string>();
            for (const block of page.blocks) {
                if (!NATIVE_TYPES.has(block.type) || !block.id || blockIds.has(block.id))
                    throw new Error("invalid_template_block");
                blockIds.add(block.id);
                if (block.type === "booking")
                    bookings++;
                const p = block.props as Record<string, unknown>;
                if (typeof p.buttonJumpTarget === "string" && p.buttonJumpTarget.startsWith("page:") && !ids.has(p.buttonJumpTarget.slice(5)))
                    throw new Error("invalid_template_page_link");
                if (block.type === "nav" && block.props.navItems?.some(item => !ids.has(item.pageId)))
                    throw new Error("invalid_template_navigation");
            }
        }
        if (bookings > 1)
            throw new Error("template_booking_limit");
    }
}
/** One-time value copy. Never retains a template ID, source identity, object reference or live subscription. */
export function installWebsiteTemplate(design: WebsiteTemplateDesign, target: {
    desktop: PagePlanConfig;
    mobile: PagePlanConfig;
}, planId: PlanId): {
    desktop: PagePlanConfig;
    mobile: PagePlanConfig;
} {
    validateWebsiteTemplateDesign(design);
    const next = structuredClone(target);
    const pollIds = new Map<string, string>();
    for (const view of ["desktop", "mobile"] as const) {
        const index = next[view].plans.findIndex(p => p.id === planId);
        if (index < 0)
            throw new Error("target_plan_not_found");
        const pages = structuredClone(design[view]);
        for (const page of pages)
            page.blocks.forEach((block) => {
                if (block.type !== "poll")
                    return;
                // Responsive layouts may insert or reorder surrounding blocks.
                // Pair the same poll by stable block identity, never its position.
                const key = page.id + ":" + block.id;
                if (!pollIds.has(key))
                    pollIds.set(key, "poll-template-" + globalThis.crypto.randomUUID());
                block.props.pollId = pollIds.get(key)!;
            });
        next[view].plans[index] = { ...next[view].plans[index], pages, activePageId: pages[0].id, blocks: cloneBlocks(pages[0].blocks) };
        // Active/public plan selection is deliberately unchanged. The editor may select this draft separately.
    }
    return next;
}
export function getWebsiteTemplateCover(design: WebsiteTemplateDesign) {
    for (const page of design.desktop)
        for (const block of page.blocks) {
            if (block.props.bgImageUrl?.startsWith("data:image/") && block.props.bgImageUrl.length <= 400000)
                return block.props.bgImageUrl;
        }
    return "";
}
