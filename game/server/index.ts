import express from "express";
import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import {
  botCommand,
  createGame,
  projectGame,
  reduceGame,
} from "../shared/engine";
import type { Game, Command } from "../shared/types";

const app = express();
const http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 16384 });
const port = Number(process.env.GAME_PORT || 3311);
interface Session {
  id: string;
  token: string;
  name: string;
  rating: number;
  games: number;
  room?: string;
}
interface Member {
  id: string;
  name: string;
  team: number | null;
  connected: boolean;
}
interface Room {
  id: string;
  mode: "training" | "private" | "duel";
  host: string;
  members: Member[];
  tiebreak: number;
  locked: boolean;
  chat: {
    id: string;
    name: string;
    text: string;
    team: number | null;
    time: number;
  }[];
  game?: Game;
  timer?: ReturnType<typeof setTimeout>;
  rated?: boolean;
}
const sessions = new Map<string, Session>(),
  rooms = new Map<string, Room>(),
  peers = new Map<string, Set<string>>();
const dataDir = resolve(process.env.GAME_DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });
const sessionFile = resolve(dataDir, "sessions.json");
try {
  for (const s of JSON.parse(readFileSync(sessionFile, "utf8")))
    sessions.set(s.token, { ...s, room: undefined });
} catch {}
function save() {
  const tmp = sessionFile + ".tmp";
  writeFileSync(
    tmp,
    JSON.stringify([...sessions.values()].map(({ room, ...s }) => s)),
    { mode: 0o600 },
  );
  renameSync(tmp, sessionFile);
}
function publicSession(s: Session) {
  return {
    id: s.id,
    token: s.token,
    name: s.name,
    rating: s.rating,
    games: s.games,
  };
}
const nameSchema = z.string().trim().min(1).max(20),
  ids = z.array(z.string().max(80)).max(99);
