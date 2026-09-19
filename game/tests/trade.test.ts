import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  reduceGame,
  projectGame,
  botCommand,
} from "../shared/engine";
import { items, itemById } from "../shared/catalog";
import type { Game } from "../shared/types";

function fixture(ability: string): Game {
  const g = createGame(
    ["a", "b", "c"].map((id) => ({ id, name: id, team: 0, bot: false })),
    { guardianChance: 0, diseaseChance: 0 },
    17,
  );
  g.turn = 0;
  g.players.forEach((p) => {
    p.hand = [];
    p.miracles = [];
    p.redraw = 0;
  });
  g.players[0].hand = [
    { uid: "trade", id: items.find((i) => i.ability === ability)!.imageName },
  ];
  g.players[1].hand = [{ uid: "goods", id: "iron-shield" }];
  return g;
}
function offer() {
  const g = reduceGame(fixture("buy"), "a", {
    type: "play",
    cards: ["trade"],
    target: 1,
  });
  return reduceGame(g, "b", { type: "defend", cards: [] });
}
test("buy reveals an offer to its buyer without moving the item or charging either player", () => {
  const g = offer();
  assert.equal(g.queue[0].kind, "purchase");
  assert.equal(g.queue[0].target, 0);
  assert.equal(g.players[0].cp, 20);
  assert.equal(g.players[1].cp, 20);
  assert.ok(g.players[1].hand.some((c) => c.uid === "goods"));
  assert.equal(projectGame(g, "a").pending?.tradeCard?.id, "iron-shield");
  assert.throws(() => reduceGame(g, "b", { type: "purchase", accept: true }));
  assert.throws(() => reduceGame(g, "a", { type: "defend", cards: [] }));
  assert.deepEqual(botCommand(g, 0), { type: "purchase", accept: true });
});
test("buyer can accept or decline the same immutable offer", () => {
  const g = offer(),
    price = itemById("iron-shield").price!;
  const yes = reduceGame(g, "a", { type: "purchase", accept: true });
  assert.equal(yes.players[0].cp, 20 - price);
  assert.equal(yes.players[1].cp, 20 + price);
  assert.ok(yes.players[0].hand.some((c) => c.uid === "goods"));
  assert.ok(!yes.players[1].hand.some((c) => c.uid === "goods"));
  const no = reduceGame(g, "a", { type: "purchase", accept: false });
  assert.equal(no.players[0].cp, 20);
  assert.ok(no.players[1].hand.some((c) => c.uid === "goods"));
  assert.equal(no.phase, "action");
});
test("sale payment consumes CP, then MP, then HP, crediting the full price", () => {
  let g = fixture("sell");
  const goods = items.find(
    (i) => i.category === "weapons" && (i.price || 0) > 12,
  )!;
  g.players[0].hand.push({ uid: "goods", id: goods.imageName });
  g.players[1].hand = [];
  g.players[1].cp = 2;
  g.players[1].mp = 3;
  g = reduceGame(g, "a", {
    type: "play",
    cards: ["trade"],
    target: 1,
    tradeCard: "goods",
  });
  g = reduceGame(g, "b", { type: "defend", cards: [] });
  assert.equal(g.players[1].cp, 0);
  assert.equal(g.players[1].mp, 0);
  assert.equal(g.players[1].hp, 50 - (goods.price! - 5));
  assert.equal(g.players[0].cp, 20 + goods.price!);
  assert.ok(g.players[1].hand.some((c) => c.uid === "goods"));
});
test("a reflected sale retains its original merchandise ownership", () => {
  let g = fixture("sell");
  g.players[0].hand.push({ uid: "goods", id: "iron-shield" });
  g.players[1].hand = [
    {
      uid: "mirror",
      id: items.find((i) => i.ability === "reflectAnything")!.imageName,
    },
  ];
  g = reduceGame(g, "a", {
    type: "play",
    cards: ["trade"],
    target: 1,
    tradeCard: "goods",
  });
  g = reduceGame(g, "b", { type: "defend", cards: ["mirror"] });
  g = reduceGame(g, "a", { type: "defend", cards: [] });
  assert.equal(
    g.players.flatMap((p) => p.hand).filter((c) => c.uid === "goods").length,
    1,
  );
  assert.equal(g.players[1].cp, 20 + itemById("iron-shield").price!);
});
test("an amulet received through a lethal forced sale is available to revive its buyer", () => {
  let g = fixture("sell");
  g.players[0].hand.push({ uid: "amulet", id: "sun-amulet" });
  g.players[1].hand = [];
  g.players[1].hp = 1;
  g.players[1].mp = 0;
  g.players[1].cp = 0;
  g = reduceGame(g, "a", {
    type: "play",
    cards: ["trade"],
    target: 1,
    tradeCard: "amulet",
  });
  g = reduceGame(g, "b", { type: "defend", cards: [] });
  assert.equal(g.players[1].hp, 10);
  assert.ok(g.cues.some((c) => c.kind === "revive" && c.target === 1));
});
