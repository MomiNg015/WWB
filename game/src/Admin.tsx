import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import "./admin.css";

type Identity = { username: string; role: string; csrf: string };
type Page =
  | "overview"
  | "users"
  | "items"
  | "characters"
  | "rules"
  | "releases"
  | "rooms"
  | "matches"
  | "audit"
  | "administrators"
  | "settings";
const names: Record<Page, string> = {
  overview: "工作概览",
  users: "用户管理",
  items: "物品管理",
  characters: "角色管理",
  rules: "游戏规则",
  releases: "版本发布",
  rooms: "在线房间",
  matches: "对局记录",
  audit: "操作日志",
  administrators: "管理员权限",
  settings: "账号设置",
};
const descriptions: Record<Page, string> = {
  overview: "查看游戏运行情况和待发布的内容变更。",
  users: "管理用户资料、积分、状态和角色关联。",
  items: "编辑物品草稿，发布后应用于新对局。",
  characters: "管理角色外观与说明，经典模式不附加属性。",
  rules: "调整初始资源、抽牌和触发概率，保存后前往版本发布。",
  releases: "核对修改、运行检查，再将内容应用于新对局。",
  rooms: "查看当前房间，处理异常对局。",
  matches: "查看已结束对局和所用内容版本。",
  audit: "追踪管理员的修改、发布和权限操作。",
  administrators: "为不同工作分配最小需要的权限。",
  settings: "修改当前管理员密码或退出登录。",
};
const roleNames: Record<string, string> = {
  owner: "超级管理员",
  support: "用户管理员",
  editor: "内容编辑",
  publisher: "发布管理员",
  viewer: "只读审计员",
};
const categoryNames: Record<string, string> = {
  weapons: "武器",
  armor: "防具",
  sundries: "杂货",
  miracles: "奇迹",
  trade: "交易",
  devils: "恶魔",
  guardians: "守护神",
  phenomena: "超常现象",
};
const elementNames: Record<string, string> = {
  "": "无",
  fire: "火",
  water: "水",
  wood: "木",
  stone: "土",
  light: "光",
  darkness: "暗",
};
const statusNames: Record<string, string> = {
  active: "正常",
  banned: "封禁",
  archived: "已归档",
  action: "行动中",
  defense: "响应中",
  ended: "已结束",
  waiting: "等待中",
  training: "修行",
  private: "私密乱斗",
  duel: "真格单挑",
};
const fieldNames: Record<string, string> = {
  atk: "攻击力",
  def: "防御力",
  cost: "MP消耗",
  price: "价格",
  giftRate: "抽取权重",
  appearanceRate: "出现权重",
  guardianAttackRate: "守护神技能权重",
  abilityValue: "能力数值",
  hitRate: "全体攻击命中率 (%)",
  initialHP: "初始HP",
  initialMP: "初始MP",
  initialCP: "初始金币",
  handSize: "初始手牌",
  maxHandSize: "手牌上限",
  maxStat: "资源上限",
  tiebreak: "末日回合（0为关闭）",
  diseaseChance: "疾病触发概率",
  guardianChance: "守护神触发概率",
  guardianLeaveChance: "守护神离开概率",
  devilChance: "恶魔触发概率",
};
const date = (s: string) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";
const assetURL = (ref: string) =>
  ref?.startsWith("uploads/") ? `/${ref}` : `/assets/images/items/${ref}.webp`;
