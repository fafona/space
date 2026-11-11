import WebsiteTemplatePreview from '@/components/admin/WebsiteTemplatePreview';
export const dynamic = 'force-dynamic';
export const metadata = { title: '网站模板预览', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const p = await searchParams;
    return <WebsiteTemplatePreview id={typeof p.id === 'string' ? p.id : ''} revision={typeof p.revision === 'string' ? p.revision : ''} mobile={p.viewport === 'mobile'}/>;
}
