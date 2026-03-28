import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage(props: AdminPageProps) {
  const resolvedSearchParams = props.searchParams ? await props.searchParams : undefined;
  const rawScope = resolvedSearchParams?.scope;
  const forcedScope = Array.isArray(rawScope) ? rawScope[0] : rawScope;
  const scopedSiteId =
    typeof forcedScope === "string" && forcedScope.startsWith("site-")
      ? forcedScope.slice("site-".length).trim()
      : "";
  if (isMerchantNumericId(scopedSiteId)) {
    const params = new URLSearchParams();
    Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
      if (key === "scope") return;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === "string") params.append(key, item);
        });
        return;
      }
      if (typeof value === "string") {
        params.set(key, value);
      }
    });
    const targetHref = buildMerchantBackendHref(scopedSiteId);
    redirect(params.size > 0 ? `${targetHref}?${params.toString()}` : targetHref);
  }
  return <AdminClient forcedScope={typeof forcedScope === "string" ? forcedScope : undefined} />;
}
