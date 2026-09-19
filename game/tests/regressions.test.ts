import test from "node:test";
import assert from "node:assert/strict";
import { createGame, reduceGame } from "../shared/engine";

test("cost-reducing weapon still occupies the primary weapon slot", () => {
  const game = createGame(
    [
      { id: "a", name: "A", team: 0, bot: false },
      { id: "b", name: "B", team: 0, bot: false },
    ],
    {},
    1,
  );
  game.turn = 0;
  game.players[0].hand = [
    { uid: "one", id: "spiritual-staff" },
    { uid: "two", id: "kusarigama" },
  ];
  // Use a catalog-backed ordinary weapon so the check exercises combination validation.
  game.players[0].hand[1].id = "god-sword";
  assert.throws(
    () =>
      reduceGame(game, "a", { type: "play", cards: ["one", "two"], target: 1 }),
    /组合/,
  );
});
