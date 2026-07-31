import EnterprisePortalClient from "@/app/enterprise/[siteId]/EnterprisePortalClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EnterprisePortalPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  return <EnterprisePortalClient siteId={siteId} />;
}
