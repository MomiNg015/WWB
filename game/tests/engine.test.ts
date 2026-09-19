import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  reduceGame,
  projectGame,
  canDefend,
  combineElements,
  botCommand,
} from "../shared/engine";
import { items } from "../shared/catalog";
const players = [
  { id: "a", name: "A", team: 0, bot: false },
  { id: "b", name: "B", team: 0, bot: false },
];
function game() {
  const g = createGame(players, { tiebreak: 0 }, 92);
  g.turn = 0;
  g.players.forEach((p) => {
    p.hand = [];
    p.miracles = [];
  });
  return g;
}
function hand(g: ReturnType<typeof game>, n: number, ...ids: string[]) {
  g.players[n].hand = ids.map((id, i) => ({ uid: `${n}-${i}`, id }));
}
test("official draw weights total 500 and ids are unique", () => {
  assert.equal(
    items.reduce((n, i) => n + (i.giftRate || 0), 0),
    500,
  );
  assert.equal(new Set(items.map((i) => i.imageName)).size, 296);
});
test("same seed gives identical initial game and 9 cards", () => {
  assert.deepEqual(createGame(players, {}, 42), createGame(players, {}, 42));
  assert.equal(createGame(players, {}, 42).players[0].hand.length, 9);
});
test("public projection excludes opponent hands and random seed", () => {
  const g = createGame(players, {}, 1);
  const v = projectGame(g, "a");
  assert.equal(v.players[1].hand, undefined);
  assert.equal(v.players[1].miracles, undefined);
  assert.equal("seed" in v, false);
  assert.equal(v.players[0].hand?.length, 9);
});
test("out of turn rejected without mutation", () => {
  const g = game(),
    before = structuredClone(g);
  assert.throws(() => reduceGame(g, "b", { type: "pray" }));
  assert.deepEqual(g, before);
});
test("foreign and duplicate cards rejected", () => {
  const g = game();
  hand(g, 0, "wonder-sword");
  for (const cards of [["bad"], ["0-0", "0-0"]])
    assert.throws(() => reduceGame(g, "a", { type: "play", cards, target: 1 }));
});
test("element defense table and light mixing", () => {
  assert.equal(canDefend("fire", "water"), true);
  assert.equal(canDefend("fire", "fire"), false);
  assert.equal(canDefend("light", "light"), false);
  assert.equal(canDefend("darkness", ""), true);
  assert.equal(canDefend("wood", "light"), true);
  assert.equal(combineElements(["fire", "light"]), "fire");
  assert.equal(combineElements(["fire", "water"]), "");
});
test("attack waits for defender and subtracts defense", () => {
  let g = game();
  hand(g, 0, "wonder-sword");
  hand(g, 1, "iron-shield");
  g = reduceGame(g, "a", { type: "play", cards: ["0-0"], target: 1 });
  assert.equal(g.phase, "defense");
  assert.equal(g.players[1].hp, 50);
  g = reduceGame(g, "b", { type: "defend", cards: ["1-0"] });
  assert.equal(g.players[1].hp, 44);
  assert.equal(g.turn, 1);
  assert.equal(g.players[0].hand.length, 1);
});
test("dark damage kills even with partial protection", () => {
  let g = game();
  hand(g, 0, "darkness");
  hand(g, 1, "iron-shield");
  g = reduceGame(g, "a", { type: "play", cards: ["0-0"], target: 1 });
  g = reduceGame(g, "b", { type: "defend", cards: ["1-0"] });
  assert.equal(g.players[1].hp, 0);
  assert.equal(g.phase, "ended");
  assert.deepEqual(g.winners, ["a"]);
});
test("miracle moves to reusable collection and costs MP", () => {
  let g = game();
  hand(g, 0, "ice");
  g = reduceGame(g, "a", { type: "play", cards: ["0-0"], target: 1 });
  assert.equal(g.players[0].mp, 8);
  assert.equal(g.players[0].miracles[0].id, "ice");
  assert.equal(g.players[0].hand.length, 0);
});
test("insufficient MP rolls back whole action", () => {
  const g = game();
  hand(g, 0, "ice");
  g.players[0].mp = 0;
  assert.throws(
    () => reduceGame(g, "a", { type: "play", cards: ["0-0"], target: 1 }),
    /MP/,
  );
  assert.equal(g.players[0].hand.length, 1);
});
test("cannot pray while holding weapon", () => {
  const g = game();
  hand(g, 0, "wonder-sword");
  assert.throws(() => reduceGame(g, "a", { type: "pray" }));
});
test("prayer draws one and advances turn", () => {
  let g = game();
  g = reduceGame(g, "a", { type: "pray" });
  assert.equal(g.players[0].hand.length, 1);
  assert.equal(g.turn, 1);
});
test("two base attacks forbidden, plus attacks legal", () => {
  let g = game();
  hand(g, 0, "wonder-sword", "crossbow", "hatchet");
  assert.throws(() =>
    reduceGame(g, "a", { type: "play", cards: ["0-0", "0-2"], target: 1 }),
  );
  g = reduceGame(g, "a", { type: "play", cards: ["0-0", "0-1"], target: 1 });
  assert.equal(g.queue[0].atk, 12);
});
test("super mirror sends action back into defense queue", () => {
  let g = game();
  hand(g, 0, "wonder-sword");
  hand(g, 1, "super-mirror");
  g = reduceGame(g, "a", { type: "play", cards: ["0-0"], target: 1 });
  g = reduceGame(g, "b", { type: "defend", cards: ["1-0"] });
  assert.equal(g.queue[0].target, 0);
  assert.equal(g.players[1].hp, 50);
  g = reduceGame(g, "a", { type: "defend", cards: [] });
  assert.equal(g.players[0].hp, 40);
});
test("exchange conserves resource sum", () => {
  let g = game();
  hand(g, 0, "exchange");
  assert.throws(() =>
    reduceGame(g, "a", {
      type: "play",
      cards: ["0-0"],
      target: 0,
      exchange: { hp: 99, mp: 99, cp: 99 },
    }),
  );
  g = reduceGame(g, "a", {
    type: "play",
    cards: ["0-0"],
    target: 0,
    exchange: { hp: 60, mp: 10, cp: 10 },
  });
  assert.equal(g.players[0].hp, 60);
});
test("flash allows only one defense card", () => {
  let g = game();
  hand(g, 0, "wonder-sword");
  hand(g, 1, "iron-shield", "iron-shield");
  g.players[1].curses = ["flash"];
  g = reduceGame(g, "a", { type: "play", cards: ["0-0"], target: 1 });
  assert.throws(() =>
    reduceGame(g, "b", { type: "defend", cards: ["1-0", "1-1"] }),
  );
});
test("surrender results in correct winner", () => {
  const g = reduceGame(game(), "a", { type: "surrender" });
  assert.equal(g.phase, "ended");
  assert.deepEqual(g.winners, ["b"]);
});
test("deterministic bot games complete without invalid state", () => {
  for (let seed = 1; seed <= 100; seed++) {
    let g = createGame(
      players.map((p) => ({ ...p, bot: true })),
      { tiebreak: 50 },
      seed,
    );
    for (let n = 0; n < 1500 && g.phase !== "ended"; n++) {
      const actor = g.phase === "defense" ? g.queue[0].target : g.turn;
      const cmd = botCommand(g, actor);
      g = reduceGame(g, g.players[actor].id, cmd);
      for (const p of g.players) {
        assert.ok(p.hp >= 0 && p.mp >= 0 && p.cp >= 0);
        assert.equal(new Set(p.hand.map((c) => c.uid)).size, p.hand.length);
      }
    }
    assert.equal(g.phase, "ended", `seed ${seed} did not finish`);
  }
});
