import test from "node:test";
import assert from "node:assert/strict";
import { createGame, reduceGame, botCommand, effects } from "../shared/engine";
import { itemById } from "../shared/catalog";

test("nine-player games with guardians, confusion and early devils preserve state invariants", () => {
  for (let seed = 1; seed <= 30; seed++) {
    let g = createGame(
      Array.from({ length: 9 }, (_, n) => ({
        id: String(n),
        name: String(n),
        team: 0,
        bot: true,
      })),
      { tiebreak: 1 },
      seed,
    );
    effects.setGuardianOfEverybody(g, 0, 0, itemById("solar-eclipse"));
    effects.confuseEverybody(g, 0, 0, itemById("mushroom-outbreak"));
    let commands = 0;
    for (; g.phase !== "ended" && commands < 3000; commands++) {
      const actor = g.phase === "defense" ? g.queue[0].target : g.turn;
      assert.ok(g.players[actor].hp > 0, `seed ${seed}, actor ${actor}`);
      g = reduceGame(g, g.players[actor].id, botCommand(g, actor));
      const cards = g.players.flatMap((p) => [...p.hand, ...p.miracles]);
      assert.equal(
        new Set(cards.map((c) => c.uid)).size,
        cards.length,
        `duplicate card, seed ${seed}`,
      );
      for (const p of g.players) {
        for (const value of [p.hp, p.mp, p.cp])
          assert.ok(
            Number.isInteger(value) && value >= 0 && value <= g.rules.maxStat,
          );
        assert.ok(
          p.hand.length <= g.rules.maxHandSize,
          `overflow, seed ${seed}`,
        );
      }
      if (g.phase === "defense") assert.ok(g.queue.length > 0);
    }
    assert.equal(
      g.phase,
      "ended",
      `seed ${seed} stalled after ${commands} commands`,
    );
  }
});
