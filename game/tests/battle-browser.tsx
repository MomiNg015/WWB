import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Battle } from "../src/App";
import { createGame, projectGame, reduceGame } from "../shared/engine";
import { items, itemById } from "../shared/catalog";
import "../src/game.css";
function fixture(mode: string) {
  const g = createGame(
    [
      { id: "a", name: "攻击方", team: 0, bot: false },
      { id: "b", name: "防守方", team: 0, bot: false },
    ],
    { guardianChance: 0 },
    42,
  );
  g.id = mode;
  g.turn = 0;
  g.phase = "defense";
  g.players.forEach((p) => {
    p.hand = [];
    p.miracles = [];
    p.redraw = 0;
  });
  const reflect = items.find((i) => i.ability === "bounceWeapon")!;
  const filter = items.find((i) => i.ability === "filterAtkElement")!;
  const ids = [
    "iron-shield",
    "god-shield",
    "super-mirror",
    reflect.imageName,
    "wonder-sword",
    filter.imageName,
    "mars-ring",
  ];
  g.players[1].hand = ids.map((id, i) => ({ id, uid: `test-${i}` }));
  g.queue = [
    {
      source: 0,
      target: 1,
      cards: [itemById("wonder-sword")],
      atk: 10,
      element: mode === "光攻击" ? "light" : "",
      miracle: false,
      kind: "attack",
      bounces: 0,
    },
  ];
  g.cues = [];
  if (mode === "购买决定") {
    g.players[1].hand = [{ uid: "goods", id: "iron-shield" }];
    g.queue = [
      {
        source: 1,
        target: 0,
        cards: [itemById("buy")],
        atk: 0,
        element: "",
        miracle: false,
        kind: "purchase",
        bounces: 0,
        tradeOwner: 1,
        tradeCard: g.players[1].hand[0],
      },
    ];
  }
  if (mode === "复活结算") {
    g.players[1].hp = 2;
    g.players[1].hand = [{ uid: "amulet", id: "sun-amulet" }];
  }
  if (mode === "组合规则" || mode === "零MP组合") {
    g.phase = "action";
    g.queue = [];
    g.players[0].mp = mode === "零MP组合" ? 0 : 20;
    g.players[0].hand = [
      "wonder-sword",
      "crossbow",
      "aura",
      "ice",
      "spiritual-staff",
      "spiritual-doll",
    ].map((id, n) => ({ id, uid: `combo-${n}` }));
  }
  return g;
}
function Harness() {
  const [g, set] = useState(() => fixture("普通攻击"));
  const [error, err] = useState("");
  return (
    <>
      <div style={{ padding: 12 }}>
        <button
          onClick={() => {
            set(fixture("普通攻击"));
            err("");
          }}
        >
          普通攻击
        </button>
        <button
          onClick={() => {
            set(fixture("光攻击"));
            err("");
          }}
        >
          光攻击
        </button>
        <output>{error}</output>
        {["组合规则", "零MP组合", "购买决定", "复活结算"].map((mode) => (
          <button
            key={mode}
            onClick={() => {
              set(fixture(mode));
              err("");
            }}
          >
            {mode}
          </button>
        ))}
      </div>
      <main className="game-frame">
        <div className="scene scene-room">
          <Battle
            key={g.id}
            game={projectGame(
              g,
              g.id.includes("组合") || g.id === "购买决定" ? "a" : "b",
            )}
            command={(c) => {
              try {
                set(
                  reduceGame(
                    g,
                    g.id.includes("组合") || g.id === "购买决定" ? "a" : "b",
                    c,
                  ),
                );
              } catch (e) {
                err(String(e));
              }
            }}
            onFinish={() => {}}
            onNotice={err}
          />
        </div>
      </main>
    </>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<Harness />);
import.meta.hot?.dispose(() => root.unmount());
