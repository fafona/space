"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MerchantMembershipListItem } from "@/lib/merchantMemberships";

type MerchantMemberManagerProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type MembershipsPayload = {
  ok?: unknown;
  memberships?: MerchantMembershipListItem[];
  message?: unknown;
};

type MemberStatusFilter = "all" | "active" | "left";

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function formatDateTime(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function statusLabel(status: MerchantMembershipListItem["status"]) {
  return status === "left" ? "已退会" : "会员中";
}

function statusBadgeClass(status: MerchantMembershipListItem["status"]) {
  return status === "left"
    ? "border-slate-200 bg-slate-100 text-slate-500"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function genderLabel(value: string | null | undefined) {
  if (value === "male") return "男";
  if (value === "female") return "女";
  if (value === "other") return "其他";
  return "-";
}

function joinLocation(...parts: Array<string | null | undefined>) {
  return parts.map((part) => trimText(part, 120)).filter(Boolean).join(" / ") || "-";
}

function formatBirthday(membership: MerchantMembershipListItem) {
  if (!membership.birthday) return "-";
  return membership.birthdayMonthDayOnly ? `${membership.birthday}（仅月日）` : membership.birthday;
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value) || fallback;
}

function getMemberDisplayName(membership: MerchantMembershipListItem) {
  if (!membership.profileVisible) return "已退会会员";
  return membership.nickname || membership.name || membership.email || membership.accountId || membership.memberNo;
}

function getAvatarInitial(membership: MerchantMembershipListItem) {
  return getMemberDisplayName(membership).slice(0, 1).toUpperCase() || "会";
}

function buildSearchText(membership: MerchantMembershipListItem) {
  const publicParts = [membership.memberNo, membership.status, membership.joinedAt, membership.leftAt];
  if (!membership.profileVisible) return publicParts.join(" ").toLowerCase();
  return [
    ...publicParts,
    membership.nickname,
    membership.name,
    membership.accountId,
    membership.email,
    membership.phone,
    membership.birthday,
    membership.gender,
    membership.country,
    membership.province,
    membership.city,
    membership.address,
    membership.taxName,
    membership.taxNumber,
    membership.taxCountry,
    membership.taxProvince,
    membership.taxCity,
    membership.taxAddress,
  ]
    .join(" ")
    .toLowerCase();
}

function ProfileField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string | number | null | undefined;
  className?: string;
}) {
  const text = trimText(value, 1000) || "-";
  return (
    <div className={`rounded-xl bg-slate-50 px-3 py-2 ${className}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-800">{text}</div>
    </div>
  );
}

export default function MerchantMemberManager({ siteId, siteName = "", className = "" }: MerchantMemberManagerProps) {
  const [memberships, setMemberships] = useState<MerchantMembershipListItem[]>([]);
  const [selectedMembershipId, setSelectedMembershipId] = useState("");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const normalizedSiteId = siteId.trim();

  const stats = useMemo(() => {
    const active = memberships.filter((membership) => membership.status === "active").length;
    const left = memberships.filter((membership) => membership.status === "left").length;
    return {
      active,
      left,
      total: memberships.length,
    };
  }, [memberships]);

  const filteredMemberships = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return memberships.filter((membership) => {
      if (statusFilter !== "all" && membership.status !== statusFilter) return false;
      if (!normalizedKeyword) return true;
      return buildSearchText(membership).includes(normalizedKeyword);
    });
  }, [keyword, memberships, statusFilter]);

  const selectedMembership = useMemo(() => {
    return (
      filteredMemberships.find((membership) => membership.id === selectedMembershipId) ??
      filteredMemberships[0] ??
      null
    );
  }, [filteredMemberships, selectedMembershipId]);

  const loadMemberships = useCallback(async () => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setMemberships([]);
      setSelectedMembershipId("");
      setLoadError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/memberships?siteId=${encodeURIComponent(normalizedSiteId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as MembershipsPayload | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(readPayloadMessage(payload?.message, "会员列表加载失败，请稍后重试"));
      }
      const nextMemberships = Array.isArray(payload.memberships) ? payload.memberships : [];
      setMemberships(nextMemberships);
      setSelectedMembershipId((current) => {
        if (current && nextMemberships.some((membership) => membership.id === current)) return current;
        return nextMemberships[0]?.id ?? "";
      });
    } catch (error) {
      setMemberships([]);
      setSelectedMembershipId("");
      setLoadError(error instanceof Error ? error.message : "会员列表加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);

  useEffect(() => {
    if (!selectedMembership && filteredMemberships[0]) {
      setSelectedMembershipId(filteredMemberships[0].id);
    }
  }, [filteredMemberships, selectedMembership]);

  return (
    <section className={`space-y-4 ${className}`}>
      <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-950">会员管理</h1>
            <p className="mt-1 text-sm text-slate-500">
              {siteName || normalizedSiteId} · 加入会员的个人用户会在这里保留记录，退会后资料自动隐藏。
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void loadMemberships()}
            disabled={loading}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">全部会员</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{stats.total}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">会员中</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-700">{stats.active}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs text-slate-500">已退会</div>
            <div className="mt-1 text-2xl font-semibold text-slate-700">{stats.left}</div>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>
      ) : null}

      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">会员列表</h2>
            <p className="mt-1 text-sm text-slate-500">会员卡号按“商户 ID + 6 位流水号”生成。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded border bg-slate-50 px-3 py-2 text-sm text-slate-700">
              当前显示：{filteredMemberships.length}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="搜索昵称 / 姓名 / 手机 / 邮箱 / 会员卡号 / 地区"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="flex flex-wrap gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
            {[
              { key: "all", label: "全部" },
              { key: "active", label: "会员中" },
              { key: "left", label: "已退会" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  statusFilter === item.key ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setStatusFilter(item.key as MemberStatusFilter)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_420px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-[1060px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2">序号</th>
                    <th className="px-3 py-2">会员</th>
                    <th className="px-3 py-2">会员卡号</th>
                    <th className="px-3 py-2">个人用户 ID</th>
                    <th className="px-3 py-2">手机</th>
                    <th className="px-3 py-2">邮箱</th>
                    <th className="px-3 py-2">加入时间</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && memberships.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-500">
                        正在加载会员列表...
                      </td>
                    </tr>
                  ) : filteredMemberships.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-500">
                        {keyword.trim() || statusFilter !== "all"
                          ? "没有匹配的会员，请调整搜索或筛选条件。"
                          : "还没有会员。个人用户在商户首页加入会员后会显示在这里。"}
                      </td>
                    </tr>
                  ) : (
                    filteredMemberships.map((membership, index) => {
                      const selected = selectedMembership?.id === membership.id;
                      const displayName = getMemberDisplayName(membership);
                      return (
                        <tr key={membership.id} className={`border-t ${selected ? "bg-blue-50/40" : "hover:bg-slate-50/70"}`}>
                          <td className="px-3 py-2 text-xs text-slate-500">{index + 1}</td>
                          <td className="px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-xs font-semibold text-white">
                                {membership.profileVisible && membership.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={membership.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                                ) : (
                                  getAvatarInitial(membership)
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="max-w-[180px] truncate font-semibold text-slate-900">{displayName}</div>
                                <div className="text-xs text-slate-400">
                                  {membership.profileVisible ? membership.name || membership.nickname || "-" : "资料已隐藏"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700">{membership.memberNo}</td>
                          <td className="px-3 py-2 text-xs">{membership.profileVisible ? membership.accountId || "-" : "-"}</td>
                          <td className="px-3 py-2 text-xs">{membership.profileVisible ? membership.phone || "-" : "-"}</td>
                          <td className="px-3 py-2 text-xs">{membership.profileVisible ? membership.email || "-" : "-"}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(membership.joinedAt)}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded border px-2 py-0.5 text-xs ${statusBadgeClass(membership.status)}`}>
                              {statusLabel(membership.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50"
                              onClick={() => setSelectedMembershipId(membership.id)}
                            >
                              详情
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-4">
            {selectedMembership ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                        {selectedMembership.profileVisible && selectedMembership.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selectedMembership.avatarUrl}
                            alt={getMemberDisplayName(selectedMembership)}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          getAvatarInitial(selectedMembership)
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-slate-950">
                          {getMemberDisplayName(selectedMembership)}
                        </div>
                        <div className="mt-1 font-mono text-xs text-slate-500">{selectedMembership.memberNo}</div>
                      </div>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${statusBadgeClass(selectedMembership.status)}`}>
                    {statusLabel(selectedMembership.status)}
                  </span>
                </div>

                <div className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <ProfileField label="加入时间" value={formatDateTime(selectedMembership.joinedAt)} />
                  <ProfileField label="退会时间" value={selectedMembership.leftAt ? formatDateTime(selectedMembership.leftAt) : "-"} />
                </div>

                {selectedMembership.profileVisible ? (
                  <>
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-900">会员资料</div>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <ProfileField label="昵称" value={selectedMembership.nickname} />
                        <ProfileField label="姓名" value={selectedMembership.name} />
                        <ProfileField label="个人用户 ID" value={selectedMembership.accountId} />
                        <ProfileField label="手机" value={selectedMembership.phone} />
                        <ProfileField label="邮箱" value={selectedMembership.email} />
                        <ProfileField label="生日" value={formatBirthday(selectedMembership)} />
                        <ProfileField label="性别" value={genderLabel(selectedMembership.gender)} />
                        <ProfileField
                          label="地区"
                          value={joinLocation(selectedMembership.country, selectedMembership.province, selectedMembership.city)}
                        />
                        <ProfileField label="地址" value={selectedMembership.address} className="md:col-span-2 xl:col-span-1 2xl:col-span-2" />
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-900">税务信息</div>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <ProfileField label="税务名称" value={selectedMembership.taxName} />
                        <ProfileField label="税号" value={selectedMembership.taxNumber} />
                        <ProfileField
                          label="税务地区"
                          value={joinLocation(
                            selectedMembership.taxCountry,
                            selectedMembership.taxProvince,
                            selectedMembership.taxCity,
                          )}
                        />
                        <ProfileField label="税务详细地址" value={selectedMembership.taxAddress} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    此会员已退会。按规则保留会员记录，但不再展示个人资料。
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
                请选择左侧会员查看详情。
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
