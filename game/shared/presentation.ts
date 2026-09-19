import type { BattleCue } from "./types";
// Timings from the public client's A.fl / A.ig animation implementations.
export const cueDuration = (cue: BattleCue): number => {
  switch (cue.kind) {
    case "launch":
      return Math.max(1, cue.cards?.length || 0) * 500;
    case "resolve":
      return Math.max(1, cue.defense?.length || 0) * 500;
    case "draw":
      return (cue.amount || 0) * 250;
    case "resource":
      return (cue.amount || 0) > 0 ? 1000 : 0;
    case "guardianAttack":
      return 500;
    case "guardianLeave":
    case "revive":
      return 1500;
    case "removeCurse":
      return 2000;
    case "trade":
      return 1750;
    case "purchase":
      return cue.amount ? 500 : 1000;
    case "redraw":
      return 2000;
    case "hit":
      return 750;
    case "exchange":
      return 2500;
    case "phenomenon":
      return 4000;
    case "devil":
      return (
        500 +
        (cue.cards?.[0]?.ability === "dealDamage"
          ? 500 + (cue.amount || 0) * 25
          : 1500)
      );
    case "disease":
      return 750;
    case "upgradeDisease":
    case "upgradeHeaven":
      return 2000;
    case "damage":
      return cue.label === "dark" ? 1750 : 1000;
    case "miss":
      return 750;
    case "reflect":
    case "bounce":
    case "curse":
      return 1750;
    case "death":
    case "guardian":
      return 3000;
    default:
      return 1000;
  }
};
export const playbackDuration = (cues: BattleCue[]) =>
  cues.reduce((sum, c) => sum + cueDuration(c), 0) + 500;
