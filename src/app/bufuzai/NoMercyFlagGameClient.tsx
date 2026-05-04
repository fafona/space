"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NoMercyFlagIcon from "@/components/NoMercyFlagIcon";

type Country = {
  code: string;
  name: string;
  region: "europe" | "priority" | "world";
};

type FlagTile = {
  id: string;
  countryCode: string;
  x: number;
  y: number;
  z: number;
  removed: boolean;
};

type TrayTile = {
  id: string;
  countryCode: string;
};

type GameStatus = "playing" | "won" | "failed";
type TileSkin = "classic" | "passport" | "night";

type ProfileState = {
  level: number;
  xp: number;
  coins: number;
  hints: number;
  shuffles: number;
  undos: number;
  clears: number;
  skin: TileSkin;
  unlockedSkins: TileSkin[];
  guild: string;
  bestLevel: number;
  wins: number;
};

type NoMercyFlagGameClientProps = {
  subtitle?: string;
  lobbyHref?: string;
};

const STORAGE_KEY = "faolla:bufuzai-flag-game:v1";
const BOARD_COLS = 8;
const BOARD_ROWS = 8;
const MAX_TRAY = 7;
const SKIN_LABELS: Record<TileSkin, string> = {
  classic: "经典白牌",
  passport: "护照蓝牌",
  night: "夜航黑牌",
};

const countries: Country[] = [
  { code: "es", name: "西班牙", region: "europe" },
  { code: "fr", name: "法国", region: "europe" },
  { code: "de", name: "德国", region: "europe" },
  { code: "it", name: "意大利", region: "europe" },
  { code: "pt", name: "葡萄牙", region: "europe" },
  { code: "nl", name: "荷兰", region: "europe" },
  { code: "be", name: "比利时", region: "europe" },
  { code: "at", name: "奥地利", region: "europe" },
  { code: "ch", name: "瑞士", region: "europe" },
  { code: "se", name: "瑞典", region: "europe" },
  { code: "no", name: "挪威", region: "europe" },
  { code: "dk", name: "丹麦", region: "europe" },
  { code: "fi", name: "芬兰", region: "europe" },
  { code: "ie", name: "爱尔兰", region: "europe" },
  { code: "pl", name: "波兰", region: "europe" },
  { code: "cz", name: "捷克", region: "europe" },
  { code: "gr", name: "希腊", region: "europe" },
  { code: "hu", name: "匈牙利", region: "europe" },
  { code: "ro", name: "罗马尼亚", region: "europe" },
  { code: "hr", name: "克罗地亚", region: "europe" },
  { code: "si", name: "斯洛文尼亚", region: "europe" },
  { code: "sk", name: "斯洛伐克", region: "europe" },
  { code: "ee", name: "爱沙尼亚", region: "europe" },
  { code: "lv", name: "拉脱维亚", region: "europe" },
  { code: "lt", name: "立陶宛", region: "europe" },
  { code: "gb", name: "英国", region: "europe" },
  { code: "ua", name: "乌克兰", region: "europe" },
  { code: "us", name: "美国", region: "priority" },
  { code: "ca", name: "加拿大", region: "priority" },
  { code: "cn", name: "中国", region: "priority" },
  { code: "jp", name: "日本", region: "priority" },
  { code: "kr", name: "韩国", region: "priority" },
  { code: "au", name: "澳大利亚", region: "priority" },
  { code: "br", name: "巴西", region: "priority" },
  { code: "sg", name: "新加坡", region: "priority" },
  { code: "my", name: "马来西亚", region: "priority" },
  { code: "ar", name: "阿根廷", region: "priority" },
  { code: "mx", name: "墨西哥", region: "world" },
  { code: "cl", name: "智利", region: "world" },
  { code: "co", name: "哥伦比亚", region: "world" },
  { code: "pe", name: "秘鲁", region: "world" },
  { code: "in", name: "印度", region: "world" },
  { code: "th", name: "泰国", region: "world" },
  { code: "vn", name: "越南", region: "world" },
  { code: "id", name: "印度尼西亚", region: "world" },
  { code: "ph", name: "菲律宾", region: "world" },
  { code: "nz", name: "新西兰", region: "world" },
  { code: "za", name: "南非", region: "world" },
  { code: "eg", name: "埃及", region: "world" },
  { code: "tr", name: "土耳其", region: "world" },
  { code: "ma", name: "摩洛哥", region: "world" },
  { code: "ae", name: "阿联酋", region: "world" },
];

