import { NextResponse } from "next/server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

type TankBattleRelayRole = "host" | "guest";

type TankBattleRelayInput = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
};

type TankBattleRelayRoom = {
  roomId: string;
  createdAt: number;
  updatedAt: number;
  hostSeenAt: number;
  guestSeenAt: number;
  guestInput: TankBattleRelayInput;
  snapshot: unknown;
};

type TankBattleRelayGlobal = typeof globalThis & {
  __faollaTankBattleRelayRooms?: Map<string, TankBattleRelayRoom>;
};

const ROOM_TTL_MS = 2 * 60 * 1000;
const PRESENCE_TTL_MS = 7_000;
const emptyInput: TankBattleRelayInput = { up: false, down: false, left: false, right: false, fire: false };
const relayGlobal = globalThis as TankBattleRelayGlobal;
const rooms = relayGlobal.__faollaTankBattleRelayRooms ?? new Map<string, TankBattleRelayRoom>();
relayGlobal.__faollaTankBattleRelayRooms = rooms;

function normalizeRoomId(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) : "";
}

function normalizeRole(value: unknown): TankBattleRelayRole | null {
  return value === "host" || value === "guest" ? value : null;
}

function normalizeInput(value: unknown): TankBattleRelayInput {
  if (!value || typeof value !== "object") return { ...emptyInput };
  const record = value as Partial<Record<keyof TankBattleRelayInput, unknown>>;
  return {
    up: record.up === true,
    down: record.down === true,
    left: record.left === true,
    right: record.right === true,
    fire: record.fire === true,
  };
}

function cleanupRooms(now: number) {
  for (const [roomId, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}

function getRoom(roomId: string, now: number) {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const room: TankBattleRelayRoom = {
    roomId,
    createdAt: now,
    updatedAt: now,
    hostSeenAt: 0,
    guestSeenAt: 0,
    guestInput: { ...emptyInput },
    snapshot: null,
  };
  rooms.set(roomId, room);
  return room;
}

function buildRoomResponse(room: TankBattleRelayRoom, now: number) {
  const hasHost = now - room.hostSeenAt <= PRESENCE_TTL_MS;
  const hasGuest = now - room.guestSeenAt <= PRESENCE_TTL_MS;
  return {
    ok: true,
    roomId: room.roomId,
    peers: Number(hasHost) + Number(hasGuest),
    hasHost,
    hasGuest,
    guestInput: hasGuest ? room.guestInput : emptyInput,
    snapshot: room.snapshot,
  };
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const roomId = normalizeRoomId(body.roomId);
  const role = normalizeRole(body.role);
  if (!roomId || !role) {
    return NextResponse.json({ ok: false, error: "invalid_room" }, { status: 400 });
  }

  const now = Date.now();
  cleanupRooms(now);
  const room = getRoom(roomId, now);
  room.updatedAt = now;

  if (role === "host") {
    room.hostSeenAt = now;
    if (body.state && typeof body.state === "object") {
      room.snapshot = body.state;
    }
  } else {
    room.guestSeenAt = now;
    room.guestInput = normalizeInput(body.input);
  }

  return NextResponse.json(buildRoomResponse(room, now));
}
