"use client";
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getBackgroundStyle } from '@/components/blocks/backgroundStyle';
import type { WebsiteTemplate } from '@/lib/websiteTemplateLibrary';
import { supabase } from '@/lib/supabase';
const Blocks = dynamic(() => import('@/components/blocks/BlockRenderer'), { ssr: false });
/** Standalone read-only viewport. Existing admin anti-framing protections remain unchanged. */
export default function WebsiteTemplatePreview({ id, revision, mobile, admin = false }: {
    id: string;
    revision: string;
    mobile: boolean;
    admin?: boolean;
}) {
    const [template, setTemplate] = useState<WebsiteTemplate | null>(null);
    const [pageId, setPageId] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const headers=new Headers();
                if (!admin) {
                    const current=await supabase.auth.getSession().catch(()=>null);
                    const accessToken=current?.data.session?.access_token;
                    if (accessToken) headers.set('x-merchant-access-token',accessToken);
                }
                if (controller.signal.aborted) return;
                const response = await fetch((admin ? '/api/super-admin/website-templates' : '/api/website-templates') + '?id=' + encodeURIComponent(id), { headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
                if (response.status===401) throw Error('当前登录状态已失效，请返回编辑器重新登录后预览。');
                if (!response.ok)
                    throw Error('模板暂不可用，请返回模板库重新选择。');
                const body = await response.json() as {
                    template: WebsiteTemplate;
                };
                if (body.template.revision !== revision)
                    throw Error('模板已更新，请返回模板库重新预览。');
                if (!controller.signal.aborted) {
                    setTemplate(body.template);
                    setPageId(body.template.design[mobile ? 'mobile' : 'desktop'][0].id);
                }
            }
            catch (e) {
                if (!controller.signal.aborted)
                    setError(e instanceof Error ? e.message : '预览读取失败。');
            }
        }
        void load();
        return () => controller.abort();
    }, [id, revision, mobile, admin]);
    if (error)
        return <div role="alert" className="p-6 text-sm text-rose-800">{error}</div>;
    if (!template)
        return <div role="status" className="p-6 text-sm text-slate-500">正在读取只读预览…</div>;
    const pages = template.design[mobile ? 'mobile' : 'desktop'];
    const page = pages.find(p => p.id === pageId) ?? pages[0];
    const props = page.blocks[0]?.props;
    return <div onSubmitCapture={event => event.preventDefault()}>
  <header className="sticky top-0 z-[2147482000] flex flex-wrap items-center justify-between gap-2 border-b bg-white/95 px-4 py-3 text-xs text-slate-600"><span>{mobile ? '手机端' : '电脑端'} · 只读预览</span><select aria-label="预览页面" value={page.id} onChange={e => setPageId(e.target.value)} className="max-w-[70%] rounded-lg border bg-white px-2 py-1.5">{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></header>
  <main className={mobile ? 'editor-mobile-preview min-h-screen' : 'min-h-screen'} style={getBackgroundStyle({ color: props?.pageBgColor ?? '#fff', imageUrl: props?.pageBgImageUrl, fillMode: props?.pageBgFillMode, position: props?.pageBgPosition, imageOpacity: props?.pageBgImageOpacity, colorOpacity: props?.pageBgColorOpacity })}>
   <Blocks blocks={page.blocks} currentPageId={page.id} availablePages={pages.map(p => ({ id: p.id, name: p.name }))} onNavigatePage={setPageId} forceMobileViewport={mobile} bookingInteractive={false} productCartEnabled={false}/>
  </main>
 </div>;
}
