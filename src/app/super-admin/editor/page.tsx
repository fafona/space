import { redirect } from "next/navigation";
import SuperAdminEditorClient from "./SuperAdminEditorClient";
import { SUPER_ADMIN_EDITOR_BUILD_TOKEN } from "./buildToken";

export const dynamic = "force-dynamic";

type SuperAdminEditorPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SuperAdminEditorPage(props: SuperAdminEditorPageProps) {
  const resolvedSearchParams = props.searchParams ? await props.searchParams : undefined;
  const rawBuild = resolvedSearchParams?.build;
  const build = Array.isArray(rawBuild) ? rawBuild[0] : rawBuild;

  if (build !== SUPER_ADMIN_EDITOR_BUILD_TOKEN) {
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
    nextSearchParams.set("build", SUPER_ADMIN_EDITOR_BUILD_TOKEN);
    redirect(`/super-admin/editor?${nextSearchParams.toString()}`);
  }

  return (
    <>
      <span
        className="sr-only"
        data-super-admin-editor-ssr-build={SUPER_ADMIN_EDITOR_BUILD_TOKEN}
      >
        SUPER-ADMIN-EDITOR-SSR-{SUPER_ADMIN_EDITOR_BUILD_TOKEN}
      </span>
      <SuperAdminEditorClient />
    </>
  );
}
