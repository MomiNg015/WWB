import test from "node:test";
import assert from "node:assert/strict";
import { createGame, reduceGame, projectGame } from "../shared/engine";
import { defenseError } from "../shared/defense";
import { items } from "../shared/catalog";
import type { Action, Card } from "../shared/types";
const card = (id: string, n = 0): Card => ({ uid: `${id}-${n}`, id });
const attack = (element: Action["element"] = "", miracle = false): Action => ({
  source: 0,
  target: 1,
  cards: [],
  atk: 10,
  element,
  miracle,
  kind: "attack",
  bounces: 0,
});
function setup(defenders: string[], element: Action["element"] = "") {
  const g = createGame(
    [
      { id: "a", name: "A", team: 0, bot: false },
      { id: "b", name: "B", team: 0, bot: false },
    ],
    { guardianChance: 0, diseaseChance: 0 },
    34,
  );
  g.turn = 0;
  g.phase = "defense";
  g.queue = [attack(element)];
  g.players.forEach((p) => {
    p.hand = [];
    p.redraw = 0;
    p.miracles = [];
  });
  g.players[1].hand = defenders.map(card);
  return g;
}
test("client/server defense restrictions agree for every item and element", () => {
  for (const element of [
    "",
    "fire",
    "water",
    "wood",
    "stone",
    "light",
    "darkness",
  ] as const) {
    for (const item of items) {
      const g = setup([item.imageName], element);
      const error = defenseError(g.queue[0], g.players[1].hand, 10, []);
      if (error)
        assert.throws(
          () =>
            reduceGame(g, "b", {
              type: "defend",
              cards: [g.players[1].hand[0].uid],
            }),
          item.imageName,
        );
      else
        assert.doesNotThrow(
          () =>
            reduceGame(g, "b", {
              type: "defend",
              cards: [g.players[1].hand[0].uid],
            }),
          item.imageName,
        );
    }
  }
});
test("filter unlocks ordinary armor against light; removing filter invalidates it", () => {
  const filter = items.find((i) => i.ability === "filterAtkElement")!;
  const a = attack("light");
  assert.ok(defenseError(a, [card("iron-shield")], 10, []));
  assert.equal(
    defenseError(a, [card(filter.imageName), card("iron-shield")], 10, []),
    null,
  );
  assert.ok(
    defenseError(a, [card(filter.imageName), card("iron-shield")], 10, [
      "flash",
    ]),
  );
});
test("counter rings obey defense element and do not stop miracles as generic shields", () => {
  assert.ok(defenseError(attack("fire"), [card("mars-ring")], 10, []));
  assert.equal(
    defenseError(attack("water"), [card("mars-ring")], 10, []),
    null,
  );
  assert.ok(
    defenseError(
      { ...attack("", true), kind: "effect" },
      [card("iron-shield")],
      10,
      [],
    ),
  );
});
test("resolution events preserve defense, actual damage, draws and safe outcome", () => {
  let g = setup(["iron-shield"]);
  g = reduceGame(g, "b", { type: "defend", cards: [g.players[1].hand[0].uid] });
  assert.equal(g.players[1].hp, 44);
  assert.deepEqual(
    g.cues.slice(0, 2).map((c) => c.kind),
    ["resolve", "damage"],
  );
  assert.equal(g.cues[0].defense?.[0].imageName, "iron-shield");
  assert.ok(g.cues.some((c) => c.kind === "draw" && c.target === 1));
  g = setup(["god-shield"]);
  g = reduceGame(g, "b", { type: "defend", cards: [g.players[1].hand[0].uid] });
  assert.ok(g.cues.some((c) => c.kind === "safe"));
  assert.equal(g.players[1].hp, 50);
});
test("reflection event shows redirected target without skipping response", () => {
  let g = setup(["super-mirror"]);
  g = reduceGame(g, "b", { type: "defend", cards: [g.players[1].hand[0].uid] });
  assert.equal(g.phase, "defense");
  assert.equal(g.queue[0].target, 0);
  assert.equal(g.cues.find((c) => c.kind === "reflect")?.nextTarget, 0);
  assert.ok(!g.cues.some((c) => c.kind === "damage"));
});
test("draw presentation cannot leak private identities", () => {
  let g = setup(["iron-shield"]);
  g = reduceGame(g, "b", { type: "defend", cards: [g.players[1].hand[0].uid] });
  const publicGame = projectGame(g, "a");
  for (const cue of publicGame.cues.filter((c) => c.kind === "draw"))
    assert.equal(cue.cards, undefined);
  assert.equal(publicGame.players[1].hand, undefined);
});
test("dark damage reports actual HP lost and revival draws a replacement", () => {
  let g = setup([], "darkness");
  g = reduceGame(g, "b", { type: "defend", cards: [] });
  assert.equal(g.cues.find((c) => c.kind === "damage")?.amount, 50);
  const revive = items.find((i) => i.ability === "revive")!;
  g = setup([revive.imageName], "darkness");
  g = reduceGame(g, "b", { type: "defend", cards: [] });
  assert.ok(g.players[1].hp > 0);
  assert.equal(g.players[1].hand.length, 1);
  assert.ok(g.cues.some((c) => c.kind === "revive"));
  const revealIndex = g.cues.findIndex((c) => c.kind === "revive");
  const recovery = g.cues[revealIndex + 1];
  assert.equal(recovery.kind, "heal");
  assert.equal(recovery.hpAfter, 10);
});
test("unused miracles can be sold while used miracles remain outside trade", () => {
  const miracle = items.find((i) => i.category === "miracles")!;
  let g = setup([]);
  g.phase = "action";
  g.queue = [];
  g.players[0].hand = [card("sell"), card(miracle.imageName)];
  g = reduceGame(g, "a", {
    type: "play",
    cards: [card("sell").uid],
    target: 1,
    tradeCard: card(miracle.imageName).uid,
  });
  assert.equal(g.queue[0].tradeCard?.id, miracle.imageName);
  g = setup([]);
  g.phase = "action";
  g.queue = [];
  g.players[0].hand = [card("sell")];
  g.players[0].miracles = [card(miracle.imageName)];
  assert.throws(() =>
    reduceGame(g, "a", {
      type: "play",
      cards: [card("sell").uid],
      target: 1,
      tradeCard: card(miracle.imageName).uid,
    }),
  );
});
test("guardian response does not consume the newly started turn", () => {
  let g = setup([]);
  g.rules.guardianChance = 1;
  g.rules.guardianLeaveChance = 0;
  g.players[1].guardian = "mars";
  g = reduceGame(g, "b", { type: "defend", cards: [] });
  assert.equal(g.turn, 1);
  assert.ok(g.cues.some((c) => c.kind === "guardianAttack"));
  while (g.phase === "defense")
    g = reduceGame(g, g.players[g.queue[0].target].id, {
      type: "defend",
      cards: [],
    });
  assert.equal(g.turn, 1);
  assert.equal(g.phase, "action");
});