const defaultProfile: ProfileState = {
  level: 1,
  xp: 0,
  coins: 680,
  hints: 3,
  shuffles: 2,
  undos: 2,
  clears: 1,
  skin: "classic",
  unlockedSkins: ["classic"],
  guild: "欧陆冲锋队",
  bestLevel: 1,
  wins: 0,
};

function createRng(seed: number) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function shuffleWithSeed<T>(items: T[], seed: number) {
  const rng = createRng(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function countryByCode(code: string) {
  return countries.find((country) => country.code === code) ?? countries[0];
}

function buildLevelTiles(level: number, reroll = 0): FlagTile[] {
  const seed = level * 911 + reroll * 1013;
  const rng = createRng(seed);
  const groupCount = Math.min(10 + level * 2, 24);
  const preferred = countries.filter((country) => country.region !== "world");
  const pool = level <= 6 ? preferred : countries;
  const selected = shuffleWithSeed(pool, seed).slice(0, groupCount);
  const codes = shuffleWithSeed(
    selected.flatMap((country) => [country.code, country.code, country.code]),
    seed + 37,
  );

  const slots: Array<{ x: number; y: number; z: number }> = [];
  for (let z = 0; z < 5; z += 1) {
    for (let y = 0; y < BOARD_ROWS; y += 1) {
      for (let x = 0; x < BOARD_COLS; x += 1) {
        const edge = x === 0 || y === 0 || x === BOARD_COLS - 1 || y === BOARD_ROWS - 1;
        const threshold = Math.max(0.18, 0.72 - z * 0.12 - (edge ? 0.1 : 0));
        if (rng() < threshold) {
          slots.push({
            x: x + (z % 2) * 0.28,
            y: y + ((z + 1) % 2) * 0.2,
            z,
          });
        }
      }
    }
  }

  const shuffledSlots = shuffleWithSeed(slots, seed + 71).slice(0, codes.length);
  return shuffledSlots.map((slot, index) => ({
    id: `L${level}-${reroll}-${index}`,
    countryCode: codes[index],
    x: slot.x,
    y: slot.y,
    z: slot.z,
    removed: false,
  }));
}

function isTileOpen(tile: FlagTile, tiles: FlagTile[], tray: TrayTile[]) {
  if (tile.removed || tray.some((item) => item.id === tile.id)) return false;
  return !tiles.some(
    (other) =>
      !other.removed &&
      other.id !== tile.id &&
      other.z > tile.z &&
      !tray.some((item) => item.id === other.id) &&
      Math.abs(other.x - tile.x) < 1.12 &&
      Math.abs(other.y - tile.y) < 1.05,
  );
}

function readStoredProfile(): ProfileState {
  if (typeof window === "undefined") return defaultProfile;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "") as Partial<ProfileState>;
    const unlockedSkins: TileSkin[] = Array.isArray(parsed.unlockedSkins)
      ? parsed.unlockedSkins.filter((item): item is TileSkin => item === "classic" || item === "passport" || item === "night")
      : ["classic"];
    const skin: TileSkin = parsed.skin === "passport" || parsed.skin === "night" ? parsed.skin : "classic";
    return {
      ...defaultProfile,
      ...parsed,
      level: Math.max(1, Math.min(99, Number(parsed.level) || 1)),
      xp: Math.max(0, Number(parsed.xp) || 0),
      coins: Math.max(0, Number(parsed.coins) || 0),
      hints: Math.max(0, Number(parsed.hints) || 0),
      shuffles: Math.max(0, Number(parsed.shuffles) || 0),
      undos: Math.max(0, Number(parsed.undos) || 0),
      clears: Math.max(0, Number(parsed.clears) || 0),
      unlockedSkins: unlockedSkins.length > 0 ? unlockedSkins : (["classic"] as TileSkin[]),
      skin,
      guild: typeof parsed.guild === "string" && parsed.guild.trim() ? parsed.guild : defaultProfile.guild,
      bestLevel: Math.max(1, Number(parsed.bestLevel) || 1),
      wins: Math.max(0, Number(parsed.wins) || 0),
    };
  } catch {
    return defaultProfile;
  }
}

