import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  reduceGame,
  effects,
  projectGame,
  botCommand,
} from "../shared/engine";
import { itemById, items } from "../shared/catalog";
import { attackSelectionError } from "../shared/actions";
import { defenseSpecial } from "../shared/defense";

function game(count = 3) {
  const g = createGame(
    Array.from({ length: count }, (_, i) => ({
      id: String(i),
      name: String(i),
      team: 0,
      bot: false,
    })),
    { guardianChance: 0, diseaseChance: 0 },
    45,
  );
  g.turn = 0;
  g.players.forEach((p) => {
    p.hand = [];
    p.miracles = [];
    p.redraw = 0;
  });
  return g;
}
test("dangerous pestle consumes the mortar and deals 99 before a normal defense prompt", () => {
  const g = game();
  g.players[0].hand = [{ uid: "p", id: "dangerous-pestle" }];
  g.players[2].hand = [{ uid: "m", id: "dangerous-mortar" }];
  const next = reduceGame(g, "0", { type: "play", cards: ["p"], target: 1 });
  assert.equal(next.players[2].hp, 0);
  assert.equal(next.players[1].hp, 50);
  assert.ok(!next.players[2].hand.some((c) => c.uid === "m"));
  assert.ok(next.cues.some((c) => c.kind === "resolve" && c.target === 2));
});
test("dying bow resolves before the last survivor is declared winner", () => {
  const g = game(2);
  g.players[0].hand = [{ uid: "s", id: "wonder-sword" }];
  g.players[1].hand = [{ uid: "b", id: "ascension-bow" }];
  g.players[0].hp = 1;
  g.players[1].hp = 1;
  g.players[0].curses = ["darkcloud"];
  let next = reduceGame(g, "0", { type: "play", cards: ["s"], target: 1 });
  next = reduceGame(next, "1", { type: "defend", cards: [] });
  assert.equal(next.phase, "defense");
  assert.equal(next.queue[0].atk, 30);
  assert.equal(next.queue[0].source, 1);
  next = reduceGame(next, "0", { type: "defend", cards: [] });
  assert.equal(next.phase, "ended");
  assert.deepEqual(next.winners, []);
});
test("guardians cannot be assigned to two living players", () => {
  const g = game(9);
  for (let repeat = 0; repeat < 20; repeat++) {
    effects.setGuardianOfEverybody(g, 0, 0, itemById("solar-eclipse"));
    assert.equal(new Set(g.players.map((p) => p.guardian)).size, 9);
  }
});
test("fog redirects among enemies and never selects the user or an ally", () => {
  for (let seed = 1; seed < 40; seed++) {
    const g = game(4);
    g.seed = seed;
    g.players[0].team = 1;
    g.players[1].team = 1;
    g.players[0].curses = ["fog"];
    g.players[0].hand = [{ uid: "s", id: "wonder-sword" }];
    const next = reduceGame(g, "0", { type: "play", cards: ["s"], target: 2 });
    assert.ok([2, 3].includes(next.queue[0].target));
  }
});
test("confusion accumulates three actions and does not take over defense or purchases", () => {
  const g = game();
  effects.confuseEverybody(g, 0, 0, itemById("mushroom-outbreak"));
  effects.confuseEverybody(g, 0, 0, itemById("mushroom-outbreak"));
  assert.equal(g.players[0].confused, 6);
  g.players[0].hand = [{ uid: "s", id: "wonder-sword" }];
  assert.deepEqual(botCommand(g, 0), { type: "confused" });
  const next = reduceGame(g, "0", { type: "confused" });
  assert.equal(next.players[0].confused, 5);
  assert.equal(next.phase, "defense");
  const defender = next.queue[0].target;
  assert.equal(botCommand(next, defender).type, "defend");
});
test("dream disguises are stable and private, and curing dream reveals real identities", () => {
  const g = game();
  g.players[0].curses = ["dream"];
  let next = g;
  for (let n = 0; n < 40; n++) effects.addItem(next, 0, 0, itemById("drop"));
  assert.ok(next.players[0].hand.some((c) => c.apparentId));
  const view = projectGame(next, "0");
  for (const card of next.players[0].hand) {
    const shown = view.players[0].hand!.find((c) => c.uid === card.uid)!;
    assert.equal(shown.id, card.apparentId || card.id);
    assert.ok(!("apparentId" in shown));
  }
  assert.equal(projectGame(next, "1").players[0].hand, undefined);
  effects.removeAllCurses(next, 0, 0, itemById("drop"));
  assert.ok(next.players[0].hand.every((c) => !c.apparentId));
});
test("every actively usable catalog entry completes its response chain", () => {
  for (const item of items.filter(
    (i) => !!i.giftRate && !attackSelectionError([i], 99),
  )) {
    let g = game();
    g.players[0].mp = 99;
    g.players[0].hand = [
      { uid: "test", id: item.imageName },
      { uid: "goods", id: "iron-shield" },
    ];
    g.players[1].hand = [{ uid: "target-goods", id: "iron-shield" }];
    const command = {
      type: "play" as const,
      cards: ["test"],
      target: 1,
      ...(item.ability === "exchange"
        ? { exchange: { hp: 50, mp: 99, cp: 20 } }
        : {}),
      ...(item.ability === "sell" ? { tradeCard: "goods" } : {}),
    };
    assert.doesNotThrow(() => {
      g = reduceGame(g, "0", command);
      for (let n = 0; g.phase === "defense" && n < 100; n++) {
        const who = g.queue[0].target;
        g = reduceGame(
          g,
          g.players[who].id,
          g.queue[0].kind === "purchase"
            ? { type: "purchase", accept: true }
            : { type: "defend", cards: [] },
        );
      }
    }, item.imageName);
    assert.notEqual(g.phase, "defense", item.imageName);
    for (const p of g.players)
      for (const stat of [p.hp, p.mp, p.cp])
        assert.ok(stat >= 0 && stat <= 99, item.imageName);
  }
});
test("self absorption resolves healing before death and does not consume an amulet", () => {
  let g = game();
  g.players[0].hp = 1;
  const sword = items.find((i) => i.ability === "absorbHP")!;
  g.players[0].hand = [
    { uid: "s", id: sword.imageName },
    { uid: "a", id: "sun-amulet" },
  ];
  g = reduceGame(g, "0", { type: "play", cards: ["s"], target: 0 });
  g = reduceGame(g, "0", { type: "defend", cards: [] });
  assert.equal(g.players[0].hp, sword.atk);
  assert.ok(g.players[0].hand.some((c) => c.uid === "a"));
  assert.ok(!g.cues.some((c) => c.kind === "death" || c.kind === "revive"));
});
test("hand overflow removes an existing card while accepting the incoming card", () => {
  const g = game();
  g.players[0].hand = Array.from({ length: 18 }, (_, i) => ({
    uid: `old-${i}`,
    id: "iron-shield",
  }));
  effects.addItem(g, 0, 0, itemById("drop"));
  assert.equal(g.players[0].hand.length, 18);
  assert.equal(
    g.players[0].hand.filter((c) => c.uid.startsWith("old-")).length,
    17,
  );
  assert.ok(g.cues.some((c) => c.kind === "draw"));
});
test("afterglow replaces existing disease without causing a heaven death", () => {
  const g = game();
  g.players[0].curses = ["heaven"];
  const phenomenon = items.find(
    (i) => i.category === "phenomena" && i.curse === "fever",
  )!;
  effects.setCurseOfEverybody(g, 0, 0, phenomenon);
  assert.deepEqual(g.players[0].curses, ["fever"]);
  assert.equal(g.players[0].hp, 50);
});
test("guardian and phenomenon actions are neither weapons nor miracles unless explicitly classified", () => {
  const g = game();
  const mirror = items.find((i) => i.ability === "reflectMiracle")!;
  const sword = items.find((i) => i.ability === "reflectWeapon")!;
  const superMirror = itemById("super-mirror");
  for (const d of items.filter(
    (i) => ["guardians", "phenomena"].includes(i.category) && !!i.atk,
  )) {
    const a = {
      source: 0,
      target: 1,
      cards: [d],
      atk: d.atk!,
      element: "" as const,
      miracle: false,
      kind: "attack" as const,
      bounces: 0,
    };
    assert.equal(defenseSpecial(a, mirror, true), false, d.imageName);
    assert.equal(
      defenseSpecial(a, sword, true),
      d.ability === "categoryWeapons",
      d.imageName,
    );
    assert.equal(defenseSpecial(a, superMirror, true), true, d.imageName);
  }
});
test("an area miss is presented only after preceding targets finish responding", () => {
  let g = game();
  g.phase = "defense";
  const action = {
    source: 0,
    target: 1,
    cards: [itemById("wonder-sword")],
    atk: 10,
    element: "" as const,
    miracle: false,
    kind: "attack" as const,
    bounces: 0,
  };
  g.queue = [action, { ...action, target: 2, kind: "miss" }];
  g = reduceGame(g, "1", { type: "defend", cards: [] });
  assert.ok(
    g.cues.findIndex((c) => c.kind === "damage") <
      g.cues.findIndex((c) => c.kind === "miss"),
  );
  assert.equal(g.phase, "action");
});
test("dream hat redraw still occurs before lethal damage is finalized", () => {
  let g = game();
  g.phase = "defense";
  g.players[1].hp = 1;
  const hat = items.find((i) => i.ability === "selfCurseAndRedraw")!;
  g.players[1].hand = [
    { uid: "hat", id: hat.imageName },
    ...Array.from({ length: 3 }, (_, i) => ({
      uid: `old-${i}`,
      id: "iron-shield",
    })),
  ];
  g.queue = [
    {
      source: 0,
      target: 1,
      cards: [itemById("wonder-sword")],
      atk: 99,
      element: "",
      miracle: false,
      kind: "attack",
      bounces: 0,
    },
  ];
  g = reduceGame(g, "1", { type: "defend", cards: ["hat"] });
  assert.ok(
    g.cues.some((c) => c.kind === "draw" && c.target === 1 && c.amount === 3),
  );
  assert.ok(!g.players[1].hand.some((c) => c.uid.startsWith("old-")));
});
