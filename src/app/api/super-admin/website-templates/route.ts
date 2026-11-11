import { websiteTemplateGet, websiteTemplatePost } from '@/lib/websiteTemplateRoutes.server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export function GET(request: Request) { return websiteTemplateGet(request, true); }
export function POST(request: Request) { return websiteTemplatePost(request); }