function countByCode(items: Array<{ countryCode: string }>) {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(item.countryCode, (counts.get(item.countryCode) ?? 0) + 1));
  return counts;
}

function getAdvice(tray: TrayTile[], openTiles: FlagTile[], remaining: number) {
  const trayCounts = countByCode(tray);
  const openCounts = countByCode(openTiles);
  const pair = [...trayCounts.entries()].find(([code, count]) => count === 2 && (openCounts.get(code) ?? 0) > 0);
  if (pair) return `优先点 ${countryByCode(pair[0]).name}，可以立即清槽。`;
  const bridge = [...trayCounts.entries()].find(([code, count]) => count === 1 && (openCounts.get(code) ?? 0) >= 2);
  if (bridge) return `${countryByCode(bridge[0]).name} 已在槽内，先凑这一组。`;
  if (tray.length >= 5) return "槽位偏紧，先用提示或整理槽降低风险。";
  if (remaining < 12) return "快结束了，优先拿已露出的同国旗。";
  return "先拿上层牌，别让槽里同时出现太多国家。";
}

function findHintTile(tray: TrayTile[], openTiles: FlagTile[]) {
  const trayCounts = countByCode(tray);
  const openCounts = countByCode(openTiles);
  const completingCode = [...trayCounts.entries()].find(([code, count]) => count === 2 && (openCounts.get(code) ?? 0) > 0)?.[0];
  if (completingCode) return openTiles.find((tile) => tile.countryCode === completingCode) ?? null;
  const pairCode = [...trayCounts.entries()].find(([code, count]) => count === 1 && (openCounts.get(code) ?? 0) >= 2)?.[0];
  if (pairCode) return openTiles.find((tile) => tile.countryCode === pairCode) ?? null;
  return [...openTiles].sort((a, b) => b.z - a.z)[0] ?? null;
}

