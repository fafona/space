"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
type AppScreen = "home" | "game" | "growth" | "skins" | "social" | "multiplayer";
type PlayMode = "campaign" | "dailyHell" | "multiplayer";
type Difficulty = "easy" | "normal" | "hard" | "hell";

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
const DIFFICULTY_CONFIG: Record<
  Difficulty,
  {
    label: string;
    subtitle: string;
    seedOffset: number;
    baseGroups: number;
    levelScale: number;
    maxGroups: number;
    layers: number;
    thresholdBase: number;
    thresholdStep: number;
    edgePenalty: number;
    trayBonus: number;
  }
> = {
  easy: {
    label: "简单",
    subtitle: "国旗少，覆盖浅，适合热身。",
    seedOffset: 101,
    baseGroups: 8,
    levelScale: 1.2,
    maxGroups: 18,
    layers: 4,
    thresholdBase: 0.62,
    thresholdStep: 0.14,
    edgePenalty: 0.14,
    trayBonus: 1,
  },
  normal: {
    label: "中等",
    subtitle: "标准闯关节奏。",
    seedOffset: 307,
    baseGroups: 10,
    levelScale: 2,
    maxGroups: 24,
    layers: 5,
    thresholdBase: 0.72,
    thresholdStep: 0.12,
    edgePenalty: 0.1,
    trayBonus: 0,
  },
  hard: {
    label: "困难",
    subtitle: "覆盖更深，槽位更紧。",
    seedOffset: 701,
    baseGroups: 14,
    levelScale: 2.2,
    maxGroups: 28,
    layers: 6,
    thresholdBase: 0.77,
    thresholdStep: 0.1,
    edgePenalty: 0.08,
    trayBonus: 0,
  },
  hell: {
    label: "地狱",
    subtitle: "每天一关，极高难度。",
    seedOffset: 1201,
    baseGroups: 24,
    levelScale: 1.4,
    maxGroups: 36,
    layers: 7,
    thresholdBase: 0.84,
    thresholdStep: 0.075,
    edgePenalty: 0.04,
    trayBonus: -1,
  },
};
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

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function getDailyHellSeed() {
  const today = new Date();
  const key = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  return hashString(`bufuzai-daily-hell-${key}`);
}

function createRoomCode() {
  return `BF${Math.floor(100000 + Math.random() * 900000)}`;
}

function countryByCode(code: string) {
  return countries.find((country) => country.code === code) ?? countries[0];
}

