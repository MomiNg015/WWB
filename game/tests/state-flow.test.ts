import test from "node:test";
import assert from "node:assert/strict";
import { createGame, reduceGame } from "../shared/engine";
import { itemById, items } from "../shared/catalog";
import type { Game } from "../shared/types";

function fixture(): Game {
  const g = createGame(
    ["a", "b", "c"].map((id) => ({ id, name: id, team: 0, bot: false })),
    { guardianChance: 0, diseaseChance: 0 },
    98,
  );
  g.turn = 0;
  g.players.forEach((p) => {
    p.hand = [];
    p.miracles = [];
    p.redraw = 0;
  });
  g.phase = "defense";
  g.queue = [1, 2].map((target) => ({
    source: 0,
    target,
    cards: [itemById("wonder-sword")],
    atk: 10,
    element: "",
    miracle: false,
    kind: "attack",
    bounces: 0,
  }));
  return g;
}

test("attacker surrender preserves the pending defender before advancing the turn", () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const next = reduceGame(original, "a", { type: "surrender" });
  assert.deepEqual(original, snapshot, "reducer must not mutate its input");
  assert.equal(next.phase, "defense");
  assert.equal(next.queue[0].target, 1);
  assert.equal(next.turn, 0);
  const second = reduceGame(next, "b", { type: "defend", cards: [] });
  assert.equal(second.players[1].hp, 40);
  assert.equal(second.queue[0].target, 2);
  const final = reduceGame(second, "c", { type: "defend", cards: [] });
  assert.equal(final.phase, "action");
  assert.equal(final.turn, 1);
});

test("surrender removes future actions targeting a dead player without skipping the current response", () => {
  const next = reduceGame(fixture(), "c", { type: "surrender" });
  assert.equal(next.phase, "defense");
  assert.deepEqual(
    next.queue.map((a) => a.target),
    [1],
  );
});

test("invalid defense is atomic even though resolution removes a queued action internally", () => {
  const g = fixture();
  g.players[1].hand = [{ uid: "shield", id: "iron-shield" }];
  const before = structuredClone(g);
  assert.throws(() =>
    reduceGame(g, "b", { type: "defend", cards: ["shield", "shield"] }),
  );
  assert.deepEqual(g, before);
  const next = reduceGame(g, "b", { type: "defend", cards: ["shield"] });
  assert.equal(next.players[1].hp, 44);
  assert.equal(next.revision, g.revision + 1);
});

test("guardian response completion skips a turn owner who has surrendered", () => {
  const g = fixture();
  g.resumeAction = true;
  g.queue = g.queue.slice(0, 1);
  g.queue[0].source = 2;
  const next = reduceGame(g, "a", { type: "surrender" });
  const final = reduceGame(next, "b", { type: "defend", cards: [] });
  assert.equal(final.phase, "action");
  assert.equal(final.turn, 1);
  assert.ok(final.players[final.turn].hp > 0);
});

test("heaven disease reducing HP to zero uses the same revival path as lethal damage", () => {
  const g = fixture();
  g.phase = "action";
  g.queue = [];
  g.rules.diseaseChance = 1;
  g.players[0].curses = ["heaven"];
  const revive = items.find((i) => i.ability === "revive")!;
  g.players[0].hand = [{ uid: "revival", id: revive.imageName }];
  const next = reduceGame(g, "a", { type: "pray" });
  assert.equal(next.players[0].hp, revive.abilityValue);
  assert.ok(next.cues.some((c) => c.kind === "revive" && c.target === 0));
  assert.ok(!next.players[0].hand.some((c) => c.uid === "revival"));
  assert.equal(next.players[0].redraw, 0);
});

test("heaven disease without revival emits death and skips the deceased player", () => {
  const g = fixture();
  g.phase = "action";
  g.queue = [];
  g.rules.diseaseChance = 1;
  g.players[0].curses = ["heaven"];
  // Discard a known non-revival card to avoid a random prayer draw before the disease.
  g.players[0].hand = [{ uid: "shield", id: "iron-shield" }];
  const next = reduceGame(g, "a", { type: "discard", cards: ["shield"] });
  assert.equal(next.players[0].hp, 0);
  assert.ok(next.cues.some((c) => c.kind === "death" && c.target === 0));
  assert.equal(next.turn, 1);
});
