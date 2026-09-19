import { useEffect, useRef, useState } from "react";
import type { BattleCue, GameView } from "../shared/types";
import { texts } from "../shared/catalog";
import { cueDuration } from "../shared/presentation";
import { Detail } from "./ItemDetail";

export function useBattlePlayback(incoming: GameView) {
  const [opening, setOpening] = useState(incoming.revision === 0);
  const [shown, setShown] = useState(incoming);
  const [cue, setCue] = useState<BattleCue | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [frame, setFrame] = useState(0);
  const [stage, setStage] = useState<BattleCue | null>(null);
  const queue = useRef<GameView[]>([]);
  const current = useRef(incoming);
  const seen = useRef(`${incoming.id}:${incoming.revision}`);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (incoming.revision !== 0) return;
    setOpening(true);
    playCueSound("start-game");
    const gifts = (incoming.players[incoming.self]?.hand || []).map((_, n) =>
      setTimeout(() => playCueSound("gift"), 1500 + n * 250),
    );
    const start = setTimeout(() => {
      setOpening(false);
      setFresh((incoming.players[incoming.self]?.hand || []).map((c) => c.uid));
    }, 1500);
    return () => {
      clearTimeout(start);
      gifts.forEach(clearTimeout);
    };
  }, [incoming.id]);
  useEffect(() => {
    if (!fresh.length) return;
    const expiry = setTimeout(() => setFresh([]), 250 * fresh.length);
    return () => clearTimeout(expiry);
  }, [fresh]);
  useEffect(() => {
    const key = `${incoming.id}:${incoming.revision}`;
    if (seen.current === key) return;
    seen.current = key;
    if (incoming.id !== current.current.id) {
      clearTimeout(timer.current);
      queue.current = [];
      running.current = false;
      current.current = incoming;
      setShown(incoming);
      setCue(null);
      setFresh([]);
      return;
    }
    queue.current.push(incoming);
    function next() {
      const queued = queue.current.shift();
      if (!queued) {
        running.current = false;
        setCue(null);
        setStage(null);
        return;
      }
      const state: GameView = queued;
      running.current = true;
      const events = [...(state.cues || [])];
      const revealed = new Set(
        current.current.players[state.self]?.hand?.map((c) => c.uid),
      );
      function step() {
        const event = events.shift();
        if (event) {
          if (event.kind === "hit" || event.kind === "miss")
            setStage({ ...event, kind: "launch" });
          if (event.kind === "launch" || event.kind === "resolve") {
            const key = event.kind === "launch" ? "cards" : "defense";
            const cards = event[key] || [];
            let count = 0;
            setCue(event);
            const revealStage = () => {
              if (count >= Math.max(1, cards.length)) {
                step();
                return;
              }
              count++;
              setStage({ ...event, [key]: cards.slice(0, count) });
              playCueSound("select-item");
              timer.current = setTimeout(revealStage, 500);
            };
            revealStage();
            return;
          }
          if (event.kind === "draw" && event.target === state.self) {
            const additions = (state.players[state.self]?.hand || [])
              .filter((c) => !revealed.has(c.uid))
              .slice(0, event.amount);
            let index = 0;
            const reveal = () => {
              const card = additions[index++];
              if (!card) {
                step();
                return;
              }
              revealed.add(card.uid);
              setShown((previous) => ({
                ...previous,
                players: previous.players.map((p, i) =>
                  i === state.self
                    ? {
                        ...p,
                        hand: [
                          ...(p.hand || []).filter((c) =>
                            state.players[i].hand?.some((h) => h.uid === c.uid),
                          ),
                          card,
                        ],
                      }
                    : p,
                ),
              }));
              setFresh([card.uid]);
              playCueSound("gift");
              timer.current = setTimeout(reveal, 250);
            };
            setCue(event);
            reveal();
            return;
          }
          setCue(event);
          playCueSound(
            event.kind === "damage" && event.label === "dark"
              ? "deal-dark-damage"
              : event.kind === "resource" && (event.amount || 0) > 0
                ? event.label === "MP"
                  ? "boost-mp"
                  : "boost-cp"
                : event.kind === "devil"
                  ? event.cards?.[0]?.ability === "dealDamage"
                    ? `devil-to-deal-damage-${Math.max(1, Math.min(3, (event.amount || 10) / 10))}`
                    : event.cards?.[0]?.ability === "removeSomething"
                      ? "devil-to-remove-something"
                      : "devil-to-boost-something"
                  : event.kind === "hit" && event.label === "darkcloud"
                    ? "darkcloud"
                    : event.kind === "discard" && event.label === "sacrifice"
                      ? "sacrifice"
                      : sounds[event.kind],
          );
          setFrame((n) => n + 1);
          timer.current = setTimeout(() => {
            if (event.kind === "damage" || event.kind === "heal") {
              setShown((previous) => ({
                ...previous,
                players: previous.players.map((p, i) =>
                  i !== event.target
                    ? p
                    : {
                        ...p,
                        hp:
                          event.hpAfter ??
                          (event.kind === "damage"
                            ? Math.max(0, p.hp - (event.amount || 0))
                            : Math.min(
                                state.rules.maxStat,
                                p.hp + (event.amount || 0),
                              )),
                      },
                ),
              }));
            }
            if (event.kind === "resource") {
              const stat = event.label === "MP" ? "mp" : "cp";
              setShown((previous) => ({
                ...previous,
                players: previous.players.map((p, i) =>
                  i !== event.target
                    ? p
                    : {
                        ...p,
                        [stat]: Math.max(
                          0,
                          Math.min(
                            state.rules.maxStat,
                            p[stat] + (event.amount || 0),
                          ),
                        ),
                      },
                ),
              }));
            }
            if (
              [
                "curse",
                "upgradeDisease",
                "removeCurse",
                "guardian",
                "guardianLeave",
                "exchange",
              ].includes(event.kind)
            ) {
              setShown((previous) => ({
                ...previous,
                players: previous.players.map((p, i) => {
                  if (i !== event.target) return p;
                  if (event.kind === "exchange")
                    return { ...p, ...event.after };
                  if (
                    event.kind === "guardian" ||
                    event.kind === "guardianLeave"
                  )
                    return {
                      ...p,
                      guardian:
                        event.kind === "guardianLeave"
                          ? null
                          : event.label || null,
                    };
                  let curses = p.curses.filter((c) =>
                    event.kind === "upgradeDisease"
                      ? !["cold", "fever", "hell", "heaven"].includes(c)
                      : c !== event.label,
                  );
                  if (event.kind !== "removeCurse" && event.label)
                    curses.push(event.label);
                  return { ...p, curses };
                }),
              }));
            }
            step();
          }, cueDuration(event));
        } else {
          setFresh([]);
          current.current = state;
          if (state.phase === "ended")
            playCueSound(state.winners.length ? "win-game" : "draw-game");
          setShown(state);
          setCue(null);
          setStage(null);
          timer.current = setTimeout(next, 500);
        }
      }
      step();
    }
    if (!running.current) next();
  }, [incoming]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      queue.current = [];
      running.current = false;
    },
    [],
  );
  return {
    game: shown,
    cue: opening ? { kind: "start" as const, target: incoming.turn } : cue,
    fresh,
    frame,
    stage,
    busy:
      opening ||
      !!cue ||
      fresh.length > 1 ||
      incoming.revision !== shown.revision,
  };
}