function buildLevelTiles(level: number, reroll = 0, difficulty: Difficulty = "normal", seedOverride?: number): FlagTile[] {
  const config = DIFFICULTY_CONFIG[difficulty];
  const seed = seedOverride ?? level * 911 + reroll * 1013 + config.seedOffset;
  const rng = createRng(seed);
  const groupCount = Math.min(Math.round(config.baseGroups + level * config.levelScale), config.maxGroups);
  const preferred = countries.filter((country) => country.region !== "world");
  const pool = level <= 6 && difficulty !== "hell" ? preferred : countries;
  const selected = shuffleWithSeed(pool, seed).slice(0, groupCount);
  const codes = shuffleWithSeed(
    selected.flatMap((country) => [country.code, country.code, country.code]),
    seed + 37,
  );

  const slots: Array<{ x: number; y: number; z: number }> = [];
  for (let z = 0; z < config.layers; z += 1) {
    for (let y = 0; y < BOARD_ROWS; y += 1) {
      for (let x = 0; x < BOARD_COLS; x += 1) {
        const edge = x === 0 || y === 0 || x === BOARD_COLS - 1 || y === BOARD_ROWS - 1;
        const threshold = Math.max(0.16, config.thresholdBase - z * config.thresholdStep - (edge ? config.edgePenalty : 0));
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
  const [screen, setScreen] = useState<AppScreen>("home");
  const [playMode, setPlayMode] = useState<PlayMode>("campaign");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [currentSeed, setCurrentSeed] = useState<number | undefined>(undefined);
  const [modeTitle, setModeTitle] = useState("闯关模式");
  const [profile, setProfile] = useState<ProfileState>(defaultProfile);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [tiles, setTiles] = useState<FlagTile[]>(() => buildLevelTiles(1, 0, "normal"));
  const [tray, setTray] = useState<TrayTile[]>([]);
  const [status, setStatus] = useState<GameStatus>("playing");
  const [reroll, setReroll] = useState(0);
  const [hintId, setHintId] = useState("");
  const [message, setMessage] = useState("点击未被压住的国旗，槽内三张相同会自动消除。");
  const [challengeCode, setChallengeCode] = useState("FLAG-0827");
  const [shareCopied, setShareCopied] = useState(false);
  const [roomCode, setRoomCode] = useState(() => createRoomCode());
  const [roomInput, setRoomInput] = useState("");
  const [roomDifficulty, setRoomDifficulty] = useState<Difficulty>("normal");
  const [roomPlayers, setRoomPlayers] = useState(2);
  const hintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const storedProfile = readStoredProfile();
    setProfile(storedProfile);
    setTiles(buildLevelTiles(storedProfile.level, 0, "normal"));
    setProfileLoaded(true);
  }, []);

  useEffect(() => {
    if (profileLoaded && typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }
  }, [profile, profileLoaded]);

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
  const trayLimit = Math.max(5, MAX_TRAY + (profile.level >= 5 ? 1 : 0) + DIFFICULTY_CONFIG[difficulty].trayBonus);

  const startLevel = useCallback((nextLevel: number, nextReroll = 0, options?: { difficulty?: Difficulty; mode?: PlayMode; seed?: number; title?: string }) => {
    const normalizedLevel = Math.max(1, nextLevel);
    const nextDifficulty = options?.difficulty ?? difficulty;
    setDifficulty(nextDifficulty);
    setPlayMode(options?.mode ?? "campaign");
    setCurrentSeed(options?.seed);
    setModeTitle(options?.title ?? "闯关模式");
    setTiles(buildLevelTiles(normalizedLevel, nextReroll, nextDifficulty, options?.seed));
    setTray([]);
    setStatus("playing");
    setHintId("");
    setScreen("game");
    setMessage(`${options?.title ?? "闯关模式"}开始，先观察上层可点国旗。`);
  }, [difficulty]);

  const startCampaign = useCallback(() => {
    startLevel(profile.level, reroll, { difficulty: "normal", mode: "campaign", title: `闯关模式 · 第 ${profile.level} 关` });
  }, [profile.level, reroll, startLevel]);

  const startDailyHell = useCallback(() => {
    const seed = getDailyHellSeed();
    startLevel(30, 0, { difficulty: "hell", mode: "dailyHell", seed, title: "地狱模式 · 今日一关" });
  }, [startLevel]);

  const startMultiplayerRace = useCallback(() => {
    const normalizedCode = (roomInput.trim() || roomCode).toUpperCase();
    const seed = hashString(`bufuzai-room-${normalizedCode}-${roomDifficulty}`);
    setRoomCode(normalizedCode);
    setRoomInput("");
    startLevel(roomDifficulty === "easy" ? 8 : roomDifficulty === "normal" ? 16 : roomDifficulty === "hard" ? 26 : 36, 0, {
      difficulty: roomDifficulty,
      mode: "multiplayer",
      seed,
      title: `多人竞赛 · ${DIFFICULTY_CONFIG[roomDifficulty].label}`,
    });
  }, [roomCode, roomDifficulty, roomInput, startLevel]);

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
    if (playMode !== "campaign") {
      setScreen("home");
      return;
    }
    setProfile((current) => ({ ...current, bestLevel: Math.max(current.bestLevel, current.level + 1), level: current.level + 1 }));
    startLevel(profile.level + 1, reroll, { difficulty: "normal", mode: "campaign", title: `闯关模式 · 第 ${profile.level + 1} 关` });
  }, [playMode, profile.level, reroll, startLevel]);

  const restart = useCallback(() => {
    const nextReroll = currentSeed === undefined ? reroll + 1 : reroll;
    setReroll(nextReroll);
    const level = playMode === "dailyHell" ? 30 : playMode === "multiplayer" ? (difficulty === "easy" ? 8 : difficulty === "normal" ? 16 : difficulty === "hard" ? 26 : 36) : profile.level;
    startLevel(level, nextReroll, { difficulty, mode: playMode, seed: currentSeed, title: modeTitle });
  }, [currentSeed, difficulty, modeTitle, playMode, profile.level, reroll, startLevel]);

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
    <main className="min-h-dvh overscroll-none bg-[#07140f] text-slate-950">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-[#eef3ef] px-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        {screen === "home" ? (
          <>
            <header className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-teal-700 text-white shadow-[0_14px_28px_rgba(15,118,110,0.26)]">
                  <NoMercyFlagIcon />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-black">不服再试</h1>
                  <div className="truncate text-xs font-semibold text-slate-500">{subtitle}</div>
                </div>
              </div>
              <button type="button" className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 active:scale-95" onClick={returnToLobby}>
                大厅
              </button>
            </header>

            <section className="mt-4 grid grid-cols-3 gap-2">
              <HomeEntry label="成长系统" value={`Lv.${profile.level}`} onClick={() => setScreen("growth")} />
              <HomeEntry label="皮肤" value={SKIN_LABELS[profile.skin]} onClick={() => setScreen("skins")} />
              <HomeEntry label="社交" value={profile.guild} onClick={() => setScreen("social")} />
            </section>

            <section className="flex flex-1 flex-col justify-center gap-3 py-5">
              <ModeButton
                title="闯关模式"
                subtitle={`第 ${profile.level} 关开始，难度会逐关提高`}
                meta={`最高 ${profile.bestLevel} · 通关 ${profile.wins}`}
                tone="bg-teal-700 text-white shadow-[0_18px_40px_rgba(15,118,110,0.3)]"
                onClick={startCampaign}
              />
              <ModeButton
                title="地狱模式"
                subtitle="每天只有一关，国旗更多、覆盖更深"
                meta="今日挑战 · 极难"
                tone="bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.28)]"
                onClick={startDailyHell}
              />
              <ModeButton
                title="多人竞赛"
                subtitle="2-5 人同房，输入同一房间码进入相同随机关卡"
                meta="简单 / 中等 / 困难 / 地狱"
                tone="bg-amber-500 text-slate-950 shadow-[0_18px_40px_rgba(245,158,11,0.26)]"
                onClick={() => setScreen("multiplayer")}
              />
            </section>

            <section className="grid grid-cols-4 gap-2 rounded-[22px] border border-slate-200 bg-white p-3 text-center text-xs font-bold text-slate-500 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
              <InfoBadge label="金币" value={`${profile.coins}`} />
              <InfoBadge label="提示" value={`${profile.hints}`} />
              <InfoBadge label="洗牌" value={`${profile.shuffles}`} />
              <InfoBadge label="撤回" value={`${profile.undos}`} />
            </section>
          </>
        ) : screen === "growth" ? (
          <Panel title="成长系统" onBack={() => setScreen("home")}>
            <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-black">等级 Lv.{profile.level}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">金币 {profile.coins}</div>
                </div>
                <div className="rounded-2xl bg-amber-50 px-3 py-2 text-sm font-black text-amber-700">最高 {profile.bestLevel}</div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, Math.round((profile.xp / xpTarget) * 100))}%` }} />
              </div>
              <div className="mt-4 grid gap-2 text-sm text-slate-600">
                <InfoLine label="技能" value={profile.level >= 5 ? "外交加槽已启用" : "Lv.5 解锁外交加槽"} />
                <InfoLine label="公会" value={profile.guild} />
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
          </Panel>
        ) : screen === "skins" ? (
          <Panel title="皮肤" onBack={() => setScreen("home")}>
            <section className="grid gap-3">
              {(["classic", "passport", "night"] as TileSkin[]).map((skin) => {
                const unlocked = profile.unlockedSkins.includes(skin);
                const cost = skin === "passport" ? 360 : skin === "night" ? 520 : 0;
                return (
                  <button
                    key={skin}
                    type="button"
                    className={`rounded-[22px] border px-4 py-4 text-left shadow-[0_12px_26px_rgba(15,23,42,0.08)] active:scale-[0.99] ${
                      profile.skin === skin ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-200 bg-white text-slate-800"
                    }`}
                    onClick={() => buySkin(skin, cost)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-base font-black">{SKIN_LABELS[skin]}</span>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-black">{unlocked ? "使用" : `${cost} 金币`}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      {["es", "fr", "cn"].map((code) => (
                        <span key={`${skin}-${code}`} className={`grid h-12 w-16 place-items-center rounded-xl border p-1 ${skin === "night" ? "border-slate-700 bg-slate-950" : skin === "passport" ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"}`}>
                          <img className="h-7 w-11 rounded object-cover" src={`https://flagcdn.com/w80/${code}.png`} alt="" draggable={false} />
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </section>
          </Panel>
        ) : screen === "social" ? (
          <Panel title="社交" onBack={() => setScreen("home")}>
            <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
              <InfoLine label="公会" value={profile.guild} />
              <InfoLine label="好友挑战码" value={challengeCode} />
              <InfoLine label="当前关卡" value={`${profile.level}`} />
            </section>
            <button type="button" className="rounded-[22px] bg-slate-950 px-4 py-4 text-sm font-black text-white active:scale-95" onClick={() => setChallengeCode(`FLAG-${Math.floor(1000 + Math.random() * 9000)}`)}>
              生成好友挑战
            </button>
            <button type="button" className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-sm font-black text-slate-800 active:scale-95" onClick={share}>
              {shareCopied ? "已复制分享卡" : "复制分享卡"}
            </button>
          </Panel>
        ) : screen === "multiplayer" ? (
          <Panel title="多人竞赛" onBack={() => setScreen("home")}>
            <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
              <div className="text-sm font-black">房间码</div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <input
                  value={roomInput}
                  onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
                  placeholder={roomCode}
                  className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-base font-black tracking-wider outline-none focus:border-teal-600"
                />
                <button type="button" className="rounded-2xl bg-slate-950 px-4 text-sm font-black text-white active:scale-95" onClick={() => setRoomCode(createRoomCode())}>
                  换房
                </button>
              </div>
              <div className="mt-3 text-xs font-semibold text-slate-500">同一房间码 + 同一难度，会生成完全相同的随机关卡。</div>
            </section>

            <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
              <div className="text-sm font-black">人数</div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {[2, 3, 4, 5].map((count) => (
                  <button key={count} type="button" className={`rounded-2xl border px-3 py-3 text-sm font-black active:scale-95 ${roomPlayers === count ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-slate-50 text-slate-700"}`} onClick={() => setRoomPlayers(count)}>
                    {count}人
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-2">
                {Array.from({ length: roomPlayers }).map((_, index) => (
                  <div key={`room-player-${index}`} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                    <span>{index === 0 ? "我" : `玩家 ${index + 1}`}</span>
                    <span className="text-xs text-slate-400">{index === 0 ? "已就绪" : "等待进入"}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
              <div className="text-sm font-black">难度</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["easy", "normal", "hard", "hell"] as Difficulty[]).map((item) => (
                  <button key={item} type="button" className={`rounded-2xl border px-3 py-3 text-left active:scale-95 ${roomDifficulty === item ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-200 bg-slate-50 text-slate-700"}`} onClick={() => setRoomDifficulty(item)}>
                    <span className="block text-sm font-black">{DIFFICULTY_CONFIG[item].label}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">{DIFFICULTY_CONFIG[item].subtitle}</span>
                  </button>
                ))}
              </div>
            </section>
            <button type="button" className="rounded-[24px] bg-teal-700 px-4 py-4 text-base font-black text-white shadow-[0_18px_40px_rgba(15,118,110,0.28)] active:scale-95" onClick={startMultiplayerRace}>
              开始竞赛
            </button>
          </Panel>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col gap-3">
            <header className="flex items-center justify-between gap-2">
              <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 active:scale-95" onClick={() => setScreen("home")}>
                首页
              </button>
              <div className="min-w-0 text-center">
                <div className="truncate text-base font-black">{modeTitle}</div>
                <div className="truncate text-xs font-semibold text-slate-500">{DIFFICULTY_CONFIG[difficulty].label} · 可点 {openTiles.length} · 剩余 {remaining}</div>
              </div>
              <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 active:scale-95" onClick={returnToLobby}>
                大厅
              </button>
            </header>

            <section className="grid grid-cols-4 gap-2 rounded-[20px] border border-slate-200 bg-white p-2 text-center text-xs font-bold text-slate-500">
              <InfoBadge label="关卡" value={playMode === "dailyHell" ? "今日" : `${profile.level}`} />
              <InfoBadge label="进度" value={`${progress}%`} />
              <InfoBadge label="金币" value={`${profile.coins}`} />
              <InfoBadge label="槽位" value={`${tray.length}/${trayLimit}`} />
            </section>

            <section className="rounded-[20px] border border-slate-200 bg-white p-2">
              <div className="mb-2 line-clamp-2 text-xs font-semibold leading-5 text-teal-900">{advice}</div>
              <div className="grid grid-cols-4 gap-2">
                <ToolButton label="提示" count={profile.hints} onClick={useHint} disabled={profile.hints <= 0 || status !== "playing"} />
                <ToolButton label="洗牌" count={profile.shuffles} onClick={useShuffle} disabled={profile.shuffles <= 0 || status !== "playing"} />
                <ToolButton label="撤回" count={profile.undos} onClick={useUndo} disabled={profile.undos <= 0 || tray.length === 0 || status !== "playing"} />
                <ToolButton label="整理" count={profile.clears} onClick={useClearTray} disabled={profile.clears <= 0 || tray.length === 0} />
              </div>
            </section>

            <section className="relative min-h-[46dvh] flex-1 overflow-hidden rounded-[22px] border border-slate-200 bg-[radial-gradient(circle_at_50%_20%,#ffffff,#dce9e1)] shadow-inner">
              {tiles.map((tile) => {
                if (tile.removed || tray.some((item) => item.id === tile.id)) return null;
                const country = countryByCode(tile.countryCode);
                const open = isTileOpen(tile, tiles, tray);
                return (
                  <button
                    key={tile.id}
                    type="button"
                    className={`absolute flex h-[42px] w-[58px] touch-manipulation flex-col items-center justify-center rounded-xl border shadow-[0_8px_18px_rgba(15,23,42,0.16)] transition ${
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
                    <img className={`h-5 w-8 rounded object-cover ${open ? "" : "grayscale"}`} src={`https://flagcdn.com/w80/${country.code}.png`} alt={`${country.name}国旗`} draggable={false} />
                    <span className="mt-0.5 max-w-full truncate px-1 text-[10px] font-black">{country.name}</span>
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
                          {playMode === "campaign" ? "下一关" : "回首页"}
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

            <section className="rounded-[20px] border border-slate-200 bg-white p-2">
              <div className="mb-2 line-clamp-1 text-xs font-semibold text-slate-500">{message}</div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${trayLimit}, minmax(0, 1fr))` }}>
                {Array.from({ length: trayLimit }).map((_, index) => {
                  const item = tray[index];
                  const country = item ? countryByCode(item.countryCode) : null;
                  return (
                    <div key={`tray-${index}`} className="grid h-[52px] place-items-center rounded-xl border border-slate-200 bg-slate-50">
                      {country ? (
                        <div className="flex min-w-0 flex-col items-center">
                          <img className="h-5 w-8 rounded object-cover" src={`https://flagcdn.com/w80/${country.code}.png`} alt={`${country.name}国旗`} draggable={false} />
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
        )}
      </div>
    </main>
  );
}

function HomeEntry({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="min-w-0 rounded-[20px] border border-slate-200 bg-white px-2 py-3 text-center shadow-[0_10px_24px_rgba(15,23,42,0.08)] active:scale-95" onClick={onClick}>
      <span className="block text-sm font-black text-slate-900">{label}</span>
      <span className="mt-1 block truncate text-[11px] font-bold text-slate-500">{value}</span>
    </button>
  );
}

function ModeButton({ title, subtitle, meta, tone, onClick }: { title: string; subtitle: string; meta: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" className={`rounded-[28px] px-5 py-5 text-left active:scale-[0.99] ${tone}`} onClick={onClick}>
      <span className="block text-2xl font-black">{title}</span>
      <span className="mt-2 block text-sm font-semibold opacity-85">{subtitle}</span>
      <span className="mt-4 inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-black">{meta}</span>
    </button>
  );
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div>{label}</div>
      <div className="mt-1 truncate text-base font-black text-slate-950">{value}</div>
    </div>
  );
}

function Panel({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <button type="button" className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 active:scale-95" onClick={onBack}>
          首页
        </button>
        <div className="text-base font-black">{title}</div>
        <span className="w-[52px]" aria-hidden="true" />
      </header>
      <div className="grid gap-3">{children}</div>
    </section>
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
