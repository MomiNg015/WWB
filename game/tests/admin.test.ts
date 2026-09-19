import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { AdminStore } from "../server/admin-store";
import { createEngine } from "../shared/engine";
import { items } from "../shared/catalog";

test("SQLite imports old identities once, preserves changes and rolls back failed transactions", () => {
  const dir = mkdtempSync(join(tmpdir(), "wwb-migration-"));
  writeFileSync(
    join(dir, "sessions.json"),
    JSON.stringify([
      {
        id: "legacy",
        token: "legacy-token",
        name: "Existing",
        rating: 1680,
        games: 8,
      },
    ]),
  );
  let store = new AdminStore(dir);
  assert.equal(store.users()[0].rating, 1680);
  assert.deepEqual(
    store.release().items.map((i) => i.imageName),
    items.map((i) => i.imageName),
  );
  const user = store.users()[0];
  user.name = "Updated";
  store.saveUser(user);
  assert.throws(() =>
    store.transaction(() => {
      store.db.prepare("DELETE FROM users").run();
      throw new Error("rollback");
    }),
  );
  assert.equal(store.users().length, 1);
  store.close();
  store = new AdminStore(dir);
  assert.equal(store.users()[0].name, "Updated");
  assert.equal(store.release().id, 1);
  store.close();
});
test("separate engine catalogs preserve old damage, defense and private projections", () => {
  const original = createEngine(items),
    newItems = structuredClone(items);
  newItems.find((i) => i.imageName === "wonder-sword")!.atk = 77;
  newItems.find((i) => i.imageName === "iron-shield")!.def = 60;
  const updated = createEngine(newItems);
  function play(engine: ReturnType<typeof createEngine>) {
    let g = engine.createGame(
      [
        { id: "a", name: "A", team: 0, bot: false },
        { id: "b", name: "B", team: 0, bot: false },
      ],
      { guardianChance: 0 },
    );
    g.turn = 0;
    g.players[0].hand = [{ uid: "sword", id: "wonder-sword" }];
    g.players[1].hand = [{ uid: "shield", id: "iron-shield" }];
    g = engine.reduceGame(g, "a", {
      type: "play",
      cards: ["sword"],
      target: 1,
    });
    const attack = g.queue[0].atk;
    g = engine.reduceGame(g, "b", { type: "defend", cards: ["shield"] });
    return { attack, hp: g.players[1].hp };
  }
  assert.deepEqual(play(original), { attack: 10, hp: 44 });
  assert.deepEqual(play(updated), { attack: 77, hp: 33 });
  newItems.find((i) => i.imageName === "wonder-sword")!.atk = 1;
  assert.equal(play(updated).attack, 77);
});

