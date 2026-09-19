import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, Socket } from "socket.io-client";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean) {
  for (let n = 0; n < 300; n++) {
    if (fn()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for state");
}
async function client(token?: string) {
  const socket = io("http://127.0.0.1:3312", {
    auth: { token },
    transports: ["websocket"],
    autoConnect: false,
  });
  const c: { socket: Socket; session: any; room: any } = {
    socket,
    session: null,
    room: null,
  };
  socket.on("session", (s) => (c.session = s));
  socket.on("room", (r) => (c.room = r));
  socket.connect();
  await until(() => !!c.session);
  return c;
}
const emit = (socket: Socket, event: string, data: unknown = {}) =>
  new Promise<{ ok: boolean; error?: string }>((resolve) =>
    socket.emit(event, data, resolve),
  );
test(
  "real server: rooms, permissions, hidden hands, reconnect and matchmaking",
  { timeout: 20000 },
  async () => {
    const server = spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
      {
        env: {
          ...process.env,
          GAME_PORT: "3312",
          GAME_DATA_DIR: mkdtempSync(join(tmpdir(), "godfield-test-")),
        },
        stdio: "pipe",
        windowsHide: true,
      },
    );
    let ready = false;
    server.stdout.on("data", (b) => {
      if (b.toString().includes("Game service")) ready = true;
    });
    let a: Awaited<ReturnType<typeof client>> | undefined,
      b: typeof a,
      c: typeof a;
    try {
      await until(() => ready);
      a = await client();
      b = await client();
      await emit(a.socket, "login", { name: "Alpha" });
      await emit(b.socket, "login", { name: "Beta" });
      assert.equal(
        (await emit(a.socket, "join", { password: "test-room" })).ok,
        true,
      );
      await emit(b.socket, "join", { password: "test-room" });
      await until(() => a!.room?.members.length === 2);
      assert.equal(
        (await emit(b.socket, "configure", { locked: true })).ok,
        false,
        "only host can configure",
      );
      await emit(a.socket, "team", { team: 0 });
      await emit(b.socket, "team", { team: 0 });
      await emit(a.socket, "start");
      await until(() => !!b!.room?.game);
      assert.equal(
        a.room.game.players.find((p: any) => p.id === b!.session.id).hand,
        undefined,
      );
      assert.equal(
        b.room.game.players.find((p: any) => p.id === a!.session.id).hand,
        undefined,
      );
      assert.equal("seed" in a.room.game, false);
      assert.equal(
        (
          await emit(a.socket, "command", {
            revision: -1,
            command: { type: "pray" },
          })
        ).ok,
        false,
      );
      assert.equal(
        (await emit(a.socket, "configure", { tiebreak: 1 })).ok,
        false,
        "no midgame rules mutation",
      );
      const token = b.session.token;
      b.socket.disconnect();
      c = await client(token);
      await until(() => !!c!.room?.game);
      assert.equal(c.session.id, b.session.id);
      assert.equal(c.room.game.self, 1);
      await emit(a.socket, "command", {
        revision: a.room.game.revision,
        command: { type: "surrender" },
      });
      await until(() => c!.room?.game.phase === "ended");
      assert.equal(c.room.game.winners.includes(c.session.id), true);
      await emit(a.socket, "reset");
      await emit(a.socket, "leave");
      await emit(c.socket, "leave");
      await emit(a.socket, "match");
      assert.equal(a.room.mode, "duel");
      assert.equal(a.room.game, null);
      await emit(c.socket, "match");
      await until(() => !!a!.room?.game && !!c!.room?.game);
      await emit(a.socket, "command", {
        revision: a.room.game.revision,
        command: { type: "surrender" },
      });
      await until(() => c!.session.games === 1);
      assert.equal(a.session.rating, 1484);
      assert.equal(c.session.rating, 1516);
    } finally {
      a?.socket.disconnect();
      b?.socket.disconnect();
      c?.socket.disconnect();
      server.kill();
    }
  },
);
