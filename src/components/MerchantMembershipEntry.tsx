"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  normalizeMerchantMembershipProfileDraft,
  type MerchantMembershipProfileDraft,
  type PersonalMembershipCard,
} from "@/lib/merchantMemberships";

type MerchantMembershipEntryProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type PersonalMembershipsPayload = {
  ok?: unknown;
  memberships?: PersonalMembershipCard[];
  profile?: Partial<MerchantMembershipProfileDraft> | null;
};

type MembershipMutationPayload = {
  ok?: unknown;
  membership?: PersonalMembershipCard;
  message?: unknown;
};

const EMPTY_MEMBER_PROFILE: MerchantMembershipProfileDraft = {
  name: "",
  phone: "",
  email: "",
  avatarUrl: "",
  birthday: "",
  gender: "",
  country: "",
  province: "",
  city: "",
  address: "",
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildPersonalLoginHref() {
  if (typeof window === "undefined") return "/login?accountType=personal";
  const loginFrom = window.location.href;
  return `/login?accountType=personal&loginFrom=${encodeURIComponent(loginFrom)}`;
}

function readPayloadMessage(value: unknown, fallback: string) {
  const message = trimText(value);
  return message || fallback;
}

export default function MerchantMembershipEntry({ siteId, siteName = "", className = "" }: MerchantMembershipEntryProps) {
  const [resolved, setResolved] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [membership, setMembership] = useState<PersonalMembershipCard | null>(null);
  const [personalProfile, setPersonalProfile] = useState<MerchantMembershipProfileDraft>(EMPTY_MEMBER_PROFILE);
  const [profileDraft, setProfileDraft] = useState<MerchantMembershipProfileDraft>(EMPTY_MEMBER_PROFILE);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const normalizedSiteId = siteId.trim();
  const joinable = /^\d{8}$/.test(normalizedSiteId);
  const active = membership?.status === "active";
  const buttonLabel = useMemo(() => {
    if (busy) return "处理中...";
    if (active) return "已是会员";
    if (membership?.status === "left") return "重新加入会员";
    return "加入会员";
  }, [active, busy, membership?.status]);

  useEffect(() => {
    if (!joinable) return;
    let cancelled = false;
    void fetch(`/api/personal-memberships?siteId=${encodeURIComponent(normalizedSiteId)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          setAuthenticated(false);
          setResolved(true);
          return;
        }
        const payload = (await response.json().catch(() => null)) as PersonalMembershipsPayload | null;
        const current = Array.isArray(payload?.memberships) ? payload.memberships[0] ?? null : null;
        const profile = normalizeMerchantMembershipProfileDraft(payload?.profile, EMPTY_MEMBER_PROFILE);
        setAuthenticated(true);
        setMembership(current);
        setPersonalProfile(profile);
        setProfileDraft(profile);
        setResolved(true);
      })
      .catch(() => {
        if (!cancelled) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [joinable, normalizedSiteId]);

  function updateProfileDraft(field: keyof MerchantMembershipProfileDraft, value: string) {
    setProfileDraft((current) => ({ ...current, [field]: value }));
  }

  function handleInputChange(field: keyof MerchantMembershipProfileDraft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      updateProfileDraft(field, event.target.value);
    };
  }

  function openJoinDialog() {
    if (!joinable || busy || active) return;
    if (authenticated === false) {
      window.location.assign(buildPersonalLoginHref());
      return;
    }
    setMessage("");
    setProfileDraft(personalProfile);
    setDialogOpen(true);
  }

  async function handleJoin() {
    if (!joinable || busy || active) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/memberships", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          siteId: normalizedSiteId,
          siteName,
          profile: profileDraft,
        }),
      });
      if (response.status === 401) {
        window.location.assign(buildPersonalLoginHref());
        return;
      }
      const payload = (await response.json().catch(() => null)) as MembershipMutationPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.membership) {
        throw new Error(readPayloadMessage(payload?.message, "加入会员失败，请稍后重试"));
      }
      setMembership(payload.membership);
      setPersonalProfile(profileDraft);
      setDialogOpen(false);
      setMessage("已加入会员");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入会员失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  if (!joinable || !resolved) return null;

  return (
    <div className={className}>
      <button
        type="button"
        className={`inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur transition disabled:cursor-default ${
          active
            ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
            : "border-slate-200/80 bg-white/90 text-slate-900 hover:bg-white"
        }`}
        onClick={() => {
          openJoinDialog();
        }}
        disabled={busy || active}
      >
        {buttonLabel}
      </button>
      {message && !active ? (
        <div className="mt-2 max-w-[220px] rounded-xl bg-slate-950/85 px-3 py-2 text-xs font-medium text-white shadow-lg">
          {message}
        </div>
      ) : null}
      {dialogOpen ? (
        <div className="fixed inset-0 z-[2147483200] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
          <form
            className="w-full max-w-xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
            onSubmit={(event) => {
              event.preventDefault();
              void handleJoin();
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-lg font-semibold text-slate-950">加入会员</div>
                <div className="mt-1 text-sm text-slate-500">{siteName || normalizedSiteId}</div>
              </div>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setDialogOpen(false)}
                disabled={busy}
              >
                关闭
              </button>
            </div>
            <div className="max-h-[72vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  姓名
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.name}
                    onChange={handleInputChange("name")}
                    autoComplete="name"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  手机
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.phone}
                    onChange={handleInputChange("phone")}
                    autoComplete="tel"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  邮箱
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.email}
                    onChange={handleInputChange("email")}
                    autoComplete="email"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  生日
                  <input
                    type="date"
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.birthday}
                    onChange={handleInputChange("birthday")}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  性别
                  <select
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.gender}
                    onChange={handleInputChange("gender")}
                  >
                    <option value="">未填写</option>
                    <option value="male">男</option>
                    <option value="female">女</option>
                    <option value="other">其他</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  国家
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.country}
                    onChange={handleInputChange("country")}
                    autoComplete="country-name"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  省
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.province}
                    onChange={handleInputChange("province")}
                    autoComplete="address-level1"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  市
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.city}
                    onChange={handleInputChange("city")}
                    autoComplete="address-level2"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  地址
                  <textarea
                    className="mt-1 min-h-20 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900"
                    value={profileDraft.address}
                    onChange={handleInputChange("address")}
                    autoComplete="street-address"
                  />
                </label>
              </div>
              {message ? (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setDialogOpen(false)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
              >
                {busy ? "保存中..." : "确认加入"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
