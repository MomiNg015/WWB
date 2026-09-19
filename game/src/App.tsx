import { Detail } from "./ItemDetail";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  items,
  texts,
  imageURL,
  itemById,
  statLabel,
  abilityLabel,
  colors,
  setRuntimeCatalog,
} from "../shared/catalog";
import type { Card, Command, GameView, Item } from "../shared/types";
import { defenseError } from "../shared/defense";
import "./battleAlerts.css";
import {
  actionCost,
  attackProfile,
  attackSelectionError,
} from "../shared/actions";
import { useBattlePlayback, BattleAnimation } from "./battlePlayback";
import { send, socket } from "./network";
import layouts from "./reference-layouts.json";
import { loadLanguage, t } from "./i18n";

type Screen =
  "home" | "menu" | "training" | "private" | "duel" | "game" | "settings";
type Session = {
  id: string;
  name: string;
  token: string;
  rating: number;
  games: number;
};
type Member = {
  id: string;
  name: string;
  team: number | null;
  connected: boolean;
};
type Room = {
  id: string;
  mode: string;
  host: string;
  members: Member[];
  tiebreak: number;
  locked: boolean;
  game: GameView | null;
  chat: { id: string; name: string; text: string; team: number | null }[];
};
const iconNames = {
  book: "b9ca42ebeea01cb8",
  back: "334ecaba671b093d",
  volume: "0b77e973db9b549b",
  settings: "d21392add7b1ceb9",
};
function Icon({ name }: { name: keyof typeof iconNames }) {
  return (
    <img className="icon" alt="" src={`/assets/icons/${iconNames[name]}.svg`} />
  );
}
function Button({
  children,
  onClick,
  className = "",
  style,
  disabled = false,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  [key: string]: unknown;
}) {
  return (
    <button
      {...rest}
      disabled={disabled}
      className={`button ${className}`}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
const teams = ["个人战", "火之队", "水之队", "光之队", "暗之队"];
function TeamMark({ team }: { team: number }) {
  return (
    <img
      className="team-mark"
      src={`/assets/icons/team-${team}.svg`}
      alt={teams[team]}
    />
  );
}
function Modal({
  children,
  onClose,
  className = "",
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className="scrim" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        className={`modal ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
function Reference() {
  const [category, setCategory] = useState("elements"),
    [selected, setSelected] = useState<Item | null>(null);
  const keys = [
    "elements",
    "curses",
    "trade",
    "weapons",
    "armor",
    "sundries",
    "miracles",
    "devils",
    "guardians",
    "phenomena",
  ];
  const list = items.filter((i) => i.category === category);
  const entries =
    (layouts as Record<string, Record<string, { left: number; top: number }>>)[
      category
    ] || {};
  const maxY = Math.max(0, ...Object.values(entries).map((p) => p.top));
  const notes: Record<string, string[]> = {
    trade: [texts.reference.discardNote, texts.reference.sacrificeNote],
    weapons: [texts.reference.bounceNote],
    miracles: [texts.reference.miraclesNote, texts.reference.usedMiraclesNote],
    devils: [texts.reference.devilsNote],
    guardians: [
      texts.reference.earthNote,
      texts.reference.moonNote,
      texts.reference.guardianAttackNote,
      texts.reference.guardiansNote,
    ],
  };
  return (
    <div className="reference">
      <nav>
        {keys.map((k, n) => (
          <Button
            key={k}
            className={`reference-tab ${category === k ? "active" : ""} ${n < 2 ? "large" : ""}`}
            onClick={() => {
              setCategory(k);
              setSelected(null);
            }}
          >
            {(texts.reference as Record<string, string>)[k]}
          </Button>
        ))}
      </nav>
      <div className="reference-main">
        {category === "elements" ? (
          <div className="elements">
            <div className="element-table">
              {Object.entries(texts.elementDescriptions).map(([k, v]) => (
                <div key={k}>
                  {k && (
                    <img src={`/assets/images/elements/${k}.webp`} alt="" />
                  )}
                  <span>
                    {v
                      .replace(
                        /\{\{(\w+)\}\}/g,
                        (_, n) =>
                          (texts.elementNames as Record<string, string>)[n],
                      )
                      .split("<br>")
                      .map((s, n) => (
                        <span key={n}>
                          {n > 0 && <br />}
                          {s}
                        </span>
                      ))}
                  </span>
                </div>
              ))}
            </div>
            <p>{texts.reference.elementsNote}</p>
            <p>{t("光属性可以成为火属性、水属性、木属性、土属性的替代。")}</p>
          </div>
        ) : category === "curses" ? (
          <div className="curse-page">
            <div className="curse-grid">
              {Object.entries(texts.curseNames).map(([k, v]) => (
                <div key={k} className={`curse ${k}`}>
                  <img src={`/assets/images/curses/${k}.webp`} alt="" />
                  <strong>{v}</strong>
                  <span>
                    {(texts.curseDescriptions as Record<string, string>)[
                      k
                    ].replaceAll("<br>", " ")}
                  </span>
                </div>
              ))}
            </div>
            {[
              texts.reference.diseasesNote,
              texts.reference.diseaseUpgradeNote,
              texts.reference.fogNote,
            ].map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        ) : (
          <>
            <div className="reference-detail">
              {selected && (
                <>
                  <Detail item={selected} />
                  <p>
                    {selected.giftRate
                      ? `获得率: ${selected.giftRate}/500`
                      : selected.appearanceRate
                        ? `出现率: ${selected.appearanceRate}/25`
                        : selected.guardianAttackRate
                          ? `行动率: ${selected.guardianAttackRate}`
                          : ""}
                  </p>
                </>
              )}
            </div>
            <div className="catalog-scroll" key={category}>
              <div style={{ height: maxY + 95, position: "relative" }}>
                {list.map((i, n) => (
                  <button
                    key={i.imageName}
                    aria-label={i.name}
                    className="catalog-item"
                    style={{
                      left: entries[i.imageName]?.left ?? (n % 9) * 85,
                      top: entries[i.imageName]?.top ?? Math.floor(n / 9) * 85,
                    }}
                    onClick={() => setSelected(i)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <img src={imageURL(i)} alt={i.name} />
                  </button>
                ))}
              </div>
              {(notes[category] || []).map((t) => (
                <p key={t}>{t}</p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
export function Battle({
  game: incoming,
  command,
  onFinish,
  onNotice,
}: {
  game: GameView;
  command: (c: Command) => void;
  onFinish: () => void;
  onNotice: (s: string) => void;
}) {
  const { game, cue, fresh, busy, frame, stage } = useBattlePlayback(incoming);
  const self = game.players[game.self];
  const [battleAlert, setBattleAlert] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!battleAlert) return;
    const timer = setTimeout(() => setBattleAlert(null), 1500);
    return () => clearTimeout(timer);
  }, [battleAlert]);
  function showBattleAlert(text: string) {
    setBattleAlert({ text });
    const volume = Number(localStorage.getItem("gf-volume") ?? 5) / 10;
    if (volume > 0) {
      const audio = new Audio("/assets/audio/alert.mp3");
      audio.volume = Math.min(1, volume);
      void audio.play().catch(() => {});
    }
  }
  const [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(0),
    [hover, setHover] = useState<Item | null>(null),
    [miracles, setMiracles] = useState(false),
    [exchange, setExchange] = useState(false),
    [values, setValues] = useState({ hp: 50, mp: 10, cp: 20 }),
    [discard, setDiscard] = useState(false),
    [trade, setTrade] = useState(false);
  useEffect(() => {
    setSelected([]);
    setBattleAlert(null);
    setExchange(false);
    setTrade(false);
    setDiscard(false);
    setTarget(
      game.players.findIndex(
        (p, i) =>
          i !== game.self && p.hp > 0 && (!self?.team || p.team !== self.team),
      ),
    );
  }, [game.revision]);
  if (!self) return <div className="waiting">{t("观战中")}</div>;
  const hand = [...(self.hand || [])].sort(
    (a, b) =>
      items.findIndex((i) => i.imageName === a.id) -
      items.findIndex((i) => i.imageName === b.id),
  );
  const available = [...hand, ...(self.miracles || [])];
  const chosen = selected
    .map((uid) => available.find((c) => c.uid === uid))
    .filter(Boolean) as Card[];
  const defs = chosen.map((c) => itemById(c.id));
  const defense = game.phase === "defense";
  const buying = game.pending?.kind === "purchase";
  const myTurn =
    !busy &&
    (defense || !self.confused) &&
    game.phase !== "ended" &&
    (defense ? game.pending?.target === game.self : game.turn === game.self);
  const pending =
    (busy && stage?.kind === "launch" ? null : game.pending) ||
    (stage?.kind === "launch"
      ? {
          source: stage.source ?? game.turn,
          target: stage.target,
          cards: stage.cards || [],
          atk: stage.amount || 0,
          element: stage.cards?.find((d) => d.element)?.element || "",
          kind: "attack" as const,
          miracle: false,
          bounces: 0,
        }
      : undefined);
  function unavailable(c: Card) {
    if (!myTurn) return true;
    if (selected.includes(c.uid)) return false;
    const d = itemById(c.id);
    if (defense && pending) {
      const next = [...chosen, c];
      if (defenseError(pending, next, Infinity, self.curses)) return true;
      if (!defenseError(pending, next, self.mp, self.curses)) return false;
      return !available.some(
        (other) =>
          other.uid !== c.uid &&
          !selected.includes(other.uid) &&
          !defenseError(pending, [...next, other], self.mp, self.curses),
      );
    }
    if (discard)
      return (
        d.category === "weapons" ||
        ["revive", "attractDanger"].includes(d.ability || "") ||
        !hand.some((h) => h.uid === c.uid)
      );
    const next = [...defs, d];
    // Original client validates MP on confirmation, not while selecting a miracle.
    return !!attackSelectionError(next);
  }
  function select(c: Card) {
    setHover(itemById(c.id));
    if (unavailable(c)) return;
    if (
      !selected.length &&
      [
        "boostHP",
        "boostMP",
        "boostCP",
        "removeMildCurses",
        "removeAllCurses",
        "setGuardian",
        "exchange",
      ].includes(itemById(c.id).ability || "")
    )
      setTarget(game.self);
    setSelected((s) => {
      const next = s.includes(c.uid)
        ? s.filter((x) => x !== c.uid)
        : [...s, c.uid];
      if (!defense && !discard && s.includes(c.uid)) {
        const kept: string[] = [];
        for (const uid of next) {
          const trial = [...kept, uid].map((id) =>
            itemById(available.find((x) => x.uid === id)!.id),
          );
          if (!attackSelectionError(trial)) kept.push(uid);
        }
        return kept;
      }
      if (defense && pending && s.includes(c.uid)) {
        const remaining = next.map((uid) =>
          available.find((x) => x.uid === uid)!,
        );
        if (defenseError(pending, remaining, self.mp, self.curses))
          return next.filter((uid) => {
            const card = remaining.find((x) => x.uid === uid)!;
            return !defenseError(pending, [card], self.mp, self.curses);
          });
      }
      return next;
    });
  }
  function commit() {
    if (!myTurn) return;
    if (buying) {
      command({ type: "purchase", accept: true });
      return;
    }
    if (
      !defense &&
      !discard &&
      defs.length &&
      attackSelectionError(defs, self.mp)
    ) {
      showBattleAlert(
        actionCost(defs) > self.mp
          ? texts.alerts.miracles
          : attackSelectionError(defs, self.mp)!,
      );
      return;
    }
    if (
      defense &&
      pending &&
      defenseError(pending, chosen, self.mp, self.curses)
    ) {
      showBattleAlert(
        actionCost(defs) > self.mp
          ? texts.alerts.miracles
          : defenseError(pending!, chosen, self.mp, self.curses)!,
      );
      return;
    }
    if (
      !defense &&
      !discard &&
      !chosen.length &&
      hand.some((c) => itemById(c.id).category === "weapons")
    ) {
      showBattleAlert(texts.alerts.pray);
      return;
    }
    if (discard) {
      if (!selected.length) {
        showBattleAlert(texts.alerts.discard);
        return;
      }
      command({ type: "discard", cards: selected });
      return;
    }
    if (defense) {
      command({ type: "defend", cards: selected });
      return;
    }
    if (!selected.length) {
      command({ type: "pray" });
      return;
    }
    if (defs[0]?.ability === "exchange") {
      setValues({ hp: self.hp, mp: self.mp, cp: self.cp });
      setExchange(true);
      return;
    }
    if (defs[0]?.ability === "sell") {
      setTrade(true);
      return;
    }
    command({ type: "play", cards: selected, target });
  }
  const summary = defense
    ? defs.reduce((n, d) => n + (d.def || 0), 0)
    : attackProfile(defs, Math.max(0, self.mp - actionCost(defs))).atk;
  const actionLabel = buying
    ? texts.game.doBuy
    : discard
      ? "舍弃"
      : chosen.length
        ? summary
          ? `${defense ? "守" : "攻"}${summary}`
          : defs[0]?.name || ""
        : defense
          ? "容许"
          : "祈祷";
  const targetPlayer = game.players[target];
  return (
    <div
      className={`battle ${cue?.kind === "start" ? "opening" : ""} ${buying ? "is-purchase" : ""} ${pending ? "has-attack" : ""} ${pending && pending.bounces % 2 ? "reversed" : ""} ${cue?.kind === "reflect" || cue?.kind === "bounce" ? "redirecting" : ""}`}
    >
      <div className="action-panel">
        <div className="actor">
          <TeamMark
            team={
              pending
                ? game.players[pending.target].team
                : game.players[game.turn].team
            }
          />
          {pending
            ? game.players[pending.target].name
            : game.players[game.turn].name}
        </div>
        {!defense && chosen.length > 0 && targetPlayer && (
          <div className="target-name">
            <TeamMark team={targetPlayer.team} />
            {targetPlayer.name}
          </div>
        )}
        <div
          className={`commit-area ${myTurn ? "enabled" : ""}`}
          role="button"
          tabIndex={myTurn && !buying ? 0 : -1}
          aria-hidden={buying}
          aria-label="确认行动"
          aria-disabled={!myTurn}
          onClick={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        >
          {(stage?.kind === "resolve"
            ? stage.defense || []
            : pending && pending.target !== game.self
              ? []
              : defs
          ).map((d, n, all) => (
            <div
              className="stage-card"
              key={`${d.imageName}-${n}`}
              style={{
                top: all.length <= 3 ? n * 100 : (n * 200) / (all.length - 1),
              }}
            >
              <Detail item={d} />
            </div>
          ))}
        </div>
        <Button
          disabled={
            !myTurn ||
            (!defense &&
              !discard &&
              defs.length > 0 &&
              !!attackSelectionError(defs)) ||
            (defense &&
              !buying &&
              !!pending &&
              !!defenseError(pending, chosen, Infinity, self.curses))
          }
          className={`action-confirm ${defense && !selected.length ? "allow" : ""}`}
          aria-label={buying ? "购买" : undefined}
          onClick={commit}
        >
          {busy
            ? stage?.kind === "resolve"
              ? `守${(stage.defense || []).reduce((n, d) => n + (d.def || 0), 0)}`
              : actionLabel
            : myTurn
              ? actionLabel
              : game.phase === "ended"
                ? "战斗结束"
                : "等待行动"}
        </Button>
        {buying && (
          <Button
            className="purchase-decline"
            aria-label="放弃购买"
            disabled={!myTurn}
            onClick={() => command({ type: "purchase", accept: false })}
          >
            {texts.game.doNotBuy}
          </Button>
        )}
      </div>
      {pending && (
        <div className="incoming">
          <div className="actor">{game.players[pending.source].name}</div>
          {(buying && game.pending?.tradeCard
            ? [itemById(game.pending.tradeCard.id)]
            : pending.cards
          ).map((i, n, all) => (
            <div
              className="stage-card"
              key={n}
              style={{
                top:
                  60 +
                  (all.length <= 3 ? n * 100 : (n * 200) / (all.length - 1)),
              }}
            >
              <Detail item={i} />
            </div>
          ))}
          <div
            className="incoming-total"
            style={{ color: colors[pending.element] }}
          >
            {pending.atk
              ? `攻${pending.atk}`
              : pending.kind === "buy" || pending.kind === "purchase"
                ? "购买"
                : pending.kind === "sell"
                  ? "出售"
                  : "奇迹"}
          </div>
        </div>
      )}
      <div className="players">
        {game.players
          .map((p, n) => ({ p, n }))
          .sort((a, b) => Number(a.n === game.self) - Number(b.n === game.self))
          .map(({ p, n }, position) => (
            <button
              key={p.id}
              className={`player ${target === n ? "targeted" : ""} ${p.hp === 0 ? "dead" : ""} ${self.curses.includes("fog") && n !== game.self && (!self.team || self.team !== p.team) && p.hp > 0 ? "fogged" : ""}`}
              disabled={!myTurn || defense || p.hp <= 0}
              style={{
                top:
                  game.players.length === 2
                    ? 90 + position * 135
                    : 10 + position * (340 / game.players.length),
              }}
              onClick={() => {
                if (p.hp > 0) setTarget(n);
              }}
              aria-label={`选择目标 ${p.name}`}
            >
              <div>
                <TeamMark team={p.team} />
                <strong
                  style={{ color: n === game.self ? "#008f6f" : "#4444dd" }}
                >
                  {p.character && (
                    <img
                      className="player-character"
                      src={
                        p.character.imageRef.startsWith("uploads/")
                          ? `/${p.character.imageRef}`
                          : `/assets/images/items/${p.character.imageRef}.webp`
                      }
                      alt={p.character.name}
                      title={p.character.name}
                    />
                  )}
                  {p.name}
                </strong>
                <span>
                  HP<b>{p.hp}</b> MP<b>{p.mp}</b> ¥<b>{p.cp}</b>
                </span>
              </div>
              <small>
                {p.guardian &&
                  (texts.guardianNames as Record<string, string>)[
                    p.guardian
                  ]}{" "}
                {p.curses
                  .map((c) => (texts.curseNames as Record<string, string>)[c])
                  .join(" · ")}
              </small>
            </button>
          ))}
      </div>
      <div className="hand-bar" />
      <Button
        className={`discard ${discard ? "selected" : ""}`}
        aria-label="舍弃神器"
        disabled={!myTurn || defense}
        onClick={() => {
          setDiscard(!discard);
          setSelected([]);
        }}
      >
        <img src="/assets/images/items/trade/discard.webp" alt="舍弃" />
      </Button>
      <div className="hand">
        {(miracles ? self.miracles || [] : hand).map((c) => {
          const d = itemById(c.id);
          return (
            <button
              disabled={unavailable(c)}
              title={
                myTurn &&
                d.category === "miracles" &&
                actionCost([...defs, d]) > self.mp
                  ? texts.alerts.miracles
                  : undefined
              }
              className={`hand-card ${fresh.includes(c.uid) ? "card-drawn" : ""} ${selected.includes(c.uid) ? "chosen" : ""}`}
              key={c.uid}
              style={
                {
                  "--gift-delay": `${Math.max(0, fresh.indexOf(c.uid)) * 250}ms`,
                } as React.CSSProperties
              }
              onClick={() => select(c)}
              onMouseEnter={() => setHover(d)}
              aria-label={`${d.name} ${statLabel(d)}`}
            >
              <img src={imageURL(d)} alt={d.name} />
              <span style={{ color: colors[d.element || ""] }}>
                {d.atk !== undefined
                  ? `${d.hitRate ?? ""}${d.hitRate !== undefined ? "%" : ""}${d.isPlusAtk ? "+" : ""}攻${d.atk}`
                  : d.def !== undefined
                    ? `守${d.def}`
                    : d.cost !== undefined
                      ? `MP${d.cost}`
                      : d.ability === "boostHP"
                        ? `+HP${d.abilityValue}`
                        : d.ability === "boostMP"
                          ? `+MP${d.abilityValue}`
                          : ""}
              </span>
            </button>
          );
        })}
      </div>
      <Button
        className={`miracles-toggle ${miracles ? "selected" : ""}`}
        disabled={busy}
        onClick={() => setMiracles(!miracles)}
      >
        {t("唤起的奇迹")}
      </Button>
      <div className="hover-detail">{hover && <Detail item={hover} />}</div>
      <div className="last-event sr-only" aria-live="polite">
        {game.history.slice(-1)[0]?.text}
      </div>
      {cue && <BattleAnimation key={frame} cue={cue} game={game} />}
      {battleAlert && (
        <div className="battle-alert" role="alert">
          {battleAlert.text}
        </div>
      )}
      {game.phase === "ended" && !busy && (
        <Modal onClose={() => {}} className="ending">
          <h1>
            {game.winners.includes(self.id)
              ? "胜利"
              : game.winners.length
                ? "战斗结束"
                : "大家都不在了"}
          </h1>
          <p>
            {game.players
              .filter((p) => game.winners.includes(p.id))
              .map((p) => p.name)
              .join(" · ")}
          </p>
          <Button onClick={onFinish}>{t("战斗结束")}</Button>
        </Modal>
      )}
      {exchange && (
        <Modal onClose={() => setExchange(false)}>
          <h2>{t("兑换")}</h2>
          <p>HP1 = MP1 = ¥1</p>
          {(["hp", "mp", "cp"] as const).map((k) => (
            <label className="exchange-row" key={k}>
              {k.toUpperCase()}
              <input
                type="number"
                min={0}
                max={game.rules.maxStat}
                value={values[k]}
                onChange={(e) =>
                  setValues({ ...values, [k]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <p>
            总值 {values.hp + values.mp + values.cp} /{" "}
            {self.hp + self.mp + self.cp}
          </p>
          <Button
            disabled={
              !Object.values(values).every(
                (n) => Number.isInteger(n) && n >= 0 && n <= game.rules.maxStat,
              ) ||
              values.hp + values.mp + values.cp !== self.hp + self.mp + self.cp
            }
            onClick={() =>
              command({
                type: "play",
                cards: selected,
                target: game.self,
                exchange: values,
              })
            }
          >
            {t("兑换")}
          </Button>
        </Modal>
      )}
      {trade && (
        <Modal onClose={() => setTrade(false)}>
          <h2>{t("选择出售的神器")}</h2>
          <div className="trade-grid">
            {hand
              .filter((c) => !selected.includes(c.uid))
              .map((c) => (
                <button
                  key={c.uid}
                  onClick={() => {
                    command({
                      type: "play",
                      cards: selected,
                      target,
                      tradeCard: c.uid,
                    });
                    setTrade(false);
                  }}
                >
                  <img
                    src={imageURL(itemById(c.id))}
                    alt={itemById(c.id).name}
                  />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function App() {
  const [localeVersion, setLocaleVersion] = useState(0);
  const [screen, setScreen] = useState<Screen>("home"),
    [reference, setReference] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [name, setName] = useState(localStorage.getItem("gf-name") || ""),
    [room, setRoom] = useState<Room | null>(null),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [counts, setCounts] = useState({ training: 0, private: 0, duel: 0 }),
    [modal, setModal] = useState(""),
    [password, setPassword] = useState(""),
    [count, setCount] = useState(2),
    [tiebreak, setTiebreak] = useState(0),
    [volume, setVolume] = useState(
      Number(localStorage.getItem("gf-volume") ?? 5),
    ),
    [chat, setChat] = useState(""),
    [teamChat, setTeamChat] = useState(false),
    [ranking, setRanking] = useState<
      { id: string; name: string; rating: number; games: number }[]
    >([]),
    [language, setLanguage] = useState(
      localStorage.getItem("gf-language") || "zh-hans",
    );
  useEffect(() => {
    loadLanguage(language)
      .then(() => setLocaleVersion((n) => n + 1))
      .catch((e) => setNotice(e.message));
  }, [language]);
  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("session", (s: Session) => {
      setSession(s);
      localStorage.setItem("gf-session", s.token);
      socket.auth = { token: s.token };
    });
    socket.on("room", (r: Room | null) => {
      if (r?.game?.catalogItems) setRuntimeCatalog(r.game.catalogItems);
      setRoom(r);
      if (!r)
        setScreen((current) =>
          ["game", "private", "duel"].includes(current) ? "menu" : current,
        );
      if (r)
        setScreen(
          r.game
            ? "game"
            : r.mode === "training"
              ? "training"
              : r.mode === "duel"
                ? "duel"
                : "private",
        );
    });
    socket.on("notice", (s: string) => setNotice(s));
    socket.on("catalog", setRuntimeCatalog);
    socket.on("counts", setCounts);
    socket.on("ranking", (data) => {
      setRanking(data);
      setModal("ranking");
    });
    socket.on("deleted", () => {
      localStorage.removeItem("gf-session");
      localStorage.removeItem("gf-name");
      location.reload();
    });
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const click = () => {
      if (!volume) return;
      const a = new Audio("/assets/audio/click.mp3");
      a.volume = volume / 10;
      a.play().catch(() => {});
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, [volume]);
  function back() {
    if (reference) {
      setReference(false);
      return;
    }
    if (modal) {
      setModal("");
      return;
    }
    if (screen === "game") {
      setModal("abandon");
      return;
    }
    if (screen === "settings" || screen === "menu") {
      setScreen("home");
      return;
    }
    if (room) send("leave");
    setRoom(null);
    setScreen("menu");
  }
  function born() {
    const value = name.trim();
    if (!value) {
      setNotice("请输入预言者的姓名");
      return;
    }
    if (!connected) {
      setNotice("正在连接服务器");
      return;
    }
    send("login", { name: value });
    localStorage.setItem("gf-name", value);
    setScreen("menu");
  }
  function command(c: Command) {
    if (room?.game)
      send("command", { revision: room.game.revision, command: c });
  }
  const title = reference
    ? "教典"
    : screen === "settings"
      ? "设置"
      : screen === "training" ||
          (screen === "game" && room?.mode === "training")
        ? "修行"
        : screen === "private" ||
            (screen === "game" && room?.mode === "private")
          ? "私密乱斗"
          : screen === "duel" || (screen === "game" && room?.mode === "duel")
            ? "真格单挑"
            : "";
  const roomMode = screen === "private";
  const self = room?.members.find((m) => m.id === session?.id);
  const host = room?.host === session?.id;
  const background =
    screen === "home"
      ? "home"
      : ["training", "private", "game"].includes(screen)
        ? "room"
        : "menu";
  return (
    <main className="game-frame">
      <header>
        {(screen !== "home" || reference) && (
          <Button className="back" onClick={back} aria-label="返回">
            <Icon name="back" />
          </Button>
        )}
        <strong className="screen-title">{t(title)}</strong>
        {room?.game && !reference && (
          <span className="round">G.F.{room.game.round}</span>
        )}
        <Button className="book" onClick={() => setReference((v) => !v)}>
          <Icon name="book" />
          {t("教典")}
        </Button>
      </header>
      <div className={`scene scene-${background}`}>
        {reference ? (
          <Reference />
        ) : screen === "home" ? (
          <div className="home">
            <img
              className="logo"
              src="/assets/images/logo.webp"
              alt="God Field"
            />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                born();
              }}
            >
              <label htmlFor="name">{t("预言者的姓名")}</label>
              <input
                id="name"
                maxLength={18}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
              <Button className="birth" type="submit">
                {t("诞生")}
              </Button>
            </form>
            <a
              className="app-store"
              href="https://apps.apple.com/cn/app/id1536427424?l=zh-hans"
              target="_blank"
              rel="noreferrer"
            >
              <img
                src="/assets/images/badges/app-store/zh-hans.svg"
                alt="App Store"
              />
            </a>
            <a
              className="google-play"
              href="https://play.google.com/store/apps/details?id=net.godfield&hl=zh-hans"
              target="_blank"
              rel="noreferrer"
            >
              <img
                src="/assets/images/badges/google-play/zh-hans.webp"
                alt="Google Play"
              />
            </a>
          </div>
        ) : screen === "menu" ? (
          <div className="modes">
            {(["training", "private", "duel"] as const).map((k) => (
              <button
                key={k}
                className={`mode mode-${k}`}
                onClick={() =>
                  k === "private" ? setModal("password") : setScreen(k)
                }
              >
                <strong>{texts.modeNames[k]}</strong>
                <span>预言者 {counts[k]} 人</span>
                <small>{texts.modeDescriptions[k]}</small>
              </button>
            ))}
          </div>
        ) : screen === "training" ? (
          <>
            <Button
              className="training-count"
              onClick={() => setModal("count")}
            >
              陪练者 {count} 人
            </Button>
            <Button
              className="training-tiebreak"
              onClick={() => setModal("tiebreak")}
            >
              {t("终末之时")}
              <span>{tiebreak ? `G.F.${tiebreak}` : "无"}</span>
            </Button>
            <Button
              className="start training-start"
              onClick={() => send("training", { count, tiebreak })}
            >
              {t("开始游戏")}
            </Button>
          </>
        ) : screen === "private" && room ? (
          <>
            <h2 className="solo-heading">{t("个人战")}</h2>
            <h2 className="team-heading">{t("团队战")}</h2>
            <Button
              className="solo-choice"
              onClick={() =>
                send("team", { team: self?.team === 0 ? null : 0 })
              }
            >
              <TeamMark team={0} />
            </Button>
            <div className="team-choices">
              {[1, 2, 3, 4].map((n) => (
                <Button
                  key={n}
                  className={`team-${n}`}
                  onClick={() =>
                    send("team", { team: self?.team === n ? null : n })
                  }
                >
                  <TeamMark team={n} />
                </Button>
              ))}
            </div>
            <div className="lobby-members">
              {Array.from({ length: 9 }, (_, n) => {
                const m = room.members.filter((m) => m.team !== null)[n];
                return (
                  <button
                    key={n}
                    onClick={() => {
                      if (m && host && m.id !== session?.id) {
                        setModal("kick:" + m.id);
                      }
                    }}
                  >
                    {m && (
                      <>
                        <TeamMark team={m.team!} />
                        {m.name}
                        {!m.connected ? "（离线）" : ""}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="unready">
              {room.members
                .filter((m) => m.team === null)
                .map((m) => (
                  <span key={m.id}>{m.name}</span>
                ))}
            </div>
            <Button
              className="room-tiebreak"
              disabled={!host}
              onClick={() => setModal("tiebreak")}
            >
              {t("终末之时")}
              <span>{room.tiebreak ? `G.F.${room.tiebreak}` : "无"}</span>
            </Button>
            <Button
              className="start shuffle"
              disabled={
                !host || room.members.filter((m) => m.team !== null).length < 2
              }
              onClick={() => send("shuffle")}
            >
              {t("随机组队")}
            </Button>
            <Button
              className="start room-start"
              disabled={
                !host || room.members.filter((m) => m.team !== null).length < 2
              }
              onClick={() => send("start")}
            >
              {t("开始游戏")}
            </Button>
          </>
        ) : screen === "duel" ? (
          <>
            <Button
              className="start duel-start"
              onClick={() =>
                room?.mode === "duel"
                  ? (send("leave"), setRoom(null))
                  : send("match")
              }
            >
              {room?.mode === "duel" ? "取消匹配" : "战斗"}
            </Button>
            {room?.mode === "duel" && (
              <p className="matching">{t("等待另一位预言者…")}</p>
            )}
            <div className="rating">
              <strong>{t("评级")}</strong>
              <b>{session?.rating ?? 1500}</b>
              <span>{session?.games ?? 0} 比赛</span>
            </div>
          </>
        ) : screen === "game" && room?.game ? (
          <Battle
            game={room.game}
            command={command}
            onNotice={setNotice}
            onFinish={() => {
              const mode = room.mode;
              send("reset");
              if (mode !== "private") {
                setRoom(null);
                setScreen(mode === "training" ? "training" : "duel");
              }
            }}
          />
        ) : screen === "settings" ? (
          <div className="settings-page">
            <select
              aria-label="语言"
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                localStorage.setItem("gf-language", e.target.value);
              }}
            >
              {Object.entries(texts.langNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <h1>{t("神界 - God Field")}</h1>
            <p>
              {t("设计")}
              <strong>Guuji</strong>
              <a href="https://x.com/guuji" target="_blank" rel="noreferrer">
                X @guuji
              </a>
            </p>
            <p>
              {t("美术")}
              <strong>Ami</strong>
            </p>
            <p>
              <small>{t("效果音素材")}</small>
              <strong>THE MATCH-MAKERS</strong>
            </p>
            {["pt", "zhHans", "fr", "zhHant", "ko", "ru"].map((k) => (
              <p key={k}>
                <small>
                  {
                    (texts.settings as Record<string, string>)[
                      k + "Translation"
                    ]
                  }
                </small>
                <strong>
                  {
                    (texts.settings as Record<string, string>)[
                      k + "TranslationCredit"
                    ]
                  }
                </strong>
              </p>
            ))}
            <button onClick={() => setModal("privacy")}>{t("隐私政策")}</button>
            <button onClick={() => setModal("delete")}>{t("删除帐户")}</button>
          </div>
        ) : null}
      </div>
      <footer>
        <span className="footer-name">
          {screen !== "home" && screen !== "settings" ? session?.name : ""}
        </span>
        {roomMode ? (
          <>
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (chat.trim()) {
                  send("chat", { text: chat, team: teamChat });
                  setChat("");
                }
              }}
            >
              <input
                aria-label="聊天消息"
                maxLength={200}
                value={chat}
                onChange={(e) => setChat(e.target.value)}
              />
              <button type="submit">
                {teamChat ? "队内聊天" : "房间聊天"}
              </button>
            </form>
            <Button className="chat-log" onClick={() => setModal("chat")}>
              {t("聊天记录")}
            </Button>
            <button
              className="lock"
              aria-label="阻止新用户"
              disabled={!host}
              onClick={() => send("configure", { locked: !room?.locked })}
            >
              {room?.locked ? "已锁" : "锁定"}
            </button>
          </>
        ) : screen === "home" || screen === "settings" ? (
          <Button
            className="footer-center"
            onClick={() => {
              setReference(false);
              setScreen("settings");
            }}
          >
            <Icon name="settings" />
            {t("设置")}
          </Button>
        ) : screen === "duel" ? (
          <Button className="footer-center" onClick={() => send("ranking")}>
            {t("排行")}
          </Button>
        ) : null}
        <div className="volume">
          <button
            aria-label="静音"
            onClick={() => {
              setVolume(volume ? 0 : 5);
              localStorage.setItem("gf-volume", String(volume ? 0 : 5));
            }}
          >
            <Icon name="volume" />
          </button>
          {Array.from({ length: 10 }, (_, i) => (
            <button
              key={i}
              aria-label={`音量 ${i + 1}`}
              style={{ opacity: i < volume ? 1 : 0.25 }}
              onClick={() => {
                setVolume(i + 1);
                localStorage.setItem("gf-volume", String(i + 1));
              }}
            />
          ))}
        </div>
      </footer>
      {!connected && (
        <div className="connection" role="status">
          {t("正在连接服务器…")}
        </div>
      )}
      {notice && (
        <div role="alert" className="notice" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
      {modal && (
        <Modal
          onClose={() => setModal("")}
          className={
            modal === "tiebreak" || modal === "count" ? "options-modal" : ""
          }
        >
          {modal === "password" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send("join", { password });
                setModal("");
              }}
            >
              <label htmlFor="password">{t("房间密码")}</label>
              <input
                id="password"
                value={password}
                maxLength={64}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <Button type="submit" className="chant">
                {t("吟唱")}
              </Button>
            </form>
          ) : modal === "count" ? (
            <>
              <h2>{t("陪练者")}</h2>
              <div className="option-grid">
                {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <Button
                    key={n}
                    onClick={() => {
                      setCount(n);
                      setModal("");
                    }}
                  >
                    {n}人
                  </Button>
                ))}
              </div>
            </>
          ) : modal === "tiebreak" ? (
            <>
              <h2>{t("终末之时")}</h2>
              <div className="option-grid">
                {[1, 50, 75, 100, 150, 0].map((n) => (
                  <Button
                    key={n}
                    onClick={() => {
                      if (screen === "private")
                        send("configure", { tiebreak: n });
                      else setTiebreak(n);
                      setModal("");
                    }}
                  >
                    {n ? `G.F.${n}` : "无"}
                  </Button>
                ))}
              </div>
            </>
          ) : modal === "abandon" ? (
            <Button
              className="danger"
              onClick={() => {
                send("leave");
                setRoom(null);
                setScreen("menu");
                setModal("");
              }}
            >
              {t("放弃游戏")}
            </Button>
          ) : modal === "chat" ? (
            <>
              <h2>{t("聊天记录")}</h2>
              <label>
                <input
                  type="checkbox"
                  checked={teamChat}
                  onChange={(e) => setTeamChat(e.target.checked)}
                />
                {t("队内聊天")}
              </label>
              <div className="chat-history">
                {room?.chat.map((c) => (
                  <p key={c.id}>
                    <b>{c.name}</b>：{c.text}
                  </p>
                ))}
              </div>
            </>
          ) : modal === "ranking" ? (
            <>
              <h2>{t("排行")}</h2>
              <div className="rank-list">
                {ranking.length ? (
                  ranking.map((r, i) => (
                    <p key={r.id}>
                      {i + 1}. {r.name} <b>{r.rating}</b>{" "}
                      <small>{r.games} 比赛</small>
                    </p>
                  ))
                ) : (
                  <p>{t("还没有完成的比赛")}</p>
                )}
              </div>
            </>
          ) : modal === "privacy" ? (
            <>
              <h2>{t("隐私政策")}</h2>
              <p>
                {t(
                  "本地复刻保存昵称、登录令牌、评级和比赛场数。房间与聊天记录存放在当前服务器内存中。不会向原站发送游戏数据。",
                )}
              </p>
            </>
          ) : modal === "delete" ? (
            <>
              <h2>{t("删除帐户")}</h2>
              <p>{t("删除本地服务器保存的账号和战绩，无法恢复。")}</p>
              <Button className="danger" onClick={() => send("deleteAccount")}>
                {t("删除")}
              </Button>
            </>
          ) : modal.startsWith("kick:") ? (
            <Button
              onClick={() => {
                send("kick", { id: modal.slice(5) });
                setModal("");
              }}
            >
              {t("踢出房间")}
            </Button>
          ) : null}
        </Modal>
      )}
    </main>
  );
}