test(
  "admin HTTP workflow: auth, CRUD, permissions, version publication and audit",
  { timeout: 60000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "wwb-admin-"));
    const server = spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
      {
        env: {
          ...process.env,
          GAME_PORT: "3314",
          GAME_DATA_DIR: dir,
          ADMIN_INITIAL_PASSWORD: "test-admin-password",
        },
        stdio: "pipe",
        windowsHide: true,
      },
    );
    let ready = false,
      output = "";
    server.stdout.on("data", (b) => {
      output += String(b);
      if (output.includes("Game service")) ready = true;
    });
    server.stderr.on("data", (b) => (output += String(b)));
    async function until(fn: () => boolean) {
      for (let n = 0; n < 500; n++) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`Timeout: ${output}`);
    }
    const base = "http://127.0.0.1:3314/api/admin";
    let cookie = "",
      csrf = "",
      player: Socket | undefined,
      session: any,
      room: any;
    async function request(
      path: string,
      method = "GET",
      body?: any,
      headers: Record<string, string> = {},
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Request": "1",
          "X-CSRF-Token": csrf,
          Cookie: cookie,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    }
    try {
      await until(() => ready);
      await t.test(
        "requires real admin login and rejects bad passwords and CSRF",
        async () => {
          assert.equal((await request("/users")).status, 401);
          assert.equal(
            (
              await request("/login", "POST", {
                username: "moming",
                password: "wrong",
              })
            ).status,
            401,
          );
          const result = await request("/login", "POST", {
            username: "moming",
            password: "test-admin-password",
          });
          assert.equal(result.status, 200);
          cookie = result.cookie!;
          csrf = result.body.csrf;
          assert.equal(result.body.role, "owner");
          assert.ok(!("hash" in result.body));
          assert.equal(
            (
              await request(
                "/users",
                "POST",
                { name: "X", reason: "test" },
                { "X-CSRF-Token": "bad" },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                "/users",
                "POST",
                { name: "X", reason: "test" },
                { Origin: "https://other.example" },
              )
            ).status,
            403,
          );
        },
      );
      await t.test(
        "user CRUD is durable, revision-checked and never exposes login tokens",
        async () => {
          const made = await request("/users", "POST", {
            name: "Admin test",
            reason: "Create regression account",
          });
          assert.equal(made.status, 201);
          assert.ok(!("token" in made.body));
          const user = made.body;
          const next = await request(`/users/${user.id}`, "PATCH", {
            ...user,
            name: "Edited user",
            rating: 1600,
            reason: "Adjust rating",
          });
          assert.equal(next.status, 200);
          assert.equal(
            (
              await request(`/users/${user.id}`, "PATCH", {
                ...user,
                reason: "Stale",
              })
            ).status,
            409,
          );
          const detail = await request(`/users/${user.id}`);
          assert.equal(detail.body.rating, 1600);
          assert.equal(detail.body.audit.length, 2);
          assert.ok(!JSON.stringify(detail.body).includes("token"));
          assert.equal(
            (
              await request(`/users/${user.id}`, "PATCH", {
                ...next.body,
                status: "archived",
                reason: "Archive",
              })
            ).status,
            200,
          );
        },
      );
      await t.test(
        "draft item and role CRUD support copy, conflict detection and safe deletion",
        async () => {
          const r = await request("/items/wonder-sword");
          assert.equal(r.status, 200);
          const custom = {
            ...r.body.data,
            imageName: "admin-test-sword",
            name: "Admin Sword",
            imageRef: "weapons/wonder-sword",
          };
          assert.equal(
            (await request("/items", "POST", { data: custom, reason: "Test" }))
              .status,
            201,
          );
          assert.equal(
            (
              await request("/items", "POST", {
                data: custom,
                reason: "Duplicate",
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request("/items/admin-test-sword", "PATCH", {
                data: { ...custom, atk: 14 },
                revision: 1,
                reason: "Balance",
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await request("/items/admin-test-sword", "PATCH", {
                data: custom,
                revision: 1,
                reason: "Stale",
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request("/items/admin-test-sword", "DELETE", {
                revision: 2,
                reason: "Remove draft",
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await request("/items/wonder-sword", "DELETE", {
                revision: r.body.revision,
                reason: "Forbidden deletion",
              })
            ).status,
            409,
          );
          const character = {
            id: "test-character",
            name: "Role test",
            description: "Cosmetic",
            imageRef: "weapons/wonder-sword",
            enabled: true,
          };
          assert.equal(
            (
              await request("/characters", "POST", {
                data: character,
                reason: "Test",
              })
            ).status,
            201,
          );
          assert.equal(
            (
              await request("/characters/test-character", "PATCH", {
                data: { ...character, name: "Updated role" },
                revision: 1,
                reason: "Edit",
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await request("/characters/test-character", "DELETE", {
                revision: 2,
                reason: "Remove",
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await request("/assets", "POST", {
                base64: Buffer.from("<svg></svg>").toString("base64"),
                name: "invalid.svg",
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "published content applies to new games while old games remain pinned",
        async () => {
          player = io("http://127.0.0.1:3314", {
            transports: ["websocket"],
            autoConnect: false,
          });
          player.on("session", (s) => (session = s));
          player.on("room", (r) => (room = r));
          player.connect();
          await until(() => !!session);
          const emit = (event: string, data: any) =>
            new Promise<any>((resolve) => player!.emit(event, data, resolve));
          await emit("training", { count: 2, tiebreak: 0 });
          await until(() => !!room?.game);
          assert.equal(room.game.contentVersion, 1);
          const record = (await request("/items/wonder-sword")).body;
          const before = (await request("/releases")).body;
          await request("/items/wonder-sword", "PATCH", {
            data: { ...record.data, atk: 11 },
            revision: record.revision,
            reason: "Test version isolation",
          });
          assert.equal(
            (
              await request("/releases", "POST", {
                active: 1,
                draftHash: before.draftHash,
                label: "stale",
                reason: "test",
              })
            ).status,
            409,
          );
          const validation = await request("/releases/validate", "POST", {});
          assert.equal(validation.status, 200, JSON.stringify(validation.body));
          const release = (await request("/releases")).body;
          const published = await request("/releases", "POST", {
            active: 1,
            draftHash: release.draftHash,
            label: "New balance",
            reason: "Test release",
          });
          assert.equal(published.status, 200, JSON.stringify(published.body));
          assert.equal(published.body.id, 2);
          assert.equal(
            room.game.catalogItems.find(
              (i: any) => i.imageName === "wonder-sword",
            ).atk,
            10,
          );
          await emit("training", { count: 2, tiebreak: 0 });
          await until(() => room?.game?.contentVersion === 2);
          assert.equal(
            room.game.catalogItems.find(
              (i: any) => i.imageName === "wonder-sword",
            ).atk,
            11,
          );
          await request("/releases/1/activate", "POST", { reason: "Rollback" });
          assert.equal(room.game.contentVersion, 2);
          const user = (await request(`/users/${session.id}`)).body;
          const assigned = await request(`/users/${session.id}`, "PATCH", {
            ...user,
            characterId: "prophet",
            reason: "Assign released character",
          });
          assert.equal(assigned.status, 200);
          await emit("training", { count: 2, tiebreak: 0 });
          await until(() =>
            room?.game?.players.some(
              (p: any) => p.id === session.id && p.character?.id === "prophet",
            ),
          );
          assert.equal(
            room.game.players.find((p: any) => p.id === session.id).hp,
            50,
          );
          await request(`/users/${session.id}`, "PATCH", {
            ...assigned.body,
            status: "banned",
            reason: "Test revocation",
          });
          await until(() => !player!.connected);
        },
      );
      await t.test(
        "read-only administrators cannot write or grant themselves permissions",
        async () => {
          assert.equal(
            (
              await request("/administrators", "POST", {
                username: "reader",
                password: "reader-password",
                role: "viewer",
                reason: "Read only",
              })
            ).status,
            200,
          );
          const ownerCookie = cookie,
            ownerCsrf = csrf;
          const login = await request("/login", "POST", {
            username: "reader",
            password: "reader-password",
          });
          cookie = login.cookie!;
          csrf = login.body.csrf;
          assert.equal((await request("/items")).status, 200);
          assert.equal(
            (
              await request("/users", "POST", {
                name: "Forbidden",
                reason: "Test",
              })
            ).status,
            403,
          );
          assert.equal((await request("/administrators")).status, 403);
          assert.equal(
            (
              await request("/releases/1/activate", "POST", {
                reason: "Forbidden",
              })
            ).status,
            403,
          );
          await request("/logout", "POST", {});
          assert.equal((await request("/me")).status, 401);
          cookie = ownerCookie;
          csrf = ownerCsrf;
          const logs = await request("/audit");
          assert.equal(logs.status, 200);
          assert.ok(logs.body.total >= 10);
          assert.ok(!JSON.stringify(logs.body).includes("test-admin-password"));
          assert.equal(
            (
              await request("/password", "POST", {
                current: "wrong",
                password: "new-password",
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request("/password", "POST", {
                current: "test-admin-password",
                password: "new-password",
              })
            ).status,
            200,
          );
          assert.equal((await request("/me")).status, 401);
        },
      );
    } finally {
      player?.disconnect();
      server.kill();
    }
  },
);