function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`adm-badge ${tone}`}>{children}</span>;
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input,button,select")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="adm-overlay"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          const list = [
            ...ref.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
            ),
          ];
          const first = list[0],
            last = list.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        ref={ref}
        className="adm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="adm-quiet" onClick={onClose}>
            关闭
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Admin() {
  useEffect(() => {
    document.title = "WWB · 管理后台";
  }, []);
  const [identity, setIdentity] = useState<Identity | null>(null),
    [boot, setBoot] = useState(true),
    [page, setPage] = useState<Page>("overview");
  const csrf = useRef("");
  const [username, setUsername] = useState("moming"),
    [password, setPassword] = useState("");
  const [data, setData] = useState<any>(null),
    [options, setOptions] = useState<any>({
      assets: [],
      templates: [],
      characters: [],
      abilities: [],
    });
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [number, setNumber] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<any>(null),
    [values, setValues] = useState<any>({}),
    [why, setWhy] = useState(""),
    [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState<any>(null),
    [detail, setDetail] = useState<any>(null);
  const [check, setCheck] = useState("");
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`/api/admin${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Request": "1",
        "X-CSRF-Token": csrf.current,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== "/login") setIdentity(null);
      throw new Error(result.error || "请求失败");
    }
    return result;
  }
  useEffect(() => {
    void api("/me")
      .then((me) => {
        csrf.current = me.csrf;
        setIdentity(me);
      })
      .catch(() => {})
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (!identity) return;
    void api("/options")
      .then(setOptions)
      .catch((e) => setError(e.message));
  }, [identity, refresh]);
  useEffect(() => {
    if (!identity || page === "settings") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setCheck("");
    const params = new URLSearchParams({ q: query, page: String(number) });
    if (filter) params.set(page === "items" ? "category" : "status", filter);
    const timer = setTimeout(
      () =>
        void api(`/${page}?${params}`)
          .then((result) => {
            if (!cancelled) setData(result);
          })
          .catch((e) => {
            if (!cancelled) setError(e.message);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          }),
      150,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [identity, page, query, filter, number, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const root = identity?.role === "owner",
    support = root || identity?.role === "support",
    edit = root || identity?.role === "editor",
    publish = root || identity?.role === "publisher";
  const canView = (p: Page) =>
    !(
      ["users", "rooms", "matches"].includes(p) &&
      !support &&
      identity?.role !== "viewer"
    ) &&
    !(p === "audit" && !root && identity?.role !== "viewer") &&
    !(p === "administrators" && !root);
  function navigate(p: Page) {
    setData(null);
    setPage(p);
    setQuery("");
    setFilter("");
    setNumber(1);
    setError("");
    setNotice("");
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const me = await api("/login", "POST", { username, password });
      csrf.current = me.csrf;
      setIdentity(me);
      setPassword("");
      navigate("overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    try {
      await api("/logout", "POST", {});
      setIdentity(null);
      setData(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function openEdit(kind: string, row?: any, copy = false) {
    let value: any;
    if (kind === "users") value = row ? { ...row } : { name: "" };
    else if (kind === "administrators")
      value = { username: "", password: "", role: "viewer" };
    else if (row) value = structuredClone(row.data);
    else if (kind === "characters")
      value = {
        id: "",
        name: "",
        description: "",
        imageRef: "sundries/sun-amulet",
        enabled: true,
      };
    else {
      const template =
        options.templates.find((i: any) => i.imageName === "wonder-sword") ||
        options.templates[0];
      value = {
        ...template,
        imageRef: `${template.category}/${template.imageName}`,
        imageName: "",
        name: "",
        enabled: true,
      };
    }
    if (copy) {
      value.imageRef ||= `${value.category}/${value.imageName}`;
      value.imageName = "";
      value.name += "（副本）";
    }
    if (kind === "items")
      value.imageRef ||= `${value.category}/${value.imageName}`;
    setValues(value);
    setWhy("");
    setFormError("");
    setEditor({
      initial: JSON.stringify(value),
      kind,
      id: copy ? undefined : row?.id,
      revision: row?.revision,
      new: !row || copy,
    });
  }
  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const { kind } = editor;
      if (kind === "users")
        await api(
          `/users${editor.new ? "" : `/${editor.id}`}`,
          editor.new ? "POST" : "PATCH",
          { ...values, reason: why },
        );
      else if (kind === "administrators")
        await api("/administrators", "POST", { ...values, reason: why });
      else
        await api(
          `/${kind}${editor.new ? "" : `/${editor.id}`}`,
          editor.new ? "POST" : "PATCH",
          { data: values, revision: editor.revision, reason: why },
        );
      setEditor(null);
      setRefresh((n) => n + 1);
      setNotice(
        kind === "users" || kind === "administrators"
          ? "已保存"
          : "草稿已保存，发布后应用于新对局",
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function closeEditor() {
    if (saving) return;
    if (
      (why || JSON.stringify(values) !== editor.initial) &&
      !window.confirm("放弃当前未保存的修改？")
    )
      return;
    setEditor(null);
  }
  function ask(action: string, row?: any) {
    setWhy("");
    setFormError("");
    setConfirm({ action, row, label: "", role: row?.role || "viewer" });
  }
  async function runConfirm(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const { action, row } = confirm;
      if (action === "publish")
        await api("/releases", "POST", {
          label: confirm.label,
          reason: why,
          active: data.active,
          draftHash: data.draftHash,
        });
      if (action === "rollback")
        await api(`/releases/${row.id}/activate`, "POST", { reason: why });
      if (action === "delete")
        await api(`/${page}/${row.id}`, "DELETE", {
          revision: row.revision,
          reason: why,
        });
      if (action === "close")
        await api(`/rooms/${row.id}/close`, "POST", { reason: why });
      if (action === "role")
        await api(`/administrators/${row.id}`, "PATCH", {
          role: confirm.role,
          reason: why,
        });
      setConfirm(null);
      setRefresh((n) => n + 1);
      setNotice("操作已完成，已记录到操作日志");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const field = (
    key: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        value={values[key] ?? ""}
        required={required}
        step={type === "number" ? "any" : undefined}
        onChange={(e) =>
          setValues({
            ...values,
            [key]:
              type === "number"
                ? e.target.value === ""
                  ? undefined
                  : Number(e.target.value)
                : e.target.value,
          })
        }
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    entries: { value: string; label: string }[],
  ) => (
    <label key={key}>
      {label}
      <select
        value={values[key] ?? ""}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      >
        {entries.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const assetSelect = () => (
    <>
      {select("imageRef", "显示素材", options.assets)}
      <label>
        上传新素材
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={saving}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 512 * 1024) {
              setFormError("图片不能超过512KB");
              return;
            }
            setSaving(true);
            setFormError("");
            try {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              const result = await api("/assets", "POST", {
                base64,
                name: file.name,
              });
              setOptions((o: any) => ({ ...o, assets: [...o.assets, result] }));
              setValues((v: any) => ({ ...v, imageRef: result.value }));
            } catch (error) {
              setFormError((error as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        />
      </label>
      <p className="adm-help">
        支持 PNG、JPEG、WebP，最大512KB。角色外观不会改变经典模式战斗属性。
      </p>
    </>
  );
  const rows = data?.rows || [];
  if (boot)
    return <div className="admin-root adm-loading">正在检查登录状态…</div>;
  if (!identity)
    return (
      <div className="admin-root adm-login">
        <aside>
          <div className="adm-wordmark">
            WWB <span>ADMIN</span>
          </div>
          <h1>
            管理游戏，
            <br />
            从这里开始。
          </h1>
          <p>
            用户与内容统一管理。
            <br />
            每一次修改都有记录，每一个版本都可追溯。
          </p>
          <small>WWB · 游戏管理控制台</small>
        </aside>
        <main>
          <form onSubmit={login}>
            <span className="adm-eyebrow">管理员入口</span>
            <h2>登录管理后台</h2>
            <p>请输入管理员用户名和密码</p>
            <label>
              用户名
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <div className="adm-error" role="alert">
                {error}
              </div>
            )}
            <button className="adm-primary" disabled={saving}>
              {saving ? "正在登录…" : "登录"}
            </button>
            <a href="/">返回游戏</a>
          </form>
        </main>
      </div>
    );
  return (
    <div className="admin-root adm-shell">
      <aside className="adm-sidebar">
        <div className="adm-wordmark">
          WWB <span>ADMIN</span>
        </div>
        <div className="adm-nav-label">管理工作台</div>
        <nav>
          {(Object.keys(names) as Page[]).filter(canView).map((p) => (
            <button
              key={p}
              className={page === p ? "active" : ""}
              onClick={() => navigate(p)}
            >
              <span className="adm-nav-mark" />
              {names[p]}
            </button>
          ))}
        </nav>
        <div className="adm-sidebar-footer">
          <Badge>{roleNames[identity.role]}</Badge>
          <strong>{identity.username}</strong>
          <a href="/" target="_blank" rel="noreferrer">
            打开游戏 ↗
          </a>
        </div>
      </aside>
      <div className="adm-workspace">
        <header className="adm-topbar">
          <span>
            管理控制台 <b>/</b> {names[page]}
          </span>
          <button className="adm-quiet" onClick={logout}>
            退出登录
          </button>
        </header>
        <main className="adm-main">
          <header className="adm-page-heading">
            <div>
              <h1>{names[page]}</h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="adm-actions">
              {["users", "items", "characters", "administrators"].includes(
                page,
              ) &&
                ((page === "users" && support) ||
                  (page === "administrators" && root) ||
                  (["items", "characters"].includes(page) && edit)) && (
                  <button
                    className="adm-primary"
                    onClick={() => openEdit(page)}
                  >
                    +{" "}
                    {page === "users"
                      ? "新增测试用户"
                      : page === "items"
                        ? "新增物品"
                        : page === "characters"
                          ? "新增角色"
                          : "新增管理员"}
                  </button>
                )}
              <button onClick={() => setRefresh((n) => n + 1)}>刷新</button>
            </div>
          </header>
          {notice && (
            <div className="adm-success" role="status">
              {notice}
            </div>
          )}
          {error && (
            <div className="adm-error" role="alert">
              {error}
              <button onClick={() => setRefresh((n) => n + 1)}>重试</button>
            </div>
          )}
          {page === "settings" ? (
            <PasswordForm
              api={api}
              done={() => {
                setIdentity(null);
                setNotice("");
              }}
            />
          ) : loading && !data ? (
            <div className="adm-panel adm-loading">正在加载数据…</div>
          ) : (
            data && (
              <>
                {page === "overview" && (
                  <>
                    <div className="adm-stats">
                      {[
                        ["用户总数", data.users, "users"],
                        ["物品草稿", data.items, "items"],
                        ["角色模板", data.characters, "characters"],
                        ["在线房间", data.rooms, "rooms"],
                      ].map(([label, count, target]) => (
                        <button
                          key={label}
                          onClick={() =>
                            canView(target as Page) && navigate(target as Page)
                          }
                        >
                          <span>{label}</span>
                          <strong>{count}</strong>
                          <small>查看管理列表 →</small>
                        </button>
                      ))}
                    </div>
                    <div className="adm-overview-grid">
                      <section className="adm-panel">
                        <div className="adm-section-title">
                          <h2>内容发布</h2>
                          <Badge tone="green">v{data.release.id} 生效中</Badge>
                        </div>
                        <h3>{data.release.label}</h3>
                        <p>发布于 {date(data.release.createdAt)}</p>
                        <div className="adm-divider" />
                        <strong>{data.changes.length} 项待发布变更</strong>
                        <p>保存草稿不会影响玩家。完成检查后，发布至新对局。</p>
                        <button
                          className="adm-primary"
                          onClick={() => navigate("releases")}
                        >
                          查看变更与发布
                        </button>
                      </section>
                      <section className="adm-panel">
                        <h2>常用操作</h2>
                        {(["users", "items", "characters", "audit"] as Page[])
                          .filter(canView)
                          .map((p) => (
                            <button
                              className="adm-shortcut"
                              key={p}
                              onClick={() => navigate(p)}
                            >
                              <strong>{names[p]}</strong>
                              <span>{descriptions[p]}</span>
                              <b>→</b>
                            </button>
                          ))}
                      </section>
                    </div>
                  </>
                )}
                {[
                  "users",
                  "items",
                  "characters",
                  "rules",
                  "audit",
                  "matches",
                ].includes(page) && (
                  <section className="adm-panel adm-list">
                    <div className="adm-toolbar">
                      <input
                        aria-label="搜索"
                        placeholder={
                          page === "audit"
                            ? "搜索管理员、操作或对象 ID"
                            : "搜索名称或 ID"
                        }
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setNumber(1);
                        }}
                      />
                      {page === "items" && (
                        <select
                          aria-label="分类筛选"
                          value={filter}
                          onChange={(e) => {
                            setFilter(e.target.value);
                            setNumber(1);
                          }}
                        >
                          <option value="">全部分类</option>
                          {Object.entries(categoryNames).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      )}
                      {page === "users" && (
                        <select
                          aria-label="状态筛选"
                          value={filter}
                          onChange={(e) => {
                            setFilter(e.target.value);
                            setNumber(1);
                          }}
                        >
                          <option value="">全部状态</option>
                          {["active", "banned", "archived"].map((k) => (
                            <option key={k} value={k}>
                              {statusNames[k]}
                            </option>
                          ))}
                        </select>
                      )}
                      <span>共 {data.total} 条</span>
                    </div>
                    <div className="adm-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            {(page === "users"
                              ? [
                                  "用户",
                                  "积分 / 场次",
                                  "状态",
                                  "最近更新",
                                  "操作",
                                ]
                              : page === "items"
                                ? [
                                    "物品",
                                    "分类 / 属性",
                                    "攻 / 守 / MP",
                                    "权重",
                                    "草稿状态",
                                    "操作",
                                  ]
                                : page === "characters"
                                  ? ["角色", "说明", "草稿状态", "操作"]
                                  : page === "rules"
                                    ? [
                                        "配置",
                                        "初始 HP / MP / 金币",
                                        "手牌 / 上限",
                                        "操作",
                                      ]
                                    : page === "audit"
                                      ? [
                                          "时间 / 操作者",
                                          "操作",
                                          "对象",
                                          "原因",
                                          "详情",
                                        ]
                                      : [
                                          "对局",
                                          "模式",
                                          "玩家",
                                          "版本 / 回合",
                                          "结束时间",
                                        ]
                            ).map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r: any) => {
                            const d = r.data || r;
                            return (
                              <tr key={r.id}>
                                {page === "users" ? (
                                  <>
                                    <td>
                                      <strong>{r.name}</strong>
                                      <small className="adm-id">{r.id}</small>
                                    </td>
                                    <td>
                                      {r.rating}{" "}
                                      <span className="adm-muted">
                                        / {r.games} 场
                                      </span>
                                    </td>
                                    <td>
                                      <Badge
                                        tone={
                                          r.status === "active"
                                            ? "green"
                                            : "orange"
                                        }
                                      >
                                        {statusNames[r.status] || r.status}
                                      </Badge>
                                    </td>
                                    <td>{date(r.updatedAt)}</td>
                                    <td>
                                      <div className="adm-row-actions">
                                        <button
                                          onClick={() =>
                                            void api(`/users/${r.id}`)
                                              .then(setDetail)
                                              .catch((e) => setError(e.message))
                                          }
                                        >
                                          详情
                                        </button>
                                        {support && (
                                          <button
                                            onClick={() => openEdit("users", r)}
                                          >
                                            编辑 / 归档
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </>
                                ) : page === "items" ? (
                                  <>
                                    <td>
                                      <div className="adm-item-cell">
                                        <img
                                          src={assetURL(
                                            d.imageRef ||
                                              `${d.category}/${d.imageName}`,
                                          )}
                                          alt=""
                                        />
                                        <div>
                                          <strong>{d.name}</strong>
                                          <small className="adm-id">
                                            {r.id}
                                          </small>
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      {categoryNames[d.category]}
                                      <small>
                                        {elementNames[d.element || ""]}属性
                                      </small>
                                    </td>
                                    <td>
                                      {d.atk ?? "—"} / {d.def ?? "—"} /{" "}
                                      {d.cost ?? "—"}
                                    </td>
                                    <td>{d.giftRate ?? 0}</td>
                                    <td>
                                      <Badge tone={d.enabled ? "green" : ""}>
                                        {d.enabled ? "启用" : "停用"}
                                      </Badge>
                                      <small>修订 {r.revision}</small>
                                    </td>
                                    <td>
                                      <div className="adm-row-actions">
                                        {edit ? (
                                          <>
                                            <button
                                              onClick={() => openEdit(page, r)}
                                            >
                                              编辑
                                            </button>
                                            <button
                                              onClick={() =>
                                                openEdit(page, r, true)
                                              }
                                            >
                                              复制
                                            </button>
                                            <button
                                              className="adm-danger-text"
                                              disabled={r.published}
                                              title={
                                                r.published
                                                  ? "已被发布版本引用，请编辑为停用"
                                                  : "删除未发布草稿"
                                              }
                                              onClick={() => ask("delete", r)}
                                            >
                                              删除
                                            </button>
                                          </>
                                        ) : (
                                          <button onClick={() => setDetail(d)}>
                                            详情
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </>
                                ) : page === "characters" ? (
                                  <>
                                    <td>
                                      <div className="adm-item-cell">
                                        <img
                                          src={assetURL(d.imageRef)}
                                          alt=""
                                        />
                                        <div>
                                          <strong>{d.name}</strong>
                                          <small className="adm-id">
                                            {r.id}
                                          </small>
                                        </div>
                                      </div>
                                    </td>
                                    <td>{d.description}</td>
                                    <td>
                                      <Badge tone={d.enabled ? "green" : ""}>
                                        {d.enabled ? "启用" : "停用"}
                                      </Badge>
                                    </td>
                                    <td>
                                      <div className="adm-row-actions">
                                        {edit ? (
                                          <>
                                            <button
                                              onClick={() => openEdit(page, r)}
                                            >
                                              编辑
                                            </button>
                                            <button
                                              className="adm-danger-text"
                                              disabled={r.published}
                                              title={
                                                r.published
                                                  ? "已被发布版本引用，请编辑为停用"
                                                  : "删除未发布草稿"
                                              }
                                              onClick={() => ask("delete", r)}
                                            >
                                              删除
                                            </button>
                                          </>
                                        ) : (
                                          <button onClick={() => setDetail(d)}>
                                            详情
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </>
                                ) : page === "rules" ? (
                                  <>
                                    <td>
                                      <strong>经典规则</strong>
                                      <small>修订 {r.revision}</small>
                                    </td>
                                    <td>
                                      {d.initialHP} / {d.initialMP} /{" "}
                                      {d.initialCP}
                                    </td>
                                    <td>
                                      {d.handSize} / {d.maxHandSize}
                                    </td>
                                    <td>
                                      <button
                                        onClick={() =>
                                          edit
                                            ? openEdit(page, r)
                                            : setDetail(d)
                                        }
                                      >
                                        {edit ? "编辑规则" : "详情"}
                                      </button>
                                    </td>
                                  </>
                                ) : page === "audit" ? (
                                  <>
                                    <td>
                                      {date(r.at)}
                                      <small>{r.actor}</small>
                                    </td>
                                    <td>
                                      <Badge>{r.action}</Badge>
                                    </td>
                                    <td className="adm-id">{r.target}</td>
                                    <td>{r.reason}</td>
                                    <td>
                                      <button
                                        onClick={() =>
                                          setDetail({
                                            操作: r.action,
                                            修改前: r.before_json
                                              ? JSON.parse(r.before_json)
                                              : null,
                                            修改后: r.after_json
                                              ? JSON.parse(r.after_json)
                                              : null,
                                          })
                                        }
                                      >
                                        查看差异
                                      </button>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="adm-id">{r.id}</td>
                                    <td>{statusNames[r.mode]}</td>
                                    <td>
                                      {r.players
                                        ?.map((p: any) => p.name)
                                        .join("、")}
                                    </td>
                                    <td>
                                      v{r.contentVersion} / {r.round}回合
                                    </td>
                                    <td>{date(r.endedAt)}</td>
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!rows.length && (
                        <div className="adm-empty">
                          <strong>没有找到记录</strong>
                          <p>尝试调整搜索条件，或新增一条数据。</p>
                        </div>
                      )}
                    </div>
                    <footer className="adm-pagination">
                      <span>
                        第 {number} / {Math.max(1, Math.ceil(data.total / 20))}{" "}
                        页
                      </span>
                      <button
                        disabled={number <= 1}
                        onClick={() => setNumber((n) => n - 1)}
                      >
                        上一页
                      </button>
                      <button
                        disabled={number * 20 >= data.total}
                        onClick={() => setNumber((n) => n + 1)}
                      >
                        下一页
                      </button>
                    </footer>
                  </section>
                )}
                {page === "releases" && (
                  <>
                    <section className="adm-panel">
                      <div className="adm-section-title">
                        <h2>
                          待发布变更 <Badge>{data.changes.length}</Badge>
                        </h2>
                        <div className="adm-actions">
                          {(edit || publish) && (
                            <button
                              disabled={saving}
                              onClick={async () => {
                                setSaving(true);
                                setCheck("");
                                try {
                                  const r = await api(
                                    "/releases/validate",
                                    "POST",
                                    {},
                                  );
                                  setCheck(r.message);
                                } catch (e) {
                                  setError((e as Error).message);
                                } finally {
                                  setSaving(false);
                                }
                              }}
                            >
                              {saving ? "检查中…" : "运行预检与测试局"}
                            </button>
                          )}
                          {publish && (
                            <button
                              className="adm-primary"
                              disabled={!data.changes.length || saving}
                              onClick={() => ask("publish")}
                            >
                              发布新版本
                            </button>
                          )}
                        </div>
                      </div>
                      <p>
                        当前生效版本 v{data.active}
                        。发布时会再次检查配置；进行中的对局继续使用原版本。
                      </p>
                      {check && (
                        <div className="adm-success" role="status">
                          {check}
                        </div>
                      )}
                      {!data.changes.length ? (
                        <div className="adm-empty">所有草稿与生效版本一致</div>
                      ) : (
                        data.changes.map((c: any) => (
                          <div className="adm-change" key={`${c.kind}-${c.id}`}>
                            <div>
                              <strong>{c.name}</strong>
                              <small>
                                {c.id} · {c.before ? "修改" : "新增"}
                              </small>
                            </div>
                            <button
                              onClick={() =>
                                setDetail({ 修改前: c.before, 修改后: c.after })
                              }
                            >
                              查看差异
                            </button>
                          </div>
                        ))
                      )}
                    </section>
                    <section className="adm-panel">
                      <h2>发布历史</h2>
                      {data.rows.map((r: any) => (
                        <div className="adm-change" key={r.id}>
                          <div>
                            <strong>
                              v{r.id} · {r.label}
                            </strong>
                            <small>{date(r.createdAt)}</small>
                          </div>
                          {r.id === data.active ? (
                            <Badge tone="green">当前生效</Badge>
                          ) : publish ? (
                            <button onClick={() => ask("rollback", r)}>
                              回滚至此版本
                            </button>
                          ) : (
                            <Badge>历史版本</Badge>
                          )}
                        </div>
                      ))}
                    </section>
                  </>
                )}
                {page === "rooms" && (
                  <section className="adm-panel">
                    {!data.length ? (
                      <div className="adm-empty">当前没有在线房间</div>
                    ) : (
                      data.map((r: any) => (
                        <div className="adm-change" key={r.id}>
                          <div>
                            <strong>
                              {statusNames[r.mode]} · {r.players.join("、")}
                            </strong>
                            <small>
                              {r.id} · {statusNames[r.phase]} ·{" "}
                              {r.contentVersion
                                ? `v${r.contentVersion}`
                                : "未开始"}
                            </small>
                          </div>
                          {support && (
                            <button
                              className="adm-danger-text"
                              onClick={() => ask("close", r)}
                            >
                              关闭房间
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </section>
                )}
                {page === "administrators" && (
                  <section className="adm-panel">
                    <table>
                      <thead>
                        <tr>
                          <th>用户名</th>
                          <th>权限角色</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.map((r: any) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.username}</strong>
                              {r.username === identity.username && (
                                <Badge>当前账号</Badge>
                              )}
                            </td>
                            <td>{roleNames[r.role]}</td>
                            <td>
                              <div className="adm-row-actions">
                                <button
                                  disabled={r.username === identity.username}
                                  onClick={() => ask("role", r)}
                                >
                                  调整权限
                                </button>
                                <button
                                  disabled={r.username === identity.username}
                                  className="adm-danger-text"
                                  onClick={() => ask("delete", r)}
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
              </>
            )
          )}
        </main>
        <footer className="adm-footer">
          WWB 管理控制台 <span>内容草稿与线上版本分离 · 管理操作留痕</span>
        </footer>
      </div>
      {editor && (
        <Dialog
          title={`${editor.new ? "新增" : "编辑"}${names[editor.kind as Page].replace("管理", "")}`}
          onClose={closeEditor}
        >
          <form onSubmit={submitEdit}>
            <div className="adm-edit-layout">
              <div className="adm-fields">
                {editor.kind === "users" ? (
                  <>
                    {field("name", "昵称", "text", true)}
                    {!editor.new && (
                      <>
                        {field("rating", "积分", "number", true)}
                        {field("games", "场次", "number", true)}
                        {select(
                          "status",
                          "账号状态",
                          ["active", "banned", "archived"].map((k) => ({
                            value: k,
                            label: statusNames[k],
                          })),
                        )}
                        {select("characterId", "关联角色（已发布）", [
                          { value: "", label: "默认角色" },
                          ...options.characters.map((c: any) => ({
                            value: c.id,
                            label: c.name,
                          })),
                        ])}
                        <p className="adm-help">
                          封禁或归档会断开该用户连接。归档保留历史记录。
                        </p>
                      </>
                    )}
                  </>
                ) : editor.kind === "administrators" ? (
                  <>
                    {field("username", "用户名", "text", true)}
                    {field("password", "初始密码（至少6位）", "password", true)}
                    {select(
                      "role",
                      "权限角色",
                      Object.entries(roleNames).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    )}
                  </>
                ) : editor.kind === "rules" ? (
                  Object.keys(fieldNames)
                    .filter((k) => k in values)
                    .map((k) => field(k, fieldNames[k], "number", true))
                ) : (
                  <>
                    {editor.kind === "items" && editor.new && (
                      <label className="adm-full">
                        从已有物品模板开始
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const t = options.templates.find(
                              (i: any) => i.imageName === e.target.value,
                            );
                            if (t)
                              setValues({
                                ...t,
                                imageRef: `${t.category}/${t.imageName}`,
                                imageName: values.imageName,
                                name: values.name,
                                enabled: true,
                              });
                          }}
                        >
                          <option value="">选择能力模板</option>
                          {options.templates.map((t: any) => (
                            <option key={t.imageName} value={t.imageName}>
                              {categoryNames[t.category]} · {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      稳定ID
                      <input
                        required
                        value={values.imageName ?? values.id ?? ""}
                        disabled={!editor.new}
                        pattern="[a-zA-Z0-9_-]+"
                        onChange={(e) =>
                          setValues({
                            ...values,
                            [editor.kind === "items" ? "imageName" : "id"]:
                              e.target.value,
                          })
                        }
                      />
                    </label>
                    {field("name", "名称", "text", true)}
                    {editor.kind === "items" ? (
                      <>
                        {select(
                          "category",
                          "分类",
                          Object.entries(categoryNames).map(
                            ([value, label]) => ({ value, label }),
                          ),
                        )}
                        {select(
                          "element",
                          "属性",
                          Object.entries(elementNames).map(
                            ([value, label]) => ({ value, label }),
                          ),
                        )}
                        {[
                          "atk",
                          "def",
                          "cost",
                          "price",
                          "giftRate",
                          "appearanceRate",
                          "guardianAttackRate",
                          "abilityValue",
                          "hitRate",
                        ]
                          .filter((k) => {
                            if (k in values) return true;
                            if (k === "cost")
                              return values.category === "miracles";
                            if (k === "guardianAttackRate")
                              return values.category === "guardians";
                            if (k === "appearanceRate")
                              return ["devils", "phenomena"].includes(
                                values.category,
                              );
                            if (k === "giftRate" || k === "price")
                              return [
                                "weapons",
                                "armor",
                                "miracles",
                                "sundries",
                              ].includes(values.category);
                            if (k === "def") return values.category === "armor";
                            if (k === "abilityValue") return !!values.ability;
                            return [
                              "weapons",
                              "miracles",
                              "guardians",
                            ].includes(values.category);
                          })
                          .map((k) => field(k, fieldNames[k], "number"))}
                        {select("ability", "能力", [
                          { value: "", label: "无特殊能力" },
                          ...options.abilities
                            .filter((a: string) =>
                              options.templates.some(
                                (t: any) =>
                                  t.category === values.category &&
                                  t.ability === a,
                              ),
                            )
                            .map((a: string) => ({
                              value: a,
                              label: options.abilityLabels?.[a] || a,
                            })),
                        ])}
                        {select("curse", "灾祸", [
                          { value: "", label: "无" },
                          ...[
                            ...new Set(
                              options.templates
                                .map((t: any) => t.curse)
                                .filter(Boolean),
                            ),
                          ].map((k: any) => ({
                            value: k,
                            label: options.curseLabels?.[k] || k,
                          })),
                        ])}
                        {select("guardian", "守护神", [
                          { value: "", label: "无" },
                          ...[
                            ...new Set(
                              options.templates
                                .map((t: any) => t.guardian)
                                .filter(Boolean),
                            ),
                          ].map((k: any) => ({
                            value: k,
                            label: options.guardianLabels?.[k] || k,
                          })),
                        ])}
                        <label className="adm-check">
                          <input
                            type="checkbox"
                            checked={!!values.isPlusAtk}
                            onChange={(e) =>
                              setValues({
                                ...values,
                                isPlusAtk: e.target.checked,
                              })
                            }
                          />
                          追加攻击物品
                        </label>
                      </>
                    ) : (
                      <label className="adm-full">
                        角色说明
                        <textarea
                          value={values.description}
                          maxLength={500}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              description: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    {assetSelect()}
                    <label className="adm-check">
                      <input
                        type="checkbox"
                        checked={values.enabled !== false}
                        onChange={(e) =>
                          setValues({ ...values, enabled: e.target.checked })
                        }
                      />
                      启用（发布后生效）
                    </label>
                  </>
                )}
                <label className="adm-full">
                  修改原因
                  <textarea
                    required
                    value={why}
                    maxLength={300}
                    placeholder="说明本次修改的原因，方便后续追溯"
                    onChange={(e) => setWhy(e.target.value)}
                  />
                </label>
              </div>
              {["items", "characters"].includes(editor.kind) && (
                <aside className="adm-preview">
                  <span className="adm-eyebrow">内容预览</span>
                  <img
                    src={assetURL(
                      values.imageRef ||
                        `${values.category}/${values.imageName}`,
                    )}
                    alt="素材预览"
                  />
                  <h3>{values.name || "未命名"}</h3>
                  <p>
                    {editor.kind === "items"
                      ? `${categoryNames[values.category]} · ${elementNames[values.element || ""]}属性`
                      : values.description || "角色说明"}
                  </p>
                  {editor.kind === "items" && (
                    <dl>
                      {["atk", "def", "cost", "price"]
                        .filter((k) => values[k] !== undefined)
                        .map((k) => (
                          <div key={k}>
                            <dt>{fieldNames[k]}</dt>
                            <dd>{values[k]}</dd>
                          </div>
                        ))}
                    </dl>
                  )}
                  <p className="adm-help">
                    保存为草稿后，前往“版本发布”检查并发布。
                  </p>
                </aside>
              )}
            </div>
            {formError && (
              <div className="adm-error" role="alert">
                {formError}
              </div>
            )}
            <footer className="adm-dialog-footer">
              <button type="button" disabled={saving} onClick={closeEditor}>
                取消
              </button>
              <button className="adm-primary" disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={
            {
              publish: "发布新版本",
              rollback: "回滚内容版本",
              delete: "删除记录",
              close: "关闭房间",
              role: "调整管理员权限",
            }[confirm.action as string] || "确认操作"
          }
          onClose={() => !saving && setConfirm(null)}
        >
          <form onSubmit={runConfirm} className="adm-confirm-form">
            <p>
              {confirm.action === "publish"
                ? `将发布 ${data.changes.length} 项变更，仅对新对局生效。`
                : confirm.action === "rollback"
                  ? `将新对局切换到 v${confirm.row.id}，不会覆盖草稿或改变进行中的对局。`
                  : confirm.action === "close"
                    ? "此房间会立即关闭，未结算对局不计积分。"
                    : confirm.action === "delete"
                      ? `删除 ${confirm.row.data?.name || confirm.row.username || confirm.row.id}。已发布或被引用的记录不能删除，请编辑为停用。`
                      : "权限变更后，对方现有管理会话会失效。"}
            </p>
            {confirm.action === "publish" && (
              <label>
                版本名称
                <input
                  required
                  value={confirm.label}
                  placeholder="例如：平衡调整 01"
                  onChange={(e) =>
                    setConfirm({ ...confirm, label: e.target.value })
                  }
                />
              </label>
            )}
            {confirm.action === "role" && (
              <label>
                权限角色
                <select
                  value={confirm.role}
                  onChange={(e) =>
                    setConfirm({ ...confirm, role: e.target.value })
                  }
                >
                  {Object.entries(roleNames).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              操作原因
              <textarea
                required
                maxLength={300}
                value={why}
                onChange={(e) => setWhy(e.target.value)}
              />
            </label>
            {formError && (
              <div className="adm-error" role="alert">
                {formError}
              </div>
            )}
            <footer className="adm-dialog-footer">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirm(null)}
              >
                取消
              </button>
              <button className="adm-primary" disabled={saving}>
                {saving ? "处理中…" : "确认"}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {detail && (
        <Dialog title="记录详情" onClose={() => setDetail(null)}>
          <div className="adm-detail">
            <RecordDetail value={detail} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
function RecordDetail({ value }: { value: any }) {
  const labels: Record<string, string> = {
    ...fieldNames,
    id: "ID",
    imageName: "物品ID",
    name: "名称",
    rating: "积分",
    games: "场次",
    status: "状态",
    characterId: "关联角色",
    createdAt: "创建时间",
    updatedAt: "更新时间",
    revision: "修订号",
    description: "说明",
    imageRef: "素材",
    enabled: "启用",
    category: "分类",
    element: "属性",
    ability: "能力",
    isPlusAtk: "追加攻击",
    username: "管理员",
    role: "权限角色",
  };
  const format = (v: any): string =>
    v === undefined || v === null
      ? "—"
      : typeof v === "boolean"
        ? v
          ? "是"
          : "否"
        : typeof v === "object"
          ? JSON.stringify(v)
          : statusNames[v] || roleNames[v] || categoryNames[v] || String(v);
  if ("修改前" in value || "修改后" in value) {
    const before = value.修改前 || {},
      after = value.修改后 || {};
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return (
      <table>
        <thead>
          <tr>
            <th>字段</th>
            <th>修改前</th>
            <th>修改后</th>
          </tr>
        </thead>
        <tbody>
          {keys
            .filter(
              (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
            )
            .map((k) => (
              <tr key={k}>
                <td>{labels[k] || k}</td>
                <td>{format(before[k])}</td>
                <td>{format(after[k])}</td>
              </tr>
            ))}
        </tbody>
      </table>
    );
  }
  return (
    <>
      <dl className="adm-detail-fields">
        {Object.entries(value)
          .filter(([key]) => key !== "audit")
          .map(([key, v]) => (
            <div key={key}>
              <dt>{labels[key] || key}</dt>
              <dd>{key.endsWith("At") ? date(String(v)) : format(v)}</dd>
            </div>
          ))}
      </dl>
      {value.audit && (
        <>
          <h3>近期管理记录</h3>
          {value.audit.length ? (
            value.audit.map((entry: any) => (
              <div className="adm-change" key={entry.id}>
                <div>
                  <strong>{entry.reason}</strong>
                  <small>
                    {entry.actor} · {date(entry.at)}
                  </small>
                </div>
                <Badge>{entry.action}</Badge>
              </div>
            ))
          ) : (
            <p>暂无管理记录</p>
          )}
        </>
      )}
    </>
  );
}
function PasswordForm({
  api,
  done,
}: {
  api: (path: string, method: string, body: unknown) => Promise<any>;
  done: () => void;
}) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="adm-panel adm-password">
      <h2>修改密码</h2>
      <p>修改成功后需要重新登录。</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (password !== repeat) {
            setError("两次输入的新密码不一致");
            return;
          }
          setBusy(true);
          try {
            await api("/password", "POST", { current, password });
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          当前密码
          <input
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          新密码
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          确认新密码
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        {error && (
          <div className="adm-error" role="alert">
            {error}
          </div>
        )}
        <button className="adm-primary" disabled={busy}>
          {busy ? "保存中…" : "修改密码"}
        </button>
      </form>
    </section>
  );
}
