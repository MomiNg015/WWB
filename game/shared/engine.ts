import { actionCost, attackProfile, attackSelectionError } from "./actions";
import {
  canDefend,
  defenseError as catalogDefenseError,
  defenseSpecial,
} from "./defense";
export { canDefend } from "./defense";
import { classicRules, items as defaultItems, sortCatalog } from "./catalog";
import type {
  Action,
  Card,
  Command,
  Element,
  Game,
  GameView,
  Item,
  Player,
  Rules,
} from "./types";

export type EffectHandler = (
  g: Game,
  source: number,
  target: number,
  item: Item,
) => void;

export function createEngine(definitions: Item[] = defaultItems) {
  const snapshot = structuredClone(sortCatalog(definitions));
  const items = snapshot.filter((item) => item.enabled !== false);
  const catalog = new Map(snapshot.map((item) => [item.imageName, item]));
  function itemById(id: string): Item {
    const item = catalog.get(id);
    if (!item) throw new Error(`Unknown artifact: ${id}`);
    return item;
  }
  const defenseError: typeof catalogDefenseError = (a, cards, mp, curses) =>
    catalogDefenseError(a, cards, mp, curses, itemById);
  // This module has no DOM, network, timers or global randomness. Rule packs can reuse it.
  function random(g: Game): number {
    let x = g.seed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    g.seed = x >>> 0;
    return g.seed / 4294967296;
  }
  function pick<T>(g: Game, a: T[]): T {
    if (!a.length) throw new Error("没有可选对象");
    return a[Math.floor(random(g) * a.length)];
  }
  function weighted(
    g: Game,
    a: Item[],
    key: "giftRate" | "appearanceRate" | "guardianAttackRate",
  ): Item {
    const sum = a.reduce((n, i) => n + (i[key] || 0), 0);
    let n = random(g) * sum;
    return a.find((i) => (n -= i[key] || 0) < 0) || a[a.length - 1];
  }
  function log(g: Game, text: string) {
    g.history.push({
      seq: (g.history.at(-1)?.seq ?? -1) + 1,
      round: g.round,
      text,
    });
    if (g.history.length > 200) g.history.shift();
  }
  function clamp(g: Game, p: Player) {
    p.hp = Math.max(0, Math.min(g.rules.maxStat, p.hp));
    p.mp = Math.max(0, Math.min(g.rules.maxStat, p.mp));
    p.cp = Math.max(0, Math.min(g.rules.maxStat, p.cp));
  }
  function enemies(g: Game, a: number) {
    return g.players
      .map((p, i) => i)
      .filter(
        (i) =>
          g.players[i].hp > 0 &&
          i !== a &&
          (!g.players[a].team || g.players[i].team !== g.players[a].team),
      );
  }
  function alive(g: Game) {
    return g.players.map((p, i) => i).filter((i) => g.players[i].hp > 0);
  }
  function newCard(g: Game, i: Item): Card {
    return { uid: `c${++g.serial}`, id: i.imageName };
  }
  const dreamGroups = new Map<string, Item[]>();
  function dreamKey(d: Item) {
    const sample: Action = {
      source: 0,
      target: 1,
      cards: [{ imageName: "sample", name: "sample", category: "weapons" }],
      atk: 1,
      element: "",
      miracle: false,
      kind: "attack",
      bounces: 0,
    };
    const response = (
      ["", "fire", "water", "wood", "stone", "light", "darkness"] as Element[]
    ).flatMap((element) =>
      [false, true].map(
        (miracle) =>
          !defenseError(
            { ...sample, element, miracle },
            [{ uid: "test", id: d.imageName }],
            999,
            [],
          ),
      ),
    );
    return JSON.stringify([
      d.category,
      !attackSelectionError([d]),
      !!d.isPlusAtk,
      d.hitRate !== undefined,
      d.ability === "cutCost",
      response,
    ]);
  }
  function disguise(g: Game, p: Player, c: Card) {
    const d = itemById(c.id);
    if (
      !p.curses.includes("dream") ||
      !["weapons", "armor", "sundries"].includes(d.category)
    )
      return c;
    const key = dreamKey(d);
    if (!dreamGroups.has(key))
      dreamGroups.set(
        key,
        items.filter((i) => i.giftRate && dreamKey(i) === key),
      );
    const alternatives = dreamGroups
      .get(key)!
      .filter((i) => i.imageName !== c.id);
    if (alternatives.length && random(g) < 0.5)
      c.apparentId = pick(g, alternatives).imageName;
    return c;
  }
  function reveal(c: Card): Card {
    return { uid: c.uid, id: c.id };
  }
  function receive(g: Game, index: number, card: Card) {
    const p = g.players[index];
    if (p.hand.length >= g.rules.maxHandSize) {
      const removed = pick(g, p.hand);
      p.hand = p.hand.filter((c) => c.uid !== removed.uid);
      g.cues.push({
        kind: "discard",
        target: index,
        cards: [itemById(removed.id)],
        amount: 1,
      });
    }
    p.hand.push(card);
  }
  function ended(g: Game) {
    // A lethal hit does not cancel already queued counters or death effects.
    if (g.queue.some((a) => g.players[a.target].hp > 0)) return false;
    const survivors = alive(g);
    if (
      survivors.length <= 1 ||
      survivors.every(
        (i) =>
          g.players[i].team > 0 &&
          g.players[i].team === g.players[survivors[0]].team,
      )
    ) {
      g.phase = "ended";
      g.queue = [];
      g.winners = survivors.map((i) => g.players[i].id);
      return true;
    }
    return false;
  }
  function hurt(
    g: Game,
    index: number,
    damage: number,
    dark = false,
    deferDeath = false,
  ) {
    const p = g.players[index];
    if (p.hp <= 0) return 0;
    const actual =
      dark && damage > 0 ? p.hp : Math.min(p.hp, Math.max(0, damage));
    p.hp = dark && actual > 0 ? 0 : p.hp - actual;
    if (actual > 0) {
      g.cues.push({
        kind: "damage",
        target: index,
        amount: actual,
        hpAfter: p.hp,
        ...(dark ? { label: "dark" } : {}),
      });
      log(g, `${p.name} 受到 ${actual} 点伤害`);
      if (p.guardian && random(g) < g.rules.guardianLeaveChance) {
        g.cues.push({
          kind: "guardianLeave",
          target: index,
          label: p.guardian,
        });
        p.guardian = null;
      }
    }
    if (!deferDeath) resolveDeath(g, index);
    return actual;
  }
  function resolveDeath(g: Game, index: number) {
    const p = g.players[index];
    if (
      p.hp === 0 &&
      g.cues.some((c) => c.kind === "death" && c.target === index)
    )
      return;
    if (p.hp === 0) {
      const rev = p.hand.find((c) => itemById(c.id).ability === "revive");
      if (rev) {
        p.hand = p.hand.filter((c) => c.uid !== rev.uid);
        p.hp = itemById(rev.id).abilityValue || 10;
        p.redraw++;
        g.cues.push({
          kind: "revive",
          target: index,
          amount: p.hp,
          hpAfter: p.hp,
          cards: [itemById(rev.id)],
        });
        g.cues.push({
          kind: "heal",
          target: index,
          amount: p.hp,
          hpAfter: p.hp,
        });
        log(g, `${p.name} 复活`);
      } else {
        log(g, `${p.name} 升天`);
        for (const bow of p.hand.filter(
          (c) => itemById(c.id).ability === "attackDyingly",
        )) {
          const d = itemById(bow.id);
          p.hand = p.hand.filter((c) => c.uid !== bow.uid);
          queueAttack(g, index, enemies(g, index), [
            { ...d, atk: d.abilityValue || 30, hitRate: 75 },
          ]);
        }
      }
    }
    if (p.hp === 0) g.cues.push({ kind: "death", target: index });
  }
  function curse(g: Game, p: Player, c: string) {
    const stages = ["cold", "fever", "hell", "heaven"];
    if (stages.includes(c)) {
      const old = p.curses.find((x) => stages.includes(x));
      if (old) {
        p.curses = p.curses.filter((x) => !stages.includes(x));
        const next = Math.max(stages.indexOf(old), stages.indexOf(c)) + 1;
        if (next > 3) {
          g.cues.push({
            kind: "upgradeHeaven",
            target: g.players.indexOf(p),
            label: "heaven",
          });
          p.hp = 0;
          resolveDeath(g, g.players.indexOf(p));
          return;
        }
        c = stages[next];
        g.cues.push({
          kind: "upgradeDisease",
          target: g.players.indexOf(p),
          label: c,
          previousLabel: old,
        });
        p.curses.push(c);
        return;
      }
    }
    if (!p.curses.includes(c)) {
      p.curses.push(c);
      g.cues.push({ kind: "curse", target: g.players.indexOf(p), label: c });
    }
  }
  function combineElements(elements: Element[]): Element {
    if (!elements.length) return "";
    let result = elements[0];
    for (const e of elements.slice(1)) {
      if (e === result) continue;
      if (result === "light" && ["fire", "water", "wood", "stone"].includes(e))
        result = e;
      else if (
        e === "light" &&
        ["fire", "water", "wood", "stone"].includes(result)
      )
        continue;
      else result = "";
    }
    return result;
  }
  const effects: Record<string, EffectHandler> = {
    boostHP: (g, s, t, i) => {
      g.players[t].hp += i.abilityValue || 0;
    },
    boostMP: (g, s, t, i) => {
      g.players[t].mp += i.abilityValue || 0;
    },
    boostCP: (g, s, t, i) => {
      g.players[t].cp += i.abilityValue || 0;
    },
    boostMPAndAddCurse: (g, s, t, i) => {
      g.players[t].mp += i.abilityValue || 0;
      curse(g, g.players[t], i.curse!);
    },
    boostHPOrDealDamage: (g, s, t, i) => {
      if (random(g) < 0.5) g.players[t].hp += i.abilityValue || 10;
      else hurt(g, t, i.abilityValue || 10);
    },
    dealDamage: (g, s, t, i) => {
      hurt(g, t, i.abilityValue || 0);
    },
    addCurse: (g, s, t, i) => curse(g, g.players[t], i.curse!),
    removeMildCurses: (g, s, t) => {
      g.players[t].curses
        .filter((c) => ["cold", "fever", "fog", "flash"].includes(c))
        .forEach((label) =>
          g.cues.push({ kind: "removeCurse", target: t, label }),
        );
      g.players[t].curses = g.players[t].curses.filter(
        (c) => !["cold", "fever", "fog", "flash"].includes(c),
      );
    },
    removeAllCurses: (g, s, t) => {
      g.players[t].curses.forEach((label) =>
        g.cues.push({ kind: "removeCurse", target: t, label }),
      );
      g.players[t].curses = [];
      g.players[t].hand = g.players[t].hand.map(reveal);
    },
    setGuardian: (g, s, t) => {
      const options = [
        "mars",
        "mercury",
        "jupiter",
        "saturn",
        "uranus",
        "pluto",
        "neptune",
        "venus",
        "earth",
        "moon",
      ].filter(
        (name) =>
          !g.players.some((p, n) => n !== t && p.hp > 0 && p.guardian === name),
      );
      g.players[t].guardian = pick(g, options);
      g.cues.push({
        kind: "guardian",
        target: t,
        label: g.players[t].guardian!,
      });
    },
    removeItems: (g, s, t) => {
      const p = g.players[t];
      for (let n = 0; n < 3 && p.hand.length; n++)
        p.hand.splice(Math.floor(random(g) * p.hand.length), 1);
    },
    removeUsedMiracles: (g, s, t) => {
      const p = g.players[t];
      for (let n = 0; n < 2 && p.miracles.length; n++)
        p.miracles.splice(Math.floor(random(g) * p.miracles.length), 1);
    },
    removeSomething: (g, s, t) => {
      const p = g.players[t];
      for (let n = 0; n < 2; n++) {
        const pool = [...p.hand, ...p.miracles];
        if (pool.length) {
          const card = pick(g, pool);
          p.hand = p.hand.filter((c) => c.uid !== card.uid);
          p.miracles = p.miracles.filter((c) => c.uid !== card.uid);
        }
      }
    },
    boostSomething: (g, s, t, i) => {
      const key = pick(g, ["hp", "mp", "cp"] as const);
      g.players[t][key] += i.abilityValue || 10;
    },
    boostCPOfEverybody: (g, s, t, i) => {
      g.players.forEach((p) => {
        if (p.hp > 0) p.cp += i.abilityValue || 0;
      });
    },
    boostCPToEnemy: (g, s, t, i) => {
      g.players[t].cp += i.abilityValue || 0;
    },
    takeCP: (g, s, t, i) => {
      const n = Math.min(g.players[t].cp, i.abilityValue || 0);
      g.players[t].cp -= n;
      g.players[s].cp += n;
    },
    addItem: (g, s, t) => draw(g, t, 1, false),
    setCurseOfEverybody: (g, s, t, i) => {
      g.players.forEach((p) => {
        if (p.hp > 0) {
          if (["cold", "fever", "hell", "heaven"].includes(i.curse || ""))
            p.curses = p.curses.filter(
              (c) => !["cold", "fever", "hell", "heaven"].includes(c),
            );
          curse(g, p, i.curse!);
        }
      });
    },
    setHPOfEverybody: (g, s, t, i) => {
      g.players.forEach((p) => {
        if (p.hp > 0) p.hp = i.abilityValue || 1;
      });
    },
    collectCPOfEverybody: (g) => {
      const living = alive(g).map((i) => g.players[i]);
      const total = living.reduce((n, p) => n + p.cp, 0);
      living.forEach((p) => (p.cp = 0));
      g.players[pick(g, alive(g))].cp = total;
    },
    shuffleItemsOfEverybody: (g) => {
      const living = alive(g).map((i) => g.players[i]);
      const counts = living.map((p) => p.hand.length + p.miracles.length);
      const pool = living.flatMap((p) => [...p.hand, ...p.miracles]);
      for (let n = pool.length - 1; n > 0; n--) {
        const j = Math.floor(random(g) * (n + 1));
        [pool[n], pool[j]] = [pool[j], pool[n]];
      }
      living.forEach((p, i) => {
        p.hand = pool.splice(0, counts[i]);
        p.miracles = [];
      });
    },
    setGuardianOfEverybody: (g, s, t, i) => {
      alive(g).forEach((n) => effects.setGuardian(g, s, n, i));
    },
    confuseEverybody: (g) => {
      alive(g).forEach((i) => {
        g.players[i].confused = (g.players[i].confused || 0) + 3;
      });
    },
    callPhenomenon: (g, s) => {
      const item = pick(
        g,
        items.filter((i) => i.category === "phenomena"),
      );
      log(g, item.name);
      g.cues.push({ kind: "phenomenon", source: s, target: s, cards: [item] });
      if (item.atk)
        queueAttack(
          g,
          s,
          item.ability === "attackSomebody"
            ? [pick(g, alive(g))]
            : enemies(g, s),
          [item],
        );
      else effects[item.ability!]?.(g, s, s, item);
    },
  };
  function draw(
    g: Game,
    p: number,
    count: number,
    devils = true,
    allowDying = false,
  ) {
    let gained = 0;
    for (let n = 0; n < count && (g.players[p].hp > 0 || allowDying); n++) {
      if (
        devils &&
        g.rules.tiebreak > 0 &&
        g.round >= g.rules.tiebreak &&
        random(g) < g.rules.devilChance
      ) {
        const d = weighted(
          g,
          items.filter((i) => i.category === "devils"),
          "appearanceRate",
        );
        log(g, `${g.players[p].name} 遭遇${d.name}`);
        g.cues.push({
          kind: "devil",
          target: p,
          cards: [d],
          amount: d.abilityValue,
        });
        effects[d.ability!]?.(g, p, p, d);
      } else {
        receive(
          g,
          p,
          disguise(
            g,
            g.players[p],
            newCard(
              g,
              weighted(
                g,
                items.filter((i) => !!i.giftRate),
                "giftRate",
              ),
            ),
          ),
        );
        gained++;
      }
    }
    if (gained > 0) g.cues.push({ kind: "draw", target: p, amount: gained });
  }
  function createGame(
    players: Pick<Player, "id" | "name" | "team" | "bot">[],
    options: Partial<Rules> = {},
    seed = 12345,
  ): Game {
    if (players.length < 2 || players.length > 9)
      throw new Error("需要2至9名预言者");
    const rules = { ...classicRules, ...options };
    const g: Game = {
      id: `game-${seed}`,
      rules,
      players: players.map((p) => ({
        ...p,
        hp: rules.initialHP,
        mp: rules.initialMP,
        cp: rules.initialCP,
        hand: [],
        miracles: [],
        curses: [],
        guardian: null,
        redraw: 0,
      })),
      turn: 0,
      round: 1,
      seed: seed || 1,
      serial: 0,
      revision: 0,
      queue: [],
      cues: [],
      history: [],
      phase: "action",
      winners: [],
    };
    g.players.forEach((_, i) => draw(g, i, rules.handSize, false));
    g.turn = Math.floor(random(g) * players.length);
    log(g, "预言者们的战斗现在开始了！");
    g.cues = [];
    return g;
  }
  function resolveCards(
    p: Player,
    uids: string[],
  ): { cards: Card[]; defs: Item[] } {
    if (new Set(uids).size !== uids.length)
      throw new Error("不能重复选择同一张神器");
    const cards = uids.map((uid) => {
      const c = [...p.hand, ...p.miracles].find((c) => c.uid === uid);
      if (!c) throw new Error("神器不属于当前玩家");
      return c;
    });
    return { cards, defs: cards.map((c) => itemById(c.id)) };
  }
  function consume(g: Game, p: Player, cards: Card[]) {
    const cost = actionCost(cards.map((c) => itemById(c.id)));
    if (p.mp < cost) throw new Error("MP不足");
    p.mp -= cost;
    if (cost)
      g.cues.push({
        kind: "resource",
        target: g.players.indexOf(p),
        amount: -cost,
        label: "MP",
      });
    for (const c of cards) {
      if (p.miracles.some((x) => x.uid === c.uid)) continue;
      const d = itemById(c.id);
      p.hand = p.hand.filter((x) => x.uid !== c.uid);
      p.redraw++;
      if (d.category === "miracles") p.miracles.push(reveal(c));
    }
  }
  function queueAttack(g: Game, s: number, targets: number[], cards: Item[]) {
    const { atk, element } = attackProfile(cards, g.players[s].mp);
    if (cards[0]?.ability === "atkBy2xMP") g.players[s].mp = 0;
    const rate = cards.find((i) => i.hitRate !== undefined)?.hitRate ?? 100;
    for (const target of targets) {
      if (g.players[target].hp <= 0) continue;
      if (
        g.players[target].curses.includes("darkcloud") ||
        random(g) * 100 < rate
      ) {
        const a: Action = {
          source: s,
          target,
          cards,
          atk,
          element,
          miracle: cards[0].category === "miracles",
          kind: atk > 0 ? "attack" : "effect",
          bounces: 0,
        };
        g.queue.push(a);
        if (cards.some((i) => i.ability === "attackTwice"))
          g.queue.push(structuredClone(a));
      } else {
        g.queue.push({
          source: s,
          target,
          cards,
          atk,
          element,
          miracle: false,
          kind: "miss",
          bounces: 0,
        });
      }
    }
  }
  function resolveDanger(g: Game, index: number, defs: Item[]) {
    const holders = alive(g).filter((n) =>
      g.players[n].hand.some((c) => itemById(c.id).ability === "attractDanger"),
    );
    if (holders.length) {
      const victim = pick(g, holders),
        holder = g.players[victim];
      const mortar = holder.hand.find(
        (c) => itemById(c.id).ability === "attractDanger",
      )!;
      holder.hand = holder.hand.filter((c) => c.uid !== mortar.uid);
      holder.redraw++;
      g.cues.push({
        kind: "resolve",
        source: index,
        target: victim,
        cards: defs,
        defense: [itemById(mortar.id)],
      });
      hurt(g, victim, itemById(mortar.id).abilityValue || 99);
    } else queueAttack(g, index, [pick(g, alive(g))], defs);
  }
  function guardianAction(g: Game, index: number, original: Item) {
    const p = g.players[index],
      foes = enemies(g, index);
    let d = original;
    let cards = [d];
    if (p.guardian === "moon") {
      d = pick(
        g,
        items.filter(
          (i) =>
            i.category === "miracles" &&
            !["blockWeapon", "bounceWeapon"].includes(i.ability || ""),
        ),
      );
      cards = d.isPlusAtk ? [original, d] : [d];
    } else if (p.guardian === "earth") {
      d = weighted(
        g,
        items.filter((i) => !!i.giftRate && i.category !== "miracles"),
        "giftRate",
      );
      cards = [d];
      if (
        d.category === "armor" ||
        (d.category === "sundries" &&
          ["revive", "attractDanger", "cutCost"].includes(d.ability || ""))
      ) {
        receive(g, index, newCard(g, d));
        g.cues.push({ kind: "draw", target: index, amount: 1 });
        return;
      }
      if (d.ability === "exchange") {
        const total = p.hp + p.mp + p.cp,
          max = g.rules.maxStat;
        const lowHP = Math.max(0, total - 2 * max);
        p.hp =
          lowHP + Math.floor(random(g) * (Math.min(total, max) - lowHP + 1));
        const lowMP = Math.max(0, total - p.hp - max);
        p.mp =
          lowMP +
          Math.floor(random(g) * (Math.min(total - p.hp, max) - lowMP + 1));
        p.cp = total - p.hp - p.mp;
        if (!p.hp) resolveDeath(g, index);
        return;
      }
      if (["sell", "buy"].includes(d.ability || "")) {
        if (!foes.length || (d.ability === "sell" && !p.hand.length)) return;
        g.queue.push({
          source: index,
          target: pick(g, foes),
          cards,
          atk: 0,
          element: "",
          miracle: false,
          kind: d.ability as "sell" | "buy",
          bounces: 0,
          tradeOwner: index,
          ...(d.ability === "sell" ? { tradeCard: pick(g, p.hand) } : {}),
        });
        return;
      }
    }
    if (d.ability === "danger") {
      resolveDanger(g, index, cards);
      return;
    }
    if (cards[0].atk || cards[0].ability === "atkBy2xMP") {
      if (foes.length)
        queueAttack(
          g,
          index,
          d.hitRate !== undefined || d.ability === "attackEveryEnemy"
            ? foes
            : [pick(g, foes)],
          cards,
        );
      return;
    }
    const hostile = [
      "takeCP",
      "boostCPToEnemy",
      "addCurse",
      "removeItems",
      "removeUsedMiracles",
    ].includes(d.ability || "");
    const target = hostile && foes.length ? pick(g, foes) : index;
    const action: Action = {
      source: index,
      target,
      cards,
      atk: 0,
      element: d.element || "",
      miracle: d.category === "miracles",
      kind: "effect",
      bounces: 0,
    };
    if (target === index) applyEffect(g, action);
    else g.queue.push(action);
  }
  function finishTurn(g: Game) {
    const p = g.players[g.turn];
    const disease = p.curses.find((c) =>
      ["cold", "fever", "hell", "heaven"].includes(c),
    );
    if (disease && p.hp > 0) {
      g.cues.push({ kind: "disease", target: g.turn, label: disease });
      if (disease === "heaven") {
        const before = p.hp;
        p.hp = Math.min(g.rules.maxStat, p.hp + 5);
        g.cues.push({ kind: "heal", target: g.turn, amount: p.hp - before });
      } else
        hurt(
          g,
          g.turn,
          ({ cold: 1, fever: 2, hell: 5 } as Record<string, number>)[disease],
        );
      if (p.hp > 0 && random(g) < g.rules.diseaseChance) curse(g, p, disease);
    }
    g.players.forEach((p, i) => {
      const count = p.redraw;
      p.redraw = 0;
      draw(g, i, count);
      clamp(g, p);
    });
    if (ended(g)) return;
    const old = g.turn;
    do {
      g.turn = (g.turn + 1) % g.players.length;
    } while (g.players[g.turn].hp === 0);
    g.round++;
    g.phase = "action";
    log(g, `${g.players[g.turn].name} 的回合`);
    for (const i of enemies(g, old)) {
      const p = g.players[i];
      if (p.guardian && random(g) < g.rules.guardianChance) {
        const options = items.filter(
          (x) => x.category === "guardians" && x.guardian === p.guardian,
        );
        if (options.length) {
          const d = options.some((x) => x.guardianAttackRate)
            ? weighted(g, options, "guardianAttackRate")
            : pick(g, options);
          log(g, `${p.name} 的守护神：${d.name}`);
          g.cues.push({
            kind: "guardianAttack",
            source: i,
            target: i,
            label: p.guardian,
            cards: [d],
          });
          guardianAction(g, i, d);
        }
      }
    }
    if (g.queue.length) {
      g.resumeAction = true;
      settle(g);
    }
  }
  function settle(g: Game) {
    g.queue = g.queue.filter((a) => g.players[a.target].hp > 0);
    while (g.queue[0]?.kind === "miss") {
      const miss = g.queue.shift()!;
      g.cues.push({
        kind: "miss",
        source: miss.source,
        target: miss.target,
        cards: miss.cards,
      });
      log(g, `${g.players[miss.target].name}：未命中`);
    }
    if (ended(g)) return;
    if (g.queue.length) {
      const a = g.queue[0];
      if (!a.announced && a.cards.some((d) => d.hitRate !== undefined)) {
        g.cues.push({
          kind: "hit",
          source: a.source,
          target: a.target,
          cards: a.cards,
          amount: a.atk,
          label: g.players[a.target].curses.includes("darkcloud")
            ? "darkcloud"
            : undefined,
        });
        a.announced = true;
      }
      g.phase = "defense";
      return;
    }
    if (g.resumeAction) {
      g.resumeAction = false;
      if (g.players[g.turn].hp > 0) {
        g.phase = "action";
        return;
      }
    }
    finishTurn(g);
  }
  function applyEffect(g: Game, a: Action) {
    const hpBefore = g.players.map((p) => p.hp);
    for (const d of a.cards) {
      if (d.ability && effects[d.ability])
        effects[d.ability](g, a.source, a.target, d);
    }
    g.players.forEach((p, i) => {
      clamp(g, p);
      if (p.hp > hpBefore[i])
        g.cues.push({ kind: "heal", target: i, amount: p.hp - hpBefore[i] });
    });
  }
  function play(
    g: Game,
    index: number,
    cmd: Extract<Command, { type: "play" }>,
  ) {
    const p = g.players[index];
    const { cards, defs } = resolveCards(p, cmd.cards);
    if (!cards.length) throw new Error("请选择神器");
    if (
      !Number.isInteger(cmd.target) ||
      !g.players[cmd.target] ||
      g.players[cmd.target].hp <= 0
    )
      throw new Error("目标无效");
    const invalid = attackSelectionError(defs, p.mp);
    if (invalid) throw new Error(invalid);
    const attacking = !!defs[0].atk || defs[0].ability === "atkBy2xMP";
    const d = defs[0];
    let target = cmd.target;
    const foes = enemies(g, index);
    if (
      p.curses.includes("fog") &&
      foes.length > 1 &&
      foes.includes(target) &&
      d.category !== "armor" &&
      !["attackSomebody", "danger", "attackEveryEnemy"].includes(
        d.ability || "",
      ) &&
      d.hitRate === undefined
    )
      target = pick(g, foes);
    if (d.ability === "exchange") {
      const v = cmd.exchange;
      if (
        !v ||
        !Object.values(v).every(
          (n) => Number.isInteger(n) && n >= 0 && n <= g.rules.maxStat,
        ) ||
        v.hp + v.mp + v.cp !== p.hp + p.mp + p.cp
      )
        throw new Error("兑换必须保持总值不变且各项资源处于允许范围内");
      consume(g, p, cards);
      g.cues.push({
        kind: "exchange",
        target: index,
        before: { hp: p.hp, mp: p.mp, cp: p.cp },
        after: { ...v },
      });
      p.hp = v.hp;
      p.mp = v.mp;
      p.cp = v.cp;
      if (!p.hp) resolveDeath(g, index);
      settle(g);
      return;
    }
    if (["sell", "buy"].includes(d.ability || "")) {
      if (target === index) throw new Error("请选择其他玩家");
      let tradeCard: Card | undefined;
      if (d.ability === "sell") {
        tradeCard = p.hand.find(
          (c) => c.uid === cmd.tradeCard && !cards.some((x) => x.uid === c.uid),
        );
        if (!tradeCard) throw new Error("请选择可出售的神器");
      }
      consume(g, p, cards);
      g.queue.push({
        source: index,
        target,
        cards: defs,
        atk: 0,
        element: "",
        miracle: false,
        kind: d.ability as "sell" | "buy",
        bounces: 0,
        tradeCard,
        tradeOwner: index,
      });
      g.cues.push({ kind: "launch", source: index, target, cards: defs });
      g.phase = "defense";
      return;
    }
    if (!attacking && !d.ability) throw new Error("无法主动使用此神器");
    consume(g, p, cards);
    log(g, `${p.name} 使用 ${defs.map((i) => i.name).join(" + ")}`);
    g.cues.push({
      kind: "launch",
      source: index,
      target,
      cards: defs,
      amount: attacking ? attackProfile(defs, p.mp).atk : 0,
    });
    if (attacking) {
      if (d.ability === "danger") {
        resolveDanger(g, index, defs);
        settle(g);
        return;
      }
      const all = defs.some(
        (x) => x.hitRate !== undefined || x.ability === "attackEveryEnemy",
      );
      queueAttack(g, index, all ? enemies(g, index) : [target], defs);
    } else {
      if (!effects[d.ability || ""])
        throw new Error(`能力尚未实现：${d.ability}`);
      g.queue.push({
        source: index,
        target,
        cards: defs,
        atk: 0,
        element: d.element || "",
        miracle: d.category === "miracles",
        kind: "effect",
        bounces: 0,
      });
      if (target === index) {
        applyEffect(g, g.queue.pop()!);
      }
    }
    settle(g);
  }
  function defend(
    g: Game,
    index: number,
    cmd: Extract<Command, { type: "defend" }>,
  ) {
    const a = g.queue.shift()!;
    const p = g.players[index];
    const { cards, defs } = resolveCards(p, cmd.cards);
    const invalid = defenseError(a, cards, p.mp, p.curses);
    if (invalid) throw new Error(invalid);
    const filter = defs.some((d) => d.ability === "filterAtkElement");
    const element = filter ? "" : a.element;
    const special = defs.find((d) => defenseSpecial(a, d, filter));
    g.cues.push({
      kind: "resolve",
      source: a.source,
      target: index,
      cards: a.cards,
      defense: defs,
      amount: a.atk,
    });
    consume(g, p, cards);
    if (special) {
      log(g, `${p.name}：${special.ability}`);
      const kind = (special.ability || "").startsWith("block")
        ? "block"
        : (special.ability || "").startsWith("bounce")
          ? "bounce"
          : "reflect";
      const cue = {
        kind,
        source: a.source,
        target: index,
        cards: a.cards,
        defense: defs,
        nextTarget: undefined as number | undefined,
      } as const;
      g.cues.push(cue);
      if (kind !== "block" && a.bounces < 32) {
        a.element = element;
        a.target = (special.ability || "").startsWith("bounce")
          ? pick(g, alive(g))
          : a.source;
        Object.assign(cue, { nextTarget: a.target });
        a.source = index;
        a.bounces++;
        g.queue.unshift(a);
      }
      settle(g);
      return;
    }
    if (a.kind === "sell") {
      const seller = g.players[a.tradeOwner ?? a.source];
      const card = seller.hand.find((c) => c.uid === a.tradeCard?.uid);
      if (card) {
        const price = itemById(card.id).price || 0;
        const coins = Math.min(p.cp, price);
        p.cp -= coins;
        const magic = Math.min(p.mp, price - coins);
        p.mp -= magic;
        g.players[a.source].cp += price;
        seller.hand = seller.hand.filter((c) => c.uid !== card.uid);
        receive(g, index, reveal(card));
        g.cues.push({
          kind: "trade",
          source: a.tradeOwner ?? a.source,
          target: index,
          cards: [itemById(card.id)],
          amount: price,
        });
        if (seller !== p) seller.redraw++;
        if (coins + magic < price) hurt(g, index, price - coins - magic);
      }
    } else if (a.kind === "buy") {
      const buyer = g.players[a.source];
      const candidates = p.hand.filter(
        (c) => (itemById(c.id).price || 0) <= buyer.cp,
      );
      if (candidates.length)
        g.queue.unshift({
          ...a,
          kind: "purchase",
          source: index,
          target: a.source,
          tradeOwner: index,
          tradeCard: pick(g, candidates),
        });
      else log(g, `${buyer.name}：没有可购买的神器`);
    } else if (a.kind === "effect") applyEffect(g, a);
    else {
      const defense = defs.reduce((n, d) => n + (d.def || 0), 0);
      const rawDamage = Math.max(0, a.atk - defense);
      const damage = hurt(
        g,
        index,
        Math.max(0, a.atk - defense),
        element === "darkness",
        true,
      );
      for (const d of a.cards) {
        if (damage > 0 && d.ability === "addCurseOnDamage")
          curse(g, p, d.curse!);
        if (
          d.ability === "absorbHP" &&
          (g.players[a.source].hp > 0 || a.source === index)
        ) {
          const source = g.players[a.source],
            before = source.hp;
          source.hp = Math.min(g.rules.maxStat, source.hp + rawDamage);
          if (source.hp > before)
            g.cues.push({
              kind: "heal",
              target: a.source,
              amount: source.hp - before,
              hpAfter: source.hp,
            });
        }
        if (d.ability === "dealSameDamage") hurt(g, a.source, damage);
      }
      for (const d of defs) {
        if (d.ability === "selfCurse" || d.ability === "selfCurseAndRedraw")
          curse(g, p, d.curse!);
        if (d.ability === "selfCurseAndRedraw") {
          g.cues.push({ kind: "redraw", target: index });
          const count = p.hand.length;
          p.hand = [];
          draw(g, index, count, false, true);
        }
        if (damage > 0) {
          if (d.ability === "counterCurse")
            curse(g, g.players[a.source], d.curse!);
          if (d.ability === "counterBoost2xMP") p.mp += damage * 2;
          if (d.ability === "counterTakeCP") {
            const n = Math.min(damage, g.players[a.source].cp);
            g.players[a.source].cp -= n;
            p.cp += n;
          }
          if (d.ability === "counterAtk" || d.ability === "counter2xAtk")
            queueAttack(
              g,
              index,
              d.hitRate !== undefined ? enemies(g, index) : [a.source],
              [{ ...d, atk: damage * (d.ability === "counter2xAtk" ? 2 : 1) }],
            );
        }
      }
      if (p.hp === 0) resolveDeath(g, index);
      if (!damage) g.cues.push({ kind: "safe", target: index });
      if (!damage) log(g, `${p.name}：安全`);
    }
    settle(g);
  }
  function purchase(g: Game, index: number, accept: boolean) {
    const a = g.queue.shift()!;
    const seller = g.players[a.tradeOwner ?? a.source];
    const buyer = g.players[index];
    const card = seller.hand.find((c) => c.uid === a.tradeCard?.uid);
    if (!card) throw new Error("商品已不可用");
    g.cues.push({
      kind: "purchase",
      source: a.source,
      target: index,
      amount: accept ? 1 : 0,
    });
    if (accept) {
      const price = itemById(card.id).price || 0;
      if (buyer.cp < price) throw new Error("CP不足");
      buyer.cp -= price;
      seller.cp += price;
      seller.hand = seller.hand.filter((c) => c.uid !== card.uid);
      receive(g, index, reveal(card));
      g.cues.push({
        kind: "trade",
        source: a.source,
        target: index,
        cards: [itemById(card.id)],
        amount: price,
      });
      seller.redraw++;
      log(g, `${buyer.name} 购买 ${itemById(card.id).name}（¥${price}）`);
    } else log(g, `${buyer.name} 放弃购买`);
    settle(g);
  }
  function reduceGame(state: Game, playerId: string, command: Command): Game {
    const g = structuredClone(state);
    g.cues = [];
    const index = g.players.findIndex((p) => p.id === playerId);
    if (index < 0 || g.players[index].hp <= 0 || g.phase === "ended")
      throw new Error("当前不能行动");
    if (command.type === "surrender") {
      g.players[index].hp = 0;
      log(g, `${g.players[index].name} 放弃游戏`);
      if (!ended(g)) {
        if (g.phase === "defense") {
          // Resolve the existing response queue before advancing its owner's turn.
          // settle also removes every queued target that has left the game.
          settle(g);
        } else if (g.turn === index) finishTurn(g);
      }
      g.revision++;
      return g;
    }
    const expected = g.phase === "defense" ? g.queue[0]?.target : g.turn;
    if (index !== expected) throw new Error("还没有轮到你");
    const involuntary =
      g.phase === "action" && (g.players[index].confused || 0) > 0;
    if (involuntary) {
      g.cues.push({ kind: "confusion", target: index });
      command = confusedCommand(g, index);
      g.players[index].confused!--;
    } else if (command.type === "confused") throw new Error("当前没有混乱状态");
    if (g.phase === "defense") {
      if (g.queue[0].kind === "purchase") {
        if (command.type !== "purchase")
          throw new Error("请选择购买或放弃购买");
        purchase(g, index, command.accept);
      } else {
        if (command.type !== "defend") throw new Error("请先响应当前行动");
        defend(g, index, command);
      }
    } else {
      if (command.type === "play") play(g, index, command);
      else if (command.type === "pray") {
        if (
          g.players[index].hand.some(
            (c) => itemById(c.id).category === "weapons",
          )
        )
          throw new Error("持有武器，无法祈祷");
        g.cues.push({ kind: "pray", target: index });
        draw(g, index, 1);
        log(g, `${g.players[index].name} 祈祷`);
        settle(g);
      } else if (command.type === "discard") {
        const p = g.players[index];
        const { cards, defs } = resolveCards(p, command.cards);
        if (
          !cards.length ||
          cards.some((c) => !p.hand.some((x) => x.uid === c.uid)) ||
          defs.some(
            (d) =>
              d.category === "weapons" ||
              ["revive", "attractDanger"].includes(d.ability || ""),
          )
        )
          throw new Error("不能丢弃这些神器");
        g.cues.push({
          kind: "discard",
          target: index,
          amount: cards.length,
          cards: defs,
          label:
            g.rules.tiebreak > 0 && g.round >= g.rules.tiebreak
              ? "sacrifice"
              : "discard",
        });
        p.hand = p.hand.filter((c) => !command.cards.includes(c.uid));
        if (g.rules.tiebreak > 0 && g.round >= g.rules.tiebreak)
          p.redraw += cards.length;
        settle(g);
      } else throw new Error("当前不在防御阶段");
    }
    g.players.forEach((p) => clamp(g, p));
    g.players.forEach((p, i) => {
      for (const stat of ["mp", "cp"] as const) {
        const label = stat === "mp" ? "MP" : "¥";
        const exchanged = g.cues
          .filter((c) => c.kind === "exchange" && c.target === i)
          .reduce(
            (n, c) => n + (c.after?.[stat] || 0) - (c.before?.[stat] || 0),
            0,
          );
        const already =
          exchanged +
          g.cues
            .filter(
              (c) =>
                c.kind === "resource" && c.target === i && c.label === label,
            )
            .reduce((n, c) => n + (c.amount || 0), 0);
        const delta = p[stat] - state.players[i][stat] - already;
        if (delta)
          g.cues.push({
            kind: "resource",
            target: i,
            amount: delta,
            label: stat === "mp" ? "MP" : "¥",
          });
      }
      const delta = p.hp - state.players[i].hp;
      if (
        delta > 0 &&
        !g.cues.some(
          (c) =>
            c.target === i &&
            (c.kind === "heal" || c.kind === "revive" || c.kind === "exchange"),
        )
      )
        g.cues.push({ kind: "heal", target: i, amount: delta });
    });
    ended(g);
    g.revision++;
    return g;
  }
  function projectGame(g: Game, playerId: string): GameView {
    const self = g.players.findIndex((p) => p.id === playerId);
    return {
      id: g.id,
      cues: g.cues,
      rules: g.rules,
      players: g.players.map((p, i) => {
        const { hand, miracles, redraw, ...publicInfo } = p;
        return {
          ...publicInfo,
          handCount: hand.length,
          miracleCount: miracles.length,
          ...(i === self
            ? {
                hand: hand.map((c) => ({
                  uid: c.uid,
                  id: c.apparentId || c.id,
                })),
                miracles: miracles.map(reveal),
              }
            : {}),
        };
      }),
      turn: g.turn,
      round: g.round,
      revision: g.revision,
      pending: g.queue[0] || null,
      history: g.history,
      phase: g.phase,
      winners: g.winners,
      self,
    };
  }
  function confusedCommand(g: Game, index: number): Command {
    const p = g.players[index],
      available = [...p.hand, ...p.miracles];
    const options = available.filter(
      (c) =>
        !attackSelectionError([itemById(c.id)], p.mp) &&
        (itemById(c.id).ability !== "sell" ||
          p.hand.some((h) => h.uid !== c.uid)),
    );
    if (!options.length) return { type: "pray" };
    const chosen = [pick(g, options)];
    for (const c of available) {
      if (
        c.uid !== chosen[0].uid &&
        !attackSelectionError(
          [...chosen, c].map((c) => itemById(c.id)),
          p.mp,
        ) &&
        random(g) < 0.5
      )
        chosen.push(c);
    }
    const d = itemById(chosen[0].id);
    const targets = ["sell", "buy"].includes(d.ability || "")
      ? alive(g).filter((n) => n !== index)
      : alive(g);
    const command: Extract<Command, { type: "play" }> = {
      type: "play",
      cards: chosen.map((c) => c.uid),
      target: pick(g, targets),
    };
    if (d.ability === "sell")
      command.tradeCard = pick(
        g,
        p.hand.filter((c) => !chosen.some((x) => x.uid === c.uid)),
      ).uid;
    if (d.ability === "exchange") {
      const total = p.hp + p.mp + p.cp,
        max = g.rules.maxStat;
      const minHP = Math.max(0, total - 2 * max);
      const hp =
        minHP + Math.floor(random(g) * (Math.min(total, max) - minHP + 1));
      const low = Math.max(0, total - hp - max),
        high = Math.min(max, total - hp);
      const mp = low + Math.floor(random(g) * (high - low + 1));
      command.exchange = { hp, mp, cp: total - hp - mp };
    }
    return command;
  }
  function botCommand(g: Game, index: number): Command {
    const p = g.players[index];
    if (g.phase === "action" && p.confused) return { type: "confused" };
    if (g.phase === "defense") {
      const a = g.queue[0];
      if (a.kind === "purchase") return { type: "purchase", accept: true };
      const reflect = p.hand.find(
        (c) => itemById(c.id).ability === "reflectAnything",
      );
      if (reflect) return { type: "defend", cards: [reflect.uid] };
      let total = 0;
      const accepted: Card[] = [];
      const defense = p.hand.filter((c) => {
        const d = itemById(c.id);
        if (
          a.kind !== "attack" ||
          !d.def ||
          !canDefend(a.element, d.element || "") ||
          total >= a.atk ||
          defenseError(a, [...accepted, c], p.mp, p.curses)
        )
          return false;
        total += d.def;
        accepted.push(c);
        return true;
      });
      return {
        type: "defend",
        cards: (p.curses.includes("flash") ? defense.slice(0, 1) : defense).map(
          (c) => c.uid,
        ),
      };
    }
    const target = enemies(g, index).sort(
      (a, b) => g.players[a].hp - g.players[b].hp,
    )[0];
    const healing = p.hand.find(
      (c) =>
        itemById(c.id).ability === "boostHP" &&
        (itemById(c.id).cost || 0) <= p.mp,
    );
    if (healing && p.hp < 35)
      return { type: "play", cards: [healing.uid], target: index };
    const attacks = [...p.hand, ...p.miracles]
      .filter((c) => {
        const d = itemById(c.id);
        return !!d.atk && !attackSelectionError([d], p.mp);
      })
      .sort((a, b) => (itemById(b.id).atk || 0) - (itemById(a.id).atk || 0));
    if (attacks.length) {
      const base = attacks[0];
      let cost = itemById(base.id).cost || 0;
      const plus = attacks
        .slice(1)
        .filter((c) => {
          const d = itemById(c.id);
          if (
            d.isPlusAtk &&
            !attackSelectionError([itemById(base.id), d], p.mp) &&
            cost + (d.cost || 0) <= p.mp
          ) {
            cost += d.cost || 0;
            return true;
          }
          return false;
        })
        .slice(0, 2);
      return { type: "play", cards: [base, ...plus].map((c) => c.uid), target };
    }
    const support = p.hand.find((c) => {
      const d = itemById(c.id);
      return (
        !!effects[d.ability || ""] &&
        !attackSelectionError([d], p.mp) &&
        d.category !== "armor" &&
        (d.cost || 0) <= p.mp
      );
    });
    if (support) return { type: "play", cards: [support.uid], target: index };
    if (!p.hand.some((c) => itemById(c.id).category === "weapons"))
      return { type: "pray" };
    return { type: "surrender" };
  }

  return {
    random,
    combineElements,
    effects,
    createGame,
    reduceGame,
    projectGame,
    botCommand,
  };
}
export const {
  random,
  combineElements,
  effects,
  createGame,
  reduceGame,
  projectGame,
  botCommand,
} = createEngine();
