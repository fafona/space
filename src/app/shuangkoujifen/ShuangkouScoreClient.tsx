"use client";

import { useEffect, useMemo, useState } from "react";

type PlayerId = "p1" | "p2" | "p3" | "p4" | "p5" | "p6";
type ParticipantCount = 4 | 5 | 6;
type TeamKey = "teamA" | "teamB";
type PlayerStatus = TeamKey | "bench";
type ResultKey = "double" | "single" | "flat";
type StarLevel = 0 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type ContributionStar = 6 | 7 | 8 | 9 | 10 | 11 | 12;
type IconName = "calculator" | "cards" | "copy" | "medal" | "plus" | "refresh" | "rest" | "trash" | "undo";

type PlayerConfig = {
  id: PlayerId;
  defaultName: string;
};

type TeamAssignment = Record<PlayerId, PlayerStatus>;
type ScoreMap = Record<PlayerId, number>;
type StarMap = Record<PlayerId, StarLevel>;
type BaseScores = Record<ResultKey, number>;
type ContributionScores = Record<ContributionStar, number>;

type RoundRecord = {
  id: string;
  at: string;
  activePlayerIds: PlayerId[];
  discarded: boolean;
  finishOrder: PlayerId[];
  resultName: string;
  scoringTeam: TeamKey | null;
  baseScore: number;
  multiplier: number;
  highestWinningStar: StarLevel;
  scores: ScoreMap;
  starByPlayer: StarMap;
  initialStarByPlayer: StarMap;
  splitBombSharingEnabled: boolean;
  splitBombShareNumerator: number;
  splitBombShareDenominator: number;
  teamAPlayers: PlayerId[];
};

type PersistedShuangkouState = {
  rules?: {
    participantCount?: unknown;
    names?: unknown;
    baseScores?: unknown;
    maxMultiplier?: unknown;
    contributionScores?: unknown;
    splitBombSharingEnabled?: unknown;
    splitBombShareNumerator?: unknown;
    splitBombShareDenominator?: unknown;
  };
  session?: {
    activePlayerIds?: unknown;
    teamAPlayers?: unknown;
    discardedRound?: unknown;
    finishOrder?: unknown;
    initialStarByPlayer?: unknown;
    starByPlayer?: unknown;
    rounds?: unknown;
    undoneRounds?: unknown;
  };
};

const storageKey = "faolla:shuangkoujifen:v1";

const playerList: PlayerConfig[] = [
  { id: "p1", defaultName: "玩家一" },
  { id: "p2", defaultName: "玩家二" },
  { id: "p3", defaultName: "玩家三" },
  { id: "p4", defaultName: "玩家四" },
  { id: "p5", defaultName: "玩家五" },
  { id: "p6", defaultName: "玩家六" },
];

const playerMap = Object.fromEntries(playerList.map((player) => [player.id, player])) as Record<PlayerId, PlayerConfig>;

const teamNames: Record<TeamKey, string> = {
  teamA: "A队",
  teamB: "B队",
};

const initialNames: Record<PlayerId, string> = {
  p1: "玩家一",
  p2: "玩家二",
  p3: "玩家三",
  p4: "玩家四",
  p5: "玩家五",
  p6: "玩家六",
};

const emptyScores: ScoreMap = {
  p1: 0,
  p2: 0,
  p3: 0,
  p4: 0,
  p5: 0,
  p6: 0,
};

const emptyStars: StarMap = {
  p1: 0,
  p2: 0,
  p3: 0,
  p4: 0,
  p5: 0,
  p6: 0,
};

const starOptions: StarLevel[] = [0, 5, 6, 7, 8, 9, 10, 11, 12];
const contributionStars: ContributionStar[] = [6, 7, 8, 9, 10, 11, 12];
const maxMultiplierOptions = [1, 2, 4, 8, 16, 32, 64, 128, 256];

const defaultBaseScores: BaseScores = {
  double: 3,
  single: 2,
  flat: 1,
};

const defaultContributionScores: ContributionScores = {
  6: 3,
  7: 5,
  8: 10,
  9: 20,
  10: 40,
  11: 150,
  12: 800,
};

