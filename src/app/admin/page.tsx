import AdminClient from "./AdminClient";

type AdminPageProps = {
  searchParams?: Promise<{ scope?: string | string[] | undefined }>;
};

export default async function AdminPage(props: AdminPageProps) {
  const resolvedSearchParams = props.searchParams ? await props.searchParams : undefined;
  const rawScope = resolvedSearchParams?.scope;
  const forcedScope = Array.isArray(rawScope) ? rawScope[0] : rawScope;
  return <AdminClient forcedScope={typeof forcedScope === "string" ? forcedScope : undefined} />;
}
