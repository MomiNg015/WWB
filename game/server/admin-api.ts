import {
  Router,
  json,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { items, classicRules, texts } from "../shared/catalog";
import { createEngine } from "../shared/engine";
import {
  AdminStore,
  AdminError,
  passwordHash,
  passwordMatches,
  publicUser,
  type UserRecord,
  type AdminRole,
} from "./admin-store";

const id = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,80}$/, "ID只允许字母、数字、短横线和下划线");
const reason = z.string().trim().min(1, "请填写操作原因").max(300);
const role = z.enum(["owner", "support", "editor", "publisher", "viewer"]);
const asset = z
  .string()
  .regex(
    /^(?:[a-z-]+\/[a-z0-9_-]+|uploads\/[a-f0-9]{64}\.(?:png|jpg|webp))$/,
    "请选择有效素材",
  );
const categories = [
  "weapons",
  "armor",
  "sundries",
  "miracles",
  "trade",
  "devils",
  "guardians",
  "phenomena",
] as const;
const elements = [
  "",
  "fire",
  "water",
  "wood",
  "stone",
  "light",
  "darkness",
] as const;
const num = z.number().int().min(0).max(999);
const itemSchema = z
  .object({
    imageName: id,
    name: z.string().trim().min(1).max(40),
    category: z.enum(categories),
    enabled: z.boolean(),
    imageRef: asset.optional(),
    element: z.enum(elements).optional(),
    atk: num.optional(),
    def: num.optional(),
    cost: num.optional(),
    price: num.optional(),
    giftRate: num.optional(),
    appearanceRate: num.optional(),
    guardianAttackRate: num.optional(),
    ability: z.string().max(80).optional(),
    abilityValue: z.number().int().min(-999).max(999).optional(),
    curse: z.string().max(40).optional(),
    guardian: z.string().max(40).optional(),
    isPlusAtk: z.boolean().optional(),
    hitRate: z.number().min(0).max(100).optional(),
  })
  .strict();
const characterSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(40),
    description: z.string().max(500),
    imageRef: asset,
    enabled: z.boolean(),
  })
  .strict();