function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "calculator") {
    return (
      <svg {...common}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 7h8M8 11h2M12 11h2M16 11h.01M8 15h2M12 15h2M16 15h.01" />
      </svg>
    );
  }
  if (name === "cards") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="10" height="14" rx="2" />
        <path d="M8 9h2M8 13h3" />
        <path d="M11 21h6a2 2 0 0 0 2-2V9" />
      </svg>
    );
  }
  if (name === "medal") {
    return (
      <svg {...common}>
        <circle cx="12" cy="9" r="5" />
        <path d="m9 14-2 7 5-3 5 3-2-7" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "rest") {
    return (
      <svg {...common}>
        <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a7 7 0 1 0 11.5 11.5Z" />
      </svg>
    );
  }
  if (name === "undo") {
    return (
      <svg {...common}>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10a6 6 0 0 1 0 12h-2" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...common}>
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </svg>
    );
  }
  if (name === "copy") {
    return (
      <svg {...common}>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 4v6h6" />
      <path d="M20 20v-6h-6" />
      <path d="M20 9a8 8 0 0 0-13.5-3.5L4 8M4 15a8 8 0 0 0 13.5 3.5L20 16" />
    </svg>
  );
}

function roundScore(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatScoreNumber(value: number) {
  const rounded = roundScore(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function formatSigned(value: number) {
  const rounded = roundScore(value);
  if (rounded > 0) return `+${formatScoreNumber(rounded)}`;
  return formatScoreNumber(rounded);
}

function parseNonNegativeInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parseStarLevel(value: string): StarLevel {
  const parsed = Number.parseInt(value, 10);
  return starOptions.includes(parsed as StarLevel) ? (parsed as StarLevel) : 0;
}

function isContributionStar(star: StarLevel): star is ContributionStar {
  return contributionStars.includes(star as ContributionStar);
}

function getPlayerName(names: Record<PlayerId, string>, playerId: PlayerId) {
  return names[playerId].trim() || playerMap[playerId].defaultName;
}

function getVisiblePlayers(participantCount: ParticipantCount) {
  return playerList.slice(0, participantCount);
}

function getVisiblePlayerIds(participantCount: ParticipantCount) {
  return getVisiblePlayers(participantCount).map((player) => player.id);
}

function uniquePlayerIds(playerIds: PlayerId[]) {
  return playerIds.filter((playerId, index) => playerIds.indexOf(playerId) === index);
}

function sanitizeActivePlayers(activePlayerIds: PlayerId[], availablePlayerIds: PlayerId[]) {
  const next = uniquePlayerIds(activePlayerIds).filter((playerId) => availablePlayerIds.includes(playerId));
  for (const playerId of availablePlayerIds) {
    if (next.length >= 4) break;
    if (!next.includes(playerId)) next.push(playerId);
  }
  return next.slice(0, 4);
}

function sanitizeTeamAPlayers(teamAPlayers: PlayerId[], activePlayerIds: PlayerId[]) {
  const next = uniquePlayerIds(teamAPlayers).filter((playerId) => activePlayerIds.includes(playerId));
  for (const playerId of activePlayerIds) {
    if (next.length >= 2) break;
    if (!next.includes(playerId)) next.push(playerId);
  }
  return next.slice(0, 2);
}

function updatePlayerSlot(playerIds: PlayerId[], slotIndex: number, nextPlayer: PlayerId) {
  const currentPlayer = playerIds[slotIndex];
  if (currentPlayer === nextPlayer) return playerIds;
  const next = [...playerIds];
  const existingIndex = next.findIndex((playerId) => playerId === nextPlayer);
  next[slotIndex] = nextPlayer;
  if (existingIndex >= 0) {
    next[existingIndex] = currentPlayer;
  }
  return next;
}

function getOpposingTeam(team: TeamKey) {
  return team === "teamA" ? "teamB" : "teamA";
}

function buildTeamAssignment(activePlayerIds: PlayerId[], teamAPlayers: PlayerId[]): TeamAssignment {
  const activeSet = new Set(activePlayerIds);
  const teamASet = new Set(teamAPlayers);
  return playerList.reduce<TeamAssignment>((assignment, player) => {
    if (!activeSet.has(player.id)) {
      assignment[player.id] = "bench";
    } else {
      assignment[player.id] = teamASet.has(player.id) ? "teamA" : "teamB";
    }
    return assignment;
  }, {} as TeamAssignment);
}

function getTeamPlayers(team: TeamKey, teamAssignment: TeamAssignment) {
  return playerList.filter((player) => teamAssignment[player.id] === team).map((player) => player.id);
}

function formatStarSummary(star: StarLevel) {
  return star > 0 ? `${star}星` : "无星";
}

function getRoundPlayerStarSummary(names: Record<PlayerId, string>, playerId: PlayerId, round: RoundRecord) {
  const settlementStar = round.starByPlayer[playerId] ?? 0;
  const initialStar = round.initialStarByPlayer[playerId] ?? settlementStar;
  const playerName = getPlayerName(names, playerId);
  if (round.splitBombSharingEnabled && initialStar > settlementStar) {
    return `${playerName}${formatStarSummary(initialStar)}拆${formatStarSummary(settlementStar)}`;
  }
  return `${playerName}${formatStarSummary(settlementStar)}`;
}

function getRoundSideStarSummary(names: Record<PlayerId, string>, playerIds: PlayerId[], round: RoundRecord) {
  if (playerIds.length === 0) return "无";
  return playerIds.map((playerId) => getRoundPlayerStarSummary(names, playerId, round)).join("，");
}

function resolveResult(finishOrder: PlayerId[], teamAssignment: TeamAssignment) {
  const firstPlayer = finishOrder[0];
  const firstTeam = teamAssignment[firstPlayer];
  if (firstTeam !== "teamA" && firstTeam !== "teamB") {
    return {
      resultName: "未完成",
      scoringTeam: null,
      resultKey: "flat" as ResultKey,
    };
  }

  const teamPositions = finishOrder
    .map((playerId, index) => ({ playerId, position: index + 1 }))
    .filter((item) => teamAssignment[item.playerId] === firstTeam)
    .map((item) => item.position)
    .sort((a, b) => a - b);

  const secondTeamPosition = teamPositions[1];
  if (secondTeamPosition === 2) {
    return {
      resultName: "双扣",
      scoringTeam: firstTeam,
      resultKey: "double" as ResultKey,
    };
  }
  if (secondTeamPosition === 3) {
    return {
      resultName: "单扣",
      scoringTeam: firstTeam,
      resultKey: "single" as ResultKey,
    };
  }
  return {
    resultName: "平扣",
    scoringTeam: firstTeam,
    resultKey: "flat" as ResultKey,
  };
}

function getNaturalMultiplier(star: StarLevel) {
  if (star < 5) return 1;
  return 2 ** (star - 4);
}

function getHighestTeamStar(team: TeamKey, teamAssignment: TeamAssignment, starByPlayer: StarMap) {
  return getTeamPlayers(team, teamAssignment).reduce<StarLevel>((highest, playerId) => {
    const star = starByPlayer[playerId];
    return star > highest ? star : highest;
  }, 0);
}

function getCappedMultiplier(star: StarLevel, maxMultiplier: number) {
  return Math.min(getNaturalMultiplier(star), Math.max(1, maxMultiplier));
}

function getContributionPoint(star: StarLevel, contributionScores: ContributionScores) {
  return isContributionStar(star) ? contributionScores[star] : 0;
}

function getTeamPartner(playerId: PlayerId, teamAssignment: TeamAssignment) {
  const team = teamAssignment[playerId];
  if (team !== "teamA" && team !== "teamB") return null;
  return getTeamPlayers(team, teamAssignment).find((teamPlayerId) => teamPlayerId !== playerId) ?? null;
}

function getSplitBombCompensation({
  activePlayerIds,
  contributionScores,
  initialStarByPlayer,
  playerId,
  shareDenominator,
  shareNumerator,
  starByPlayer,
}: {
  activePlayerIds: PlayerId[];
  contributionScores: ContributionScores;
  initialStarByPlayer: StarMap;
  playerId: PlayerId;
  shareDenominator: number;
  shareNumerator: number;
  starByPlayer: StarMap;
}) {
  if (shareDenominator <= 0 || shareNumerator <= 0) return 0;
  const initialPoint = getContributionPoint(initialStarByPlayer[playerId], contributionScores);
  const settlementPoint = getContributionPoint(starByPlayer[playerId], contributionScores);
  const pointLoss = initialPoint - settlementPoint;
  if (pointLoss <= 0) return 0;
  return roundScore((pointLoss * (activePlayerIds.length - 1) * shareNumerator) / shareDenominator);
}

function buildRoundScore({
  activePlayerIds,
  baseScores,
  discarded,
  maxMultiplier,
  contributionScores,
  finishOrder,
  initialStarByPlayer,
  splitBombShareDenominator,
  splitBombShareNumerator,
  splitBombSharingEnabled,
  teamAssignment,
  starByPlayer,
}: {
  activePlayerIds: PlayerId[];
  baseScores: BaseScores;
  discarded: boolean;
  maxMultiplier: number;
  contributionScores: ContributionScores;
  finishOrder: PlayerId[];
  initialStarByPlayer: StarMap;
  splitBombShareDenominator: number;
  splitBombShareNumerator: number;
  splitBombSharingEnabled: boolean;
  teamAssignment: TeamAssignment;
  starByPlayer: StarMap;
}) {
  const result = discarded
    ? {
        resultName: "丢牌",
        scoringTeam: null,
        resultKey: "flat" as ResultKey,
      }
    : resolveResult(finishOrder, teamAssignment);
  const baseScore = result.scoringTeam ? baseScores[result.resultKey] : 0;
  const highestWinningStar =
    result.scoringTeam && baseScore > 0 ? getHighestTeamStar(result.scoringTeam, teamAssignment, starByPlayer) : 0;
  const multiplier = result.scoringTeam && baseScore > 0 ? getCappedMultiplier(highestWinningStar, maxMultiplier) : 1;
  const scores: ScoreMap = { ...emptyScores };

  if (result.scoringTeam && baseScore > 0) {
    const opposingTeam = getOpposingTeam(result.scoringTeam);
    const winLossScore = baseScore * multiplier;
    getTeamPlayers(result.scoringTeam, teamAssignment).forEach((playerId) => {
      scores[playerId] += winLossScore;
    });
    getTeamPlayers(opposingTeam, teamAssignment).forEach((playerId) => {
      scores[playerId] -= winLossScore;
    });
  }

  activePlayerIds.forEach((contributorId) => {
    const pointPerOtherPlayer = getContributionPoint(starByPlayer[contributorId], contributionScores);
    if (pointPerOtherPlayer <= 0) return;
    scores[contributorId] += pointPerOtherPlayer * (activePlayerIds.length - 1);
    activePlayerIds.forEach((playerId) => {
      if (playerId !== contributorId) {
        scores[playerId] -= pointPerOtherPlayer;
      }
    });
  });

  if (splitBombSharingEnabled) {
    activePlayerIds.forEach((contributorId) => {
      const partnerId = getTeamPartner(contributorId, teamAssignment);
      if (!partnerId) return;
      const compensation = getSplitBombCompensation({
        activePlayerIds,
        contributionScores,
        initialStarByPlayer,
        playerId: contributorId,
        shareDenominator: splitBombShareDenominator,
        shareNumerator: splitBombShareNumerator,
        starByPlayer,
      });
      if (compensation <= 0) return;
      scores[contributorId] += compensation;
      scores[partnerId] -= compensation;
    });
  }

  return {
    ...result,
    baseScore,
    multiplier,
    highestWinningStar,
    scores,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && playerList.some((player) => player.id === value);
}

function isTeamKey(value: unknown): value is TeamKey {
  return value === "teamA" || value === "teamB";
}

function sanitizeParticipantCountValue(value: unknown): ParticipantCount {
  return value === 5 || value === 6 ? value : 4;
}

function sanitizePlayerIdArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlayerId);
}

function sanitizeFinishOrderValue(value: unknown, activePlayerIds: PlayerId[]) {
  return uniquePlayerIds(sanitizePlayerIdArray(value))
    .filter((playerId) => activePlayerIds.includes(playerId))
    .slice(0, 4);
}

function sanitizeNonNegativeIntegerValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
}

function sanitizePositiveIntegerValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

function sanitizeScoreNumberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? roundScore(value) : fallback;
}

function sanitizeNamesValue(value: unknown) {
  const source = isPlainRecord(value) ? value : {};
  return playerList.reduce<Record<PlayerId, string>>((nextNames, player) => {
    const name = source[player.id];
    nextNames[player.id] = typeof name === "string" ? name : initialNames[player.id];
    return nextNames;
  }, {} as Record<PlayerId, string>);
}

function sanitizeBaseScoresValue(value: unknown) {
  const source = isPlainRecord(value) ? value : {};
  return {
    double: sanitizeNonNegativeIntegerValue(source.double, defaultBaseScores.double),
    single: sanitizeNonNegativeIntegerValue(source.single, defaultBaseScores.single),
    flat: sanitizeNonNegativeIntegerValue(source.flat, defaultBaseScores.flat),
  };
}

function sanitizeContributionScoresValue(value: unknown) {
  const source = isPlainRecord(value) ? value : {};
  return contributionStars.reduce<ContributionScores>((scores, star) => {
    scores[star] = sanitizeNonNegativeIntegerValue(source[String(star)], defaultContributionScores[star]);
    return scores;
  }, {} as ContributionScores);
}

function sanitizeStarLevelValue(value: unknown): StarLevel {
  return typeof value === "number" && starOptions.includes(value as StarLevel) ? (value as StarLevel) : 0;
}

function sanitizeStarMapValue(value: unknown) {
  const source = isPlainRecord(value) ? value : {};
  return playerList.reduce<StarMap>((stars, player) => {
    stars[player.id] = sanitizeStarLevelValue(source[player.id]);
    return stars;
  }, {} as StarMap);
}

function sanitizeScoreMapValue(value: unknown) {
  const source = isPlainRecord(value) ? value : {};
  return playerList.reduce<ScoreMap>((scores, player) => {
    scores[player.id] = sanitizeScoreNumberValue(source[player.id]);
    return scores;
  }, {} as ScoreMap);
}

function sanitizeRoundRecordsValue(value: unknown, participantCount: ParticipantCount) {
  if (!Array.isArray(value)) return [];
  const visiblePlayerIds = getVisiblePlayerIds(participantCount);
  return value.reduce<RoundRecord[]>((records, item, index) => {
    if (!isPlainRecord(item)) return records;
    const activePlayerIds = sanitizeActivePlayers(sanitizePlayerIdArray(item.activePlayerIds), visiblePlayerIds);
    const teamAPlayers = sanitizeTeamAPlayers(sanitizePlayerIdArray(item.teamAPlayers), activePlayerIds);
    const discarded = item.discarded === true;
    const starByPlayer = sanitizeStarMapValue(item.starByPlayer);
    records.push({
      id: typeof item.id === "string" && item.id ? item.id : `saved-${Date.now()}-${index}`,
      at: typeof item.at === "string" ? item.at : "",
      activePlayerIds,
      discarded,
      finishOrder: discarded ? [] : sanitizeFinishOrderValue(item.finishOrder, activePlayerIds),
      resultName: typeof item.resultName === "string" && item.resultName ? item.resultName : discarded ? "丢牌" : "未完成",
      scoringTeam: isTeamKey(item.scoringTeam) ? item.scoringTeam : null,
      baseScore: sanitizeScoreNumberValue(item.baseScore),
      multiplier: sanitizePositiveIntegerValue(item.multiplier, 1),
      highestWinningStar: sanitizeStarLevelValue(item.highestWinningStar),
      scores: sanitizeScoreMapValue(item.scores),
      starByPlayer,
      initialStarByPlayer: sanitizeStarMapValue(item.initialStarByPlayer ?? item.starByPlayer),
      splitBombSharingEnabled: item.splitBombSharingEnabled === true,
      splitBombShareNumerator: sanitizePositiveIntegerValue(item.splitBombShareNumerator, 2),
      splitBombShareDenominator: sanitizePositiveIntegerValue(item.splitBombShareDenominator, 3),
      teamAPlayers,
    });
    return records;
  }, []);
}

function readPersistedShuangkouState(): PersistedShuangkouState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPlainRecord(parsed) ? (parsed as PersistedShuangkouState) : null;
  } catch {
    return null;
  }
}

