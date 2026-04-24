import Link from "next/link";
import { loadPublicPersonalProfileByAccountId } from "@/lib/publicPersonalProfile";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function buildLocationLabel(input: {
  country?: string;
  province?: string;
  city?: string;
  address?: string;
}) {
  return [input.country, input.province, input.city, input.address].filter(Boolean).join(" / ");
}

function getInitialLabel(value: string) {
  const first = Array.from((value || "").trim())[0] ?? "F";
  return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
}

export default async function PersonalPublicPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const supabase = createServerSupabaseServiceClient();
  const profile = await loadPublicPersonalProfileByAccountId(supabase as never, accountId);

  if (!profile) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.35),_transparent_46%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-white/70 bg-white/90 px-8 py-12 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-400">Faolla Profile</div>
          <h1 className="mt-4 text-3xl font-semibold text-slate-900">用户不存在</h1>
          <p className="mt-3 text-sm leading-7 text-slate-500">这个个人主页暂时不可访问。</p>
          <div className="mt-8">
            <Link
              href="/"
              className="inline-flex items-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              返回 Faolla
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const locationLabel = buildLocationLabel(profile);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.35),_transparent_46%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-6 py-20">
      <div className="mx-auto max-w-4xl rounded-[36px] border border-white/70 bg-white/90 px-8 py-10 shadow-[0_28px_90px_rgba(15,23,42,0.1)] backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-400">Faolla Personal</div>
        <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-center">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[28px] bg-slate-900 text-3xl font-semibold text-white shadow-[0_18px_48px_rgba(15,23,42,0.16)]">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" />
            ) : (
              <span>{getInitialLabel(profile.displayName)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-4xl font-semibold tracking-tight text-slate-900">{profile.displayName}</h1>
            <div className="mt-3 text-sm font-medium text-slate-400">ID {profile.accountId}</div>
            {profile.signature ? <p className="mt-4 text-base leading-8 text-slate-600">{profile.signature}</p> : null}
            {locationLabel ? (
              <div className="mt-5 inline-flex max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
                <span className="truncate">{locationLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-10 rounded-[28px] border border-slate-200 bg-slate-50/90 p-6">
          <div className="text-lg font-semibold text-slate-900">Faolla 个人主页</div>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            这里是 Faolla 个人用户的公开主页入口。聊天里的联系卡短链会提供完整联系方式，这里只保留公开资料展示。
          </p>
        </div>
      </div>
    </main>
  );
}
