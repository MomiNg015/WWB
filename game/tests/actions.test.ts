import test from "node:test";
import assert from "node:assert/strict";
import { createGame, reduceGame } from "../shared/engine";
import { itemById } from "../shared/catalog";
import {
  actionCost,
  attackProfile,
  attackSelectionError,
} from "../shared/actions";
import { defenseError } from "../shared/defense";

const defs = (...ids: string[]) => ids.map(itemById);
function fixture(ids: string[], mp = 20) {
  const g = createGame(
    ["a", "b"].map((id) => ({ id, name: id, team: 0, bot: false })),
    { guardianChance: 0, diseaseChance: 0 },
    98,
  );
  g.turn = 0;
  g.players[0].mp = mp;
  g.players[0].hand = ids.map((id, n) => ({ id, uid: `c-${n}` }));
  g.players[0].miracles = [];
  g.players[1].hand = [];
  return g;
}
function play(ids: string[], mp = 20) {
  const g = fixture(ids, mp);
  return reduceGame(g, "a", {
    type: "play",
    cards: g.players[0].hand.map((c) => c.uid),
    target: 1,
  });
}

test("ordered attack arithmetic matches the public client's tw helper", () => {
  assert.equal(play(["wonder-sword", "aura", "crossbow"]).queue[0].atk, 22);
  assert.equal(play(["wonder-sword", "crossbow", "aura"]).queue[0].atk, 24);
  assert.equal(play(["wonder-sword", "aura", "aura"]).queue[0].atk, 40);
});
test("element setters override in selection order, with subsequent elements still mixed", () => {
  assert.equal(
    play(["wonder-sword", "wand-of-ignition", "wand-of-mystic-water"]).queue[0]
      .element,
    "water",
  );
  assert.equal(
    play(["wonder-sword", "wand-of-mystic-water", "wand-of-ignition"]).queue[0]
      .element,
    "fire",
  );
  assert.equal(
    play(["wonder-sword", "wand-of-ignition", "crossbow"]).queue[0].element,
    "",
  );
});
test("a spiritual companion discounts only the immediately preceding miracle", () => {
  const g = play(["wonder-sword", "aura", "spiritual-doll", "aura"], 6);
  assert.equal(g.players[0].mp, 0);
  assert.equal(g.queue[0].atk, 40);
  assert.equal(actionCost(defs("aura", "spiritual-doll", "aura")), 6);
  assert.throws(
    () => play(["wonder-sword", "aura", "spiritual-doll", "aura"], 0),
    /MP/,
  );
});
test("spiritual weapons are companions after miracles and contribute no attack in that role", () => {
  const g = play(["ice", "spiritual-staff"], 0);
  assert.equal(g.players[0].mp, 0);
  assert.equal(g.queue[0].atk, 4);
  assert.equal(g.queue[0].element, "water");
  assert.equal(g.queue[0].miracle, true);
  assert.equal(g.players[0].miracles.length, 1);
});
test("the leading artifact determines weapon versus miracle response category", () => {
  assert.equal(play(["wonder-sword", "aura"]).queue[0].miracle, false);
});
test("unsupported sequence rejected atomically: miracle or area weapon plus attack", () => {
  for (const ids of [
    ["ice", "crossbow"],
    ["ascension-bow", "crossbow"],
    ["aura"],
    ["spiritual-doll"],
  ]) {
    const g = fixture(ids);
    const before = structuredClone(g);
    assert.throws(() =>
      reduceGame(g, "a", {
        type: "play",
        cards: g.players[0].hand.map((c) => c.uid),
        target: 1,
      }),
    );
    assert.deepEqual(g, before);
  }
});
test("shared preview produces the authoritative attack for legal sequences", () => {
  for (const ids of [
    ["wonder-sword", "aura", "crossbow"],
    ["ice", "spiritual-staff"],
    ["wonder-sword", "wand-of-ignition"],
  ]) {
    const cards = defs(...ids);
    assert.equal(attackSelectionError(cards, 20), null);
    const actual = play(ids);
    const predicted = attackProfile(cards, 20 - actionCost(cards));
    assert.equal(actual.queue[0].atk, predicted.atk);
    assert.equal(actual.queue[0].element, predicted.element);
  }
});

test("filter plus reflection keeps the cleared element for the next defender", () => {
  let g = play(["wonder-sword", "wand-of-ignition"]);
  // Catalog lookup keeps this fixture tied to the real filter artifact.
  const filterId = "rainbow-curtain";
  g.players[1].hand = [
    { uid: "f", id: filterId },
    { uid: "r", id: "super-mirror" },
  ];
  g = reduceGame(g, "b", { type: "defend", cards: ["f", "r"] });
  assert.equal(g.queue[0].element, "");
  assert.equal(g.queue[0].target, 0);
});
test("special defense cannot stack with ordinary armor in either order", () => {
  const g = play(["wonder-sword"]);
  const shield = { uid: "s", id: "iron-shield" },
    mirror = { uid: "m", id: "super-mirror" };
  assert.ok(defenseError(g.queue[0], [shield, mirror], 10, []));
  assert.ok(defenseError(g.queue[0], [mirror, shield], 10, []));
});
