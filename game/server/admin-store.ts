import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { items, classicRules, sortCatalog } from "../shared/catalog";
import type { Item, Rules } from "../shared/types";

export type AdminRole = "owner" | "support" | "editor" | "publisher" | "viewer";
export interface UserRecord {
  id: string;
  token: string;
  name: string;
  rating: number;
  games: number;
  room?: string;
  status?: "active" | "banned" | "archived";
  characterId?: string;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
}
export interface Character {
  id: string;
  name: string;
  description: string;
  imageRef: string;
  enabled: boolean;
}
export interface Release {
  id: number;
  label: string;
  createdAt: string;
  items: Item[];
  characters: Character[];
  rules: Rules;
}
export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const passwordHash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
export function passwordMatches(password: string, stored: string) {
  const [salt, value] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(value, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const initialHash =
  "e3d910beb900b159128687f11c343385:93a89e9fe97fed96992fc83f3061199516097a2ee6b93b277c48c4c35dd94d89f067027f185470a7245df9678c94793ff7052e3294986ff5573a9e068d69b24e";

export class AdminStore {
  db: DatabaseSync;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(resolve(directory, "game.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS administrators (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_sessions (token TEXT PRIMARY KEY, admin_id TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS releases (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, before_json TEXT, after_json TEXT);
      CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    `);
    if (
      !this.db.prepare("SELECT 1 FROM metadata WHERE key='initialized'").get()
    ) {
      this.transaction(() => {
        this.db
          .prepare("INSERT INTO administrators VALUES (?,?,?,?)")
          .run(
            randomUUID(),
            process.env.ADMIN_INITIAL_USERNAME || "moming",
            process.env.ADMIN_INITIAL_PASSWORD
              ? passwordHash(process.env.ADMIN_INITIAL_PASSWORD)
              : initialHash,
            "owner",
          );
        for (const item of items)
          this.putRecord(
            "items",
            item.imageName,
            { ...item, enabled: true },
            0,
          );
        this.putRecord("rules", "classic", classicRules, 0);
        this.putRecord(
          "characters",
          "prophet",
          {
            id: "prophet",
            name: "预言者",
            description: "经典模式角色，不提供额外属性。",
            imageRef: "sundries/sun-amulet",
            enabled: true,
          },
          0,
        );
        const old = resolve(directory, "sessions.json");
        if (existsSync(old)) {
          const data = JSON.parse(readFileSync(old, "utf8")) as UserRecord[];
          for (const user of data) this.saveUser(user);
        }
        this.publish("初始经典版本");
        this.db
          .prepare("INSERT INTO metadata VALUES ('initialized','1')")
          .run();
      });
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  users(): UserRecord[] {
    return this.db
      .prepare("SELECT body FROM users")
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  saveUser(user: UserRecord) {
    const { room, ...clean } = user;
    const now = new Date().toISOString();
    const old = this.db
      .prepare("SELECT body FROM users WHERE id=?")
      .get(user.id);
    const previous = old ? JSON.parse(String(old.body)) : undefined;
    if (
      previous &&
      Object.entries(clean).every(
        ([key, value]) =>
          JSON.stringify(value) === JSON.stringify(previous[key]),
      )
    ) {
      Object.assign(user, previous);
      return user;
    }
    const next = {
      ...clean,
      status: clean.status || "active",
      createdAt: clean.createdAt || previous?.createdAt || now,
      updatedAt: now,
      revision: (previous?.revision || 0) + 1,
    };
    this.db
      .prepare(
        "INSERT INTO users VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(user.id, JSON.stringify(next));
    Object.assign(user, next);
    return next as UserRecord;
  }
  record(kind: string, id: string): { data: any; revision: number } {
    const r = this.db
      .prepare("SELECT body,revision FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    if (!r) throw new AdminError(404, "记录不存在");
    return { data: JSON.parse(String(r.body)), revision: Number(r.revision) };
  }
  records(kind: string) {
    return this.db
      .prepare("SELECT id,body,revision FROM records WHERE kind=? ORDER BY id")
      .all(kind)
      .map((r) => ({
        id: String(r.id),
        data: JSON.parse(String(r.body)),
        revision: Number(r.revision),
      }));
  }
  putRecord(kind: string, id: string, value: unknown, revision: number) {
    if (revision === 0) {
      if (
        this.db
          .prepare("SELECT 1 FROM records WHERE kind=? AND id=?")
          .get(kind, id)
      )
        throw new AdminError(409, "ID已存在，请使用其他ID");
      this.db
        .prepare("INSERT INTO records VALUES (?,?,?,1)")
        .run(kind, id, JSON.stringify(value));
    } else {
      const result = this.db
        .prepare(
          "UPDATE records SET body=?,revision=revision+1 WHERE kind=? AND id=? AND revision=?",
        )
        .run(JSON.stringify(value), kind, id, revision);
      if (!result.changes)
        throw new AdminError(409, "数据已被修改，请刷新后重新编辑");
    }
  }
  publish(label: string) {
    const body = {
      items: sortCatalog(this.records("items").map((r) => r.data)),
      characters: this.records("characters").map((r) => r.data),
      rules: this.record("rules", "classic").data,
    };
    const result = this.db
      .prepare("INSERT INTO releases(label,created_at,body) VALUES (?,?,?)")
      .run(label, new Date().toISOString(), JSON.stringify(body));
    const id = Number(result.lastInsertRowid);
    this.activate(id);
    return id;
  }
  activate(id: number) {
    this.release(id);
    this.db
      .prepare(
        "INSERT INTO metadata VALUES ('active_release',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(String(id));
  }
  release(id?: number): Release {
    id ??= Number(
      this.db
        .prepare("SELECT value FROM metadata WHERE key='active_release'")
        .get()?.value,
    );
    const r = this.db.prepare("SELECT * FROM releases WHERE id=?").get(id);
    if (!r) throw new AdminError(404, "版本不存在");
    return {
      id,
      label: String(r.label),
      createdAt: String(r.created_at),
      ...JSON.parse(String(r.body)),
    };
  }
  audit(
    actor: string,
    action: string,
    target: string,
    reason: string,
    before?: unknown,
    after?: unknown,
  ) {
    this.db
      .prepare(
        "INSERT INTO audit(at,actor,action,target,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        new Date().toISOString(),
        actor,
        action,
        target,
        reason,
        before === undefined ? null : JSON.stringify(before),
        after === undefined ? null : JSON.stringify(after),
      );
  }
  close() {
    this.db.close();
  }
}

export function publicUser({ token, room, ...user }: UserRecord) {
  return user;
}
