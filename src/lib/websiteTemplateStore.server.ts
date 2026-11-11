import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebsiteTemplate, WebsiteTemplateCard, WebsiteTemplateDesign } from "@/lib/websiteTemplateLibrary";
import { getWebsiteTemplateCover, validateWebsiteTemplateDesign, WEBSITE_TEMPLATE_CATEGORIES } from "@/lib/websiteTemplateLibrary";
const PUBLIC_COLUMNS = "id,revision,name,category,status,sort_order,cover_image_url,desktop_page_count,mobile_page_count,updated_at";
const SOURCE_COLUMNS = ",source_site_id,source_plan_id";
/** Strict empty-site probe. A query error is never interpreted as a new merchant. */
export async function canInitializeWebsiteTemplateDraft(db: SupabaseClient,siteId:string) {
    const draft=await db.from('pages').select('id').is('merchant_id',null).eq('slug','__merchant_draft__:'+siteId).limit(2).abortSignal(AbortSignal.timeout(8000));
    if(draft.error||!Array.isArray(draft.data))throw new Error('template_library_unavailable');
    if(draft.data.length)return false;
    const published=await db.from('pages').select('id,slug').eq('merchant_id',siteId).limit(1001).abortSignal(AbortSignal.timeout(8000));
    if(published.error||!Array.isArray(published.data))throw new Error('template_library_unavailable');
    if(published.data.length>1000)return false;
    return !published.data.some(row=>typeof row.slug!=='string'||!row.slug.startsWith('__'));
}
function card(row: Record<string, unknown>, admin = false): WebsiteTemplateCard {
    return { id: String(row.id), revision: String(row.revision), name: String(row.name), category: row.category as WebsiteTemplateCard['category'], status: row.status as WebsiteTemplateCard['status'], sortOrder: Number(row.sort_order), coverImageUrl: String(row.cover_image_url ?? ''), desktopPageCount: Number(row.desktop_page_count), mobilePageCount: Number(row.mobile_page_count), updatedAt: String(row.updated_at), ...(admin ? { sourceSiteId: String(row.source_site_id), sourcePlanId: row.source_plan_id as WebsiteTemplateCard['sourcePlanId'] } : {}) };
}
export async function listWebsiteTemplates(db: SupabaseClient, admin = false, filters: {
    search?: string;
    category?: string;
    offset?: number;
} = {}) {
    const offset = filters.offset ?? 0;
    let query = db.from('website_templates').select(PUBLIC_COLUMNS + (admin ? SOURCE_COLUMNS : '')).order('sort_order').order('updated_at', { ascending: false }).order('id').range(offset, offset + 23);
    if (!admin)
        query = query.eq('status', 'published');
    if (filters.search?.trim())
        query = query.ilike('name', '%' + filters.search.trim().replace(/[\\%_]/g, '\\$&') + '%');
    if (filters.category && filters.category !== '全部')
        query = query.eq('category', filters.category);
    const result = await query;
    if (result.error)
        throw new Error('template_library_unavailable');
    return (result.data ?? []).map(r => card(r as unknown as Record<string, unknown>, admin));
}
export async function readWebsiteTemplate(db: SupabaseClient, id: string, admin = false): Promise<WebsiteTemplate | null> {
    let query = db.from('website_templates').select(PUBLIC_COLUMNS + ',design' + (admin ? SOURCE_COLUMNS : '')).eq('id', id);
    if (!admin)
        query = query.eq('status', 'published');
    const result = await query.maybeSingle();
    if (result.error)
        throw new Error('template_library_unavailable');
    if (!result.data)
        return null;
    const row = result.data as unknown as Record<string, unknown>;
    const design = structuredClone(row.design) as WebsiteTemplateDesign;
    validateWebsiteTemplateDesign(design);
    return { ...card(row, admin), design };
}
export async function createWebsiteTemplate(db: SupabaseClient, input: {
    name: string;
    category: string;
    sourceSiteId: string;
    sourcePlanId: string;
    design: WebsiteTemplateDesign;
}) {
    validateWebsiteTemplateDesign(input.design);
    if (!input.name.trim() || input.name.length > 100 || !WEBSITE_TEMPLATE_CATEGORIES.includes(input.category as never))
        throw new Error('invalid_template_metadata');
    const row = { id: randomUUID(), revision: randomUUID(), name: input.name.trim(), category: input.category, status: 'draft', sort_order: 0, design: structuredClone(input.design), cover_image_url: getWebsiteTemplateCover(input.design), desktop_page_count: input.design.desktop.length, mobile_page_count: input.design.mobile.length, source_site_id: input.sourceSiteId, source_plan_id: input.sourcePlanId };
    const result = await db.from('website_templates').insert(row).select(PUBLIC_COLUMNS + SOURCE_COLUMNS).single();
    if (result.error || !result.data)
        throw new Error('template_create_failed');
    return card(result.data as unknown as Record<string, unknown>, true);
}
export async function updateWebsiteTemplate(db: SupabaseClient, id: string, revision: string, patch: {
    name: string;
    category: string;
    status: string;
    sortOrder: number;
    reviewed?: boolean;
}) {
    if (!patch.name.trim() || patch.name.length > 100 || !WEBSITE_TEMPLATE_CATEGORIES.includes(patch.category as never) || !['draft', 'published'].includes(patch.status) || !Number.isInteger(patch.sortOrder) || Math.abs(patch.sortOrder) > 10000)
        throw new Error('invalid_template_metadata');
    if (patch.status === 'published' && patch.reviewed !== true)
        throw new Error('template_review_required');
    const result = await db.from('website_templates').update({ name: patch.name.trim(), category: patch.category, status: patch.status, sort_order: patch.sortOrder, revision: randomUUID(), updated_at: new Date().toISOString() }).eq('id', id).eq('revision', revision).select(PUBLIC_COLUMNS + SOURCE_COLUMNS).maybeSingle();
    if (result.error)
        throw new Error('template_update_failed');
    if (!result.data)
        throw new Error('template_revision_conflict');
    return card(result.data as unknown as Record<string, unknown>, true);
}
export async function replaceWebsiteTemplateDesign(db: SupabaseClient, id: string, revision: string, design: WebsiteTemplateDesign) {
    validateWebsiteTemplateDesign(design);
    const result = await db.from('website_templates').update({
        design: structuredClone(design), status: 'draft', revision: randomUUID(), updated_at: new Date().toISOString(),
        cover_image_url: getWebsiteTemplateCover(design), desktop_page_count: design.desktop.length, mobile_page_count: design.mobile.length,
    }).eq('id', id).eq('revision', revision).select(PUBLIC_COLUMNS + SOURCE_COLUMNS).maybeSingle();
    if (result.error)
        throw new Error('template_update_failed');
    if (!result.data)
        throw new Error('template_revision_conflict');
    return card(result.data as unknown as Record<string, unknown>, true);
}