export default function NoMercyFlagGameClient({ subtitle = "游戏大厅", lobbyHref = "/game-lobby" }: NoMercyFlagGameClientProps) {
  const [profile, setProfile] = useState<ProfileState>(defaultProfile);
  const [tiles, setTiles] = useState<FlagTile[]>(() => buildLevelTiles(1));
  const [tray, setTray] = useState<TrayTile[]>([]);
  const [status, setStatus] = useState<GameStatus>("playing");
  const [reroll, setReroll] = useState(0);
  const [hintId, setHintId] = useState("");
  const [message, setMessage] = useState("点击未被压住的国旗，槽内三张相同会自动消除。");
  const [challengeCode, setChallengeCode] = useState("FLAG-0827");
  const [shareCopied, setShareCopied] = useState(false);
  const hintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const storedProfile = readStoredProfile();
    setProfile(storedProfile);
    setTiles(buildLevelTiles(storedProfile.level));
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }
  }, [profile]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    };
  }, []);

  const activeTiles = useMemo(() => tiles.filter((tile) => !tile.removed && !tray.some((item) => item.id === tile.id)), [tiles, tray]);
  const openTiles = useMemo(() => activeTiles.filter((tile) => isTileOpen(tile, tiles, tray)), [activeTiles, tiles, tray]);
  const remaining = activeTiles.length + tray.length;
  const progress = tiles.length > 0 ? Math.round(((tiles.length - remaining) / tiles.length) * 100) : 0;
  const advice = getAdvice(tray, openTiles, remaining);
  const xpTarget = 180 + profile.level * 30;
  const trayLimit = profile.level >= 5 ? MAX_TRAY + 1 : MAX_TRAY;

  const startLevel = useCallback((nextLevel: number, nextReroll = 0) => {
    const normalizedLevel = Math.max(1, nextLevel);
    setTiles(buildLevelTiles(normalizedLevel, nextReroll));
    setTray([]);
    setStatus("playing");
    setHintId("");
    setMessage(`第 ${normalizedLevel} 关开始，先观察上层可点国旗。`);
  }, []);

  const unlockProgress = useCallback((rewardXp: number, rewardCoins: number) => {
    setProfile((current) => {
      let nextXp = current.xp + rewardXp;
      const target = 180 + current.level * 30;
      const bonusUnlocked = nextXp >= target;
      if (bonusUnlocked) {
        nextXp -= target;
      }
      return {
        ...current,
        xp: nextXp,
        coins: current.coins + rewardCoins,
        bestLevel: Math.max(current.bestLevel, current.level),
        wins: current.wins + 1,
        hints: current.hints + (bonusUnlocked ? 1 : 0),
        shuffles: current.shuffles + (bonusUnlocked && current.wins % 2 === 1 ? 1 : 0),
        undos: current.undos + (bonusUnlocked ? 1 : 0),
      };
    });
  }, []);

  const selectTile = useCallback(
    (tile: FlagTile) => {
      if (status !== "playing") return;
      if (!isTileOpen(tile, tiles, tray)) {
        setMessage("这张被上层压住了，先拆掉覆盖它的国旗。");
        return;
      }
      const nextTray = [...tray, { id: tile.id, countryCode: tile.countryCode }];
      const same = nextTray.filter((item) => item.countryCode === tile.countryCode);
      if (same.length >= 3) {
        const removedIds = new Set(same.slice(0, 3).map((item) => item.id));
        setTray(nextTray.filter((item) => !removedIds.has(item.id)));
        setTiles((current) => current.map((item) => (removedIds.has(item.id) ? { ...item, removed: true } : item)));
        setMessage(`${countryByCode(tile.countryCode).name} 三连消除。`);
        return;
      }
      if (nextTray.length >= trayLimit) {
        setTray(nextTray);
        setStatus("failed");
        setMessage("槽位满了，但可以广告复活或用整理槽再试。");
        return;
      }
      setTray(nextTray);
      setMessage(`已放入 ${countryByCode(tile.countryCode).name}。`);
    },
    [status, tiles, tray, trayLimit],
  );

  useEffect(() => {
    if (status !== "playing") return;
    if (activeTiles.length === 0 && tray.length === 0) {
      unlockProgress(80 + profile.level * 12, 120 + profile.level * 16);
      setStatus("won");
      setMessage(`第 ${profile.level} 关通关，解锁下一轮再试。`);
    }
  }, [activeTiles.length, profile.level, status, tray.length, unlockProgress]);

  const useHint = useCallback(() => {
    if (profile.hints <= 0 || status !== "playing") return;
    const target = findHintTile(tray, openTiles);
    if (!target) {
      setMessage("当前没有可点国旗，使用洗牌或撤回。");
      return;
    }
    setProfile((current) => ({ ...current, hints: Math.max(0, current.hints - 1) }));
    setHintId(target.id);
    setMessage(`建议先点 ${countryByCode(target.countryCode).name}。`);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHintId(""), 1800);
  }, [openTiles, profile.hints, status, tray]);

  const useUndo = useCallback(() => {
    if (profile.undos <= 0 || tray.length === 0 || status !== "playing") return;
    const last = tray[tray.length - 1];
    setProfile((current) => ({ ...current, undos: Math.max(0, current.undos - 1) }));
    setTray((current) => current.slice(0, -1));
    setTiles((current) => current.map((tile) => (tile.id === last.id ? { ...tile, removed: false } : tile)));
    setMessage("已撤回最后一步。");
  }, [profile.undos, status, tray]);

  const useShuffle = useCallback(() => {
    if (profile.shuffles <= 0 || status !== "playing") return;
    const activeIds = new Set(activeTiles.map((tile) => tile.id));
    const shuffledCodes = shuffleWithSeed(
      activeTiles.map((tile) => tile.countryCode),
      Date.now(),
    );
    let index = 0;
    setProfile((current) => ({ ...current, shuffles: Math.max(0, current.shuffles - 1) }));
    setTiles((current) =>
      current.map((tile) => (activeIds.has(tile.id) ? { ...tile, countryCode: shuffledCodes[index++] } : tile)),
    );
    setMessage("剩余国旗已重新洗牌。");
  }, [activeTiles, profile.shuffles, status]);

  const useClearTray = useCallback(() => {
    if (profile.clears <= 0 || tray.length === 0) return;
    const returning = tray.slice(0, Math.min(3, tray.length));
    const returningIds = new Set(returning.map((item) => item.id));
    setProfile((current) => ({ ...current, clears: Math.max(0, current.clears - 1) }));
    setTray((current) => current.filter((item) => !returningIds.has(item.id)));
    setTiles((current) => current.map((tile) => (returningIds.has(tile.id) ? { ...tile, removed: false } : tile)));
    setStatus("playing");
    setMessage("整理槽已腾出空间。");
  }, [profile.clears, tray]);

  const reviveByAd = useCallback(() => {
    const returningIds = new Set(tray.map((item) => item.id));
    setTray([]);
    setTiles((current) => current.map((tile) => (returningIds.has(tile.id) ? { ...tile, removed: false } : tile)));
    setProfile((current) => ({ ...current, coins: current.coins + 30 }));
    setStatus("playing");
    setMessage("广告复活完成，槽位已清空。");
  }, [tray]);

  const buyItem = useCallback((kind: "hints" | "shuffles" | "undos" | "clears", cost: number) => {
    setProfile((current) => {
      if (current.coins < cost) return current;
      return { ...current, coins: current.coins - cost, [kind]: current[kind] + 1 };
    });
  }, []);

  const buySkin = useCallback((skin: TileSkin, cost: number) => {
    setProfile((current) => {
      if (current.unlockedSkins.includes(skin)) return { ...current, skin };
      if (current.coins < cost) return current;
      return { ...current, coins: current.coins - cost, skin, unlockedSkins: [...current.unlockedSkins, skin] };
    });
  }, []);

  const nextLevel = useCallback(() => {
    setProfile((current) => ({ ...current, bestLevel: Math.max(current.bestLevel, current.level + 1), level: current.level + 1 }));
    startLevel(profile.level + 1, reroll);
  }, [profile.level, reroll, startLevel]);

  const restart = useCallback(() => {
    const nextReroll = reroll + 1;
    setReroll(nextReroll);
    startLevel(profile.level, nextReroll);
  }, [profile.level, reroll, startLevel]);

  const share = useCallback(async () => {
    const text = `不服再试｜第 ${profile.level} 关｜进度 ${progress}%｜公会 ${profile.guild}`;
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1400);
    } catch {
      setShareCopied(false);
    }
  }, [profile.guild, profile.level, progress]);

  const returnToLobby = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.assign(new URL(lobbyHref, window.location.origin).toString());
  }, [lobbyHref]);

  const skinClass =
    profile.skin === "night"
      ? "border-slate-600 bg-slate-950 text-white"
      : profile.skin === "passport"
        ? "border-sky-300 bg-sky-50 text-slate-950"
        : "border-slate-200 bg-white text-slate-950";

  return (
    <main className="min-h-screen bg-[#eef3ef] px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] text-slate-950">
      <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid gap-3">
          <header className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-teal-700 text-white">
                <NoMercyFlagIcon />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-black">不服再试</h1>
                <div className="truncate text-xs text-slate-500">{subtitle}</div>
              </div>
            </div>
            <button type="button" className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 active:scale-95" onClick={returnToLobby}>
              返回大厅
            </button>
          </header>

          <section className="rounded-[22px] border border-slate-200 bg-white p-3 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="grid grid-cols-4 gap-2 text-center text-xs font-bold text-slate-500">
              <div className="rounded-2xl bg-slate-50 px-2 py-2">
                <div>关卡</div>
                <div className="mt-1 text-lg font-black text-slate-950">{profile.level}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-2 py-2">
                <div>进度</div>
                <div className="mt-1 text-lg font-black text-teal-700">{progress}%</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-2 py-2">
                <div>金币</div>
                <div className="mt-1 text-lg font-black text-amber-600">{profile.coins}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-2 py-2">
                <div>槽位</div>
                <div className="mt-1 text-lg font-black text-slate-950">{tray.length}/{trayLimit}</div>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${progress}%` }} />
            </div>
          </section>

          <section className="relative min-h-[430px] overflow-hidden rounded-[22px] border border-slate-200 bg-[radial-gradient(circle_at_50%_20%,#ffffff,#dce9e1)] p-3 shadow-inner sm:min-h-[540px]">
            <div className="absolute left-3 top-3 z-20 rounded-full bg-white/85 px-3 py-1 text-xs font-bold text-slate-600 shadow-sm">
              可点 {openTiles.length} 张 · 剩余 {remaining} 张
            </div>
            {tiles.map((tile) => {
              if (tile.removed || tray.some((item) => item.id === tile.id)) return null;
              const country = countryByCode(tile.countryCode);
              const open = isTileOpen(tile, tiles, tray);
              return (
                <button
                  key={tile.id}
                  type="button"
                  className={`absolute flex h-[42px] w-[58px] touch-manipulation flex-col items-center justify-center rounded-xl border shadow-[0_8px_18px_rgba(15,23,42,0.16)] transition sm:h-[58px] sm:w-[78px] ${
                    open ? `${skinClass} active:scale-95` : "border-slate-300 bg-slate-200 text-slate-400"
                  } ${hintId === tile.id ? "ring-4 ring-amber-300" : ""}`}
                  style={{
                    left: `${4 + (tile.x / (BOARD_COLS - 1)) * 84}%`,
                    top: `${8 + (tile.y / (BOARD_ROWS - 1)) * 76}%`,
                    zIndex: 10 + tile.z,
                    transform: `translate(-50%, -50%) translate(${tile.z * 4}px, ${tile.z * -3}px)`,
                  }}
                  onClick={() => selectTile(tile)}
                >
                  <img className={`h-5 w-8 rounded object-cover sm:h-7 sm:w-11 ${open ? "" : "grayscale"}`} src={`https://flagcdn.com/w80/${country.code}.png`} alt={`${country.name}国旗`} draggable={false} />
                  <span className="mt-0.5 max-w-full truncate px-1 text-[10px] font-black sm:text-xs">{country.name}</span>
                </button>
              );
            })}
            {status !== "playing" ? (
              <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950/60 p-4">
                <div className="w-full max-w-sm rounded-[24px] bg-white p-4 text-center shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
                  <div className="text-2xl font-black">{status === "won" ? "通关" : "还差一点"}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">{message}</div>
                  <div className="mt-4 grid gap-2">
                    {status === "won" ? (
                      <button type="button" className="rounded-2xl bg-teal-700 px-4 py-3 text-sm font-black text-white active:scale-95" onClick={nextLevel}>
                        下一关
                      </button>
                    ) : (
                      <button type="button" className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white active:scale-95" onClick={reviveByAd}>
                        广告复活
                      </button>
                    )}
                    <button type="button" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 active:scale-95" onClick={restart}>
                      不服再试
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-[22px] border border-slate-200 bg-white p-3 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black">收集槽</div>
              <div className="text-xs font-semibold text-slate-500">{message}</div>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1.5">
              {Array.from({ length: trayLimit }).map((_, index) => {
                const item = tray[index];
                const country = item ? countryByCode(item.countryCode) : null;
                return (
                  <div key={`tray-${index}`} className="grid h-[54px] place-items-center rounded-xl border border-slate-200 bg-slate-50 sm:h-[68px]">
                    {country ? (
                      <div className="flex flex-col items-center">
                        <img className="h-5 w-8 rounded object-cover sm:h-6 sm:w-10" src={`https://flagcdn.com/w80/${country.code}.png`} alt={`${country.name}国旗`} draggable={false} />
                        <span className="mt-0.5 max-w-full truncate px-1 text-[10px] font-black">{country.name}</span>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-slate-300">{index + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="grid gap-3">
          <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="text-sm font-black">策略建议</div>
            <div className="mt-2 rounded-2xl bg-teal-50 px-3 py-3 text-sm leading-6 text-teal-900">{advice}</div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <ToolButton label="提示" count={profile.hints} onClick={useHint} disabled={profile.hints <= 0 || status !== "playing"} />
              <ToolButton label="洗牌" count={profile.shuffles} onClick={useShuffle} disabled={profile.shuffles <= 0 || status !== "playing"} />
              <ToolButton label="撤回" count={profile.undos} onClick={useUndo} disabled={profile.undos <= 0 || tray.length === 0 || status !== "playing"} />
              <ToolButton label="整理" count={profile.clears} onClick={useClearTray} disabled={profile.clears <= 0 || tray.length === 0} />
            </div>
          </section>

          <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
              <div className="text-sm font-black">成长系统</div>
              <div className="text-xs font-bold text-slate-500">Lv.{profile.level}</div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, Math.round((profile.xp / xpTarget) * 100))}%` }} />
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-600">
              <InfoLine label="技能" value={profile.level >= 5 ? "外交加槽已启用" : "Lv.5 解锁外交加槽"} />
              <InfoLine label="公会" value={profile.guild} />
              <InfoLine label="最高关" value={`${profile.bestLevel}`} />
              <InfoLine label="通关数" value={`${profile.wins}`} />
            </div>
          </section>

          <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="text-sm font-black">道具商店</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <ShopButton label="买提示" cost={120} onClick={() => buyItem("hints", 120)} disabled={profile.coins < 120} />
              <ShopButton label="买洗牌" cost={160} onClick={() => buyItem("shuffles", 160)} disabled={profile.coins < 160} />
              <ShopButton label="买撤回" cost={100} onClick={() => buyItem("undos", 100)} disabled={profile.coins < 100} />
              <ShopButton label="买整理" cost={180} onClick={() => buyItem("clears", 180)} disabled={profile.coins < 180} />
            </div>
          </section>

          <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="text-sm font-black">皮肤</div>
            <div className="mt-3 grid gap-2">
              {(["classic", "passport", "night"] as TileSkin[]).map((skin) => {
                const unlocked = profile.unlockedSkins.includes(skin);
                const cost = skin === "passport" ? 360 : skin === "night" ? 520 : 0;
                return (
                  <button key={skin} type="button" className={`rounded-2xl border px-3 py-2 text-left text-sm font-bold ${profile.skin === skin ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 text-slate-700"}`} onClick={() => buySkin(skin, cost)}>
                    {SKIN_LABELS[skin]} <span className="float-right text-xs">{unlocked ? "使用" : `${cost} 金币`}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
            <div className="text-sm font-black">社交</div>
            <div className="mt-3 grid gap-2">
              <button type="button" className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-black text-white active:scale-95" onClick={() => setChallengeCode(`FLAG-${Math.floor(1000 + Math.random() * 9000)}`)}>
                好友挑战 {challengeCode}
              </button>
              <button type="button" className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-black text-slate-700 active:scale-95" onClick={share}>
                {shareCopied ? "已复制分享卡" : "复制分享卡"}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function ToolButton({ label, count, onClick, disabled }: { label: string; count: number; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="rounded-2xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-black text-slate-700 active:scale-95 disabled:opacity-45" onClick={onClick} disabled={disabled}>
      {label}
      <span className="mt-1 block text-sm text-slate-950">{count}</span>
    </button>
  );
}

function ShopButton({ label, cost, onClick, disabled }: { label: string; cost: number; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900 active:scale-95 disabled:opacity-45" onClick={onClick} disabled={disabled}>
      {label}
      <span className="block text-xs font-bold">{cost} 金币</span>
    </button>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <span>{label}</span>
      <strong className="text-slate-950">{value}</strong>
    </div>
  );
}