const sounds: Partial<Record<BattleCue["kind"], string>> = {
  launch: "select-item",
  resolve: "select-item",
  damage: "deal-damage",
  heal: "boost-hp",
  reflect: "reflect",
  bounce: "bounce",
  block: "block",
  safe: "safe",
  miss: "miss",
  curse: "add-curse",
  death: "die",
  revive: "revive",
  guardian: "set-guardian",
  pray: "pray",
  discard: "remove-items",
  guardianAttack: "attack-by-guardian",
  guardianLeave: "remove-guardian",
  removeCurse: "remove-curses",
  confusion: "confusion",
  redraw: "redraw",
  trade: "move-cp",
  purchase: "buy",
  hit: "hit",
  exchange: "exchange",
  phenomenon: "phenomenon",
  disease: "disease",
  upgradeDisease: "upgrade-disease",
  upgradeHeaven: "upgrade-heaven",
};
function playCueSound(name?: string) {
  const volume = Number(localStorage.getItem("gf-volume") ?? 5) / 10;
  if (!name || !volume) return;
  const audio = new Audio(`/assets/audio/${name}.mp3`);
  audio.volume = Math.min(1, Math.max(0, volume));
  void audio.play().catch(() => {});
}
const labels: Partial<Record<BattleCue["kind"], string>> = {
  reflect: "反射",
  bounce: "乱弹",
  block: "防御",
  safe: "安全",
  miss: "未命中",
  pray: "祈祷",
  death: "升天",
  revive: "复活",
  confusion: "混乱",
  redraw: "重新授予",
  hit: "命中",
  upgradeHeaven: "发作",
};
export function BattleAnimation({
  cue,
  game,
}: {
  cue: BattleCue;
  game: GameView;
}) {
  if (
    ["launch", "resolve", "draw"].includes(cue.kind) ||
    (cue.kind === "resource" && (cue.amount || 0) <= 0)
  )
    return null;
  const source = cue.source ?? game.pending?.source ?? game.turn;
  const reversed = (game.pending?.bounces || 0) % 2 === 1;
  const right = (cue.target !== source) !== reversed;
  if (cue.kind === "start")
    return (
      <div className="gf-opening" data-effect="start">
        {texts.game.opening.split("<br>").map((line, n) => (
          <div key={n}>{line}</div>
        ))}
      </div>
    );
  const curseColors: Record<string, string> = {
    cold: "#6688aa",
    fever: "#ff6666",
    hell: "#111111",
    heaven: "#eeeeee",
    fog: "#6666ff",
    flash: "#c5c500",
    dream: "#ff9900",
    darkcloud: "#aa55cc",
  };
  if (cue.kind === "exchange")
    return (
      <div className="gf-exchange" data-effect="exchange">
        <div>
          HP{cue.before?.hp}　MP{cue.before?.mp}　¥{cue.before?.cp}
        </div>
        <img
          className="gf-exchange-arrow"
          src="/assets/icons/exchange-down.svg"
          alt="兑换为"
        />
        <div className="gf-exchange-after">
          HP{cue.after?.hp}　MP{cue.after?.mp}　¥{cue.after?.cp}
        </div>
      </div>
    );
  if (
    cue.kind === "phenomenon" ||
    cue.kind === "devil" ||
    cue.kind === "revive"
  )
    return (
      <div
        className={`gf-special-card gf-${cue.kind}`}
        style={{
          left:
            cue.kind === "revive"
              ? right
                ? 360
                : 20
              : cue.kind === "devil"
                ? 360
                : 20,
        }}
        data-effect={cue.kind}
      >
        {cue.cards?.[0] && <Detail item={cue.cards[0]} />}
      </div>
    );
  if (cue.kind === "discard" || cue.kind === "trade")
    return (
      <div
        className={`gf-card-motion gf-${cue.kind} ${cue.label === "sacrifice" ? "gf-sacrifice" : ""}`}
        style={
          {
            left: cue.kind === "trade" ? (right ? 20 : 360) : right ? 360 : 20,
            "--trade-direction": right ? "340px" : "-340px",
          } as React.CSSProperties
        }
        data-effect={cue.kind}
      >
        {(cue.cards || []).map((d, n, all) => (
          <div
            key={n}
            className="gf-moving-card"
            style={{
              top: all.length <= 3 ? n * 100 : (n * 200) / (all.length - 1),
            }}
          >
            <Detail item={d} />
          </div>
        ))}
        {cue.kind === "trade" && !!cue.amount && (
          <div className="gf-coin">¥{cue.amount}</div>
        )}
      </div>
    );
  return (
    <div
      className={`gf-effect gf-${cue.kind} ${cue.label === "dark" ? "gf-dark" : ""} ${cue.kind === "resource" ? (cue.label === "MP" ? "gf-mp" : "gf-cp") : ""}`}
      style={{
        left: right ? 370 : 30,
        ...(cue.kind === "purchase" && !cue.amount ? { top: 255 } : {}),
      }}
      role="status"
      aria-live="polite"
      data-effect={cue.kind}
    >
      {cue.kind === "upgradeHeaven" &&
        ["top", "bottom"].map((half) => (
          <div key={half} className={`gf-heaven-half gf-heaven-${half}`}>
            <div className="gf-heaven-cover">
              <img src="/assets/images/curses/medium/heaven.webp" alt="" />
              <span>{texts.curseNames.heaven}</span>
            </div>
          </div>
        ))}
      {cue.kind === "upgradeDisease" && (
        <div
          className="gf-previous-curse"
          style={{ background: curseColors[cue.previousLabel || ""] }}
        >
          <img
            src={`/assets/images/curses/medium/${cue.previousLabel}.webp`}
            alt=""
          />
          <span>
            {
              (texts.curseNames as Record<string, string>)[
                cue.previousLabel || ""
              ]
            }
          </span>
        </div>
      )}
      <div
        className="gf-effect-body"
        style={
          ["curse", "removeCurse", "disease", "upgradeDisease"].includes(
            cue.kind,
          )
            ? { background: curseColors[cue.label || ""] }
            : undefined
        }
      >
        {cue.kind === "damage" ? (
          <>
            <strong>{cue.amount}</strong>
            <small>伤害</small>
          </>
        ) : cue.kind === "heal" ? (
          `HP${cue.amount}`
        ) : cue.kind === "resource" ? (
          `${cue.label}${cue.amount}`
        ) : cue.kind === "purchase" ? (
          cue.amount ? (
            texts.game.doBuy
          ) : (
            texts.game.doNotBuy
          )
        ) : cue.kind === "hit" && cue.label === "darkcloud" ? (
          texts.curseNames.darkcloud
        ) : ["curse", "removeCurse", "disease", "upgradeDisease"].includes(
            cue.kind,
          ) ? (
          <>
            <img
              src={`/assets/images/curses/medium/${cue.label}.webp`}
              alt=""
            />
            <span>
              {(texts.curseNames as Record<string, string>)[cue.label || ""] ||
                cue.label}
            </span>
          </>
        ) : ["guardian", "guardianAttack", "guardianLeave"].includes(
            cue.kind,
          ) ? (
          <img
            src={`/assets/images/guardians/large/${cue.label || game.players[cue.target]?.guardian}.webp`}
            alt="守护神"
          />
        ) : (
          labels[cue.kind]
        )}
      </div>
    </div>
  );
}