function PlayerBadge({
  playerId,
  names,
  teamAssignment,
  compact = false,
}: {
  playerId: PlayerId;
  names: Record<PlayerId, string>;
  teamAssignment: TeamAssignment;
  compact?: boolean;
}) {
  const status = teamAssignment[playerId];
  const statusLabel = status === "teamA" ? "A" : status === "teamB" ? "B" : "休";
  const statusClass =
    status === "teamA" ? "bg-emerald-700" : status === "teamB" ? "bg-red-700" : "bg-slate-400";
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <span
        className={`grid shrink-0 place-items-center rounded-md font-bold text-white ${
          compact ? "h-6 w-6 text-[11px]" : "h-8 w-8 text-xs"
        } ${statusClass}`}
      >
        {statusLabel}
      </span>
      <span className="truncate font-semibold text-slate-900">{getPlayerName(names, playerId)}</span>
    </span>
  );
}

function ScorePill({ value }: { value: number }) {
  const className =
    value > 0
      ? "bg-emerald-100 text-emerald-800"
      : value < 0
        ? "bg-red-100 text-red-800"
        : "bg-slate-100 text-slate-600";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-black sm:py-1 sm:text-sm ${className}`}>{formatSigned(value)}</span>;
}

type ShuangkouScoreClientProps = {
  subtitle?: string;
};

export default function ShuangkouScoreClient({ subtitle = "www.faolla.com/shuangkoujifen" }: ShuangkouScoreClientProps) {
  const [participantCount, setParticipantCount] = useState<ParticipantCount>(4);
  const [names, setNames] = useState<Record<PlayerId, string>>(initialNames);
  const [activePlayerIds, setActivePlayerIds] = useState<PlayerId[]>(["p1", "p2", "p3", "p4"]);
  const [teamAPlayers, setTeamAPlayers] = useState<PlayerId[]>(["p1", "p3"]);
  const [discardedRound, setDiscardedRound] = useState(false);
  const [finishOrder, setFinishOrder] = useState<PlayerId[]>([]);
  const [initialStarByPlayer, setInitialStarByPlayer] = useState<StarMap>(emptyStars);
  const [starByPlayer, setStarByPlayer] = useState<StarMap>(emptyStars);
  const [baseScores, setBaseScores] = useState<BaseScores>(defaultBaseScores);
  const [maxMultiplier, setMaxMultiplier] = useState(8);
  const [contributionScores, setContributionScores] = useState<ContributionScores>(defaultContributionScores);
  const [splitBombSharingEnabled, setSplitBombSharingEnabled] = useState(true);
  const [splitBombShareNumerator, setSplitBombShareNumerator] = useState(2);
  const [splitBombShareDenominator, setSplitBombShareDenominator] = useState(3);
  const [rounds, setRounds] = useState<RoundRecord[]>([]);
  const [undoneRounds, setUndoneRounds] = useState<RoundRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pendingSwapOutId, setPendingSwapOutId] = useState<PlayerId | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const persisted = readPersistedShuangkouState();
      if (!persisted) {
        setStorageReady(true);
        return;
      }

      const rules = isPlainRecord(persisted.rules) ? persisted.rules : {};
      const session = isPlainRecord(persisted.session) ? persisted.session : {};
      const nextParticipantCount = sanitizeParticipantCountValue(rules.participantCount);
      const nextVisiblePlayerIds = getVisiblePlayerIds(nextParticipantCount);
      const defaultActivePlayerIds = sanitizeActivePlayers(nextVisiblePlayerIds.slice(0, 4), nextVisiblePlayerIds);
      const savedActivePlayerIds = Array.isArray(session.activePlayerIds)
        ? sanitizePlayerIdArray(session.activePlayerIds)
        : defaultActivePlayerIds;
      const nextActivePlayerIds = sanitizeActivePlayers(savedActivePlayerIds, nextVisiblePlayerIds);
      const savedTeamAPlayers = Array.isArray(session.teamAPlayers)
        ? sanitizePlayerIdArray(session.teamAPlayers)
        : [nextActivePlayerIds[0], nextActivePlayerIds[2]];
      const nextTeamAPlayers = sanitizeTeamAPlayers(savedTeamAPlayers, nextActivePlayerIds);
      const nextDiscardedRound = session.discardedRound === true;
      const nextStarByPlayer = sanitizeStarMapValue(session.starByPlayer);
      const savedMaxMultiplier = sanitizePositiveIntegerValue(rules.maxMultiplier, 8);

      setParticipantCount(nextParticipantCount);
      setNames(sanitizeNamesValue(rules.names));
      setActivePlayerIds(nextActivePlayerIds);
      setTeamAPlayers(nextTeamAPlayers);
      setDiscardedRound(nextDiscardedRound);
      setFinishOrder(nextDiscardedRound ? [] : sanitizeFinishOrderValue(session.finishOrder, nextActivePlayerIds));
      setInitialStarByPlayer(sanitizeStarMapValue(session.initialStarByPlayer ?? session.starByPlayer));
      setStarByPlayer(nextStarByPlayer);
      setBaseScores(sanitizeBaseScoresValue(rules.baseScores));
      setMaxMultiplier(maxMultiplierOptions.includes(savedMaxMultiplier) ? savedMaxMultiplier : 8);
      setContributionScores(sanitizeContributionScoresValue(rules.contributionScores));
      setSplitBombSharingEnabled(rules.splitBombSharingEnabled !== false);
      setSplitBombShareNumerator(sanitizePositiveIntegerValue(rules.splitBombShareNumerator, 2));
      setSplitBombShareDenominator(sanitizePositiveIntegerValue(rules.splitBombShareDenominator, 3));
      setRounds(sanitizeRoundRecordsValue(session.rounds, nextParticipantCount));
      setUndoneRounds(sanitizeRoundRecordsValue(session.undoneRounds, nextParticipantCount));
      setPendingSwapOutId(null);
      setStorageReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          rules: {
            participantCount,
            names,
            baseScores,
            maxMultiplier,
            contributionScores,
            splitBombSharingEnabled,
            splitBombShareNumerator,
            splitBombShareDenominator,
          },
          session: {
            activePlayerIds,
            teamAPlayers,
            discardedRound,
            finishOrder,
            initialStarByPlayer,
            starByPlayer,
            rounds,
            undoneRounds,
          },
        }),
      );
    } catch {
      // The scorer remains usable even if private browsing or quota limits block persistence.
    }
  }, [
    activePlayerIds,
    baseScores,
    contributionScores,
    discardedRound,
    finishOrder,
    initialStarByPlayer,
    maxMultiplier,
    names,
    participantCount,
    rounds,
    splitBombShareDenominator,
    splitBombShareNumerator,
    splitBombSharingEnabled,
    starByPlayer,
    storageReady,
    teamAPlayers,
    undoneRounds,
  ]);

  const visiblePlayers = useMemo(() => getVisiblePlayers(participantCount), [participantCount]);
  const visiblePlayerIds = useMemo(() => visiblePlayers.map((player) => player.id), [visiblePlayers]);
  const teamAssignment = useMemo(
    () => buildTeamAssignment(activePlayerIds, teamAPlayers),
    [activePlayerIds, teamAPlayers],
  );
  const currentRound = useMemo(
    () =>
      buildRoundScore({
        activePlayerIds,
        baseScores,
        discarded: discardedRound,
        maxMultiplier,
        contributionScores,
        finishOrder,
        initialStarByPlayer,
        splitBombShareDenominator,
        splitBombShareNumerator,
        splitBombSharingEnabled,
        teamAssignment,
        starByPlayer,
      }),
    [
      activePlayerIds,
      baseScores,
      contributionScores,
      discardedRound,
      finishOrder,
      initialStarByPlayer,
      maxMultiplier,
      splitBombShareDenominator,
      splitBombShareNumerator,
      splitBombSharingEnabled,
      starByPlayer,
      teamAssignment,
    ],
  );

  const totals = useMemo(() => {
    return rounds.reduce<ScoreMap>(
      (sum, round) => {
        playerList.forEach((player) => {
          sum[player.id] += round.scores[player.id];
        });
        return sum;
      },
      { ...emptyScores },
    );
  }, [rounds]);

  const leadingScore = Math.max(...visiblePlayers.map((player) => totals[player.id]), 0);
  const winLossScore = roundScore(currentRound.baseScore * currentRound.multiplier);
  const canRecordRound = discardedRound || finishOrder.length === 4;

  function applyParticipantCount(nextCount: ParticipantCount) {
    const nextVisibleIds = getVisiblePlayerIds(nextCount);
    const nextActive = sanitizeActivePlayers(activePlayerIds, nextVisibleIds);
    const nextTeamA = sanitizeTeamAPlayers(teamAPlayers, nextActive);
    setParticipantCount(nextCount);
    setActivePlayerIds(nextActive);
    setTeamAPlayers(nextTeamA);
    setDiscardedRound(false);
    setFinishOrder([]);
    setPendingSwapOutId(null);
  }

  function replaceActivePlayer(outPlayerId: PlayerId, inPlayerId: PlayerId) {
    if (outPlayerId === inPlayerId || activePlayerIds.includes(inPlayerId)) return;
    const outIndex = activePlayerIds.indexOf(outPlayerId);
    if (outIndex < 0) return;

    const nextActive = [...activePlayerIds];
    nextActive[outIndex] = inPlayerId;
    const nextTeamA = sanitizeTeamAPlayers(
      teamAPlayers.map((playerId) => (playerId === outPlayerId ? inPlayerId : playerId)),
      nextActive,
    );
    setActivePlayerIds(nextActive);
    setTeamAPlayers(nextTeamA);
    setDiscardedRound(false);
    setFinishOrder([]);
    setPendingSwapOutId(null);
  }

  function applyPlayerSelectionToggle(playerId: PlayerId) {
    const isActive = activePlayerIds.includes(playerId);
    const benchPlayerIds = visiblePlayerIds.filter((visiblePlayerId) => !activePlayerIds.includes(visiblePlayerId));

    if (participantCount === 4) {
      setPendingSwapOutId(null);
      return;
    }

    if (isActive) {
      if (participantCount === 5 && benchPlayerIds.length === 1) {
        replaceActivePlayer(playerId, benchPlayerIds[0]);
        return;
      }
      setPendingSwapOutId((current) => (current === playerId ? null : playerId));
      return;
    }

    if (pendingSwapOutId && activePlayerIds.includes(pendingSwapOutId)) {
      replaceActivePlayer(pendingSwapOutId, playerId);
      return;
    }

    if (participantCount === 5 && activePlayerIds.length === 4) {
      replaceActivePlayer(activePlayerIds[activePlayerIds.length - 1], playerId);
    }
  }

  function applyTeamAPlayerChange(slotIndex: number, nextPlayer: PlayerId) {
    const swapped = updatePlayerSlot(teamAPlayers, slotIndex, nextPlayer);
    setTeamAPlayers(sanitizeTeamAPlayers(swapped, activePlayerIds));
  }

  function applySingleStarChange(playerId: PlayerId, nextStar: StarLevel) {
    setInitialStarByPlayer((current) => ({ ...current, [playerId]: nextStar }));
    setStarByPlayer((current) => ({ ...current, [playerId]: nextStar }));
  }

  function applyInitialStarChange(playerId: PlayerId, nextStar: StarLevel) {
    setInitialStarByPlayer((current) => ({ ...current, [playerId]: nextStar }));
    setStarByPlayer((current) => ({ ...current, [playerId]: nextStar }));
  }

  function applySettlementStarChange(playerId: PlayerId, nextStar: StarLevel) {
    setStarByPlayer((current) => ({ ...current, [playerId]: nextStar }));
  }

  function clearStars() {
    setInitialStarByPlayer(emptyStars);
    setStarByPlayer(emptyStars);
  }

  function clearFinishOrder() {
    setDiscardedRound(false);
    setFinishOrder([]);
  }

  function toggleFinishOrderPlayer(playerId: PlayerId) {
    if (discardedRound) return;
    setFinishOrder((current) => {
      if (current.includes(playerId)) return current.filter((item) => item !== playerId);
      if (current.length >= 4) return current;
      const next = [...current, playerId];
      if (next.length === 3) {
        const lastPlayerId = activePlayerIds.find((activePlayerId) => !next.includes(activePlayerId));
        return lastPlayerId ? [...next, lastPlayerId] : next;
      }
      return next;
    });
  }

  function toggleDiscardedRound() {
    setDiscardedRound((current) => {
      const next = !current;
      if (next) setFinishOrder([]);
      return next;
    });
  }

  function resetRoundOptions() {
    const nextActive = sanitizeActivePlayers(visiblePlayerIds.slice(0, 4), visiblePlayerIds);
    const nextTeamA = sanitizeTeamAPlayers([nextActive[0], nextActive[2]], nextActive);
    setActivePlayerIds(nextActive);
    setTeamAPlayers(nextTeamA);
    setDiscardedRound(false);
    setFinishOrder([]);
    clearStars();
    setPendingSwapOutId(null);
  }

  function addRound() {
    if (!canRecordRound) return;
    const record: RoundRecord = {
      id: `${Date.now()}-${rounds.length}`,
      at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      activePlayerIds: [...activePlayerIds],
      discarded: discardedRound,
      finishOrder: discardedRound ? [] : [...finishOrder],
      resultName: currentRound.resultName,
      scoringTeam: currentRound.baseScore > 0 ? currentRound.scoringTeam : null,
      baseScore: currentRound.baseScore,
      multiplier: currentRound.multiplier,
      highestWinningStar: currentRound.highestWinningStar,
      scores: { ...currentRound.scores },
      starByPlayer: { ...starByPlayer },
      initialStarByPlayer: { ...initialStarByPlayer },
      splitBombSharingEnabled,
      splitBombShareNumerator,
      splitBombShareDenominator,
      teamAPlayers: [...teamAPlayers],
    };
    setRounds((current) => [record, ...current]);
    setUndoneRounds([]);
    setDiscardedRound(false);
    clearStars();
    clearFinishOrder();
  }

  function undoRound() {
    const [latestRound, ...remainingRounds] = rounds;
    if (!latestRound) return;
    setRounds(remainingRounds);
    setUndoneRounds((current) => [latestRound, ...current]);
  }

  function restoreRound() {
    const [restoredRound, ...remainingUndoneRounds] = undoneRounds;
    if (!restoredRound) return;
    setUndoneRounds(remainingUndoneRounds);
    setRounds((current) => [restoredRound, ...current]);
  }

  function restartScoring() {
    setRounds([]);
    setUndoneRounds([]);
  }

  async function copySummary() {
    const lines = [
      "累计积分",
      `${rounds.length}局已记录`,
      `领先：${formatScoreNumber(leadingScore)}`,
      ...visiblePlayers.map((player) => `${getPlayerName(names, player.id)}：${totals[player.id]} 分`),
    ];
    try {
      await navigator.clipboard?.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f7f2] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-700 text-base font-black text-white sm:h-11 sm:w-11 sm:text-lg">
              双
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black text-slate-950 sm:text-2xl">双扣计分工具</h1>
              <p className="text-xs text-slate-500 sm:text-sm">{subtitle}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 text-xs sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:text-sm">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-2 font-bold text-slate-700 hover:bg-slate-50 sm:h-10 sm:px-3"
              onClick={restartScoring}
              title="清空记录重新开始"
            >
              <Icon name="refresh" />
              重新开始
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-950 px-2 font-bold text-white hover:bg-emerald-800 sm:h-10 sm:px-3"
              onClick={() => setRulesOpen(true)}
              title="打开规则设置"
            >
              <Icon name="calculator" />
              规则设置
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 lg:px-6">
        <section className="grid gap-3 sm:gap-4">
          {participantCount === 4 ? (
            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="grid content-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:gap-3 sm:p-3">
                <div className="text-sm font-black text-slate-800">A 队搭档</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-2">
                    <select
                      aria-label="A队第 1 人"
                      value={teamAPlayers[0]}
                      onChange={(event) => applyTeamAPlayerChange(0, event.target.value as PlayerId)}
                      className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:border-emerald-600 sm:h-10 sm:px-3 sm:text-sm"
                    >
                      {activePlayerIds.map((playerId) => (
                        <option key={`team-a-first-four-${playerId}`} value={playerId}>
                          {getPlayerName(names, playerId)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <select
                      aria-label="A队对家"
                      value={teamAPlayers[1]}
                      onChange={(event) => applyTeamAPlayerChange(1, event.target.value as PlayerId)}
                      className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:border-emerald-600 sm:h-10 sm:px-3 sm:text-sm"
                    >
                      {activePlayerIds.map((playerId) => (
                        <option key={`team-a-second-four-${playerId}`} value={playerId}>
                          {getPlayerName(names, playerId)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </section>
          ) : null}

          {participantCount > 4 ? (
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                  <Icon name="medal" />
                  本局上场与队伍
                </div>
                <p className="mt-1 hidden text-xs leading-5 text-slate-500 sm:block sm:text-sm">每局选 4 人上场，再选 A 队两人；上场中剩下两人为 B 队。</p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:h-9 sm:gap-2 sm:px-3 sm:text-sm"
                onClick={resetRoundOptions}
                title="恢复前四人上场，第一和第三一队"
              >
                <Icon name="refresh" />
                默认前四
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid grid-cols-2 content-start gap-2 sm:gap-3">
                {visiblePlayers.map((player) => {
                  const status = teamAssignment[player.id];
                  const isActive = status === "teamA" || status === "teamB";
                  const isPendingSwapOut = pendingSwapOutId === player.id;
                  const canSwapIn = !isActive && Boolean(pendingSwapOutId);
                  return (
                    <button
                      key={`player-toggle-${player.id}`}
                      type="button"
                      aria-pressed={isActive}
                      className={`flex min-h-14 min-w-0 items-center justify-between gap-2 rounded-lg border p-2 text-left transition sm:min-h-20 sm:gap-3 sm:p-3 ${
                        isPendingSwapOut
                          ? "border-amber-400 bg-amber-50 text-amber-950"
                          : isActive
                            ? "border-emerald-200 bg-emerald-50 text-slate-950 hover:border-emerald-500"
                            : canSwapIn
                              ? "border-slate-300 bg-white text-slate-950 hover:border-emerald-500 hover:bg-emerald-50"
                              : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300"
                      }`}
                      data-player-toggle={player.id}
                      onClick={() => applyPlayerSelectionToggle(player.id)}
                      title={canSwapIn ? "点此上场" : isActive ? "点此休息" : "休息"}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black sm:text-sm">{getPlayerName(names, player.id)}</span>
                      </span>
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-black sm:h-8 sm:w-8 sm:text-xs ${
                          isPendingSwapOut
                            ? "bg-amber-500 text-white"
                            : status === "teamA"
                              ? "bg-emerald-700 text-white"
                              : status === "teamB"
                                ? "bg-red-700 text-white"
                                : canSwapIn
                                  ? "bg-slate-900 text-white"
                                  : "bg-slate-200 text-slate-500"
                        }`}
                      >
                        {isPendingSwapOut ? (
                          "换"
                        ) : status === "teamA" ? (
                          "A"
                        ) : status === "teamB" ? (
                          "B"
                        ) : (
                          <Icon name="rest" className="h-4 w-4" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid content-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:gap-3 sm:p-3">
                <div className="text-sm font-black text-slate-800">A 队搭档</div>
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
                <label className="grid gap-2">
                  <select
                    aria-label="A队第 1 人"
                    value={teamAPlayers[0]}
                    onChange={(event) => applyTeamAPlayerChange(0, event.target.value as PlayerId)}
                    className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:border-emerald-600 sm:h-10 sm:px-3 sm:text-sm"
                  >
                    {activePlayerIds.map((playerId) => (
                      <option key={`team-a-first-${playerId}`} value={playerId}>
                        {getPlayerName(names, playerId)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <select
                    aria-label="A队对家"
                    value={teamAPlayers[1]}
                    onChange={(event) => applyTeamAPlayerChange(1, event.target.value as PlayerId)}
                    className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:border-emerald-600 sm:h-10 sm:px-3 sm:text-sm"
                  >
                    {activePlayerIds.map((playerId) => (
                      <option key={`team-a-second-${playerId}`} value={playerId}>
                        {getPlayerName(names, playerId)}
                      </option>
                    ))}
                  </select>
                </label>
                </div>
              </div>
            </div>
          </section>
          ) : null}

          <div className="grid gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_320px_320px]">
            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                  <Icon name="medal" />
                  出完顺序
                  <button
                    type="button"
                    className={`inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs font-bold transition ${
                      discardedRound
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                    onClick={toggleDiscardedRound}
                    aria-pressed={discardedRound}
                  >
                    丢牌
                  </button>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:h-9 sm:px-3 sm:text-sm"
                  onClick={clearFinishOrder}
                >
                  <Icon name="refresh" />
                  重排
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3">
                {activePlayerIds.map((playerId) => {
                  const rank = finishOrder.indexOf(playerId) + 1;
                  const selected = rank > 0;
                  const status = teamAssignment[playerId];
                  return (
                    <button
                      key={`finish-order-${playerId}`}
                      type="button"
                      className={`flex min-h-14 min-w-0 items-center justify-between gap-2 rounded-lg border p-2 text-left transition sm:min-h-16 sm:p-3 ${
                        discardedRound
                          ? "border-slate-200 bg-slate-100 text-slate-400 opacity-60"
                          : selected
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-slate-200 bg-slate-50 hover:border-emerald-400 hover:bg-white"
                      }`}
                      disabled={discardedRound}
                      onClick={() => toggleFinishOrderPlayer(playerId)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black text-slate-950 sm:text-sm">{getPlayerName(names, playerId)}</span>
                        <span className={status === "teamA" ? "mt-1 block text-xs font-bold text-emerald-700" : "mt-1 block text-xs font-bold text-red-700"}>
                          {status === "teamA" ? "A队" : "B队"}
                        </span>
                      </span>
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm font-black ${
                          selected
                            ? "bg-slate-950 text-white"
                            : status === "teamA"
                              ? "bg-emerald-700 text-white"
                              : "bg-red-700 text-white"
                        }`}
                      >
                        {selected ? rank : status === "teamA" ? "A" : "B"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
                <div>
                  <div className="text-sm font-black text-slate-800">本局星炸弹</div>
                  <p className="mt-1 hidden text-xs leading-5 text-slate-500 sm:block sm:text-sm">
                    每个上场玩家单独填写。胜负分按胜方最高星翻倍；6 星以上同时按个人贡献分结算。
                  </p>
                </div>
                <button
                  type="button"
                  className="h-8 rounded-md border border-slate-200 px-2 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:h-9 sm:px-3 sm:text-sm"
                  onClick={clearStars}
                >
                  清空星数
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
                {activePlayerIds.map((playerId) => {
                  const partnerId = getTeamPartner(playerId, teamAssignment);
                  const splitBombCompensation = splitBombSharingEnabled
                    ? getSplitBombCompensation({
                        activePlayerIds,
                        contributionScores,
                        initialStarByPlayer,
                        playerId,
                        shareDenominator: splitBombShareDenominator,
                        shareNumerator: splitBombShareNumerator,
                        starByPlayer,
                      })
                    : 0;
                  return (
                    <div key={`star-${playerId}`} className="grid min-w-0 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:gap-2 sm:p-3">
                      <span className="flex min-w-0 items-center justify-between gap-2 text-xs font-bold text-slate-700 sm:text-sm">
                        <span className="min-w-0 truncate">{getPlayerName(names, playerId)}</span>
                        <span className={teamAssignment[playerId] === "teamA" ? "text-emerald-700" : "text-red-700"}>
                          {teamNames[teamAssignment[playerId] as TeamKey]}
                        </span>
                      </span>
                      {splitBombSharingEnabled ? (
                        <div className="grid grid-cols-2 gap-1.5">
                          <label className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-1.5 text-xs font-bold text-slate-500">
                            <span>起牌</span>
                            <select
                              value={initialStarByPlayer[playerId]}
                              onChange={(event) => applyInitialStarChange(playerId, parseStarLevel(event.target.value))}
                              className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-950 outline-none focus:border-emerald-600 sm:px-2 sm:text-xs"
                            >
                              {starOptions.map((star) => (
                                <option key={`${playerId}-initial-${star}`} value={star}>
                                  {star === 0 ? "无星炸弹" : `${star} 星`}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-1.5 text-xs font-bold text-slate-500">
                            <span>结算</span>
                            <select
                              value={starByPlayer[playerId]}
                              onChange={(event) => applySettlementStarChange(playerId, parseStarLevel(event.target.value))}
                              className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-950 outline-none focus:border-emerald-600 sm:px-2 sm:text-xs"
                            >
                              {starOptions.map((star) => (
                                <option key={`${playerId}-settlement-${star}`} value={star}>
                                  {star === 0 ? "无星炸弹" : `${star} 星`}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : (
                        <select
                          value={starByPlayer[playerId]}
                          onChange={(event) => applySingleStarChange(playerId, parseStarLevel(event.target.value))}
                          className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:border-emerald-600 sm:h-10 sm:px-3 sm:text-sm"
                        >
                          {starOptions.map((star) => (
                            <option key={`${playerId}-${star}`} value={star}>
                              {star === 0 ? "无星炸弹" : `${star} 星`}
                            </option>
                          ))}
                        </select>
                      )}
                      {splitBombCompensation > 0 && partnerId ? (
                        <span className="text-xs font-semibold text-amber-700">
                          拆炸补偿：{getPlayerName(names, partnerId)} -{formatScoreNumber(splitBombCompensation)}，本人 +
                          {formatScoreNumber(splitBombCompensation)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <aside className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="rounded-lg border border-slate-200 bg-[#123f32] p-3 text-white sm:p-4">
                <div className="text-xs text-emerald-100 sm:text-sm">结果</div>
                <div className="mt-1 text-3xl font-black sm:text-4xl">{currentRound.resultName}</div>
              </div>
              <div className="mt-3 grid gap-1.5 sm:mt-4 sm:gap-2">
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm">
                  <span className="text-slate-500">胜负分</span>
                  <strong>
                    {currentRound.baseScore} x {currentRound.multiplier} = {winLossScore}
                  </strong>
                </div>
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm">
                  <span className="text-slate-500">胜方最高星</span>
                  <strong>{currentRound.highestWinningStar ? `${currentRound.highestWinningStar}星` : "无"}</strong>
                </div>
                {visiblePlayers.map((player) => (
                  <div key={`preview-score-${player.id}`} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1.5 sm:px-3 sm:py-2">
                    <PlayerBadge playerId={player.id} names={names} teamAssignment={teamAssignment} compact />
                    <ScorePill value={currentRound.scores[player.id]} />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-black text-white hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 sm:mt-4 sm:h-11"
                onClick={addRound}
                disabled={!canRecordRound}
                title="把当前本局分加入累计"
              >
                <Icon name="plus" />
                记入本局
              </button>
            </aside>
          </div>

        </section>

        <aside className="grid gap-3 sm:gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-black text-slate-800">累计积分</div>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    onClick={copySummary}
                    title="复制累计积分"
                  >
                    <Icon name="copy" className="h-3.5 w-3.5" />
                    {copied ? "已复制" : "复制汇总"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500 sm:text-sm">{rounds.length} 局已记录</p>
              </div>
              <div className="rounded-md bg-slate-100 px-2 py-1.5 text-xs font-black text-slate-700 sm:px-3 sm:py-2 sm:text-sm">
                领先 {formatScoreNumber(leadingScore)}
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:mt-4">
              {visiblePlayers.map((player) => (
                <div key={`total-${player.id}`} className="rounded-lg border border-slate-200 p-2.5 sm:p-3">
                  <div className="flex items-center justify-between gap-3">
                    <PlayerBadge playerId={player.id} names={names} teamAssignment={teamAssignment} />
                    <span className="text-xl font-black text-slate-950 sm:text-2xl">{formatScoreNumber(totals[player.id])}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                    <div
                      className={`h-full rounded ${
                        teamAssignment[player.id] === "teamA"
                          ? "bg-emerald-700"
                          : teamAssignment[player.id] === "teamB"
                            ? "bg-red-700"
                            : "bg-slate-400"
                      }`}
                      style={{ width: `${Math.max(4, totals[player.id] > 0 && leadingScore > 0 ? (totals[player.id] / leadingScore) * 100 : 4)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:h-10"
                onClick={undoRound}
                disabled={rounds.length === 0}
                title="撤销上一局"
              >
                <Icon name="undo" />
                撤销
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 sm:h-10"
                onClick={restoreRound}
                disabled={undoneRounds.length === 0}
                title="恢复撤销的一局"
              >
                <Icon name="refresh" />
                恢复
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="text-sm font-black text-slate-800">历史记录</div>
            <div className="mt-3 grid max-h-[520px] gap-2 overflow-auto pr-1">
              {rounds.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs leading-5 text-slate-500 sm:p-4 sm:text-sm sm:leading-6">
                  还没有记录。设置本局结果后点“记入本局”，累计分会自动更新。
                </div>
              ) : (
                rounds.map((round, index) => {
                  const roundTeamAssignment = buildTeamAssignment(round.activePlayerIds, round.teamAPlayers);
                  const roundWinningTeam = round.scoringTeam ?? resolveResult(round.finishOrder, roundTeamAssignment).scoringTeam;
                  const roundLosingTeam = roundWinningTeam ? getOpposingTeam(roundWinningTeam) : null;
                  const roundWinningPlayers = roundWinningTeam ? getTeamPlayers(roundWinningTeam, roundTeamAssignment) : [];
                  const roundLosingPlayers = roundLosingTeam ? getTeamPlayers(roundLosingTeam, roundTeamAssignment) : [];
                  return (
                    <div key={round.id} className="rounded-lg border border-slate-200 p-2.5 sm:p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-black text-slate-950">
                          第 {rounds.length - index} 局 · {round.resultName}
                        </div>
                        <div className="text-xs text-slate-400">{round.at}</div>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {round.discarded ? (
                          <div>只计炸弹贡献</div>
                        ) : (
                          <>
                            <div>胜方：{getRoundSideStarSummary(names, roundWinningPlayers, round)}</div>
                            <div>负方：{getRoundSideStarSummary(names, roundLosingPlayers, round)}</div>
                          </>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-2">
                        {visiblePlayers.map((player) => (
                          <div key={`${round.id}-${player.id}`} className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1">
                            <span className="truncate text-xs font-semibold text-slate-700">
                              {getPlayerName(names, player.id)}
                            </span>
                            <span className={`text-xs font-black sm:text-sm ${round.scores[player.id] >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                              {formatSigned(round.scores[player.id])}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

        </aside>
      </div>

      {rulesOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-950/55 p-3 sm:p-6"
          role="presentation"
          onClick={() => setRulesOpen(false)}
        >
          <section
            aria-labelledby="rules-settings-title"
            aria-modal="true"
            className="my-3 w-full max-w-5xl rounded-lg bg-white shadow-2xl"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-slate-200 bg-white px-4 py-3">
              <div>
                <div id="rules-settings-title" className="text-lg font-black text-slate-950">
                  规则设置
                </div>
                <p className="mt-1 text-sm text-slate-500">调整玩家名单、胜负分和贡献分。</p>
              </div>
              <button
                type="button"
                className="h-9 rounded-md border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                onClick={() => setRulesOpen(false)}
              >
                关闭
              </button>
            </div>

            <div className="grid gap-6 p-4 sm:p-5">
              <section>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-emerald-800">
                      <Icon name="cards" />
                      玩家名单
                    </div>
                    <p className="mt-1 text-sm text-slate-500">可设置 4、5 或 6 人总名单；每局只选 4 人上场。</p>
                  </div>
                  <div className="rounded-md bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">
                    默认封顶 8 倍，双扣/单扣/平扣默认 3/2/1 分
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {([4, 5, 6] as ParticipantCount[]).map((count) => (
                    <button
                      key={`participant-count-${count}`}
                      type="button"
                      className={`h-9 rounded-md border px-3 text-sm font-bold ${
                        participantCount === count
                          ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                          : "border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => applyParticipantCount(count)}
                    >
                      {count} 人计分
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
                  {visiblePlayers.map((player, index) => (
                    <label key={player.id} className="grid min-w-0 gap-2 rounded-lg border border-slate-200 p-3">
                      <span className="flex min-w-0 items-center justify-between gap-2 text-sm font-bold text-slate-700">
                        <span className="min-w-0 truncate">玩家 {index + 1}</span>
                        <span
                          className={`shrink-0 ${
                            teamAssignment[player.id] === "teamA"
                              ? "text-emerald-700"
                              : teamAssignment[player.id] === "teamB"
                                ? "text-red-700"
                                : "text-slate-400"
                          }`}
                        >
                          {teamAssignment[player.id] === "teamA"
                            ? "本局A队"
                            : teamAssignment[player.id] === "teamB"
                              ? "本局B队"
                              : "本局休息"}
                        </span>
                      </span>
                      <input
                        value={names[player.id]}
                        onChange={(event) => setNames((current) => ({ ...current, [player.id]: event.target.value }))}
                        className="h-10 w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-emerald-600 focus:bg-white"
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="border-t border-slate-200 pt-5">
                <div className="text-sm font-black text-slate-800">胜负分设置</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    { key: "double" as ResultKey, label: "双扣分" },
                    { key: "single" as ResultKey, label: "单扣分" },
                    { key: "flat" as ResultKey, label: "平扣分" },
                  ].map((item) => (
                    <label key={item.key} className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm font-bold text-slate-700">
                      {item.label}
                      <input
                        type="number"
                        min={0}
                        value={baseScores[item.key]}
                        onChange={(event) =>
                          setBaseScores((current) => ({
                            ...current,
                            [item.key]: parseNonNegativeInt(event.target.value, current[item.key]),
                          }))
                        }
                        className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-emerald-600 focus:bg-white"
                      />
                    </label>
                  ))}
                  <label className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm font-bold text-slate-700">
                    最高倍数
                    <select
                      value={maxMultiplier}
                      onChange={(event) => setMaxMultiplier(parsePositiveInt(event.target.value, maxMultiplier))}
                      className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-emerald-600 focus:bg-white"
                    >
                      {maxMultiplierOptions.map((option) => (
                        <option key={`max-multiplier-${option}`} value={option}>
                          {option} 倍
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  翻倍规则：5星 x2，6星 x4，7星 x8，8星 x16，之后继续翻倍，并受最高倍数限制。
                </p>
              </section>

              <section className="border-t border-slate-200 pt-5">
                <div className="text-sm font-black text-slate-800">模式选择</div>
                <div className="mt-3 rounded-lg border border-slate-200 p-3">
                  <label className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <span className="block text-sm font-black text-slate-800">拆炸弹对家分担</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={splitBombSharingEnabled}
                      onChange={(event) => setSplitBombSharingEnabled(event.target.checked)}
                      className="h-5 w-5 accent-emerald-700"
                    />
                  </label>
                  {splitBombSharingEnabled ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
                      <label className="grid gap-2 text-sm font-bold text-slate-700">
                        分担分子
                        <input
                          type="number"
                          min={1}
                          value={splitBombShareNumerator}
                          onChange={(event) => setSplitBombShareNumerator(parsePositiveInt(event.target.value, splitBombShareNumerator))}
                          className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </label>
                      <span className="hidden pb-2 text-center text-lg font-black text-slate-400 sm:block">/</span>
                      <label className="grid gap-2 text-sm font-bold text-slate-700">
                        分担分母
                        <input
                          type="number"
                          min={1}
                          value={splitBombShareDenominator}
                          onChange={(event) => setSplitBombShareDenominator(parsePositiveInt(event.target.value, splitBombShareDenominator))}
                          className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="border-t border-slate-200 pt-5">
                <div className="text-sm font-black text-slate-800">贡献分设置</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {contributionStars.map((star) => (
                    <label key={`contribution-${star}`} className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm font-bold text-slate-700">
                      {star}星每家付
                      <input
                        type="number"
                        min={0}
                        value={contributionScores[star]}
                        onChange={(event) =>
                          setContributionScores((current) => ({
                            ...current,
                            [star]: parseNonNegativeInt(event.target.value, current[star]),
                          }))
                        }
                        className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-emerald-600 focus:bg-white"
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  贡献分按玩家个人结算：某玩家打出 7 星，若 7 星每家付 6，则本人 +18，其他三家各 -6。
                </p>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
