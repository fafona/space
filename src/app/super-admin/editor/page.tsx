import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SuperAdminEditorPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SuperAdminEditorPage(props: SuperAdminEditorPageProps) {
  const resolvedSearchParams = props.searchParams ? await props.searchParams : undefined;
  const nextSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams ?? {})) {
    if (key === "build" || value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        nextSearchParams.append(key, entry);
      }
    } else {
      nextSearchParams.set(key, value);
    }
  }
  const nextSearch = nextSearchParams.toString();
  redirect(`/super-admin/editor/latest${nextSearch ? `?${nextSearch}` : ""}`);
}
