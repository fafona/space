import { websiteTemplateGet } from '@/lib/websiteTemplateRoutes.server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Deliberately read-only: no merchant POST/PATCH/DELETE export and no service credentials in client code.
export function GET(request: Request) { return websiteTemplateGet(request); }