const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("play"),
    cards: ids,
    target: z.number().int().min(0).max(8),
    exchange: z
      .object({
        hp: z.number().int().min(0).max(999),
        mp: z.number().int().min(0).max(999),
        cp: z.number().int().min(0).max(999),
      })
      .optional(),
    tradeCard: z.string().max(80).optional(),
  }),
  z.object({
    type: z.literal("defend"),
    cards: ids,
    buy: z.boolean().optional(),
  }),
  z.object({ type: z.literal("pray") }),
  z.object({ type: z.literal("purchase"), accept: z.boolean() }),
  z.object({ type: z.literal("discard"), cards: ids }),
  z.object({ type: z.literal("surrender") }),
]);
function getSession(id: string) {
  return [...sessions.values()].find((s) => s.id === id);
}
function broadcastCounts() {
  const counts = { training: 0, private: 0, duel: 0 };
  for (const r of rooms.values())
    counts[r.mode] += r.members.filter((m) => m.connected).length;
  io.emit("counts", counts);
}
function stateFor(room: Room, id: string) {
  const self = room.members.find((m) => m.id === id);
  return {
    id: room.id,
    mode: room.mode,
    host: room.host,
    members: room.members,
    tiebreak: room.tiebreak,
    locked: room.locked,
    chat: room.chat.filter(
      (c) => c.team === null || (self?.team !== null && self?.team === c.team),
    ),
    game: room.game ? projectGame(room.game, id) : null,
  };
}
function update(room: Room) {
  for (const m of room.members)
    for (const sid of peers.get(m.id) || [])
      io.to(sid).emit("room", stateFor(room, m.id));
  broadcastCounts();
}
function score(room: Room) {
  const g = room.game;
  if (!g || g.phase !== "ended" || room.rated || room.mode !== "duel") return;
  room.rated = true;
  const a = getSession(g.players[0].id),
    b = getSession(g.players[1].id);
  if (!a || !b) return;
  const actual =
    g.winners.length === 0 ? 0.5 : g.winners.includes(a.id) ? 1 : 0;
  const diff = Math.round(
    32 * (actual - 1 / (1 + 10 ** ((b.rating - a.rating) / 400))),
  );
  a.rating += diff;
  b.rating -= diff;
  a.games++;
  b.games++;
  save();
  for (const s of [a, b])
    for (const sid of peers.get(s.id) || [])
      io.to(sid).emit("session", publicSession(s));
}
function advance(room: Room) {
  if (room.timer) clearTimeout(room.timer);
  score(room);
  update(room);
  const g = room.game;
  if (!g || g.phase === "ended") return;
  const actor = g.players[g.phase === "defense" ? g.queue[0].target : g.turn];
  const confused = g.phase === "action" && !!actor.confused;
  if (actor.bot || confused || !peers.get(actor.id)?.size) {
    room.timer = setTimeout(
      () => {
        try {
          if (!room.game || room.game.phase === "ended") return;
          room.game = reduceGame(
            room.game,
            actor.id,
            botCommand(
              room.game,
              room.game.players.findIndex((p) => p.id === actor.id),
            ),
          );
          advance(room);
        } catch (err) {
          console.error(
            "Bot action rejected",
            err instanceof Error ? err.message : "error",
          );
          if (room.game) {
            room.game = reduceGame(room.game, actor.id, { type: "surrender" });
            advance(room);
          }
        }
      },
      actor.bot || confused
        ? (g.revision === 0
            ? 1500 + g.rules.handSize * 250
            : playbackDuration(g.cues || [])) + 700
        : 30000,
    );
  }
}
function leave(s: Session) {
  const room = s.room ? rooms.get(s.room) : undefined;
  s.room = undefined;
  if (!room) return;
  if (
    room.game?.players.some((p) => p.id === s.id && p.hp > 0) &&
    room.game.phase !== "ended"
  ) {
    room.game = reduceGame(room.game, s.id, { type: "surrender" });
  }
  room.members = room.members.filter((m) => m.id !== s.id);
  if (room.host === s.id) room.host = room.members[0]?.id || "";
  if (!room.members.length) {
    if (room.timer) clearTimeout(room.timer);
    rooms.delete(room.id);
  } else advance(room);
  for (const sid of peers.get(s.id) || []) io.to(sid).emit("room", null);
  broadcastCounts();
}
function enter(s: Session, r: Room) {
  leave(s);
  s.room = r.id;
  r.members.push({
    id: s.id,
    name: s.name,
    team: r.mode === "private" ? null : 0,
    connected: true,
  });
  rooms.set(r.id, r);
  update(r);
}
function start(r: Room) {
  const members = r.members.filter((m) => m.team !== null);
  if (members.length < 2) throw new Error("至少需要两名已选择阵营的预言者");
  if (members.every((m) => m.team !== 0 && m.team === members[0].team))
    throw new Error("至少需要两个阵营");
  r.rated = false;
  r.game = createGame(
    members.map((m) => ({ id: m.id, name: m.name, team: m.team!, bot: false })),
    { tiebreak: r.tiebreak },
    randomBytes(4).readUInt32LE(),
  );
  advance(r);
}
io.on("connection", (socket: Socket) => {
  let token =
    typeof socket.handshake.auth.token === "string"
      ? socket.handshake.auth.token
      : "";
  let s = sessions.get(token);
  if (!s) {
    token = randomBytes(32).toString("hex");
    s = { id: randomUUID(), token, name: "预言者", rating: 1500, games: 0 };
    sessions.set(token, s);
    save();
  }
  const session = s;
  let set = peers.get(s.id);
  if (!set) {
    set = new Set();
    peers.set(s.id, set);
  }
  set.add(socket.id);
  socket.emit("session", publicSession(s));
  if (s.room && rooms.has(s.room)) {
    const room = rooms.get(s.room)!;
    const m = room.members.find((m) => m.id === s!.id);
    if (m) m.connected = true;
    socket.emit("room", stateFor(room, s.id));
    advance(room);
  }
  broadcastCounts();
  let windowStart = Date.now(),
    calls = 0;
  function on(event: string, fn: (payload: any) => void) {
    socket.on(event, (payload, ack) => {
      try {
        if (Date.now() - windowStart > 1000) {
          calls = 0;
          windowStart = Date.now();
        }
        if (++calls > 25) throw new Error("操作太频繁");
        fn(payload);
        if (typeof ack === "function") ack({ ok: true });
      } catch (e) {
        const message =
          e instanceof z.ZodError
            ? "请求格式无效"
            : e instanceof Error
              ? e.message
              : "请求失败";
        socket.emit("notice", message);
        if (typeof ack === "function") ack({ ok: false, error: message });
      }
    });
  }
  function room() {
    const r = session.room ? rooms.get(session.room) : undefined;
    if (!r) throw new Error("你不在房间中");
    return r;
  }
  function host() {
    const r = room();
    if (r.host !== session.id) throw new Error("仅房主可操作");
    return r;
  }
  on("login", (p) => {
    session.name = nameSchema.parse(p.name);
    save();
    socket.emit("session", publicSession(session));
  });
  on("training", (p) => {
    const count = z.number().int().min(2).max(9).parse(p.count);
    const tiebreak = z
      .union([
        z.literal(0),
        z.literal(1),
        z.literal(50),
        z.literal(75),
        z.literal(100),
        z.literal(150),
      ])
      .parse(p.tiebreak);
    const r: Room = {
      id: randomUUID(),
      mode: "training",
      host: session.id,
      members: [],
      tiebreak,
      locked: true,
      chat: [],
    };
    enter(session, r);
    const names = ["雪", "风", "月", "星", "空", "海", "森", "山"];
    r.game = createGame(
      [
        { id: session.id, name: session.name, team: 0, bot: false },
        ...Array.from({ length: count - 1 }, (_, i) => ({
          id: `bot-${i}`,
          name: names[i],
          team: 0,
          bot: true,
        })),
      ],
      { tiebreak },
      randomBytes(4).readUInt32LE(),
    );
    advance(r);
  });
  on("join", (p) => {
    const key = z.string().trim().min(1).max(64).parse(p.password);
    const id = createHash("sha256").update(key).digest("hex").slice(0, 24);
    let r = rooms.get(id);
    if (r && (r.locked || (r.game && r.game.phase !== "ended")))
      throw new Error("房间已锁定或正在对战");
    if (r && r.members.length >= 9) throw new Error("房间人数已满");
    if (session.room === id) {
      update(r!);
      return;
    }
    if (!r)
      r = {
        id,
        mode: "private",
        host: session.id,
        members: [],
        tiebreak: 100,
        locked: false,
        chat: [],
      };
    enter(session, r);
  });
  on("team", (p) => {
    const team = z.number().int().min(0).max(4).nullable().parse(p.team);
    const r = room();
    if (r.game && r.game.phase !== "ended")
      throw new Error("游戏中无法更换阵营");
    r.members.find((m) => m.id === session.id)!.team = team;
    update(r);
  });
  on("configure", (p) => {
    const r = host();
    if (r.game && r.game.phase !== "ended")
      throw new Error("游戏中无法更改配置");
    if (p.tiebreak !== undefined)
      r.tiebreak = z
        .union([
          z.literal(0),
          z.literal(1),
          z.literal(50),
          z.literal(75),
          z.literal(100),
          z.literal(150),
        ])
        .parse(p.tiebreak);
    if (p.locked !== undefined) r.locked = z.boolean().parse(p.locked);
    update(r);
  });
  on("shuffle", () => {
    const r = host();
    if (r.game && r.game.phase !== "ended")
      throw new Error("游戏中无法随机组队");
    const members = r.members.filter((m) => m.team !== null);
    for (let i = members.length - 1; i > 0; i--) {
      const j = randomBytes(4).readUInt32LE() % (i + 1);
      [members[i], members[j]] = [members[j], members[i]];
    }
    members.forEach((m, i) => (m.team = (i % 2) + 1));
    update(r);
  });
  on("kick", (p) => {
    const r = host();
    const id = z.string().parse(p.id);
    if (id === session.id) throw new Error("不能踢出自己");
    const victim = getSession(id);
    if (victim?.room === r.id) leave(victim);
  });
  on("start", () => {
    const r = host();
    if (r.game && r.game.phase !== "ended") throw new Error("游戏已开始");
    start(r);
  });
  on("command", (p) => {
    const r = room();
    if (!r.game) throw new Error("尚未开始");
    const revision = z.number().int().parse(p.revision);
    if (revision !== r.game.revision) throw new Error("局面已更新，请重新操作");
    const cmd = commandSchema.parse(p.command) as Command;
    r.game = reduceGame(r.game, session.id, cmd);
    advance(r);
  });
  on("reset", () => {
    const r = room();
    if (r.game?.phase !== "ended") throw new Error("对战尚未结束");
    if (r.mode === "private") {
      r.game = undefined;
      update(r);
    } else leave(session);
  });
  on("leave", () => leave(session));
  on("match", () => {
    if (session.room && rooms.get(session.room)?.mode === "duel") return;
    const waiting = [...rooms.values()].find(
      (r) =>
        r.mode === "duel" &&
        !r.game &&
        r.members.length === 1 &&
        r.members[0].id !== session.id,
    );
    const r = waiting || {
      id: randomUUID(),
      mode: "duel" as const,
      host: session.id,
      members: [],
      tiebreak: 100,
      locked: true,
      chat: [],
    };
    enter(session, r);
    if (r.members.length === 2) start(r);
  });
  on("chat", (p) => {
    const r = room();
    const text = z.string().trim().min(1).max(200).parse(p.text);
    const self = r.members.find((m) => m.id === session.id)!;
    const team = p.team === true ? self.team : null;
    if (p.team && (!team || team === 0)) throw new Error("个人战没有队内聊天");
    r.chat.push({
      id: randomUUID(),
      name: session.name,
      text,
      team,
      time: Date.now(),
    });
    r.chat = r.chat.slice(-100);
    update(r);
  });
  on("ranking", () => {
    socket.emit(
      "ranking",
      [...sessions.values()]
        .filter((s) => s.games > 0)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 100)
        .map((s) => ({
          id: s.id,
          name: s.name,
          rating: s.rating,
          games: s.games,
        })),
    );
  });
  on("deleteAccount", () => {
    leave(session);
    sessions.delete(session.token);
    save();
    socket.emit("deleted");
    socket.disconnect(true);
  });
  socket.on("disconnect", () => {
    peers.get(session.id)?.delete(socket.id);
    if (!peers.get(session.id)?.size) {
      const r = session.room ? rooms.get(session.room) : undefined;
      if (r) {
        const member = r.members.find((m) => m.id === session.id);
        if (member) member.connected = false;
        advance(r);
      }
    }
    broadcastCounts();
  });
});
app.get("/api/health", (_, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(resolve("dist")));
http.listen(port, "127.0.0.1", () =>
  console.log(`Game service http://127.0.0.1:${port}`),
);
import { playbackDuration } from "../shared/presentation";
