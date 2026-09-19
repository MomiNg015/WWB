import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(process.env.GAME_DATA_DIR || "data");
const database = resolve(directory, "game.sqlite");
if (!existsSync(database)) throw new Error("数据库尚未建立，请先启动游戏服务");
const destination = resolve(
  directory,
  "backups",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(destination, { recursive: true });
const db = new DatabaseSync(database);
try {
  // VACUUM INTO creates a consistent SQLite snapshot including committed WAL data.
  db.prepare("VACUUM INTO ?").run(resolve(destination, "game.sqlite"));
} finally {
  db.close();
}
const uploads = resolve(directory, "uploads");
if (existsSync(uploads))
  cpSync(uploads, resolve(destination, "uploads"), { recursive: true });
writeFileSync(
  resolve(destination, "README.txt"),
  "Stop the game service before restoring. Copy game.sqlite and uploads/ into GAME_DATA_DIR on the destination computer. Do not overwrite a live database. Sessions and scores are included; running matches are not.\n",
);
console.log(`Backup created: ${destination}`);