const rulesSchema = z
  .object({
    id: z.literal("classic"),
    initialHP: num.min(1),
    initialMP: num,
    initialCP: num,
    handSize: num.min(1).max(18),
    maxHandSize: num.min(1).max(36),
    maxStat: num.min(1),
    tiebreak: num,
    diseaseChance: z.number().min(0).max(1),
    guardianChance: z.number().min(0).max(1),
    guardianLeaveChance: z.number().min(0).max(1),
    devilChance: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (r) =>
      Math.max(r.initialHP, r.initialMP, r.initialCP) <= r.maxStat &&
      r.handSize <= r.maxHandSize,
    "初始资源或手牌不能超过上限",
  );
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const canonical = (value: any): string =>
  JSON.stringify(value, Object.keys(value).sort());
export interface AdminHooks {
  users: Map<string, UserRecord>;
  userChanged: (user: UserRecord) => void;
  rooms: () => unknown[];
  closeRoom: (id: string) => void;
}
export function adminRouter(store: AdminStore, hooks: AdminHooks) {
  const router = Router();
  const failed = new Map<string, { count: number; until: number }>();
  router.use(json({ limit: "1mb" }));
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers["x-admin-request"] !== "1")
        return res.status(403).json({ error: "请求来源校验失败" });
      if (req.headers.origin) {
        try {
          const allowedOrigins = (
            process.env.ADMIN_ALLOWED_ORIGINS ||
            "http://127.0.0.1:5173,http://localhost:5173"
          ).split(",");
          if (
            new URL(req.headers.origin).host !== req.headers.host &&
            !allowedOrigins.includes(req.headers.origin)
          )
            return res.status(403).json({ error: "不允许跨站管理操作" });
        } catch {
          return res.status(403).json({ error: "请求来源无效" });
        }
      }
    }
    next();
  });
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.ADMIN_SECURE_COOKIE === "1",
    path: "/api/admin",
  };
  router.post("/login", (req, res) => {
    const input = z
      .object({
        username: z.string().trim().min(1).max(80),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const key = req.ip || "local";
    for (const [k, v] of failed) if (v.until < Date.now()) failed.delete(k);
    const attempts = failed.get(key);
    if (attempts && attempts.count >= 10)
      throw new AdminError(429, "登录失败次数过多，请15分钟后重试");
    const admin = store.db
      .prepare("SELECT * FROM administrators WHERE username=?")
      .get(input.username);
    // Also hash unknown usernames to avoid returning immediately.
    const valid = passwordMatches(
      input.password,
      String(
        admin?.hash || "00000000000000000000000000000000:" + "00".repeat(64),
      ),
    );
    if (!admin || !valid) {
      failed.set(key, {
        count: (attempts?.count || 0) + 1,
        until: attempts?.until || Date.now() + 15 * 60_000,
      });
      throw new AdminError(401, "用户名或密码错误");
    }
    failed.delete(key);
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    store.db
      .prepare("DELETE FROM admin_sessions WHERE expires<?")
      .run(Date.now());
    store.db
      .prepare("INSERT INTO admin_sessions VALUES (?,?,?,?)")
      .run(hashToken(token), String(admin.id), csrf, Date.now() + 8 * 3600_000);
    store.audit(String(admin.username), "login", String(admin.id), "登录后台");
    res
      .cookie("wwb_admin", token, { ...cookieOptions, maxAge: 8 * 3600_000 })
      .json({ username: admin.username, role: admin.role, csrf });
  });
  router.use((req, res, next) => {
    const token =
      (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("wwb_admin="))
        ?.slice(10) || "";
    const admin = store.db
      .prepare(
        "SELECT a.id,a.username,a.role,s.csrf,s.token FROM admin_sessions s JOIN administrators a ON a.id=s.admin_id WHERE s.token=? AND s.expires>?",
      )
      .get(hashToken(token), Date.now());
    if (!admin) return res.status(401).json({ error: "请先登录管理员账号" });
    if (req.method !== "GET" && req.headers["x-csrf-token"] !== admin.csrf)
      return res.status(403).json({ error: "会话校验失败，请重新登录" });
    res.locals.admin = admin;
    next();
  });
  const allow =
    (...roles: AdminRole[]) =>
    (_req: Request, res: Response, next: NextFunction) => {
      if (
        res.locals.admin.role !== "owner" &&
        !roles.includes(res.locals.admin.role)
      )
        return res.status(403).json({ error: "当前账号没有此操作权限" });
      next();
    };
  const write = (
    res: Response,
    action: string,
    target: string,
    why: string,
    fn: () => { before?: unknown; after?: unknown },
  ) =>
    store.transaction(() => {
      const changes = fn();
      store.audit(
        res.locals.admin.username,
        action,
        target,
        why,
        changes.before,
        changes.after,
      );
      return changes.after;
    });
  router.get("/me", (_req, res) => {
    const { username, role, csrf } = res.locals.admin;
    res.json({ username, role, csrf });
  });
  router.post("/logout", (_req, res) => {
    store.db
      .prepare("DELETE FROM admin_sessions WHERE token=?")
      .run(res.locals.admin.token);
    res.clearCookie("wwb_admin", cookieOptions).json({ ok: true });
  });
  router.post("/password", (req, res) => {
    const data = z
      .object({
        current: z.string().max(128),
        password: z.string().min(6).max(128),
      })
      .parse(req.body);
    const old = store.db
      .prepare("SELECT hash FROM administrators WHERE id=?")
      .get(res.locals.admin.id)!;
    if (!passwordMatches(data.current, String(old.hash)))
      throw new AdminError(400, "当前密码不正确");
    write(res, "password", res.locals.admin.id, "修改登录密码", () => {
      store.db
        .prepare("UPDATE administrators SET hash=? WHERE id=?")
        .run(passwordHash(data.password), res.locals.admin.id);
      store.db
        .prepare("DELETE FROM admin_sessions WHERE admin_id=?")
        .run(res.locals.admin.id);
      return {};
    });
    res.clearCookie("wwb_admin", cookieOptions).json({ ok: true });
  });
  router.get("/overview", (_req, res) => {
    const users = store.users();
    res.json({
      users: users.length,
      banned: users.filter((u) => u.status === "banned").length,
      items: store.records("items").length,
      characters: store.records("characters").length,
      rooms: hooks.rooms().length,
      release: store.release(),
      changes: changes(),
    });
  });
  function page(req: Request, rows: any[]) {
    const number = Math.max(1, Number(req.query.page) || 1),
      size = 20;
    return {
      rows: rows.slice((number - 1) * size, number * size),
      total: rows.length,
      page: number,
      pageSize: size,
    };
  }
  const search = (req: Request) =>
    String(req.query.q || "")
      .toLowerCase()
      .slice(0, 100);
  router.get("/users", allow("support", "viewer"), (req, res) => {
    const q = search(req);
    res.json(
      page(
        req,
        store
          .users()
          .filter(
            (u) =>
              `${u.id} ${u.name}`.toLowerCase().includes(q) &&
              (!req.query.status || u.status === req.query.status),
          )
          .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
          .map(publicUser),
      ),
    );
  });
  router.post("/users", allow("support"), (req, res) => {
    const data = z
      .object({ name: z.string().trim().min(1).max(20), reason })
      .parse(req.body);
    const user: UserRecord = {
      id: randomUUID(),
      token: randomBytes(32).toString("hex"),
      name: data.name,
      rating: 1500,
      games: 0,
      status: "active",
    };
    const result = write(res, "user.create", user.id, data.reason, () => {
      store.saveUser(user);
      return { after: publicUser(user) };
    });
    hooks.users.set(user.token, user);
    res.status(201).json(result);
  });
  router.get("/users/:id", allow("support", "viewer"), (req, res) => {
    const user = store.users().find((u) => u.id === req.params.id);
    if (!user) throw new AdminError(404, "用户不存在");
    const audit = store.db
      .prepare(
        "SELECT id,at,actor,action,reason,before_json,after_json FROM audit WHERE target=? ORDER BY id DESC LIMIT 50",
      )
      .all(user.id);
    res.json({ ...publicUser(user), audit });
  });
  router.patch("/users/:id", allow("support"), (req, res) => {
    const input = z
      .object({
        revision: z.number().int(),
        name: z.string().trim().min(1).max(20),
        status: z.enum(["active", "banned", "archived"]),
        rating: z.number().int().min(0).max(100000),
        games: z.number().int().min(0).max(1000000),
        characterId: z.string().max(80).optional(),
        reason,
      })
      .parse(req.body);
    const user = [...hooks.users.values()].find((u) => u.id === req.params.id);
    if (!user) throw new AdminError(404, "用户不存在");
    const result = write(res, "user.update", user.id, input.reason, () => {
      const dbUser = store.users().find((u) => u.id === user.id)!;
      if (dbUser.revision !== input.revision)
        throw new AdminError(409, "用户资料已更新，请刷新后再修改");
      if (
        input.characterId &&
        !store
          .release()
          .characters.some((c) => c.id === input.characterId && c.enabled)
      )
        throw new AdminError(400, "角色未发布或已停用");
      const { revision, reason: _, ...values } = input;
      const next = store.saveUser({ ...dbUser, ...values });
      return { before: publicUser(dbUser), after: publicUser(next) };
    });
    Object.assign(user, result);
    hooks.userChanged(user);
    res.json(result);
  });
  function validateRecord(kind: string, value: unknown) {
    if (kind === "characters") {
      const data = characterSchema.parse(value);
      checkAsset(data.imageRef);
      return data;
    }
    if (kind === "rules") return rulesSchema.parse(value);
    const data = itemSchema.parse(value);
    checkAsset(data.imageRef || `${data.category}/${data.imageName}`);
    if (
      data.ability &&
      !items.some(
        (i) => i.ability === data.ability && i.category === data.category,
      )
    )
      throw new AdminError(400, "该分类不支持所选能力，请选择已有能力模板");
    if (data.curse && !items.some((i) => i.curse === data.curse))
      throw new AdminError(400, "未知灾祸");
    if (data.guardian && !items.some((i) => i.guardian === data.guardian))
      throw new AdminError(400, "未知守护神");
    if (data.category === "miracles" && data.cost === undefined)
      throw new AdminError(400, "奇迹必须设置MP消耗");
    return data;
  }
  function checkAsset(ref: string) {
    if (
      !existsSync(
        ref.startsWith("uploads/")
          ? resolve(store.directory, ref)
          : resolve("public/assets/images/items", `${ref}.webp`),
      )
    )
      throw new AdminError(400, "素材不存在，请选择已有素材");
  }
  for (const kind of ["items", "characters", "rules"]) {
    router.get(`/${kind}`, (req, res) => {
      const q = search(req);
      const published = new Set(
        store.db
          .prepare("SELECT body FROM releases")
          .all()
          .flatMap((r) => {
            const content = JSON.parse(String(r.body));
            return (kind === "rules" ? [content.rules] : content[kind]).map(
              (record: any) => record.imageName || record.id,
            );
          }),
      );
      res.json(
        page(
          req,
          store
            .records(kind)
            .map((record) => ({
              ...record,
              published: published.has(record.id),
            }))
            .filter(
              (r) =>
                `${r.id} ${r.data.name || ""}`.toLowerCase().includes(q) &&
                (!req.query.category ||
                  r.data.category === req.query.category) &&
                (!req.query.status ||
                  String(r.data.enabled !== false) === req.query.status),
            ),
        ),
      );
    });
    router.get(`/${kind}/:id`, (req, res) =>
      res.json(store.record(kind, String(req.params.id))),
    );
    router.post(`/${kind}`, allow("editor"), (req, res) => {
      if (kind === "rules") throw new AdminError(400, "请编辑经典规则配置");
      const input = z.object({ data: z.unknown(), reason }).parse(req.body);
      const data = validateRecord(kind, input.data) as any;
      const key = data.imageName || data.id;
      write(res, `${kind}.create`, key, input.reason, () => {
        store.putRecord(kind, key, data, 0);
        return { after: data };
      });
      res.status(201).json(store.record(kind, key));
    });
    router.patch(`/${kind}/:id`, allow("editor"), (req, res) => {
      const input = z
        .object({
          revision: z.number().int().positive(),
          data: z.unknown(),
          reason,
        })
        .parse(req.body);
      const key = String(req.params.id),
        data = validateRecord(kind, input.data) as any;
      if ((data.imageName || data.id) !== key)
        throw new AdminError(400, "不能更改记录ID，请复制为新记录");
      const before = store.record(kind, key).data;
      write(res, `${kind}.update`, key, input.reason, () => {
        store.putRecord(kind, key, data, input.revision);
        return { before, after: data };
      });
      res.json(store.record(kind, key));
    });
    router.delete(`/${kind}/:id`, allow("editor"), (req, res) => {
      if (kind === "rules") throw new AdminError(400, "不能删除基础规则");
      const input = z
          .object({ revision: z.number().int(), reason })
          .parse(req.body),
        key = String(req.params.id);
      const before = store.record(kind, key);
      if (before.revision !== input.revision)
        throw new AdminError(409, "记录已更新，请刷新");
      const used = store.db
        .prepare("SELECT body FROM releases")
        .all()
        .some((r) =>
          JSON.parse(String(r.body))[kind].some(
            (i: any) => (i.imageName || i.id) === key,
          ),
        );
      if (used)
        throw new AdminError(
          409,
          "该记录已被发布版本引用，请改为停用并发布新版本",
        );
      if (
        kind === "characters" &&
        store.users().some((u) => u.characterId === key)
      )
        throw new AdminError(409, "该角色已关联用户，不能删除");
      write(res, `${kind}.delete`, key, input.reason, () => {
        store.db
          .prepare("DELETE FROM records WHERE kind=? AND id=?")
          .run(kind, key);
        return { before: before.data };
      });
      res.json({ ok: true });
    });
  }
  router.get("/options", (_req, res) =>
    res.json({
      categories,
      elements,
      abilities: [...new Set(items.map((i) => i.ability).filter(Boolean))],
      abilityLabels: Object.fromEntries(
        Object.entries(texts.abilities).map(([key, value]) => [
          key,
          String(value).replace(/<br>/g, " "),
        ]),
      ),
      curseLabels: texts.curseNames,
      guardianLabels: texts.guardianNames,
      assets: [
        ...items.map((i) => ({
          value: `${i.category}/${i.imageName}`,
          label: i.name,
        })),
        ...(existsSync(resolve(store.directory, "uploads"))
          ? readdirSync(resolve(store.directory, "uploads")).map((name) => ({
              value: `uploads/${name}`,
              label: `已上传 ${name.slice(0, 10)}`,
            }))
          : []),
      ],
      templates: items,
      characters: store.release().characters.filter((c) => c.enabled),
      rules: classicRules,
    }),
  );
  function changes() {
    const release = store.release();
    return ["items", "characters", "rules"].flatMap((kind) => {
      const previous =
        kind === "rules" ? [release.rules] : (release as any)[kind];
      return store
        .records(kind)
        .filter(
          (r) =>
            canonical(r.data) !==
            canonical(
              previous.find((p: any) => (p.imageName || p.id) === r.id) || {},
            ),
        )
        .map((r) => ({
          kind,
          id: r.id,
          name: r.data.name || "经典规则",
          before:
            previous.find((p: any) => (p.imageName || p.id) === r.id) || null,
          after: r.data,
        }));
    });
  }
  router.post("/assets", allow("editor"), (req, res) => {
    const input = z
      .object({ base64: z.string().max(720000), name: z.string().max(100) })
      .parse(req.body);
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length > 512 * 1024)
      throw new AdminError(400, "图片不能超过512KB");
    const ext = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "jpg"
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          ? "webp"
          : null;
    if (!ext) throw new AdminError(400, "仅支持PNG、JPEG和WebP图片");
    const name = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
    mkdirSync(resolve(store.directory, "uploads"), { recursive: true });
    writeFileSync(resolve(store.directory, "uploads", name), bytes);
    store.audit(
      res.locals.admin.username,
      "asset.upload",
      name,
      "上传游戏素材",
      undefined,
      { name: input.name, size: bytes.length },
    );
    res.json({ value: `uploads/${name}`, label: input.name });
  });
  function validateRelease() {
    const definitions = store
      .records("items")
      .map((r) => validateRecord("items", r.data) as any);
    const rules = rulesSchema.parse(store.record("rules", "classic").data);
    for (const r of store.records("characters"))
      validateRecord("characters", r.data);
    const active = definitions.filter((i) => i.enabled);
    if (!active.some((i) => i.giftRate > 0))
      throw new AdminError(
        400,
        "抽取池为空：至少一个启用物品的抽取权重必须大于0",
      );
    for (const category of ["guardians", "devils", "phenomena", "miracles"])
      if (!active.some((i) => i.category === category))
        throw new AdminError(400, `${category} 分类不能全部停用`);
    const engine = createEngine(definitions);
    for (let seed = 1; seed <= 3; seed++) {
      let g = engine.createGame(
        [
          { id: "a", name: "测试A", team: 0, bot: true },
          { id: "b", name: "测试B", team: 0, bot: true },
        ],
        { ...rules, tiebreak: 1 },
        seed * 79,
      );
      let steps = 0;
      while (g.phase !== "ended" && steps++ < 2000) {
        const turn = g.phase === "defense" ? g.queue[0].target : g.turn;
        g = engine.reduceGame(
          g,
          g.players[turn].id,
          engine.botCommand(g, turn),
        );
      }
      if (g.phase !== "ended")
        throw new AdminError(400, "测试对局未在2000步内结束，请检查规则数值");
    }
    return {
      ok: true,
      message: "字段、素材、抽取池检查通过；3组固定种子测试对局正常结束",
      changes: changes(),
    };
  }
  function draftHash() {
    return createHash("sha256")
      .update(
        JSON.stringify(
          ["items", "characters", "rules"].map((kind) => store.records(kind)),
        ),
      )
      .digest("hex");
  }
  router.get("/releases", (_req, res) =>
    res.json({
      active: store.release().id,
      draftHash: draftHash(),
      rows: store.db
        .prepare(
          "SELECT id,label,created_at AS createdAt FROM releases ORDER BY id DESC",
        )
        .all(),
      changes: changes(),
    }),
  );
  router.post("/releases/validate", allow("editor", "publisher"), (_req, res) =>
    res.json(validateRelease()),
  );
  router.post("/releases", allow("publisher"), (req, res) => {
    const input = z
      .object({
        label: z.string().trim().min(1).max(80),
        reason,
        active: z.number().int(),
        draftHash: z.string(),
      })
      .parse(req.body);
    if (store.release().id !== input.active)
      throw new AdminError(409, "生效版本已改变，请刷新发布页面");
    if (input.draftHash !== draftHash())
      throw new AdminError(409, "草稿已被修改，请刷新并重新核对变更");
    validateRelease();
    const result = write(
      res,
      "release.publish",
      "content",
      input.reason,
      () => ({
        before: { id: store.release().id },
        after: { id: store.publish(input.label) },
      }),
    );
    res.json(result);
  });
  router.post("/releases/:id/activate", allow("publisher"), (req, res) => {
    const input = z.object({ reason }).parse(req.body),
      releaseId = Number(req.params.id);
    write(res, "release.rollback", "content", input.reason, () => {
      const before = { id: store.release().id };
      store.activate(releaseId);
      return { before, after: { id: releaseId } };
    });
    res.json({ ok: true });
  });
  router.get("/audit", allow("viewer"), (req, res) => {
    const q = `%${search(req)}%`,
      number = Math.max(1, Number(req.query.page) || 1);
    const total = store.db
      .prepare(
        "SELECT count(*) AS n FROM audit WHERE actor LIKE ? OR target LIKE ? OR action LIKE ?",
      )
      .get(q, q, q)!.n;
    const rows = store.db
      .prepare(
        "SELECT * FROM audit WHERE actor LIKE ? OR target LIKE ? OR action LIKE ? ORDER BY id DESC LIMIT 20 OFFSET ?",
      )
      .all(q, q, q, (number - 1) * 20);
    res.json({ rows, total, page: number, pageSize: 20 });
  });
  router.get("/rooms", allow("support", "viewer"), (_req, res) =>
    res.json(hooks.rooms()),
  );
  router.post("/rooms/:id/close", allow("support"), (req, res) => {
    const input = z.object({ reason }).parse(req.body);
    hooks.closeRoom(String(req.params.id));
    store.audit(
      res.locals.admin.username,
      "room.close",
      String(req.params.id),
      input.reason,
    );
    res.json({ ok: true });
  });
  router.get("/matches", allow("support", "viewer"), (req, res) =>
    res.json(
      page(
        req,
        store.db
          .prepare("SELECT body FROM matches ORDER BY rowid DESC")
          .all()
          .map((r) => JSON.parse(String(r.body))),
      ),
    ),
  );
  router.get("/administrators", allow(), (_req, res) =>
    res.json(
      store.db
        .prepare(
          "SELECT id,username,role FROM administrators ORDER BY username",
        )
        .all(),
    ),
  );
  router.post("/administrators", allow(), (req, res) => {
    const input = z
      .object({
        username: id,
        password: z.string().min(6).max(128),
        role,
        reason,
      })
      .parse(req.body);
    const adminId = randomUUID();
    if (
      store.db
        .prepare("SELECT 1 FROM administrators WHERE username=?")
        .get(input.username)
    )
      throw new AdminError(409, "用户名已存在");
    write(res, "admin.create", adminId, input.reason, () => {
      store.db
        .prepare("INSERT INTO administrators VALUES (?,?,?,?)")
        .run(adminId, input.username, passwordHash(input.password), input.role);
      return { after: { username: input.username, role: input.role } };
    });
    res.json({ ok: true });
  });
  router.patch("/administrators/:id", allow(), (req, res) => {
    const input = z.object({ role, reason }).parse(req.body),
      key = String(req.params.id);
    if (key === res.locals.admin.id)
      throw new AdminError(400, "不能修改自己的权限");
    const old = store.db
      .prepare("SELECT username,role FROM administrators WHERE id=?")
      .get(key);
    if (!old) throw new AdminError(404, "管理员不存在");
    write(res, "admin.role", key, input.reason, () => {
      store.db
        .prepare("UPDATE administrators SET role=? WHERE id=?")
        .run(input.role, key);
      store.db.prepare("DELETE FROM admin_sessions WHERE admin_id=?").run(key);
      return { before: old, after: { role: input.role } };
    });
    res.json({ ok: true });
  });
  router.delete("/administrators/:id", allow(), (req, res) => {
    const input = z.object({ reason }).parse(req.body),
      key = String(req.params.id);
    if (key === res.locals.admin.id)
      throw new AdminError(400, "不能删除当前登录管理员");
    const old = store.db
      .prepare("SELECT username,role FROM administrators WHERE id=?")
      .get(key);
    if (!old) throw new AdminError(404, "管理员不存在");
    write(res, "admin.delete", key, input.reason, () => {
      store.db.prepare("DELETE FROM admin_sessions WHERE admin_id=?").run(key);
      store.db.prepare("DELETE FROM administrators WHERE id=?").run(key);
      return { before: old };
    });
    res.json({ ok: true });
  });
  router.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof z.ZodError)
        return res.status(400).json({
          error: err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("；"),
        });
      if (err instanceof AdminError)
        return res.status(err.status).json({ error: err.message });
      console.error("Admin operation failed", err);
      res.status(500).json({ error: "操作失败，数据未保存，请检查服务器日志" });
    },
  );
  return router;
}
